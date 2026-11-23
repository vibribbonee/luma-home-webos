package com.gathin.tvhome;

import android.content.Context;
import android.content.SharedPreferences;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;
import android.os.SystemClock;
import android.util.Log;
import android.view.ContextThemeWrapper;
import android.view.InputDevice;
import android.view.KeyEvent;
import android.widget.Toast;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

import java.util.HashSet;
import java.util.HashMap;
import java.util.Map;
import java.util.Set;

import static com.gathin.tvhome.LumaSocket.json;

/** Keeps room controls available while another Streamer app is in front. */
final class LumaRemoteOverlay {
    private static final String TAG = "LumaRemote";
    static final String PREFS = "luma-native";
    static final String ENABLED = "hold-home-controls";
    static final String LG_REMOTE_NAVIGATION = "lg-remote-navigation";

    private final Context context;
    private final LumaSocket socket = new LumaSocket();
    private final Handler main = new Handler(Looper.getMainLooper());
    private final LumaRoomControls controls;
    private final LumaMedia media;
    private final SharedPreferences credentials;
    private final SharedPreferences.OnSharedPreferenceChangeListener changed = (store, key) -> reload();
    private JSONObject local = json();
    private JSONObject shared = json();
    private boolean streamerOnly;
    private String address, token, tv;
    private int port;
    private boolean connecting;
    private boolean pendingControls;
    private String connectionStatus = "Starting";
    private String rendererId = "";
    private boolean relayReady;
    private boolean supportsRendererHeartbeat;
    private final Runnable verifyRegistration = this::verifyRegistration;
    private String registrationFailure = "";
    private boolean webosQuickActive;
    private boolean webosHoldConfirm;
    private boolean webosNativeTarget;
    private long lastNativeKey;
    private final SharedPreferences options;
    private final Set<Integer> relayedKeys = new HashSet<>();
    private final Map<Integer, Long> confirmations = new HashMap<>();
    private final Runnable reconnect = this::connect;
    private final Runnable controlsTimeout;

    LumaRemoteOverlay(HomeKeyService service) {
        context = service;
        controlsTimeout = () -> {
            pendingControls = false;
            Toast.makeText(context, "Room controls could not connect to Home Assistant.", Toast.LENGTH_SHORT).show();
        };
        options = service.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
        ContextThemeWrapper theme = new ContextThemeWrapper(service, R.style.Theme_TvHome);
        media = new LumaMedia(theme, true);
        controls = new LumaRoomControls(theme, socket, true, state -> media.showCamera(address, token,
                json("camera", state.optString("entity_id"), "title", LumaRoomControls.entityLabel(state))));
        media.observeRoomControls(controls);
        credentials = service.getSharedPreferences("lumax", Context.MODE_PRIVATE);
        credentials.registerOnSharedPreferenceChangeListener(changed);
        reload();
    }

    private void reload() {
        local = parse(new LumaPreferences(credentials).get());
        String selected = local.optString("tv");
        String nextTv = "standalone".equals(selected) ? "" : selected;
        String nextAddress = local.optString("url");
        String nextToken = local.optString("token");
        int nextPort = local.optInt("input", 1);
        if (nextTv.equals(tv) && nextAddress.equals(address) && nextToken.equals(token) && nextPort == port) return;
        tv = nextTv;
        address = nextAddress;
        token = nextToken;
        port = nextPort;
        JSONObject cached = parse(context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getString("catalog", "{}"));
        shared = tv.equals(cached.optString("tv_id")) ? settings(cached) : json();
        streamerOnly = tv.equals(cached.optString("tv_id")) && cached.optBoolean("streamer_only");
        controls.close();
        media.close();
        media.closeNotification();
        connect();
    }

    private void connect() {
        main.removeCallbacks(reconnect);
        main.removeCallbacks(verifyRegistration);
        webosQuickActive = false;
        webosHoldConfirm = false;
        webosNativeTarget = false;
        rendererId = "";
        relayReady = false;
        socket.close();
        connecting = false;
        if (token.isEmpty() || address.isEmpty()) return;
        connecting = true;
        connectionStatus = "Connecting";
        socket.open(address, token, () -> {
            connecting = false;
            connectionStatus = "Connected";
            if (tv.isEmpty()) {
                openPendingControls();
                return;
            }
            socket.request("luma_home/config/get", json("tv_id", tv), initial -> {
                if (!(initial instanceof JSONObject)) { retryRegistration("Luma Home room not ready"); return; }
                receiveConfig(initial);
                socket.subscribe("luma_home/config/subscribe", json("tv_id", tv), result -> {
                    if (result == null) retryRegistration("Room configuration not ready");
                }, this::receiveConfig);
                subscribe();
                if (!paired()) { relayReady = true; openPendingControls(); return; }
                socket.subscribe("luma_home/quick/subscribe", json("tv_id", tv, "role", "streamer"), result -> {
                    relayReady = result != null;
                    if (!relayReady) retryRegistration("LG key relay not ready");
                    else openPendingControls();
                }, event -> {
                    if (event.has("active")) {
                        webosQuickActive = event.optBoolean("active");
                        webosHoldConfirm = webosQuickActive && event.optBoolean("hold_confirm");
                        Log.d(TAG, webosQuickActive ? "LG panel opened" : "LG panel released remote");
                    }
                    if (event.has("native_target")) {
                        webosNativeTarget = event.optBoolean("native_target");
                        if (webosNativeTarget) controls.close();
                    }
                });
            });
        }, reason -> {
            connectionStatus = reason;
            connecting = false;
            webosQuickActive = false;
            webosHoldConfirm = false;
            webosNativeTarget = false;
            controls.close();
            media.close();
            media.closeNotification();
            if ("Home Assistant is offline.".equals(reason)) main.postDelayed(reconnect, 5000);
        });
    }

    private void receiveConfig(Object value) {
        if (!(value instanceof JSONObject)) { retryRegistration("Luma Home room not ready"); return; }
        JSONObject snapshot = (JSONObject) value;
        if (!tv.equals(snapshot.optString("tv_id"))) return;
        int previous = streamerInput();
        boolean wasPaired = paired();
        boolean wasStreamerOnly = streamerOnly;
        shared = settings(snapshot);
        supportsRendererHeartbeat = snapshot.optBoolean("overlay_keepalive");
        if (supportsRendererHeartbeat && !rendererId.isEmpty()) {
            main.removeCallbacks(verifyRegistration);
            main.postDelayed(verifyRegistration, 15000);
        }
        streamerOnly = snapshot.optBoolean("streamer_only");
        boolean routingChanged = streamerInput() != previous || paired() != wasPaired || streamerOnly != wasStreamerOnly;
        if (routingChanged && !rendererId.isEmpty()) {
            main.removeCallbacks(reconnect);
            main.post(reconnect);
        }
        else openPendingControls();
    }

    private boolean paired() { return !tv.isEmpty() && shared.optBoolean("lumax_enabled"); }

    private int streamerInput() {
        return paired() ? shared.optInt("lumax_input", 1) : port;
    }

    private void retryRegistration(String reason) {
        registrationFailure = reason;
        main.removeCallbacks(reconnect);
        main.postDelayed(reconnect, 1500);
    }

    private void verifyRegistration() {
        if (!supportsRendererHeartbeat || !socket.isReady() || rendererId.isEmpty()) return;
        socket.request("luma_home/lumax/keepalive", json("tv_id", tv, "renderer", rendererId), result -> {
            if (!(result instanceof JSONObject) || !((JSONObject) result).optBoolean("active"))
                retryRegistration("Overlay registration expired");
        });
        main.postDelayed(verifyRegistration, 15000);
    }

    private void subscribe() {
        JSONObject registration = json("tv_id", tv, "streamer_input", streamerInput());
        if (supportsRendererHeartbeat) LumaSocket.put(registration, "background", true);
        socket.subscribe("luma_home/lumax/subscribe", registration, result -> {
            rendererId = result instanceof JSONObject ? ((JSONObject) result).optString("renderer") : "";
            if (rendererId.isEmpty()) retryRegistration("Overlay receiver not ready");
            else {
                registrationFailure = "";
                openPendingControls();
                if (supportsRendererHeartbeat) {
                    main.removeCallbacks(verifyRegistration);
                    main.postDelayed(verifyRegistration, 15000);
                }
            }
        }, event -> {
            if (!(paired() || streamerOnly) || rendererId.isEmpty()) return;
            String kind = event.optString("kind");
            switch (kind) {
                case "quick":
                case "notification":
                case "voice":
                    break;
                case "camera":
                    if (!LumaMedia.validCamera(event)) return;
                    break;
                case "announcement":
                    if (!LumaAnnouncement.valid(event)) return;
                    break;
                case "dismiss":
                    if (!media.hasOverlay() && !controls.isShowing()) return;
                    break;
                default:
                    return;
            }
            socket.request("luma_home/lumax/ack", json("tv_id", tv, "renderer", rendererId, "nonce", event.optString("nonce")), result -> {
                if (!(result instanceof JSONObject) || !((JSONObject) result).optBoolean("accepted")) return;
                switch (kind) {
                    case "quick": show(); break;
                    case "camera": media.showCamera(address, token, event); break;
                    case "dismiss": media.close(); controls.close(); break;
                    case "notification": media.showNotification(event); break;
                    case "announcement": media.showAnnouncement(socket, address, event); break;
                    case "voice": media.showForwardedVoice(address, event); break;
                }
            });
        });
    }

    String diagnostics() { return "connection=" + connectionStatus + ", ready=" + socket.isReady() + ", paired=" + paired() + ", lgPanel=" + webosQuickActive + ", controls=" + controls.isShowing() + ", receiverRegistered=" + !rendererId.isEmpty() + ", relayRegistered=" + relayReady + ", registrationFailure=" + registrationFailure; }

    boolean tapOpensHome() { return !paired() || shared.optBoolean("home_swap", true); }

    boolean relayKey(KeyEvent event) {
        int code = event.getKeyCode();
        if (event.getAction() == KeyEvent.ACTION_UP) {
            Long started = confirmations.remove(code);
            if (started != null && webosQuickActive && socket.isReady() && !event.isCanceled()) {
                sendKey(event.getEventTime() - started >= 650 ? "ok_hold" : "ok", false);
            }
            return relayedKeys.remove(code);
        }
        InputDevice device = event.getDevice();
        boolean nativeNavigation = !webosQuickActive && webosNativeTarget
                && options.getBoolean(LG_REMOTE_NAVIGATION, false) && isRemote(device);
        if (event.getAction() != KeyEvent.ACTION_DOWN || !paired() || !socket.isReady()
                || !(webosQuickActive || nativeNavigation)) {
            return relayedKeys.contains(code);
        }
        String key;
        switch (code) {
            case KeyEvent.KEYCODE_DPAD_UP: key = "up"; break;
            case KeyEvent.KEYCODE_DPAD_DOWN: key = "down"; break;
            case KeyEvent.KEYCODE_DPAD_LEFT: key = "left"; break;
            case KeyEvent.KEYCODE_DPAD_RIGHT: key = "right"; break;
            case KeyEvent.KEYCODE_DPAD_CENTER:
            case KeyEvent.KEYCODE_ENTER: key = "ok"; break;
            case KeyEvent.KEYCODE_BACK: key = "back"; break;
            case KeyEvent.KEYCODE_HOME:
                if (!webosQuickActive) return false;
                key = "close";
                break;
            default: return false;
        }
        if (event.getRepeatCount() > 0 && !relayedKeys.contains(code)) return false;
        relayedKeys.add(code);
        if (webosHoldConfirm && "ok".equals(key)) {
            if (event.getRepeatCount() == 0) confirmations.put(code, event.getEventTime());
            return true;
        }
        boolean direction = code >= KeyEvent.KEYCODE_DPAD_UP && code <= KeyEvent.KEYCODE_DPAD_RIGHT;
        long now = SystemClock.elapsedRealtime();
        if (event.getRepeatCount() == 0 || direction && (!nativeNavigation || now - lastNativeKey >= 120)) {
            if (nativeNavigation) lastNativeKey = now;
            sendKey(key, nativeNavigation);
        }
        return true;
    }

    private static boolean isRemote(InputDevice device) {
        if (device == null || !device.supportsSource(InputDevice.SOURCE_DPAD)
                || device.supportsSource(InputDevice.SOURCE_GAMEPAD)) return false;
        return Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q ? device.isExternal() : device.getVendorId() != 0;
    }

    private void sendKey(String key, boolean nativeNavigation) {
        JSONObject request = json("tv_id", tv, "key", key);
        if (nativeNavigation) LumaSocket.put(request, "native", true);
        socket.request("luma_home/quick/key", request, result -> {
            boolean accepted = result instanceof JSONObject && ((JSONObject) result).optBoolean("accepted");
            Log.d(TAG, "LG relay " + key + (accepted ? " delivered" : " unavailable"));
            if (!accepted && !nativeNavigation) webosQuickActive = false;
        });
    }

    boolean closeControls() {
        if (pendingControls) {
            pendingControls = false;
            main.removeCallbacks(controlsTimeout);
            return true;
        }
        if (!controls.isShowing()) return false;
        controls.close();
        return true;
    }

    void openHome(Runnable localHome) {
        if (paired() && socket.isReady()) route("home", localHome);
        else localHome.run();
    }

    void showControls() {
        if (!socket.isReady() || paired() && (rendererId.isEmpty() || !relayReady)) {
            if (token.isEmpty()) {
                Toast.makeText(context, "Connect Home Assistant first.", Toast.LENGTH_SHORT).show();
                return;
            }
            pendingControls = true;
            main.removeCallbacks(controlsTimeout);
            main.postDelayed(controlsTimeout, 6500);
            if (!connecting) connect();
            Log.d(TAG, "Room controls waiting for Home Assistant");
        } else if (paired()) route("quick", this::show);
        else show();
    }

    private void openPendingControls() {
        if (!pendingControls) return;
        if (paired() && (rendererId.isEmpty() || !relayReady)) return;
        pendingControls = false;
        main.removeCallbacks(controlsTimeout);
        showControls();
    }

    void assist() {
        media.startAssist(socket, address, token, tv, shared);
    }

    private void route(String view, Runnable fallback) {
        socket.request("call_service", json("domain", "luma_home", "service", "open",
                "service_data", json("tv_id", tv, "view", view)), result -> {
            if (result != null) return;
            fallback.run();
        });
    }

    private void show() {
        JSONArray ids = tv.isEmpty() ? local.optJSONArray("controls") : shared.optJSONArray("controls");
        controls.show(tv, ids == null ? new JSONArray() : ids, tv.isEmpty() ? local : shared);
    }

    void close() {
        pendingControls = false;
        credentials.unregisterOnSharedPreferenceChangeListener(changed);
        main.removeCallbacksAndMessages(null);
        controls.close();
        media.close();
        media.closeNotification();
        socket.close();
    }

    private static JSONObject settings(JSONObject snapshot) {
        JSONObject value = snapshot.optJSONObject("settings");
        return value == null ? json() : value;
    }

    private static JSONObject parse(String value) {
        try { return new JSONObject(value); } catch (JSONException invalid) { return json(); }
    }
}

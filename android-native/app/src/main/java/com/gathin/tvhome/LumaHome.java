package com.gathin.tvhome;

import android.app.AlertDialog;
import android.app.role.RoleManager;
import android.os.Build;
import android.content.ActivityNotFoundException;
import android.content.ComponentName;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.graphics.drawable.Drawable;
import android.os.Handler;
import android.provider.Settings;
import android.text.InputType;
import android.view.View;
import android.view.Window;
import android.view.WindowManager;
import android.widget.EditText;
import android.widget.LinearLayout;
import android.widget.TextView;
import android.widget.Toast;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

import java.text.NumberFormat;
import java.util.ArrayList;
import java.util.List;
import java.util.LinkedHashSet;
import java.util.function.Consumer;

import static com.gathin.tvhome.LumaRoomControls.controlService;
import static com.gathin.tvhome.LumaRoomControls.entityLabel;
import static com.gathin.tvhome.LumaSocket.json;
import static com.gathin.tvhome.LumaSocket.put;

/** Supplies Home Assistant tiles and readings to the native launcher. */
final class LumaHome {
    static final String REMOTE = "dev.lumax.remote.";
    private static final String[] SENSOR_KEYS = {"temperature", "humidity", "co2"};
    private static final String[] SENSOR_CLASSES = {"temperature", "humidity", "carbon_dioxide"};
    private static final String[] SENSOR_NAMES = {"Temperature", "Humidity", "Carbon dioxide"};
    private static final int[] SENSOR_ICONS = {R.drawable.ic_lumax_temperature, R.drawable.ic_lumax_humidity, R.drawable.ic_lumax_co2};
    private static final long REFRESH_MS = 20000;
    private final MainActivity activity;
    private final Runnable tilesChanged;
    private final LumaSocket socket = new LumaSocket();
    private final Handler main = new Handler(android.os.Looper.getMainLooper());
    private final Runnable refresh = this::refresh;
    private final LumaPreferences credentials;
    private final SharedPreferences cache;
    final LumaTileArt artwork;
    private final LumaMedia media;
    private final LumaRoomControls roomControls;
    private final LinearLayout readings;
    private final TextView[] values = new TextView[SENSOR_KEYS.length];
    private JSONObject preferences;
    private JSONObject config;
    private JSONObject lgIcons;
    private String cachedConfig;
    private String iconVersion, iconTv, iconRequest = "";
    private JSONArray devices = new JSONArray();
    private List<AppAdapter.Entry> tiles = new ArrayList<>();
    private String tileSignature;
    private boolean overlayRequested;
    private boolean configSubscribed;
    private boolean active;
    private String status = "Home Assistant disconnected";

    LumaHome(MainActivity activity, Runnable tilesChanged) {
        this.activity = activity;
        this.tilesChanged = tilesChanged;
        credentials = new LumaPreferences(activity.getSharedPreferences("lumax", 0));
        cache = activity.getSharedPreferences("luma-native", 0);
        artwork = new LumaTileArt(activity, cache, this::reloadArtwork);
        media = new LumaMedia(activity);
        roomControls = new LumaRoomControls(activity, socket, false);
        media.observeRoomControls(roomControls);
        preferences = parse(credentials.get());
        cachedConfig = cache.getString("catalog", "{}");
        config = parse(cachedConfig);
        lgIcons = parse(cache.getString("lg-icons", "{}"));
        iconVersion = cache.getString("lg-icons-version", "");
        iconTv = cache.getString("lg-icons-tv", "");
        readings = activity.findViewById(R.id.lumaClimate);
        for (int i = 0; i < values.length; i++) {
            TextView reading = new TextView(activity);
            reading.setTextColor(0xffe6e7ee);
            reading.setTextSize(14);
            reading.setCompoundDrawablePadding(dp(5));
            reading.setCompoundDrawablesRelativeWithIntrinsicBounds(SENSOR_ICONS[i], 0, 0, 0);
            LinearLayout.LayoutParams layout = new LinearLayout.LayoutParams(-2, -2);
            layout.setMarginEnd(dp(14));
            readings.addView(reading, layout);
            values[i] = reading;
        }
        renderReadings(new JSONArray());
        buildTiles(false);
    }

    List<AppAdapter.Entry> tiles() { return tiles; }

    void resume() {
        active = true;
        if (!preferences.optString("token").isEmpty()) connect();
    }

    void pause() {
        active = false;
        main.removeCallbacksAndMessages(null);
        socket.close();
        media.close();
        media.closeNotification();
        roomControls.close();
    }

    private void connect() {
        iconRequest = "";
        overlayRequested = false;
        configSubscribed = false;
        String address = preferences.optString("url"), token = preferences.optString("token");
        socket.open(address, token, () -> {
            status = "Home Assistant connected";
            socket.request("luma_home/list", json(), result -> {
                devices = array(result);
                if (preferences.optString("tv").isEmpty() && devices.length() == 1) {
                    JSONObject tv = devices.optJSONObject(0);
                    if (tv != null) update("tv", tv.optString("tv_id"));
                }
                subscribeConfig();
                refresh();
            });
        }, reason -> {
            status = reason;
            if (active && reason.equals("Home Assistant is offline.")) main.postDelayed(this::connect, 5000);
        });
    }

    private void refresh() {
        main.removeCallbacks(refresh);
        if (!active || !socket.isReady()) return;
        String tv = preferences.optString("tv");
        if (tv.isEmpty() || "standalone".equals(tv)) {
            boolean configured = false;
            for (String key : SENSOR_KEYS) configured |= !sensor(key).isEmpty();
            if (configured) socket.request("get_states", json(), result -> renderReadings(array(result)));
        } else if (configSubscribed) {
            fetchArtwork(tv);
            refreshPairedReadings(tv);
        }
        else socket.request("luma_home/config/get", json("tv_id", tv), result -> receiveConfig(tv, result));
        main.postDelayed(refresh, REFRESH_MS);
    }

    private void subscribeConfig() {
        String tv = preferences.optString("tv");
        if (tv.isEmpty() || "standalone".equals(tv)) return;
        socket.subscribe("luma_home/config/subscribe", json("tv_id", tv), ignored -> { }, snapshot -> {
            if (!tv.equals(preferences.optString("tv"))) return;
            configSubscribed = true;
            receiveConfig(tv, snapshot);
        });
    }

    private void receiveConfig(String tv, Object snapshot) {
        if (!active || !(snapshot instanceof JSONObject) || !tv.equals(preferences.optString("tv"))) return;
        JSONObject updated = (JSONObject) snapshot;
        if (!tv.equals(updated.optString("tv_id"))) return;
        JSONArray catalog = array(updated.opt("catalog"));
        if (catalog.length() == 0 && !updated.optBoolean("catalog_ready")
                && !updated.optBoolean("streamer_only") && tv.equals(config.optString("tv_id"))) {
            catalog = array(config.opt("catalog"));
            put(updated, "catalog", catalog);
        }
        config = updated;
        String saved = json("tv_id", tv, "entry_id", config.optString("entry_id"), "streamer_only", config.optBoolean("streamer_only"),
                "catalog", catalog, "settings", sharedSettings()).toString();
        if (!saved.equals(cachedConfig)) {
            cachedConfig = saved;
            cache.edit().putString("catalog", saved).apply();
        }
        buildTiles(true);
        fetchArtwork(tv);
        subscribeOverlays(tv);
        refreshPairedReadings(tv);
    }

    private void refreshPairedReadings(String tv) {
        JSONArray ids = new JSONArray();
        for (String key : SENSOR_KEYS) if (!sensor(key).isEmpty()) ids.put(sensor(key));
        if (ids.length() == 0) renderReadings(new JSONArray());
        else socket.request("luma_home/states", json("tv_id", tv, "entity_ids", ids), result -> {
            if (tv.equals(preferences.optString("tv"))) renderReadings(array(result));
        });
    }

    private JSONObject sharedSettings() {
        JSONObject shared = config.optJSONObject("settings");
        return shared == null ? json() : shared;
    }

    private String sensor(String kind) {
        return paired() ? sharedSettings().optString(kind) : preferences.optString("sensor_" + kind);
    }

    private boolean paired() {
        return !config.optString("tv_id").isEmpty() && config.optString("tv_id").equals(preferences.optString("tv"));
    }

    private int streamerPort() {
        JSONObject shared = sharedSettings();
        return shared.optBoolean("lumax_enabled") ? shared.optInt("lumax_input", 1) : preferences.optInt("input", 1);
    }

    private void subscribeOverlays(String tv) {
        if (overlayRequested) return;
        overlayRequested = true;
        String[] renderer = {""};
        socket.subscribe("luma_home/lumax/subscribe", json("tv_id", tv, "streamer_input", streamerPort()), result -> {
            if (result instanceof JSONObject) renderer[0] = ((JSONObject) result).optString("renderer");
        }, event -> {
            if (!active || !paired() || !tv.equals(config.optString("tv_id")) || renderer[0].isEmpty()) return;
            String kind = event.optString("kind");
            if ("dismiss".equals(kind)) {
                if (!media.hasOverlay() && !roomControls.isShowing()) return;
            } else {
                if (!activity.hasWindowFocus() && !media.hasCamera() && !media.hasForwardedVoice()) return;
                if ("camera".equals(kind)) {
                    if (!LumaMedia.validCamera(event)) return;
                } else if ("announcement".equals(kind)) {
                    if (!LumaAnnouncement.valid(event)) return;
                } else if (!"quick".equals(kind) && !"notification".equals(kind) && !"voice".equals(kind)) return;
            }
            socket.request("luma_home/lumax/ack", json("tv_id", tv, "renderer", renderer[0], "nonce", event.optString("nonce")), result -> {
                if (!active || !(result instanceof JSONObject) || !((JSONObject) result).optBoolean("accepted")) return;
                switch (kind) {
                    case "quick": showControls(); break;
                    case "notification": media.showNotification(event); break;
                    case "announcement": media.showAnnouncement(socket, preferences.optString("url"), event); break;
                    case "voice": media.showForwardedVoice(preferences.optString("url"), event); break;
                    case "camera": media.showCamera(preferences.optString("url"), preferences.optString("token"), event); break;
                    case "dismiss": media.close(); roomControls.close(); break;
                }
            });
        });
    }

    private void fetchArtwork(String tv) {
        String version = config.optString("artwork_version");
        if (version.isEmpty() || (tv.equals(iconTv) && version.equals(iconVersion)) || !iconRequest.isEmpty()) return;
        iconRequest = version;
        socket.request("luma_home/catalog/artwork", json("tv_id", tv), result -> {
            iconRequest = "";
            if (!(result instanceof JSONObject) || !tv.equals(preferences.optString("tv"))) return;
            JSONObject response = (JSONObject) result;
            String latestVersion = config.optString("artwork_version");
            String receivedVersion = response.optString("version");
            JSONObject icons = response.optJSONObject("icons");
            if (!latestVersion.equals(receivedVersion) || icons == null) {
                if (!latestVersion.equals(version)) fetchArtwork(tv);
                return;
            }
            lgIcons = icons;
            iconVersion = receivedVersion;
            iconTv = tv;
            cache.edit().putString("lg-icons", lgIcons.toString()).putString("lg-icons-version", iconVersion)
                    .putString("lg-icons-tv", iconTv).apply();
            reloadArtwork();
        });
    }

    private void renderReadings(JSONArray states) {
        boolean shown = false;
        for (int i = 0; i < values.length; i++) {
            TextView target = values[i];
            String value = reading(states, sensor(SENSOR_KEYS[i]), i == 0 ? 1 : 0);
            target.setVisibility(value.isEmpty() ? View.GONE : View.VISIBLE);
            if (!value.isEmpty()) {
                target.setText(value);
                target.setContentDescription(SENSOR_NAMES[i] + " " + value);
                shown = true;
            }
        }
        readings.setVisibility(shown ? View.VISIBLE : View.GONE);
    }

    private static String reading(JSONArray states, String entity, int decimals) {
        if (entity.isEmpty()) return "";
        for (int i = 0; i < states.length(); i++) {
            JSONObject state = states.optJSONObject(i);
            if (state == null || !state.optString("entity_id").equals(entity)) continue;
            double number = state.optDouble("state");
            if (!Double.isFinite(number)) return "";
            NumberFormat format = NumberFormat.getNumberInstance();
            format.setMaximumFractionDigits(decimals);
            JSONObject attributes = state.optJSONObject("attributes");
            String unit = attributes == null ? "" : attributes.optString("unit_of_measurement");
            return format.format(number) + ("%".equals(unit) || unit.isEmpty() ? unit : " " + unit);
        }
        return "";
    }

    private void buildTiles(boolean notify) {
        if (!paired() || config.optBoolean("streamer_only")) {
            if (!tiles.isEmpty()) { tiles = new ArrayList<>(); if (notify) tilesChanged.run(); }
            tileSignature = null;
            return;
        }
        JSONObject shared = sharedSettings();
        JSONArray catalog = array(config.opt("catalog"));
        int port = streamerPort();
        int other = port == 2 ? 1 : 2;
        String inputLabel = shared.optString("hdmi" + other, "HDMI " + other);
        String signature = catalog + "|" + other + "|" + inputLabel + "|" + config.optString("tv_id");
        if (signature.equals(tileSignature)) return;
        tileSignature = signature;
        ArrayList<AppAdapter.Entry> next = new ArrayList<>();
        next.add(tile("input" + other, inputLabel, "input", other, null));
        for (int i = 0; i < catalog.length(); i++) {
            JSONObject app = catalog.optJSONObject(i);
            if (app == null) continue;
            String id = app.optString("id");
            if (!app.optBoolean("visible", true) || !id.matches("[A-Za-z0-9._-]+") || id.startsWith("com.webos.app.hdmi")) continue;
            String icon = iconTv.equals(config.optString("tv_id")) ? lgIcons.optString(id) : null;
            next.add(tile("app." + id, app.optString("title", id), id, 0, icon));
        }
        tiles = next;
        if (notify) tilesChanged.run();
    }

    private AppAdapter.Entry tile(String key, String title, String app, int port, String icon) {
        String pkg = REMOTE + key;
        String label = Cards.cleanLabel(artwork.title(pkg, title), title);
        Drawable art = artwork.picture(pkg, icon);
        Drawable fallback = activity.getDrawable(port != 0 ? R.drawable.ic_input : R.drawable.ic_lumax_tv);
        return new AppAdapter.Entry(AppAdapter.Entry.REMOTE, label, new ComponentName(pkg, "Tile"), art,
                art == null ? fallback : null, null, 0, () -> launch(app, port));
    }

    private void launch(String app, int port) {
        if (!socket.isReady()) { message("Home Assistant is offline."); return; }
        JSONObject service = json("entry_id", config.optString("entry_id"));
        if (port != 0) put(service, "input", port);
        else put(service, "app", app);
        socket.request("call_service", json("domain", "luma_home", "service", port == 0 ? "launch_app" : "select_input",
                "service_data", service), result -> { if (result == null) message("The LG could not open this tile."); });
    }

    private void reloadArtwork() { tileSignature = null; buildTiles(true); }

    private void showSidePanel(AlertDialog.Builder builder) {
        AlertDialog dialog = builder.create();
        Window window = dialog.getWindow();
        if (window != null) LumaPanel.sideSheet(activity, window);
        dialog.show();
        if (window != null) LumaPanel.sideSheet(activity, window);
        if (dialog.getListView() != null) dialog.getListView().setSelector(R.drawable.luma_panel_focus);
    }

    void showSettings() {
        boolean homeShortcut = cache.getBoolean(LumaRemoteOverlay.ENABLED, false);
        boolean reverseLightKeys = LumaRoomControls.reverseLightKeys(activity, sharedSettings());
        boolean redirectGoogleHome = cache.getBoolean(HomeKeyService.REDIRECT_GOOGLE_HOME, true);
        boolean lgNavigation = cache.getBoolean(LumaRemoteOverlay.LG_REMOTE_NAVIGATION, false);
        List<String> rows = new ArrayList<>(java.util.Arrays.asList("Home Assistant address", "Access token", "Luma Home room", "Streamer HDMI port",
                "Temperature sensor", "Humidity sensor", "Carbon dioxide sensor", "Room controls",
                "Disconnect Home Assistant", "Find Home Assistant",
                "Home button shortcuts · " + (homeShortcut ? "On" : "Off"),
                "Adjustable lights · " + (reverseLightKeys ? "Tap toggles, hold adjusts" : "Tap adjusts, hold toggles"),
                "Default assistant and mic button",
                "Use LumaX for Google TV Home · " + (homeShortcut && redirectGoogleHome ? "On" : "Off"),
                activity.getString(R.string.lumax_hidden_apps)));
        boolean linkedToLg = paired() && !config.optBoolean("streamer_only");
        if (linkedToLg) rows.add("LG idle and no signal");
        boolean tapOpensHome = sharedSettings().optBoolean("home_swap", true);
        if (linkedToLg && sharedSettings().optBoolean("lumax_enabled")) {
            rows.add(tapOpensHome ? "Tap Home opens the launcher" : "Tap Home opens Room controls");
            rows.add("Google remote on other LG inputs · " + (lgNavigation ? "On" : "Off"));
        }
        int androidHomeRow = rows.size();
        rows.add("Android Home app");
        showSidePanel(LumaPanel.dialog(activity).setTitle("Settings").setItems(rows.toArray(new String[0]), (dialog, row) -> {
            if (row == androidHomeRow) {
                openAndroidDefaults(Settings.ACTION_HOME_SETTINGS);
                return;
            }
            if (row >= 4 && row <= 6) { chooseSensor(row - 4); return; }
            switch (row) {
                case 0:
                    if (preferences.optString("url").isEmpty()) findHomeAssistant();
                    else editAddress();
                    break;
                case 1: edit(rows.get(row), "", true, value -> {
                    if (preferences.optString("url").isEmpty()) { message("Set the Home Assistant address first."); return; }
                    if (!value.isEmpty() && update("token", value)) connect();
                }); break;
                case 2: chooseTv(); break;
                case 3: LumaPanel.dialog(activity).setTitle(rows.get(row)).setItems(new String[]{"HDMI 1", "HDMI 2"},
                        (d, which) -> { if (update("input", which + 1) && socket.isReady()) connect(); }).show(); break;
                case 7: configureControls(); break;
                case 8:
                    socket.close();
                    main.removeCallbacksAndMessages(null);
                    clearTv();
                    update("token", "");
                    status = "Home Assistant disconnected";
                    break;
                case 9: findHomeAssistant(); break;
                case 10:
                    cache.edit().putBoolean(LumaRemoteOverlay.ENABLED, !homeShortcut).apply();
                    if (!HomeKeyService.applyLumaHomeShortcut() && !homeShortcut) {
                        Intent settings = SystemSettings.intent(activity, Settings.ACTION_ACCESSIBILITY_SETTINGS);
                        if (settings != null) {
                            message("Enable LumaX's Home key helper to use this shortcut.");
                            activity.startActivity(settings);
                        }
                    } else showSettings();
                    break;
                case 11:
                    if (linkedToLg && config.optBoolean("quick_hold_confirm"))
                        saveLgSetting("reverse_light_keys", !reverseLightKeys, this::showSettings);
                    else {
                        cache.edit().putBoolean(LumaRoomControls.REVERSE_LIGHT_KEYS, !reverseLightKeys).apply();
                        showSettings();
                    }
                    break;
                case 12: chooseAssistant(); break;
                case 13:
                    if (!homeShortcut) { message("Enable the LumaX Home key helper first."); return; }
                    cache.edit().putBoolean(HomeKeyService.REDIRECT_GOOGLE_HOME, !redirectGoogleHome).apply();
                    HomeKeyService.applyLumaHomeShortcut();
                    showSettings();
                    break;
                case 14: showHiddenApps(); break;
                case 15: showLgIdleSettings(); break;
                case 16: saveLgSetting("home_swap", !tapOpensHome, this::showSettings); break;
                case 17:
                    cache.edit().putBoolean(LumaRemoteOverlay.LG_REMOTE_NAVIGATION, !lgNavigation).apply();
                    showSettings();
                    break;
            }
        }).setNegativeButton("Close", null));
    }

    private void showLgIdleSettings() {
        JSONObject shared = sharedSettings();
        boolean noSignal = shared.optBoolean("no_signal");
        boolean screensaver = shared.optBoolean("screensaver");
        int idle = shared.optInt("idle");
        String[] choices = {
                "LG launcher idle clock · " + (idle == 0 ? "Off" : idle + " min"),
                "Show LG home when HDMI has no signal · " + (noSignal ? "On" : "Off"),
                "Replace the LG screensaver with the clock · " + (screensaver ? "On" : "Off"),
        };
        showSidePanel(LumaPanel.dialog(activity).setTitle("LG idle and no signal")
                .setItems(choices, (dialog, row) -> {
                    if (row == 0) {
                        int[] delays = {0, 1, 2, 5, 10, 15, 30};
                        String[] labels = {"Off", "1 minute", "2 minutes", "5 minutes", "10 minutes", "15 minutes", "30 minutes"};
                        LumaPanel.dialog(activity).setTitle("LG launcher idle clock")
                                .setItems(labels, (picker, delay) -> saveLgSetting("idle", delays[delay], this::showLgIdleSettings))
                                .setNegativeButton("Back", (picker, button) -> showLgIdleSettings()).show();
                    } else if (row == 1) saveLgSetting("no_signal", !noSignal, this::showLgIdleSettings);
                    else saveLgSetting("screensaver", !screensaver, this::showLgIdleSettings);
                }).setNegativeButton("Back", (dialog, button) -> showSettings()));
    }

    private void saveLgSetting(String key, Object value, Runnable returnToSettings) {
        String tv = preferences.optString("tv");
        socket.request("luma_home/config/set", json("tv_id", tv, "settings", json(key, value)), result -> {
            if (result != null) receiveConfig(tv, result);
            else message("Could not apply the LG setting. Check the TV and Home Assistant connection.");
            if (active) returnToSettings.run();
        });
    }

    private void showHiddenApps() {
        List<String> packages = new ArrayList<>(LibraryApps.loadRemoved(activity));
        if (packages.isEmpty()) {
            message(activity.getString(R.string.lumax_no_hidden_apps));
            showSettings();
            return;
        }
        List<String> names = new ArrayList<>();
        packages.sort(String.CASE_INSENSITIVE_ORDER);
        for (String pkg : packages) {
            String name = null;
            for (AppAdapter.Entry tile : tiles) {
                if (tile.pkg.equals(pkg)) {
                    name = tile.label;
                    break;
                }
            }
            if (name == null) {
                PackageManager pm = activity.getPackageManager();
                try {
                    name = pm.getApplicationLabel(pm.getApplicationInfo(pkg, 0)).toString();
                } catch (PackageManager.NameNotFoundException missing) {
                    name = pkg.startsWith(REMOTE + "app.") ? pkg.substring((REMOTE + "app.").length()) : pkg;
                }
            }
            names.add(activity.getString(R.string.lumax_show_app, name));
        }
        showSidePanel(LumaPanel.dialog(activity).setTitle(R.string.lumax_hidden_apps)
                .setItems(names.toArray(new String[0]), (dialog, selected) -> {
                    if (LibraryApps.restoreShortcut(activity, packages.get(selected))) tilesChanged.run();
                    else message(activity.getString(R.string.library_save_failed));
                    showHiddenApps();
                }).setNegativeButton("Back", (dialog, selected) -> showSettings()));
    }

    private void findHomeAssistant() {
        message("Looking for Home Assistant…");
        new LumaDiscovery(activity, hosts -> {
            if (!active || activity.isFinishing()) return;
            if (hosts.isEmpty()) { editAddress(); return; }
            List<String> labels = new ArrayList<>();
            for (LumaDiscovery.Host host : hosts) labels.add(host.name + "  ·  " + host.address);
            LumaPanel.dialog(activity).setTitle("Choose Home Assistant")
                    .setItems(labels.toArray(new String[0]), (dialog, row) -> saveAddress(hosts.get(row).address))
                    .setNeutralButton("Enter address", (dialog, button) -> editAddress())
                    .setNegativeButton("Cancel", null).show();
        }).start();
    }

    private void editAddress() {
        edit("Home Assistant address", preferences.optString("url"), false, this::saveAddress);
    }

    private void saveAddress(String address) {
        try {
            java.net.URI endpoint = LumaSocket.endpoint(address);
            String normalized = (endpoint.getScheme().equals("wss") ? "https" : "http") + "://" + endpoint.getRawAuthority();
            if (!normalized.equals(preferences.optString("url"))) {
                socket.close();
                main.removeCallbacksAndMessages(null);
                put(preferences, "token", "");
                clearTv();
                status = "Home Assistant disconnected";
            }
            update("url", normalized);
            showSettings();
        } catch (IllegalArgumentException error) { message("Enter a valid Home Assistant address."); }
    }

    private void clearTv() {
        preferences.remove("tv");
        for (String kind : SENSOR_KEYS) preferences.remove("sensor_" + kind);
        config = json();
        cachedConfig = "{}";
        devices = new JSONArray();
        iconVersion = iconTv = iconRequest = "";
        lgIcons = json();
        cache.edit().remove("catalog").remove("lg-icons").remove("lg-icons-version").remove("lg-icons-tv")
                .remove("assist-pipeline").apply();
        buildTiles(true);
        renderReadings(new JSONArray());
    }

    private void chooseTv() {
        List<String> labels = new ArrayList<>(), ids = new ArrayList<>();
        labels.add("Streamer only without a Luma Home room"); ids.add("standalone");
        for (int i = 0; i < devices.length(); i++) {
            JSONObject device = devices.optJSONObject(i);
            if (device == null) continue;
            ids.add(device.optString("tv_id"));
            labels.add(device.optString("name", "Luma Home") + (device.optBoolean("streamer_only") ? " · Streamer" : " · LG TV"));
        }
        LumaPanel.dialog(activity).setTitle("Choose a Luma Home room").setItems(labels.toArray(new String[0]), (dialog, row) -> {
            if (update("tv", ids.get(row))) {
                buildTiles(true);
                renderReadings(new JSONArray());
                connect();
            }
        }).show();
    }

    private void chooseSensor(int index) {
        if (!socket.isReady()) { message("Connect Home Assistant first."); return; }
        socket.request("get_states", json(), result -> {
            if (!active || result == null) return;
            JSONArray states = array(result);
            List<String> labels = new ArrayList<>(), ids = new ArrayList<>();
            labels.add("None"); ids.add("");
            for (int i = 0; i < states.length(); i++) {
                JSONObject state = states.optJSONObject(i);
                JSONObject a = state == null ? null : state.optJSONObject("attributes");
                if (a == null || !SENSOR_CLASSES[index].equals(a.optString("device_class"))) continue;
                String id = state.optString("entity_id");
                labels.add(a.optString("friendly_name", id)); ids.add(id);
            }
            LumaPanel.dialog(activity).setTitle(SENSOR_NAMES[index]).setItems(labels.toArray(new String[0]),
                    (dialog, row) -> {
                        String key = SENSOR_KEYS[index];
                        if (paired()) {
                            socket.request("luma_home/config/set", json("tv_id", preferences.optString("tv"),
                                    "settings", json(key, ids.get(row))), resultConfig -> {
                                if (resultConfig == null) message("Could not save the sensor in Luma Home.");
                                else refresh();
                            });
                        } else if (update("sensor_" + key, ids.get(row))) refresh();
                    }).show();
        });
    }

    private JSONArray controlIds() { return paired() ? array(sharedSettings().opt("controls")) : array(preferences.opt("controls")); }

    boolean hasControls() { return controlIds().length() > 0; }

    void showCameras() {
        if (!socket.isReady()) { message("Connect Home Assistant first."); return; }
        media.chooseCamera(socket, preferences.optString("url"), preferences.optString("token"));
    }

    void showAssist() {
        media.startAssist(socket, preferences.optString("url"), preferences.optString("token"),
                paired() ? preferences.optString("tv") : "", sharedSettings());
    }

    private void chooseAssistant() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            RoleManager roles = activity.getSystemService(RoleManager.class);
            if (roles != null && roles.isRoleAvailable(RoleManager.ROLE_ASSISTANT)
                    && !roles.isRoleHeld(RoleManager.ROLE_ASSISTANT)) {
                Intent choose = roles.createRequestRoleIntent(RoleManager.ROLE_ASSISTANT);
                if (choose.resolveActivity(activity.getPackageManager()) != null) {
                    activity.startActivityForResult(choose, 8943);
                    return;
                }
            }
        }
        openAndroidDefaults(Settings.ACTION_MANAGE_DEFAULT_APPS_SETTINGS);
    }

    private void openAndroidDefaults(String action) {
        try {
            activity.startActivity(SystemSettings.intent(activity, action));
        } catch (ActivityNotFoundException | SecurityException unavailable) {
            message("Open Android Settings → Apps → Default apps to change this setting.");
        }
    }

    private void configureControls() {
        if (!socket.isReady()) { message("Connect Home Assistant first."); return; }
        socket.request("get_states", json(), result -> {
            if (!active || result == null) return;
            JSONArray states = array(result);
            List<String> names = new ArrayList<>(), ids = new ArrayList<>();
            LinkedHashSet<String> selected = new LinkedHashSet<>();
            JSONArray current = controlIds();
            for (int i = 0; i < current.length(); i++) selected.add(current.optString(i));
            for (int i = 0; i < states.length(); i++) {
                JSONObject state = states.optJSONObject(i);
                if (state == null || controlService(state.optString("entity_id")).isEmpty()) continue;
                ids.add(state.optString("entity_id"));
                names.add(entityLabel(state));
            }
            boolean[] checked = new boolean[ids.size()];
            for (int i = 0; i < checked.length; i++) checked[i] = selected.contains(ids.get(i));
            LumaPanel.dialog(activity).setTitle("Room controls")
                    .setMultiChoiceItems(names.toArray(new String[0]), checked, (dialog, row, on) -> {
                        if (on) selected.add(ids.get(row)); else selected.remove(ids.get(row));
                    }).setPositiveButton("Save", (dialog, button) -> saveControls(new JSONArray(selected)))
                    .setNegativeButton("Cancel", null).show();
        });
    }

    private void saveControls(JSONArray ids) {
        if (!paired()) {
            update("controls", ids);
            return;
        }
        String tv = preferences.optString("tv");
        socket.request("luma_home/config/set", json("tv_id", tv, "settings", json("controls", ids)), result -> {
            if (result == null) message("Could not save the shared room controls.");
            else receiveConfig(tv, result);
        });
    }

    void showControls() {
        boolean linked = paired();
        roomControls.show(linked ? preferences.optString("tv") : "", controlIds(),
                linked ? sharedSettings() : preferences);
    }

    void edit(String title, String old, boolean password, Consumer<String> save) {
        EditText field = new EditText(activity);
        field.setSingleLine(true);
        field.setInputType(InputType.TYPE_CLASS_TEXT | (password ? InputType.TYPE_TEXT_VARIATION_PASSWORD : 0));
        field.setText(old);
        AlertDialog dialog = LumaPanel.dialog(activity).setTitle(title).setView(field)
                .setNegativeButton("Cancel", null).setPositiveButton("Save", (d, w) -> save.accept(field.getText().toString().trim())).create();
        if (dialog.getWindow() != null) dialog.getWindow().setSoftInputMode(WindowManager.LayoutParams.SOFT_INPUT_STATE_ALWAYS_VISIBLE);
        dialog.show();
        field.requestFocus();
    }

    private boolean update(String key, Object value) {
        put(preferences, key, value);
        if (credentials.save(preferences.toString())) return true;
        preferences = parse(credentials.get());
        message("Could not save the setting.");
        return false;
    }

    private void message(String text) { Toast.makeText(activity, text, Toast.LENGTH_SHORT).show(); }
    private int dp(int value) { return Math.round(value * activity.getResources().getDisplayMetrics().density); }
    private static JSONArray array(Object value) { return value instanceof JSONArray ? (JSONArray) value : new JSONArray(); }
    private static JSONObject parse(String value) { try { return new JSONObject(value); } catch (JSONException error) { return json(); } }
}

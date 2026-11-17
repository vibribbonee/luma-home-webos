package com.gathin.tvhome;

import android.os.Handler;
import android.os.Looper;

import com.neovisionaries.ws.client.WebSocket;
import com.neovisionaries.ws.client.WebSocketAdapter;
import com.neovisionaries.ws.client.WebSocketException;
import com.neovisionaries.ws.client.WebSocketFactory;
import com.neovisionaries.ws.client.WebSocketFrame;

import org.json.JSONException;
import org.json.JSONObject;

import java.io.IOException;
import java.net.URI;
import java.util.HashMap;
import java.util.Map;
import java.util.function.Consumer;

/** A foreground Home Assistant WebSocket. Listeners and request completions run on the UI thread. */
final class LumaSocket {
    private final Handler main = new Handler(Looper.getMainLooper());
    private final Map<Integer, Consumer<Object>> pending = new HashMap<>();
    private final Map<Integer, Consumer<JSONObject>> subscriptions = new HashMap<>();
    private volatile WebSocket socket;
    private int nextId;
    private boolean ready;

    static URI endpoint(String address) {
        URI uri = URI.create(address.trim());
        String scheme = uri.getScheme();
        if (!("http".equals(scheme) || "https".equals(scheme)) || uri.getHost() == null
                || uri.getUserInfo() != null || uri.getQuery() != null || uri.getFragment() != null
                || !(uri.getPath().isEmpty() || "/".equals(uri.getPath()))) {
            throw new IllegalArgumentException("Enter your Home Assistant base address.");
        }
        return URI.create(("https".equals(scheme) ? "wss" : "ws") + "://" + uri.getRawAuthority() + "/api/websocket");
    }

    void open(String address, String token, Runnable connected, Consumer<String> closed) {
        close();
        try {
            socket = new WebSocketFactory().setConnectionTimeout(5000).createSocket(endpoint(address));
            socket.setPingInterval(20000).addListener(new WebSocketAdapter() {
                @Override public void onTextMessage(WebSocket active, String text) {
                    main.post(() -> {
                        if (active != socket) return;
                        try {
                            JSONObject message = new JSONObject(text);
                            switch (message.optString("type")) {
                                case "auth_required": active.sendText(json("type", "auth", "access_token", token).toString()); break;
                                case "auth_ok": ready = true; connected.run(); break;
                                case "auth_invalid": close(); closed.accept("Home Assistant rejected the token."); break;
                                case "result":
                                    Consumer<Object> callback = pending.remove(message.optInt("id"));
                                    boolean success = message.optBoolean("success");
                                    if (!success) subscriptions.remove(message.optInt("id"));
                                    if (callback != null) callback.accept(success ? message.opt("result") : null);
                                    break;
                                case "event":
                                    Consumer<JSONObject> listener = subscriptions.get(message.optInt("id"));
                                    JSONObject event = message.optJSONObject("event");
                                    if (listener != null && event != null) listener.accept(event);
                                    break;
                            }
                        } catch (JSONException ignored) {
                            // Ignore a malformed response; the individual request will time out.
                        }
                    });
                }

                @Override public void onConnectError(WebSocket active, WebSocketException error) { offline(active); }
                @Override public void onDisconnected(WebSocket active, WebSocketFrame server,
                                                     WebSocketFrame client, boolean byServer) { offline(active); }
                private void offline(WebSocket active) {
                    main.post(() -> {
                        if (active != socket) return;
                        close();
                        closed.accept("Home Assistant is offline.");
                    });
                }
            }).connectAsynchronously();
        } catch (IOException | IllegalArgumentException error) {
            closed.accept("Could not connect to the Home Assistant address.");
        }
    }

    boolean isReady() { return ready; }

    void binary(byte[] bytes) {
        WebSocket active = socket;
        if (active != null && active.isOpen()) active.sendBinary(bytes);
    }

    void request(String type, JSONObject body, Consumer<Object> callback) {
        send(type, body, callback, null);
    }

    void subscribe(String type, JSONObject body, Consumer<Object> callback, Consumer<JSONObject> event) {
        send(type, body, callback, event);
    }

    private void send(String type, JSONObject body, Consumer<Object> callback, Consumer<JSONObject> event) {
        if (!ready) { callback.accept(null); return; }
        int id = ++nextId;
        put(body, "type", type);
        put(body, "id", id);
        pending.put(id, callback);
        if (event != null) subscriptions.put(id, event);
        socket.sendText(body.toString());
        main.postDelayed(() -> {
            Consumer<Object> timedOut = pending.remove(id);
            if (timedOut != null) {
                subscriptions.remove(id);
                timedOut.accept(null);
            }
        }, 6000);
    }

    void close() {
        WebSocket old = socket;
        socket = null;
        ready = false;
        pending.clear();
        subscriptions.clear();
        if (old != null) old.disconnect();
    }

    static JSONObject json(Object... fields) {
        JSONObject object = new JSONObject();
        for (int i = 0; i < fields.length; i += 2) put(object, (String) fields[i], fields[i + 1]);
        return object;
    }

    static void put(JSONObject object, String key, Object value) {
        try { object.put(key, value); } catch (JSONException error) { throw new IllegalArgumentException(error); }
    }
}

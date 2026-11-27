package com.gathin.tvhome;

import android.content.Context;
import android.content.SharedPreferences;
import android.os.Handler;
import android.os.Looper;
import android.util.Log;

import com.neovisionaries.ws.client.WebSocket;
import com.neovisionaries.ws.client.WebSocketAdapter;
import com.neovisionaries.ws.client.WebSocketFactory;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

import java.io.InputStream;
import java.net.DatagramPacket;
import java.net.DatagramSocket;
import java.net.InetAddress;
import java.net.SocketTimeoutException;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.cert.Certificate;
import java.security.cert.X509Certificate;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.LinkedBlockingQueue;
import java.util.concurrent.TimeUnit;
import java.util.function.Consumer;

import javax.net.ssl.SSLContext;
import javax.net.ssl.SSLSession;
import javax.net.ssl.TrustManager;
import javax.net.ssl.X509TrustManager;

/**
 * Talks to the LG TV's own network control API (the "second screen" API that Home Assistant's LG
 * integration also uses), so HDMI switching and app launches keep working while Home Assistant is down.
 *
 * <p>The TV is found on the network by its SSDP identity, never by a fixed IP address, so a DHCP change
 * is followed automatically. The first command shows LG's own "allow this device" prompt on the TV; the
 * key it returns and the TV's certificate fingerprint are kept, and a TV presenting another certificate
 * at the saved identity is refused. The pairing manifest in {@code res/raw/lg_register.json} comes from
 * aiowebostv (Apache License 2.0), the library behind Home Assistant's LG webOS integration.
 *
 * <p>Callbacks run on the UI thread. Each command opens a short connection; nothing stays connected.
 */
final class LgDirect {
    private static final String TAG = "LgDirect";
    private static final String PREFS = "lg_direct";
    private static final String SSDP_ST = "urn:lge-com:service:webos-second-screen:1";
    private static final int PAIR_TIMEOUT_S = 60, REPLY_TIMEOUT_S = 8;
    private static LgDirect instance;

    private final Context context;
    private final SharedPreferences prefs;
    private final Handler main = new Handler(Looper.getMainLooper());
    private final ExecutorService worker = Executors.newSingleThreadExecutor();

    /** Result of a command: ok, or a short message for the person holding the remote. */
    interface Done { void done(boolean ok, String message); }

    static synchronized LgDirect get(Context context) {
        if (instance == null) instance = new LgDirect(context.getApplicationContext());
        return instance;
    }

    private LgDirect(Context context) {
        this.context = context;
        this.prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }

    boolean enabled() { return prefs.getBoolean("enabled", true); }
    void setEnabled(boolean on) { prefs.edit().putBoolean("enabled", on).apply(); }
    boolean paired() { return !prefs.getString("client_key", "").isEmpty() && !prefs.getString("uuid", "").isEmpty(); }
    String host() { return prefs.getString("host", ""); }

    /** Forget the TV: the next command pairs again (and shows the TV's prompt). */
    void forget() { prefs.edit().remove("uuid").remove("host").remove("client_key").remove("cert").remove("scheme").apply(); }

    void switchInput(int port, Done done) {
        request("tv/switchInput", json("inputId", "HDMI_" + port), done);
    }

    /** Launches an LG app the same way Home Assistant does: through the Luma Home TV app. */
    void launchApp(String appId, Done done) {
        request("system.launcher/launch", json("id", "com.spinoff.lumahome",
                "params", json("luma", "app", "app_id", appId)), done);
    }

    void request(String uri, JSONObject payload, Done done) {
        if (!enabled()) { reply(done, false, "Direct LG control is off."); return; }
        worker.execute(() -> {
            String error = null;
            for (Target target : candidates()) {
                try {
                    send(target, uri, payload);
                    remember(target);
                    reply(done, true, null);
                    return;
                } catch (Exception e) {
                    error = e.getMessage();
                    Log.d(TAG, "request via " + target.host + " failed: " + e);
                }
            }
            reply(done, false, error == null ? "The LG TV was not found on the network." : error);
        });
    }

    // ---- Finding the TV -------------------------------------------------------------------------

    static final class Target {
        final String uuid, host;
        Target(String uuid, String host) { this.uuid = uuid; this.host = host; }
    }

    /** The saved address first; then whatever SSDP finds, preferring the saved TV identity. */
    private List<Target> candidates() {
        List<Target> out = new ArrayList<>();
        String uuid = prefs.getString("uuid", ""), host = host();
        if (!uuid.isEmpty() && !host.isEmpty()) out.add(new Target(uuid, host));
        List<Target> found = discover(2500);
        for (Target t : found) if (!uuid.isEmpty() && uuid.equals(t.uuid) && !t.host.equals(host)) out.add(t);
        // Not paired yet: the Streamer sits on one TV; try what answered (an unknown TV only ever
        // shows a prompt, it never runs a command before someone accepts it there).
        if (uuid.isEmpty()) out.addAll(found);
        return out;
    }

    private void remember(Target target) {
        prefs.edit().putString("uuid", target.uuid).putString("host", target.host).apply();
    }

    static List<Target> discover(int timeoutMs) {
        List<Target> found = new ArrayList<>();
        String search = "M-SEARCH * HTTP/1.1\r\nHOST: 239.255.255.250:1900\r\nMAN: \"ssdp:discover\"\r\nMX: 2\r\nST: "
                + SSDP_ST + "\r\n\r\n";
        try (DatagramSocket socket = new DatagramSocket()) {
            byte[] bytes = search.getBytes(StandardCharsets.US_ASCII);
            InetAddress group = InetAddress.getByName("239.255.255.250");
            socket.send(new DatagramPacket(bytes, bytes.length, group, 1900));
            socket.send(new DatagramPacket(bytes, bytes.length, group, 1900));
            long end = System.currentTimeMillis() + timeoutMs;
            byte[] buffer = new byte[2048];
            while (System.currentTimeMillis() < end) {
                socket.setSoTimeout((int) Math.max(1, end - System.currentTimeMillis()));
                DatagramPacket packet = new DatagramPacket(buffer, buffer.length);
                try { socket.receive(packet); } catch (SocketTimeoutException e) { break; }
                Target t = parseSsdp(new String(packet.getData(), 0, packet.getLength(), StandardCharsets.UTF_8),
                        packet.getAddress().getHostAddress());
                if (t != null && found.stream().noneMatch(f -> f.uuid.equals(t.uuid))) found.add(t);
            }
        } catch (Exception e) {
            Log.d(TAG, "SSDP search failed: " + e);
        }
        return found;
    }

    /** Reads an SSDP reply: the TV's stable uuid from USN and the address it answered from. */
    static Target parseSsdp(String reply, String sender) {
        if (reply == null || !reply.toLowerCase(Locale.ROOT).contains("webos-second-screen")) return null;
        String uuid = null;
        for (String line : reply.split("\r?\n")) {
            int colon = line.indexOf(':');
            if (colon < 0) continue;
            if (line.substring(0, colon).trim().equalsIgnoreCase("USN")) {
                String usn = line.substring(colon + 1).trim();
                if (usn.toLowerCase(Locale.ROOT).startsWith("uuid:")) usn = usn.substring(5);
                int end = usn.indexOf("::");
                uuid = (end >= 0 ? usn.substring(0, end) : usn).trim();
            }
        }
        if (uuid == null || uuid.isEmpty() || sender == null || sender.isEmpty()) return null;
        return new Target(uuid, sender);
    }

    // ---- Talking to the TV ----------------------------------------------------------------------

    private void send(Target target, String uri, JSONObject payload) throws Exception {
        boolean preferWss = !"ws".equals(prefs.getString("scheme", "wss"));
        Exception first = null;
        for (boolean wss : preferWss ? new boolean[]{true, false} : new boolean[]{false, true}) {
            try {
                exchange(target, wss, uri, payload);
                prefs.edit().putString("scheme", wss ? "wss" : "ws").apply();
                return;
            } catch (PairingRefused e) {
                throw e;
            } catch (Exception e) {
                if (first == null) first = e;
            }
        }
        throw first;
    }

    private static final class PairingRefused extends Exception {
        PairingRefused(String message) { super(message); }
    }

    private void exchange(Target target, boolean wss, String uri, JSONObject payload) throws Exception {
        LinkedBlockingQueue<JSONObject> inbox = new LinkedBlockingQueue<>();
        WebSocketFactory factory = new WebSocketFactory().setConnectionTimeout(3000);
        if (wss) {
            SSLContext ssl = SSLContext.getInstance("TLS");
            ssl.init(null, new TrustManager[]{TRUST_ANY}, null);   // pinned below, after the handshake
            factory.setSSLContext(ssl).setVerifyHostname(false);
        }
        WebSocket ws = factory.createSocket((wss ? "wss://" : "ws://") + target.host + (wss ? ":3001" : ":3000"));
        ws.addListener(new WebSocketAdapter() {
            @Override public void onTextMessage(WebSocket socket, String text) {
                try { inbox.add(new JSONObject(text)); } catch (JSONException ignored) { }
            }
        });
        try {
            ws.connect();
            if (wss) checkPin(target, ws);
            register(ws, inbox, true);
            ws.sendText(json("id", "cmd", "type", "request", "uri", "ssap://" + uri, "payload", payload).toString());
            JSONObject reply = await(inbox, "cmd", REPLY_TIMEOUT_S);
            JSONObject body = reply.optJSONObject("payload");
            if (!"response".equals(reply.optString("type")) || body == null || !body.optBoolean("returnValue", true)) {
                String why = reply.optString("error", body == null ? "" : body.optString("errorText"));
                throw new IllegalStateException(why.isEmpty() ? "The LG TV did not accept the command." : "The LG TV said: " + why);
            }
        } finally {
            ws.disconnect();
        }
    }

    private void register(WebSocket ws, LinkedBlockingQueue<JSONObject> inbox, boolean signed) throws Exception {
        ws.sendText(json("type", "register", "id", "reg", "payload",
                registration(manifest(), prefs.getString("client_key", ""), signed)).toString());
        while (true) {
            JSONObject message = await(inbox, "reg", PAIR_TIMEOUT_S);
            String type = message.optString("type");
            if ("registered".equals(type)) {
                String key = message.optJSONObject("payload") == null ? "" : message.optJSONObject("payload").optString("client-key");
                if (!key.isEmpty()) prefs.edit().putString("client_key", key).apply();
                return;
            }
            if ("error".equals(type)) {
                // Newer firmware rejects the signed manifest; aiowebostv retries unsigned the same way.
                if (signed) { register(ws, inbox, false); return; }
                prefs.edit().remove("client_key").apply();
                throw new PairingRefused("The LG TV refused LumaX. Accept the prompt on the TV, then try again.");
            }
            JSONObject body = message.optJSONObject("payload");
            if (body != null && "PROMPT".equals(body.optString("pairingType")))
                main.post(() -> android.widget.Toast.makeText(context, "Allow LumaX on your LG TV (prompt on the TV screen).",
                        android.widget.Toast.LENGTH_LONG).show());
        }
    }

    /** The registration payload: the saved key, and the signed or unsigned manifest. */
    static JSONObject registration(JSONObject base, String clientKey, boolean signed) throws JSONException {
        JSONObject payload = new JSONObject(base.toString());
        if (!signed) {
            JSONObject manifest = payload.getJSONObject("manifest");
            manifest.remove("signatures");
            JSONObject signedPart = (JSONObject) manifest.remove("signed");
            java.util.TreeSet<String> permissions = new java.util.TreeSet<>();
            JSONArray own = manifest.getJSONArray("permissions");
            for (int i = 0; i < own.length(); i++) permissions.add(own.getString(i));
            JSONArray extra = signedPart == null ? new JSONArray() : signedPart.getJSONArray("permissions");
            for (int i = 0; i < extra.length(); i++) permissions.add(extra.getString(i));
            manifest.put("permissions", new JSONArray(permissions));
        }
        if (clientKey != null && !clientKey.isEmpty()) payload.put("client-key", clientKey);
        return payload;
    }

    private JSONObject manifest() throws Exception {
        try (InputStream in = context.getResources().openRawResource(R.raw.lg_register)) {
            return new JSONObject(new String(in.readAllBytes(), StandardCharsets.UTF_8));
        }
    }

    private static JSONObject await(LinkedBlockingQueue<JSONObject> inbox, String id, int seconds) throws Exception {
        long end = System.nanoTime() + TimeUnit.SECONDS.toNanos(seconds);
        while (true) {
            long left = end - System.nanoTime();
            JSONObject message = left > 0 ? inbox.poll(left, TimeUnit.NANOSECONDS) : null;
            if (message == null) throw new IllegalStateException("The LG TV did not answer.");
            if (id.equals(message.optString("id"))) return message;
        }
    }

    /** Trust on first use: keep the certificate seen at first pairing and refuse any other one later. */
    private void checkPin(Target target, WebSocket ws) throws Exception {
        java.net.Socket raw = ws.getSocket();
        if (!(raw instanceof javax.net.ssl.SSLSocket)) return;
        SSLSession session = ((javax.net.ssl.SSLSocket) raw).getSession();
        Certificate[] chain = session.getPeerCertificates();
        String seen = fingerprint(chain[0].getEncoded());
        String saved = prefs.getString("cert", "");
        boolean sameTv = target.uuid.equals(prefs.getString("uuid", ""));
        if (saved.isEmpty() || !sameTv) prefs.edit().putString("cert", seen).apply();
        else if (!saved.equals(seen)) throw new PairingRefused("The LG TV's identity changed. Pair it again in LumaX settings.");
    }

    static String fingerprint(byte[] der) throws Exception {
        StringBuilder out = new StringBuilder();
        for (byte b : MessageDigest.getInstance("SHA-256").digest(der)) out.append(String.format(Locale.ROOT, "%02x", b));
        return out.toString();
    }

    private static final X509TrustManager TRUST_ANY = new X509TrustManager() {
        @Override public void checkClientTrusted(X509Certificate[] chain, String authType) { }
        @Override public void checkServerTrusted(X509Certificate[] chain, String authType) { }
        @Override public X509Certificate[] getAcceptedIssuers() { return new X509Certificate[0]; }
    };

    private void reply(Done done, boolean ok, String message) { main.post(() -> done.done(ok, message)); }

    static JSONObject json(Object... pairs) {
        JSONObject out = new JSONObject();
        try { for (int i = 0; i + 1 < pairs.length; i += 2) out.put((String) pairs[i], pairs[i + 1]); }
        catch (JSONException ignored) { }
        return out;
    }
}

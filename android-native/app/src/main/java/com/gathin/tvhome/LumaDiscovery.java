package com.gathin.tvhome;

import android.content.Context;
import android.net.nsd.NsdManager;
import android.net.nsd.NsdServiceInfo;
import android.os.Handler;
import android.os.Looper;

import java.net.InetAddress;
import java.net.URI;
import java.net.UnknownHostException;
import java.nio.charset.StandardCharsets;
import java.util.ArrayDeque;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Queue;
import java.util.Set;
import java.util.function.Consumer;

/** Discovers local HA endpoints. Credentials stay with the address the owner selects. */
final class LumaDiscovery implements NsdManager.DiscoveryListener {
    private static final String TYPE = "_home-assistant._tcp.";
    private final NsdManager manager;
    private final Handler main = new Handler(Looper.getMainLooper());
    private final Set<String> seen = new HashSet<>();
    private final Queue<NsdServiceInfo> pending = new ArrayDeque<>();
    private final LinkedHashMap<String, Host> hosts = new LinkedHashMap<>();
    private final Consumer<List<Host>> result;
    private boolean active = true, resolving;

    static final class Host {
        final String name;
        final String address;
        Host(String name, String address) { this.name = name; this.address = address; }
    }

    LumaDiscovery(Context context, Consumer<List<Host>> result) {
        manager = context.getSystemService(NsdManager.class);
        this.result = result;
    }

    void start() {
        if (manager == null) { finish(); return; }
        try {
            manager.discoverServices(TYPE, NsdManager.PROTOCOL_DNS_SD, this);
            main.postDelayed(this::finish, 5000);
        } catch (IllegalArgumentException | SecurityException error) { finish(); }
    }

    @Override public void onDiscoveryStarted(String type) { }
    @Override public void onDiscoveryStopped(String type) { }
    @Override public void onStartDiscoveryFailed(String type, int error) { main.post(this::finish); }
    @Override public void onStopDiscoveryFailed(String type, int error) { }
    @Override public void onServiceLost(NsdServiceInfo info) { }

    @Override public void onServiceFound(NsdServiceInfo info) {
        main.post(() -> {
            if (!active || !seen.add(info.getServiceName())) return;
            pending.add(info);
            resolveNext();
        });
    }

    @SuppressWarnings("deprecation")
    private void resolveNext() {
        if (!active || resolving || pending.isEmpty()) return;
        resolving = true;
        try {
            manager.resolveService(pending.remove(), new NsdManager.ResolveListener() {
                @Override public void onResolveFailed(NsdServiceInfo info, int error) { main.post(() -> resolved(null)); }
                @Override public void onServiceResolved(NsdServiceInfo info) { main.post(() -> resolved(info)); }
            });
        } catch (IllegalArgumentException | SecurityException error) { resolved(null); }
    }

    @SuppressWarnings("deprecation")
    private void resolved(NsdServiceInfo info) {
        if (!active) return;
        resolving = false;
        if (info != null) {
            byte[] advertised = info.getAttributes().get("internal_url");
            String url = advertised == null ? "" : new String(advertised, StandardCharsets.UTF_8).trim();
            String address = preferredAddress(url, info.getHost(), info.getPort());
            String service = info.getServiceName();
            if (address != null) hosts.putIfAbsent(service, new Host(service, address));
        }
        resolveNext();
    }

    static String preferredAddress(String advertised, InetAddress resolved, int port) {
        String scheme = "http";
        try {
            LumaSocket.endpoint(advertised);
            URI uri = URI.create(advertised.trim());
            scheme = uri.getScheme();
            String host = uri.getHost();
            // A hostname can follow DHCP changes on its own. When the advertised
            // URL is a stale IP literal, the DNS-SD response is the current address.
            if (resolved == null || !isNumericHost(host) || sameIp(host, resolved)) {
                return scheme + "://" + uri.getRawAuthority();
            }
        } catch (IllegalArgumentException ignored) { }
        if (resolved == null || port <= 0) return null;
        String host = resolved.getHostAddress();
        if (host.contains(":")) host = "[" + host.replace("%", "%25") + "]";
        return scheme + "://" + host + ":" + port;
    }

    private static boolean isNumericHost(String host) {
        return host.contains(":") || host.matches("[0-9.]+");
    }

    private static boolean sameIp(String literal, InetAddress resolved) {
        String value = literal.replace("[", "").replace("]", "").split("%", 2)[0];
        try {
            // The input has already been checked to be an IPv4 or IPv6 literal.
            return Arrays.equals(InetAddress.getByName(value).getAddress(), resolved.getAddress());
        } catch (UnknownHostException ignored) {
            return false;
        }
    }

    private void finish() {
        if (!active) return;
        active = false;
        main.removeCallbacksAndMessages(null);
        if (manager != null) {
            try { manager.stopServiceDiscovery(this); } catch (IllegalArgumentException ignored) { }
        }
        result.accept(new ArrayList<>(hosts.values()));
    }
}

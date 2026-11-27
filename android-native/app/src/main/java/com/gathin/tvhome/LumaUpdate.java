package com.gathin.tvhome;

import android.app.Activity;
import android.app.PendingIntent;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.content.SharedPreferences;
import android.content.pm.PackageInfo;
import android.content.pm.PackageInstaller;
import android.content.pm.PackageManager;
import android.content.pm.Signature;
import android.net.Uri;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;
import android.provider.Settings;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.HashSet;
import java.util.Set;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.function.Consumer;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * Checks the project's GitHub releases for a newer LumaX APK and installs it
 * through Android's own confirmation screen. Nothing installs without the
 * user's OK, and an APK signed by any other key is rejected before Android
 * sees it.
 */
final class LumaUpdate {
    static final String RELEASES_URL =
            "https://api.github.com/repos/vibribbonee/luma-home-webos/releases?per_page=20";
    private static final Pattern ASSET = Pattern.compile("lumax-native-preview_(\\d+(?:\\.\\d+)*)\\.apk");
    private static final long CHECK_INTERVAL_MS = 24L * 60 * 60 * 1000;
    private static final long MAX_APK_BYTES = 80L * 1024 * 1024;
    private static final String PREFS = "lumax-update";
    private static final String ACTION_INSTALLED = "dev.lumax.UPDATE_STATUS";

    /** A newer APK published on GitHub. */
    static final class Release {
        final String version;
        final String url;
        final long size;
        Release(String version, String url, long size) { this.version = version; this.url = url; this.size = size; }
    }

    private final Activity activity;
    private final Handler main = new Handler(Looper.getMainLooper());
    private final ExecutorService worker = Executors.newSingleThreadExecutor();
    private final SharedPreferences prefs;
    private Release available;
    private boolean busy;

    LumaUpdate(Activity activity) {
        this.activity = activity;
        this.prefs = activity.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }

    Release available() { return available; }

    /** Check at most once a day; report a newer release to {@code found}. */
    void checkDaily(Consumer<Release> found) {
        long now = System.currentTimeMillis();
        if (now - prefs.getLong("checked", 0) < CHECK_INTERVAL_MS) return;
        check(found, error -> { });
    }

    /** Check now. {@code found} receives null when LumaX is up to date. */
    void check(Consumer<Release> found, Consumer<String> failed) {
        if (busy) return;
        busy = true;
        String installed = installedVersion();
        worker.execute(() -> {
            try {
                Release release = newest(new JSONArray(get(RELEASES_URL)), installed);
                prefs.edit().putLong("checked", System.currentTimeMillis()).apply();
                main.post(() -> { busy = false; available = release; found.accept(release); });
            } catch (IOException | JSONException | RuntimeException error) {
                main.post(() -> { busy = false; failed.accept("Could not check for updates."); });
            }
        });
    }

    /** Download, verify the signer, and hand the APK to Android's installer. */
    void install(Release release, Consumer<String> status) {
        if (busy) return;
        PackageManager packages = activity.getPackageManager();
        if (Build.VERSION.SDK_INT >= 26 && !packages.canRequestPackageInstalls()) {
            status.accept("Allow LumaX to install apps, then choose Update again.");
            activity.startActivity(new Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES,
                    Uri.parse("package:" + activity.getPackageName())));
            return;
        }
        busy = true;
        status.accept("Downloading LumaX " + release.version + "…");
        worker.execute(() -> {
            File apk = new File(activity.getCacheDir(), "lumax-update.apk");
            try {
                download(release.url, apk);
                String problem = verify(apk);
                if (problem != null) {
                    apk.delete();
                    main.post(() -> { busy = false; status.accept(problem); });
                    return;
                }
                commit(apk);
                main.post(() -> { busy = false; status.accept("Confirm the update on screen."); });
            } catch (IOException | RuntimeException error) {
                apk.delete();
                main.post(() -> { busy = false; status.accept("The update could not be downloaded."); });
            }
        });
    }

    // Decisions, kept free of Android so they can be unit-tested ---------

    /** The newest APK across all releases, including previews, if newer than installed. */
    static Release newest(JSONArray releases, String installed) {
        Release best = null;
        for (int i = 0; i < releases.length(); i++) {
            JSONObject release = releases.optJSONObject(i);
            if (release == null || release.optBoolean("draft")) continue;
            JSONArray assets = release.optJSONArray("assets");
            if (assets == null) continue;
            for (int j = 0; j < assets.length(); j++) {
                JSONObject asset = assets.optJSONObject(j);
                if (asset == null) continue;
                Matcher match = ASSET.matcher(asset.optString("name"));
                if (!match.matches()) continue;
                String version = match.group(1);
                if (compare(version, installed) <= 0) continue;
                if (best == null || compare(version, best.version) > 0) {
                    best = new Release(version, asset.optString("browser_download_url"), asset.optLong("size"));
                }
            }
        }
        return best;
    }

    /** Compare dotted version numbers; text after the numbers ("-native-preview") is ignored. */
    static int compare(String a, String b) {
        int[] left = numbers(a), right = numbers(b);
        for (int i = 0; i < Math.max(left.length, right.length); i++) {
            int x = i < left.length ? left[i] : 0, y = i < right.length ? right[i] : 0;
            if (x != y) return Integer.compare(x, y);
        }
        return 0;
    }

    private static int[] numbers(String version) {
        Matcher match = Pattern.compile("^(\\d+(?:\\.\\d+)*)").matcher(version == null ? "" : version.trim());
        if (!match.find()) return new int[0];
        String[] parts = match.group(1).split("\\.");
        int[] values = new int[parts.length];
        for (int i = 0; i < parts.length; i++) {
            try { values[i] = Integer.parseInt(parts[i]); } catch (NumberFormatException ignored) { values[i] = 0; }
        }
        return values;
    }

    /** True when both sets contain exactly the same certificates. */
    static boolean sameSigners(Set<String> installed, Set<String> downloaded) {
        return !installed.isEmpty() && installed.equals(downloaded);
    }

    // Android ------------------------------------------------------------

    private String installedVersion() {
        try {
            return activity.getPackageManager().getPackageInfo(activity.getPackageName(), 0).versionName;
        } catch (PackageManager.NameNotFoundException error) {
            return "0";
        }
    }

    @SuppressWarnings("deprecation")
    private String verify(File apk) {
        PackageManager packages = activity.getPackageManager();
        int flags = Build.VERSION.SDK_INT >= 28 ? PackageManager.GET_SIGNING_CERTIFICATES : PackageManager.GET_SIGNATURES;
        PackageInfo downloaded = packages.getPackageArchiveInfo(apk.getPath(), flags);
        if (downloaded == null || !activity.getPackageName().equals(downloaded.packageName)) {
            return "The download is not a LumaX update for this app.";
        }
        try {
            PackageInfo installed = packages.getPackageInfo(activity.getPackageName(), flags);
            if (!sameSigners(signers(installed), signers(downloaded))) {
                return "The update is signed by a different key and was not installed.";
            }
        } catch (PackageManager.NameNotFoundException error) {
            return "LumaX could not read its own signature.";
        }
        return null;
    }

    @SuppressWarnings("deprecation")
    private static Set<String> signers(PackageInfo info) {
        Signature[] signatures;
        if (Build.VERSION.SDK_INT >= 28 && info.signingInfo != null) {
            signatures = info.signingInfo.hasMultipleSigners()
                    ? info.signingInfo.getApkContentsSigners() : info.signingInfo.getSigningCertificateHistory();
        } else {
            signatures = info.signatures;
        }
        Set<String> result = new HashSet<>();
        if (signatures != null) for (Signature signature : signatures) result.add(signature.toCharsString());
        return result;
    }

    private void commit(File apk) throws IOException {
        PackageInstaller installer = activity.getPackageManager().getPackageInstaller();
        PackageInstaller.SessionParams params =
                new PackageInstaller.SessionParams(PackageInstaller.SessionParams.MODE_FULL_INSTALL);
        params.setAppPackageName(activity.getPackageName());
        int id = installer.createSession(params);
        try (PackageInstaller.Session session = installer.openSession(id)) {
            try (InputStream in = new java.io.FileInputStream(apk);
                 OutputStream out = session.openWrite("lumax.apk", 0, apk.length())) {
                byte[] buffer = new byte[64 * 1024];
                for (int read; (read = in.read(buffer)) > 0; ) out.write(buffer, 0, read);
                session.fsync(out);
            }
            registerConfirmation();
            Intent result = new Intent(ACTION_INSTALLED).setPackage(activity.getPackageName());
            int mutable = Build.VERSION.SDK_INT >= 31 ? PendingIntent.FLAG_MUTABLE : 0;
            PendingIntent pending = PendingIntent.getBroadcast(activity, id, result,
                    PendingIntent.FLAG_UPDATE_CURRENT | mutable);
            session.commit(pending.getIntentSender());
        } finally {
            apk.delete();
        }
    }

    /** Android asks to confirm the install; show its screen when it does. */
    private void registerConfirmation() {
        BroadcastReceiver receiver = new BroadcastReceiver() {
            @Override public void onReceive(Context context, Intent intent) {
                int code = intent.getIntExtra(PackageInstaller.EXTRA_STATUS, PackageInstaller.STATUS_FAILURE);
                if (code == PackageInstaller.STATUS_PENDING_USER_ACTION) {
                    Intent confirm = intent.getParcelableExtra(Intent.EXTRA_INTENT);
                    if (confirm != null) activity.startActivity(confirm.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK));
                    return;
                }
                try { activity.unregisterReceiver(this); } catch (IllegalArgumentException ignored) { }
            }
        };
        IntentFilter filter = new IntentFilter(ACTION_INSTALLED);
        if (Build.VERSION.SDK_INT >= 33) activity.registerReceiver(receiver, filter, Context.RECEIVER_NOT_EXPORTED);
        else activity.registerReceiver(receiver, filter);
    }

    private static String get(String address) throws IOException {
        HttpURLConnection connection = open(address, "application/vnd.github+json");
        try (InputStream in = connection.getInputStream()) {
            return new String(readAll(in, 4L * 1024 * 1024), StandardCharsets.UTF_8);
        } finally {
            connection.disconnect();
        }
    }

    private static void download(String address, File target) throws IOException {
        if (!address.startsWith("https://github.com/") && !address.startsWith("https://objects.githubusercontent.com/")) {
            throw new IOException("Unexpected download address");
        }
        HttpURLConnection connection = open(address, null);
        try (InputStream in = connection.getInputStream(); OutputStream out = new FileOutputStream(target)) {
            byte[] buffer = new byte[64 * 1024];
            long total = 0;
            for (int read; (read = in.read(buffer)) > 0; ) {
                total += read;
                if (total > MAX_APK_BYTES) throw new IOException("Update is too large");
                out.write(buffer, 0, read);
            }
        } finally {
            connection.disconnect();
        }
    }

    /** Opens a request; every header is set before the connection is made. */
    private static HttpURLConnection open(String address, String accept) throws IOException {
        HttpURLConnection connection = (HttpURLConnection) new URL(address).openConnection();
        connection.setConnectTimeout(10_000);
        connection.setReadTimeout(30_000);
        connection.setInstanceFollowRedirects(true);
        connection.setRequestProperty("User-Agent", "LumaX-updater");
        if (accept != null) connection.setRequestProperty("Accept", accept);
        int code = connection.getResponseCode();
        if (code != HttpURLConnection.HTTP_OK) throw new IOException("HTTP " + code);
        return connection;
    }

    private static byte[] readAll(InputStream in, long limit) throws IOException {
        java.io.ByteArrayOutputStream out = new java.io.ByteArrayOutputStream();
        byte[] buffer = new byte[16 * 1024];
        for (int read; (read = in.read(buffer)) > 0; ) {
            if (out.size() + read > limit) throw new IOException("Response too large");
            out.write(buffer, 0, read);
        }
        return out.toByteArray();
    }
}

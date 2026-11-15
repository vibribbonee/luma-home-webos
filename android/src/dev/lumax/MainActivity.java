package dev.lumax;

import android.app.Activity;
import android.app.role.RoleManager;
import android.content.ComponentName;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.ResolveInfo;
import android.graphics.Bitmap;
import android.graphics.Canvas;
import android.graphics.drawable.Drawable;
import android.os.Build;
import android.provider.Settings;
import android.os.Bundle;
import android.util.Base64;
import android.webkit.JavascriptInterface;
import android.webkit.WebResourceRequest;
import android.webkit.WebView;
import android.webkit.WebViewClient;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

public final class MainActivity extends Activity {
    private static final String APP_PAGE = "file:///android_asset/index.html";
    private final Map<String, ComponentName> launchable = new HashMap<>();
    private WebView screen;
    private Preferences store;
    private volatile String apps = "[]";

    @Override public void onCreate(Bundle state) {
        super.onCreate(state);
        SharedPreferences preferences = getSharedPreferences("lumax", MODE_PRIVATE);
        store = new Preferences(preferences);
        screen = new WebView(this);
        screen.setBackgroundColor(0xff101522);
        screen.getSettings().setJavaScriptEnabled(true);
        screen.getSettings().setDomStorageEnabled(true);
        screen.getSettings().setAllowContentAccess(false);
        // The page is packaged with the APK and needs to connect to the user's HA WebSocket.
        screen.getSettings().setAllowUniversalAccessFromFileURLs(true);
        screen.setWebViewClient(new WebViewClient() {
            @Override public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                return true;
            }
        });
        screen.addJavascriptInterface(new Host(), "LumaX");
        setContentView(screen);
        screen.loadUrl(APP_PAGE);
    }

    @Override protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        invoke("'home'");
    }

    @Override protected void onResume() {
        super.onResume();
        if (screen != null) {
            invoke("'resume'");
            new Thread(this::loadCatalog, "lumax-catalog").start();
        }
    }

    @Override protected void onPause() {
        invoke("'pause'");
        super.onPause();
    }

    @Override public void onBackPressed() {
        screen.evaluateJavascript("window.lumaEvent && window.lumaEvent('back')", consumed -> {
            if (!"true".equals(consumed)) finish();
        });
    }

    private void invoke(String event) {
        screen.evaluateJavascript("window.lumaEvent && window.lumaEvent(" + event + ")", null);
    }

    private void loadCatalog() {
        Intent intent = new Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_LEANBACK_LAUNCHER);
        List<ResolveInfo> entries = new ArrayList<>(getPackageManager().queryIntentActivities(intent, 0));
        entries.sort(Comparator.comparing(item -> item.loadLabel(getPackageManager()).toString(),
                String.CASE_INSENSITIVE_ORDER));
        JSONArray catalog = new JSONArray();
        Map<String, ComponentName> targets = new HashMap<>();
        for (ResolveInfo item : entries) {
            String id = item.activityInfo.packageName;
            if (id.equals(getPackageName()) || targets.containsKey(id)) continue;
            targets.put(id, new ComponentName(id, item.activityInfo.name));
            try {
                JSONObject app = new JSONObject();
                app.put("id", id);
                app.put("name", item.loadLabel(getPackageManager()));
                Drawable icon = item.loadIcon(getPackageManager());
                Drawable banner = item.activityInfo.loadBanner(getPackageManager());
                Bitmap artwork = raster(banner != null ? banner : icon, banner != null ? 320 : 104,
                        banner != null ? 180 : 104);
                if (artwork != null) {
                    app.put(banner != null ? "banner" : "icon", encode(artwork));
                    app.put("tint", tint(artwork));
                    artwork.recycle();
                }
                catalog.put(app);
            } catch (org.json.JSONException ignored) {
                // The remaining catalog entries are still usable.
            }
        }
        runOnUiThread(() -> {
            launchable.clear();
            launchable.putAll(targets);
            String updated = catalog.toString();
            if (!updated.equals(apps)) {
                apps = updated;
                invoke("'catalog'");
            }
        });
    }

    private static Bitmap raster(Drawable source, int width, int height) {
        if (source == null) return null;
        Bitmap bitmap = Bitmap.createBitmap(width, height, Bitmap.Config.ARGB_8888);
        source.setBounds(0, 0, width, height);
        source.draw(new Canvas(bitmap));
        return bitmap;
    }

    private static String encode(Bitmap bitmap) {
        ByteArrayOutputStream bytes = new ByteArrayOutputStream();
        bitmap.compress(Bitmap.CompressFormat.PNG, 100, bytes);
        return "data:image/png;base64," + Base64.encodeToString(bytes.toByteArray(), Base64.NO_WRAP);
    }

    private static String tint(Bitmap bitmap) {
        int[] sums = new int[3];
        int count = 0;
        for (int y = 2; y < bitmap.getHeight(); y += 6) {
            for (int x = 2; x < bitmap.getWidth(); x += 6) {
                int pixel = bitmap.getPixel(x, y);
                int red = (pixel >> 16) & 255;
                int green = (pixel >> 8) & 255;
                int blue = pixel & 255;
                int range = Math.max(red, Math.max(green, blue)) - Math.min(red, Math.min(green, blue));
                if ((pixel >>> 24) < 128 || range < 45) continue;
                sums[0] += red;
                sums[1] += green;
                sums[2] += blue;
                count++;
            }
        }
        if (count == 0) return "104,91,170";
        return sums[0] / count + "," + sums[1] / count + "," + sums[2] / count;
    }

    private final class Host {
        @JavascriptInterface public String catalog() { return apps; }
        @JavascriptInterface public String preferences() { return store.get(); }
        @JavascriptInterface public boolean save(String value) { return store.save(value); }
        @JavascriptInterface public void launch(String id) {
            runOnUiThread(() -> {
                ComponentName target = launchable.get(id);
                if (target != null) startActivity(new Intent(Intent.ACTION_MAIN)
                        .addCategory(Intent.CATEGORY_LEANBACK_LAUNCHER).setComponent(target)
                        .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK));
            });
        }
        @JavascriptInterface public void homeSettings() {
            runOnUiThread(() -> {
                try {
                    startActivity(new Intent(Settings.ACTION_HOME_SETTINGS));
                } catch (android.content.ActivityNotFoundException ignored) {
                    RoleManager roles = Build.VERSION.SDK_INT >= 29 ? getSystemService(RoleManager.class) : null;
                    if (roles != null && roles.isRoleAvailable(RoleManager.ROLE_HOME)
                            && !roles.isRoleHeld(RoleManager.ROLE_HOME)) {
                        startActivityForResult(roles.createRequestRoleIntent(RoleManager.ROLE_HOME), 1);
                    } else {
                        startActivity(new Intent(Settings.ACTION_SETTINGS));
                    }
                }
            });
        }
        @JavascriptInterface public void googleHome() {
            runOnUiThread(() -> {
                Intent home = new Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_HOME)
                        .setPackage("com.google.android.apps.tv.launcherx");
                try { startActivity(home); }
                catch (android.content.ActivityNotFoundException ignored) {
                    startActivity(new Intent(Settings.ACTION_SETTINGS));
                }
            });
        }
    }
}

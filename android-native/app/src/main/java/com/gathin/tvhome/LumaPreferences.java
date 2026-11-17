package com.gathin.tvhome;

import android.content.SharedPreferences;
import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyProperties;
import android.util.Base64;

import org.json.JSONObject;

import java.nio.charset.StandardCharsets;
import java.security.KeyStore;

import javax.crypto.Cipher;
import javax.crypto.KeyGenerator;
import javax.crypto.SecretKey;
import javax.crypto.spec.GCMParameterSpec;

/** The HA credential is encrypted with a key in the APK's Android Keystore. */
final class LumaPreferences {
    private static final String KEY = "lumax-ha";
    private final SharedPreferences store;

    LumaPreferences(SharedPreferences store) { this.store = store; }

    private SecretKey key() throws Exception {
        KeyStore keys = KeyStore.getInstance("AndroidKeyStore");
        keys.load(null);
        if (keys.containsAlias(KEY)) return (SecretKey) keys.getKey(KEY, null);
        KeyGenerator generator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore");
        generator.init(new KeyGenParameterSpec.Builder(KEY,
                KeyProperties.PURPOSE_ENCRYPT | KeyProperties.PURPOSE_DECRYPT)
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE).build());
        return generator.generateKey();
    }

    synchronized boolean save(String value) {
        try {
            JSONObject settings = new JSONObject(value);
            String token = settings.optString("token");
            settings.remove("token");
            SharedPreferences.Editor edit = store.edit().putString("settings", settings.toString());
            if (token.isEmpty()) return edit.remove("secret").remove("iv").commit();
            Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
            cipher.init(Cipher.ENCRYPT_MODE, key());
            byte[] encrypted = cipher.doFinal(token.getBytes(StandardCharsets.UTF_8));
            return edit.putString("secret", Base64.encodeToString(encrypted, Base64.NO_WRAP))
                    .putString("iv", Base64.encodeToString(cipher.getIV(), Base64.NO_WRAP)).commit();
        } catch (Exception error) {
            return false;
        }
    }

    synchronized String get() {
        try {
            JSONObject settings = new JSONObject(store.getString("settings", "{}"));
            String encrypted = store.getString("secret", "");
            if (!encrypted.isEmpty()) {
                byte[] iv = Base64.decode(store.getString("iv", ""), Base64.NO_WRAP);
                Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
                cipher.init(Cipher.DECRYPT_MODE, key(), new GCMParameterSpec(128, iv));
                settings.put("token", new String(cipher.doFinal(Base64.decode(encrypted, Base64.NO_WRAP)),
                        StandardCharsets.UTF_8));
            }
            return settings.toString();
        } catch (Exception error) {
            return "{}";
        }
    }
}

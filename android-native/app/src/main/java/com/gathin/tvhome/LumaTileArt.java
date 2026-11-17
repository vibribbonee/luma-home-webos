package com.gathin.tvhome;

import android.app.Activity;
import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.content.SharedPreferences;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.graphics.Canvas;
import android.graphics.Paint;
import android.graphics.Path;
import android.graphics.RectF;
import android.graphics.drawable.BitmapDrawable;
import android.graphics.drawable.Drawable;
import android.net.Uri;
import android.util.AtomicFile;
import android.util.Base64;
import android.widget.Toast;

import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;

final class LumaTileArt {
    static final int PICK_IMAGE = 8941;
    private static final int MAX_ICON_CHARS = 100_000;
    private final Activity activity;
    private final SharedPreferences store;
    private final Runnable changed;
    private String pending;

    LumaTileArt(Activity activity, SharedPreferences store, Runnable changed) {
        this.activity = activity;
        this.store = store;
        this.changed = changed;
    }

    String title(String key, String original) { return store.getString("name:" + key, original); }

    void rename(String key, String value) {
        SharedPreferences.Editor edit = store.edit();
        if (value.isEmpty()) edit.remove("name:" + key);
        else edit.putString("name:" + key, value);
        edit.apply();
        changed.run();
    }

    private File file(String key) { return new File(activity.getFilesDir(), key + ".png"); }

    Drawable picture(String key, String lgIcon) {
        Bitmap bitmap = BitmapFactory.decodeFile(file(key).getPath());
        if (bitmap == null && store.getBoolean("split:" + key, false)) bitmap = splitBanner();
        if (bitmap == null && lgIcon != null && lgIcon.length() <= MAX_ICON_CHARS && lgIcon.startsWith("data:image/")) {
            int comma = lgIcon.indexOf(',');
            if (comma >= 0) {
                try {
                    byte[] bytes = Base64.decode(lgIcon.substring(comma + 1), Base64.DEFAULT);
                    BitmapFactory.Options options = new BitmapFactory.Options();
                    options.inJustDecodeBounds = true;
                    BitmapFactory.decodeByteArray(bytes, 0, bytes.length, options);
                    if (options.outWidth > 0 && options.outHeight > 0 && options.outWidth <= 512 && options.outHeight <= 512) {
                        bitmap = BitmapFactory.decodeByteArray(bytes, 0, bytes.length);
                        if (bitmap != null) bitmap = iconBanner(bitmap);
                    }
                } catch (IllegalArgumentException ignored) {
                    // A tile can still use its device icon.
                }
            }
        }
        return bitmap == null ? null : new BitmapDrawable(activity.getResources(), bitmap);
    }

    void pick(String key) {
        pending = key;
        try {
            activity.startActivityForResult(new Intent(Intent.ACTION_OPEN_DOCUMENT)
                    .addCategory(Intent.CATEGORY_OPENABLE).setType("image/*"), PICK_IMAGE);
        } catch (ActivityNotFoundException error) {
            pending = null;
            Toast.makeText(activity, "Install a file picker to choose a picture.", Toast.LENGTH_SHORT).show();
        }
    }

    void picked(Intent result) {
        String key = pending;
        pending = null;
        Uri image = result == null ? null : result.getData();
        if (key == null || image == null) return;
        new Thread(() -> {
            try {
                save(key, image);
                activity.runOnUiThread(changed);
            } catch (IOException | SecurityException error) {
                activity.runOnUiThread(() -> Toast.makeText(activity, "Could not read the picture.", Toast.LENGTH_SHORT).show());
            }
        }, "luma-tile-art").start();
    }

    private void save(String key, Uri uri) throws IOException {
        BitmapFactory.Options options = new BitmapFactory.Options();
        options.inJustDecodeBounds = true;
        try (InputStream input = activity.getContentResolver().openInputStream(uri)) { BitmapFactory.decodeStream(input, null, options); }
        options.inJustDecodeBounds = false;
        options.inSampleSize = 1;
        while (Math.max(options.outWidth, options.outHeight) / options.inSampleSize > 960) options.inSampleSize *= 2;
        Bitmap bitmap;
        try (InputStream input = activity.getContentResolver().openInputStream(uri)) { bitmap = BitmapFactory.decodeStream(input, null, options); }
        if (bitmap == null) throw new IOException("Invalid image");
        AtomicFile target = new AtomicFile(file(key));
        FileOutputStream output = target.startWrite();
        try {
            if (!bitmap.compress(Bitmap.CompressFormat.PNG, 100, output)) throw new IOException("Could not encode image");
            target.finishWrite(output);
        } catch (IOException error) {
            target.failWrite(output);
            throw error;
        } finally {
            bitmap.recycle();
        }
    }

    void clearPicture(String key) {
        new AtomicFile(file(key)).delete();
        store.edit().remove("split:" + key).apply();
        changed.run();
    }

    void useSplitBanner(String key) {
        new AtomicFile(file(key)).delete();
        store.edit().putBoolean("split:" + key, true).putString("name:" + key, "Steam / Switch 2").apply();
        changed.run();
    }

    private static Bitmap iconBanner(Bitmap source) {
        Bitmap banner = Bitmap.createBitmap(320, 180, Bitmap.Config.ARGB_8888);
        Canvas canvas = new Canvas(banner);
        canvas.drawColor(0xff222532);
        float scale = 124f / Math.max(source.getWidth(), source.getHeight());
        float width = source.getWidth() * scale, height = source.getHeight() * scale;
        canvas.drawBitmap(source, null, new RectF(160 - width / 2, 90 - height / 2, 160 + width / 2, 90 + height / 2),
                new Paint(Paint.FILTER_BITMAP_FLAG));
        source.recycle();
        return banner;
    }

    private Bitmap splitBanner() {
        Bitmap bitmap = Bitmap.createBitmap(480, 270, Bitmap.Config.ARGB_8888);
        Canvas canvas = new Canvas(bitmap);
        Paint paint = new Paint(Paint.ANTI_ALIAS_FLAG);
        canvas.drawColor(0xff0e233d);
        Path red = new Path();
        red.moveTo(300, 0); red.lineTo(480, 0); red.lineTo(480, 270); red.lineTo(192, 270); red.close();
        paint.setColor(0xffb51331);
        canvas.drawPath(red, paint);
        paint.setColor(0xfff8faff);
        paint.setStrokeWidth(3);
        canvas.drawLine(300, 0, 192, 270, paint);
        Drawable steam = activity.getDrawable(R.drawable.ic_lumax_steam);
        steam.setBounds(58, 76, 176, 194);
        steam.draw(canvas);
        Drawable switch2 = activity.getDrawable(R.drawable.ic_lumax_switch2);
        switch2.setBounds(283, 90, 453, 180);
        switch2.draw(canvas);
        return bitmap;
    }
}

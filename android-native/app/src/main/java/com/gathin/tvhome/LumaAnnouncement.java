package com.gathin.tvhome;

import android.app.AlertDialog;
import android.content.Context;
import android.media.MediaPlayer;
import android.os.Handler;
import android.os.Looper;
import android.view.Gravity;
import android.view.Window;
import android.view.WindowManager;
import android.widget.Button;
import android.widget.LinearLayout;
import android.widget.TextView;

import org.json.JSONObject;

import java.io.IOException;
import java.net.URI;
import java.util.ArrayDeque;

import static com.gathin.tvhome.LumaSocket.json;

/** Plays a Home Assistant announcement on the active Streamer display. */
final class LumaAnnouncement {
    private final Context context;
    private final boolean overlay;
    private final Runnable layoutChanged;
    private final Handler main = new Handler(Looper.getMainLooper());
    private Run current;

    private static final class Run {
        final LumaSocket socket;
        final String address, tv, id;
        final ArrayDeque<JSONObject> tracks = new ArrayDeque<>();
        AlertDialog panel;
        TextView status;
        MediaPlayer player;

        Run(LumaSocket socket, String address, JSONObject event) {
            this.socket = socket;
            this.address = address;
            tv = event.optString("tv_id");
            id = event.optString("id");
            for (String key : new String[]{"preannounce", "media"}) {
                JSONObject track = event.optJSONObject(key);
                if (track != null) tracks.add(track);
            }
        }

        void report(String state) {
            socket.request("luma_home/announcement/result", json("tv_id", tv, "run_id", id, "state", state), ignored -> { });
        }
    }

    LumaAnnouncement(Context context, boolean overlay, Runnable layoutChanged) {
        this.context = context;
        this.overlay = overlay;
        this.layoutChanged = layoutChanged;
    }

    static boolean valid(JSONObject event) {
        return event.optString("id").matches("[0-9a-f]{32}") && !event.optString("tv_id").isEmpty();
    }

    boolean isShowing() { return current != null; }

    int height() {
        return current == null ? 0 : current.panel.getWindow().getDecorView().getHeight();
    }

    void show(LumaSocket socket, String address, JSONObject event, boolean listening) {
        if (!valid(event)) return;
        Run run = new Run(socket, address, event);
        if (listening) {
            run.report("cancelled");
            return;
        }
        close();
        current = run;
        LinearLayout card = LumaPanel.messageCard(context);
        TextView title = new TextView(context);
        LumaPanel.text(title, 21, LumaPanel.MUTED);
        title.setText("Home Assistant");
        Button dismiss = LumaPanel.closeButton(context, "Dismiss announcement", this::close);
        card.addView(LumaPanel.heading(context, title, dismiss));
        TextView message = new TextView(context);
        LumaPanel.text(message, 29, LumaPanel.TEXT);
        message.setLineSpacing(0, 1.35f);
        message.setPadding(0, LumaPanel.tvPx(context, 14), 0, 0);
        message.setText(LumaPanel.format(event.optString("message", "Announcement")));
        card.addView(message);
        run.status = new TextView(context);
        LumaPanel.text(run.status, 20, LumaPanel.MUTED);
        run.status.setPadding(0, LumaPanel.tvPx(context, 10), 0, 0);
        run.status.setText("Connecting…");
        card.addView(run.status);

        run.panel = LumaPanel.dialog(context).create();
        run.panel.setView(card, 0, 0, 0, 0);
        run.panel.setOnDismissListener(dialog -> finish(run, "cancelled"));
        Window window = run.panel.getWindow();
        if (overlay) window.setType(WindowManager.LayoutParams.TYPE_ACCESSIBILITY_OVERLAY);
        run.panel.show();
        LumaPanel.place(context, window, Gravity.LEFT | Gravity.TOP, LumaPanel.tvPx(context, LumaPanel.MESSAGE_WIDTH));
        window.getDecorView().addOnLayoutChangeListener((view, left, top, right, bottom, oldLeft, oldTop, oldRight, oldBottom) -> {
            if (current == run && bottom - top != oldBottom - oldTop) layoutChanged.run();
        });
        layoutChanged.run();
        main.postDelayed(() -> finish(run, "error"), 140000);
        if (run.tracks.isEmpty()) main.postDelayed(() -> finish(run, "done"), 3000);
        else playNext(run);
    }

    void close() {
        if (current != null) finish(current, "cancelled");
    }

    private void playNext(Run run) {
        if (current != run) return;
        JSONObject track = run.tracks.poll();
        if (track == null) {
            finish(run, "done");
            return;
        }
        String url = track.optString("url");
        if (track.optBoolean("ha")) {
            if (!localPath(url)) {
                finish(run, "error");
                return;
            }
            run.socket.request("auth/sign_path", json("path", url, "expires", 150), result -> {
                if (current != run) return;
                String path = result instanceof JSONObject ? ((JSONObject) result).optString("path") : "";
                if (localPath(path)) play(run, URI.create(run.address).resolve(path).toString());
                else finish(run, "error");
            });
        } else play(run, url);
    }

    private void play(Run run, String url) {
        try {
            URI source = URI.create(url);
            if (!("https".equals(source.getScheme()) || "http".equals(source.getScheme()))
                    || source.getHost() == null || source.getUserInfo() != null) {
                finish(run, "error");
                return;
            }
            MediaPlayer player = new MediaPlayer();
            run.player = player;
            player.setDataSource(source.toString());
            player.setOnPreparedListener(ready -> {
                if (current != run || run.player != ready) return;
                try {
                    ready.start();
                    run.status.setVisibility(android.view.View.GONE);
                    run.report("playing");
                } catch (IllegalStateException ignored) {
                    finish(run, "error");
                }
            });
            player.setOnCompletionListener(ended -> {
                if (current != run || run.player != ended) return;
                releasePlayer(run);
                playNext(run);
            });
            player.setOnErrorListener((failed, what, extra) -> {
                if (run.player == failed) finish(run, "error");
                return true;
            });
            player.prepareAsync();
        } catch (IOException | IllegalArgumentException | IllegalStateException ignored) {
            finish(run, "error");
        }
    }

    private static boolean localPath(String path) {
        try {
            URI candidate = URI.create(path);
            return path.startsWith("/") && !path.startsWith("//") && !candidate.isAbsolute()
                    && candidate.getRawAuthority() == null;
        } catch (IllegalArgumentException ignored) {
            return false;
        }
    }

    private static void releasePlayer(Run run) {
        MediaPlayer player = run.player;
        run.player = null;
        if (player != null) player.release();
    }

    private void finish(Run run, String state) {
        if (current != run) return;
        current = null;
        main.removeCallbacksAndMessages(null);
        releasePlayer(run);
        run.panel.setOnDismissListener(null);
        run.panel.dismiss();
        run.report(state);
        layoutChanged.run();
    }
}

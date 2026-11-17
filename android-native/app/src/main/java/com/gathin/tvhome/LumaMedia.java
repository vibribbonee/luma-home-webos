package com.gathin.tvhome;

import android.Manifest;
import android.app.AlertDialog;
import android.content.Context;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.media.AudioFormat;
import android.media.AudioRecord;
import android.media.MediaPlayer;
import android.media.MediaRecorder;
import android.os.Handler;
import android.os.Looper;
import android.os.PowerManager;
import android.os.SystemClock;
import android.view.ContextThemeWrapper;
import android.view.Gravity;
import android.view.View;
import android.view.Window;
import android.view.WindowManager;
import android.widget.ImageView;
import android.widget.Button;
import android.widget.LinearLayout;
import android.widget.TextView;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URI;
import java.util.ArrayDeque;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;
import java.util.function.BooleanSupplier;

import static com.gathin.tvhome.LumaSocket.json;
import static com.gathin.tvhome.LumaSocket.put;

/** Foreground camera snapshots and push-to-talk with the Home Assistant Assist pipeline. */
final class LumaMedia {
    static final int MIC_PERMISSION = 8942;
    private static final int SAMPLE_RATE = 16000;
    private static final int MAX_IMAGE_BYTES = 3 * 1024 * 1024;
    private static final long ASSIST_DISMISS_DELAY_MS = 6000;
    private final Context activity;
    private final boolean overlay;
    private final Handler main = new Handler(Looper.getMainLooper());
    private final Handler cameraFrames = new Handler(Looper.getMainLooper());
    private final LumaSocket voice = new LumaSocket();
    private AlertDialog panel;
    private AlertDialog camera;
    private int cameraGeneration;
    private int cameraGravity;
    private int cameraWidth;
    private ImageView cameraImage;
    private BooleanSupplier roomOpen = () -> false;
    private TextView cameraStatus;
    private long cameraDeadline;
    private int cameraTimeout;
    private boolean cameraReady;
    private boolean cameraFailed;
    private AlertDialog notification;
    private final LumaAnnouncement announcement;
    private final Handler announcements = new Handler(Looper.getMainLooper());
    private TextView assistStatus;
    private TextView assistTranscript;
    private Button stopListening;
    private boolean forwardedVoice;
    private boolean audioOnlyAssist;
    private volatile boolean recording;
    private volatile int generation;
    private MediaPlayer reply;
    private LumaSocket lgDisplay;
    private String displayTv;
    private String recognizedSpeech = "";
    private String replyText = "";
    private String audioPath = "";
    private String replyMediaId = "";
    private final ArrayDeque<JSONObject> displayUpdates = new ArrayDeque<>();
    private final Runnable dismissAssist = this::closeAssist;
    private final Runnable assistTimeout = () -> {
        recording = false;
        voice.close();
        updateAssist("error", "Assist timed out.");
        scheduleAssistDismiss();
    };

    LumaMedia(MainActivity activity) { this(activity, false); }

    LumaMedia(Context context, boolean overlay) {
        this.activity = context;
        this.overlay = overlay;
        announcement = new LumaAnnouncement(context, overlay, this::relayoutAlerts);
    }

    void observeRoomControls(LumaRoomControls controls) {
        roomOpen = controls::isShowing;
        controls.onVisibilityChanged(this::positionCamera);
    }

    static boolean validCamera(JSONObject event) {
        return event.optString("camera").matches("camera\\.[a-z0-9_]+");
    }

    void chooseCamera(LumaSocket socket, String address, String token) {
        socket.request("get_states", json(), result -> {
            if (!(result instanceof JSONArray)) return;
            JSONArray states = (JSONArray) result;
            List<String> names = new ArrayList<>(), ids = new ArrayList<>();
            for (int i = 0; i < states.length(); i++) {
                JSONObject state = states.optJSONObject(i);
                if (state == null) continue;
                String id = state.optString("entity_id");
                if (!id.matches("camera\\.[a-z0-9_]+")) continue;
                JSONObject attrs = state.optJSONObject("attributes");
                ids.add(id);
                names.add(attrs == null ? id : attrs.optString("friendly_name", id));
            }
            if (names.isEmpty()) { status("No camera entities are available."); return; }
            LumaPanel.dialog(activity).setTitle("Cameras").setItems(names.toArray(new String[0]),
                    (dialog, row) -> openCamera(address, token, ids.get(row), names.get(row)))
                    .setNegativeButton("Close", null).show();
        });
    }

    private void openCamera(String address, String token, String id, String name) {
        openCamera(address, token, id, name, 0, "", 0);
    }

    void showCamera(String address, String token, JSONObject event) {
        String id = event.optString("camera");
        String title = event.optString("title").trim();
        int seconds = Math.max(3, Math.min(120, event.optInt("timeout", 15)));
        int size = Math.max(15, Math.min(45, event.optInt("size", 25)));
        openCamera(address, token, id, title.isEmpty() ? "Camera" : title,
                seconds, event.optString("position"), size);
    }

    boolean hasCamera() { return camera != null; }

    boolean hasOverlay() { return camera != null || panel != null || notification != null || announcement.isShowing(); }

    void showAnnouncement(LumaSocket socket, String address, JSONObject event) {
        if (!recording && reply != null) {
            reply.release();
            reply = null;
            scheduleAssistDismiss();
        }
        announcement.show(socket, address, event, recording);
    }

    void dismissCamera() {
        cameraGeneration++;
        cameraFrames.removeCallbacksAndMessages(null);
        AlertDialog open = camera;
        camera = null;
        cameraImage = null;
        if (open != null) {
            open.setOnDismissListener(null);
            open.dismiss();
        }
    }

    boolean hasForwardedVoice() { return forwardedVoice; }

    void showForwardedVoice(String address, JSONObject event) {
        String phase = event.optString("phase", "");
        if ("starting".equals(phase)) {
            announcement.close();
            closeAssist();
            showAssistPanel();
            forwardedVoice = true;
            stopListening.setVisibility(View.GONE);
        }
        if (!forwardedVoice) return;
        main.removeCallbacks(dismissAssist);
        main.postDelayed(dismissAssist, 60000);
        status(event.optString("message", ""));
        String transcript = event.optString("transcript", "");
        assistTranscript.setText(LumaPanel.format(transcript));
        assistTranscript.setVisibility(transcript.isEmpty() ? View.GONE : View.VISIBLE);
        if ("reply".equals(phase)) {
            String audio = event.optString("audio_path", "");
            if (audio.startsWith("/api/tts_proxy/")) play(address, audio);
            else scheduleAssistDismiss();
        } else if ("error".equals(phase)) scheduleAssistDismiss();
    }

    void showNotification(JSONObject event) {
        closeNotification();
        String title = event.optString("title", "");
        String message = event.optString("message", "");
        if (message.isEmpty()) return;
        LinearLayout card = LumaPanel.messageCard(activity);
        TextView heading = new TextView(activity);
        LumaPanel.text(heading, 21, LumaPanel.MUTED);
        heading.setText(title.isEmpty() ? "Home Assistant" : title);
        card.addView(heading);
        TextView body = new TextView(activity);
        LumaPanel.text(body, 29, LumaPanel.TEXT);
        body.setPadding(0, px(14), 0, 0);
        body.setLineSpacing(0, 1.35f);
        body.setText(LumaPanel.format(message));
        card.addView(body);
        notification = LumaPanel.dialog(activity).create();
        notification.setView(card, 0, 0, 0, 0);
        Window window = notification.getWindow();
        if (overlay) window.setType(WindowManager.LayoutParams.TYPE_ACCESSIBILITY_OVERLAY);
        window.addFlags(WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE | WindowManager.LayoutParams.FLAG_NOT_TOUCHABLE);
        notification.show();
        LumaPanel.place(activity, window, Gravity.LEFT | Gravity.TOP, px(LumaPanel.MESSAGE_WIDTH));
        relayoutAlerts();
        int seconds = Math.max(3, Math.min(120, event.optInt("seconds", 15)));
        announcements.postDelayed(this::closeNotification, seconds * 1000L);
    }

    void closeNotification() {
        announcements.removeCallbacksAndMessages(null);
        if (notification == null) return;
        notification.dismiss();
        notification = null;
        positionCamera();
    }

    private void relayoutAlerts() {
        if (notification != null) {
            Window window = notification.getWindow();
            WindowManager.LayoutParams layout = window.getAttributes();
            int spokenHeight = announcement.height();
            layout.y = px(LumaPanel.EDGE) + (spokenHeight > 0 ? spokenHeight + px(24) : 0);
            window.setAttributes(layout);
        }
        positionCamera();
    }

    private void openCamera(String address, String token, String id, String name, int seconds, String position, int size) {
        dismissCamera();
        ImageView image = new ImageView(activity);
        int screenWidth = activity.getResources().getDisplayMetrics().widthPixels;
        int width = screenWidth * (seconds > 0 ? size : 52) / 100;
        cameraImage = image;
        cameraWidth = width;
        image.setLayoutParams(new LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, width * 9 / 16));
        image.setScaleType(ImageView.ScaleType.FIT_CENTER);
        image.setBackgroundColor(LumaPanel.MEDIA);
        LinearLayout picture = new LinearLayout(activity);
        picture.setOrientation(LinearLayout.VERTICAL);
        picture.setBackground(LumaPanel.card(activity));
        picture.setClipToOutline(true);
        picture.addView(image);
        image.setContentDescription(name);
        LinearLayout caption = new LinearLayout(activity);
        caption.setOrientation(LinearLayout.VERTICAL);
        TextView title = new TextView(activity);
        LumaPanel.text(title, 23, LumaPanel.TEXT);
        title.setText(name);
        caption.addView(title);
        cameraStatus = new TextView(activity);
        LumaPanel.text(cameraStatus, 17, LumaPanel.MUTED);
        cameraStatus.setPadding(0, px(6), 0, 0);
        cameraStatus.setText("Connecting to camera…");
        caption.addView(cameraStatus);
        Button closeCamera = LumaPanel.closeButton(activity, "Close camera", this::dismissCamera);
        LinearLayout footer = new LinearLayout(activity);
        footer.setGravity(Gravity.CENTER_VERTICAL);
        footer.setPadding(px(22), px(16), px(22), px(16));
        footer.addView(caption, new LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1));
        footer.addView(closeCamera);
        picture.addView(footer);
        camera = LumaPanel.dialog(activity).create();
        camera.setView(picture, 0, 0, 0, 0);
        camera.setOnDismissListener(dialog -> dismissCamera());
        if (overlay) camera.getWindow().setType(WindowManager.LayoutParams.TYPE_ACCESSIBILITY_OVERLAY);
        camera.show();
        Window window = camera.getWindow();
        if (window != null) {
            if (seconds > 0) {
                cameraGravity = (position.startsWith("bottom") ? Gravity.BOTTOM : Gravity.TOP)
                        | (position.endsWith("left") ? Gravity.LEFT : Gravity.RIGHT);
                LumaPanel.place(activity, window, cameraGravity, width);
                positionCamera();
            } else {
                cameraGravity = Gravity.CENTER;
                LumaPanel.place(activity, window, cameraGravity, width);
            }
        }
        closeCamera.requestFocus();
        cameraDeadline = 0;
        cameraTimeout = seconds;
        cameraReady = false;
        cameraFailed = false;
        int version = cameraGeneration;
        cameraFrames.postDelayed(() -> {
            if (version != cameraGeneration || cameraReady) return;
            cameraFailed = true;
            cameraStatus.setText("Camera did not respond. Check its feed in Home Assistant.");
            cameraFrames.postDelayed(() -> {
                if (version == cameraGeneration && !cameraReady) dismissCamera();
            }, 6000);
        }, 15000);
        frame(address, token, id, image, cameraGeneration);
    }

    private void positionCamera() {
        if (camera == null || cameraGravity == Gravity.CENTER) return;
        Window window = camera.getWindow();
        if (window == null) return;
        boolean busyLeft = panel != null || notification != null || announcement.isShowing();
        boolean left = (cameraGravity & Gravity.HORIZONTAL_GRAVITY_MASK) == Gravity.LEFT && !busyLeft;
        int width = activity.getResources().getDisplayMetrics().widthPixels;
        int right = px(LumaPanel.EDGE) + (roomOpen.getAsBoolean() ? width / 3 + px(24) : 0);
        int cardWidth = busyLeft ? Math.min(cameraWidth,
                Math.max(px(280), width - right - px(LumaPanel.MESSAGE_WIDTH + 62))) : cameraWidth;
        WindowManager.LayoutParams layout = window.getAttributes();
        layout.gravity = (cameraGravity & Gravity.VERTICAL_GRAVITY_MASK) | (left ? Gravity.LEFT : Gravity.RIGHT);
        layout.x = left ? px(LumaPanel.EDGE) : right;
        layout.width = cardWidth;
        window.setAttributes(layout);
        cameraImage.getLayoutParams().height = cardWidth * 9 / 16;
        cameraImage.requestLayout();
    }

    private void frame(String address, String token, String id, ImageView view, int version) {
        new Thread(() -> {
            Bitmap bitmap = null;
            try {
                URI url = URI.create(address).resolve("/api/camera_proxy/" + id);
                HttpURLConnection connection = (HttpURLConnection) url.toURL().openConnection();
                connection.setInstanceFollowRedirects(false);
                connection.setConnectTimeout(3500);
                connection.setReadTimeout(3500);
                connection.setRequestProperty("Authorization", "Bearer " + token);
                try (InputStream input = connection.getInputStream(); ByteArrayOutputStream buffer = new ByteArrayOutputStream()) {
                    byte[] bytes = new byte[8192];
                    for (int count; (count = input.read(bytes)) > 0;) {
                        if (buffer.size() + count > MAX_IMAGE_BYTES) throw new IOException("Camera image too large");
                        buffer.write(bytes, 0, count);
                    }
                    byte[] encoded = buffer.toByteArray();
                    BitmapFactory.Options options = new BitmapFactory.Options();
                    options.inJustDecodeBounds = true;
                    BitmapFactory.decodeByteArray(encoded, 0, encoded.length, options);
                    options.inJustDecodeBounds = false;
                    options.inSampleSize = 1;
                    while (Math.max(options.outWidth, options.outHeight) / options.inSampleSize > 1600) options.inSampleSize *= 2;
                    bitmap = BitmapFactory.decodeByteArray(encoded, 0, encoded.length, options);
                } finally { connection.disconnect(); }
            } catch (IOException | IllegalArgumentException ignored) {
                // The dialog keeps the last available frame while retrying.
            }
            Bitmap next = bitmap;
            cameraFrames.post(() -> {
                if (version != cameraGeneration || camera == null) { if (next != null) next.recycle(); return; }
                if (next != null) {
                    view.setImageBitmap(next);
                    if (!cameraReady) {
                        cameraReady = true;
                        if (cameraTimeout > 0) {
                            cameraDeadline = SystemClock.elapsedRealtime() + cameraTimeout * 1000L;
                            cameraFrames.postDelayed(this::dismissCamera, cameraTimeout * 1000L);
                        }
                    }
                }
                if (next == null) {
                    if (!cameraFailed) cameraStatus.setText("Camera unavailable · retrying");
                } else if (cameraDeadline == 0) cameraStatus.setText("Back to dismiss");
                else cameraStatus.setText("Closes in " + Math.max(0, (cameraDeadline - SystemClock.elapsedRealtime() + 999) / 1000) + "s · Back to dismiss");
                cameraFrames.postDelayed(() -> frame(address, token, id, view, version), next == null ? 3000 : 1500);
            });
        }, "luma-camera").start();
    }

    void startAssist(LumaSocket configSocket, String address, String token, String tv, JSONObject roomSettings) {
        if (token.isEmpty() || !configSocket.isReady()) {
            status("Connect Home Assistant first.");
            return;
        }
        announcement.close();
        int listenSeconds = Math.max(3, Math.min(30, roomSettings.optInt("voice_listen_seconds", 12)));
        if (tv.isEmpty()) {
            assist(configSocket, address, token, "", json(), listenSeconds);
            return;
        }
        int request = generation;
        configSocket.request("luma_home/voice/config", json("tv_id", tv, "microphone", "streamer"), result -> {
            if (request != generation) return;
            if (result instanceof JSONObject) sharedAssist(configSocket, address, token, tv, result, listenSeconds);
            else configSocket.request("luma_home/voice/config", json("tv_id", tv), legacy -> {
                if (request == generation) sharedAssist(configSocket, address, token, tv, legacy, listenSeconds);
            });
        });
    }

    private void sharedAssist(LumaSocket configSocket, String address, String token, String tv,
                              Object result, int listenSeconds) {
        SharedPreferences cache = activity.getSharedPreferences(LumaRemoteOverlay.PREFS, Context.MODE_PRIVATE);
        JSONObject settings = result instanceof JSONObject ? (JSONObject) result : cachedVoice(cache, address, tv);
        if (settings == null) {
            status("Could not read the shared Assist pipeline.");
            return;
        }
        if (settings.isNull("stt_engine") || settings.optString("stt_engine").isEmpty()) {
            status("Choose a shared Assist pipeline with speech recognition.");
            return;
        }
        if (result instanceof JSONObject) {
            cache.edit().putString("assist-pipeline", json("address", address, "tv", tv, "settings", settings).toString()).apply();
        }
        assist(configSocket, address, token, tv, settings, listenSeconds);
    }

    private static JSONObject cachedVoice(SharedPreferences cache, String address, String tv) {
        try {
            JSONObject saved = new JSONObject(cache.getString("assist-pipeline", "{}"));
            if (address.equals(saved.optString("address")) && tv.equals(saved.optString("tv"))) {
                return saved.optJSONObject("settings");
            }
        } catch (JSONException ignored) { }
        return null;
    }

    private void assist(LumaSocket configSocket, String address, String token, String tv,
                        JSONObject settings, int listenSeconds) {
        if (activity.checkSelfPermission(Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED) {
            if (activity instanceof MainActivity) {
                ((MainActivity) activity).requestPermissions(new String[]{Manifest.permission.RECORD_AUDIO}, MIC_PERMISSION);
            } else status("Open Assist once in LumaX to grant microphone access.");
            return;
        }
        closeAssist();
        PowerManager power = activity.getSystemService(PowerManager.class);
        audioOnlyAssist = power != null && !power.isInteractive();
        int version = generation;
        if (tv.isEmpty() || audioOnlyAssist) {
            if (!audioOnlyAssist) showAssistPanel();
            runAssist(configSocket, address, token, tv, settings, version, listenSeconds);
            return;
        }
        configSocket.request("luma_home/voice/display", json("tv_id", tv, "origin", "streamer",
                "phase", "starting", "message", "Starting microphone…"), result -> {
            if (version != generation) return;
            String renderer = result instanceof JSONObject ? ((JSONObject) result).optString("renderer") : "";
            if ("webos".equals(renderer)) {
                lgDisplay = configSocket;
                displayTv = tv;
            } else if ("audio_only".equals(renderer)) audioOnlyAssist = true;
            else showAssistPanel();
            runAssist(configSocket, address, token, tv, settings, version, listenSeconds);
        });
    }

    private void runAssist(LumaSocket configSocket, String address, String token, String tv,
                           JSONObject settings, int version, int listenSeconds) {
        JSONObject run = json("start_stage", "stt",
                "end_stage", settings.optBoolean("voice_reply", true) ? "tts" : "intent",
                "input", json("sample_rate", SAMPLE_RATE));
        if (!settings.optString("pipeline").isEmpty()) put(run, "pipeline", settings.optString("pipeline"));
        if (!settings.isNull("device_id")) put(run, "device_id", settings.optString("device_id"));
        voice.open(address, token, () -> voice.subscribe("assist_pipeline/run",
                run,
                result -> { if (result == null) assistError("Could not start the Assist pipeline."); },
                event -> assistEvent(address, event, version, listenSeconds, () -> {
                    if (tv.isEmpty() || !settings.optBoolean("speaker_configured") || replyMediaId.isEmpty()) {
                        finishReply(address, false);
                        return;
                    }
                    configSocket.request("luma_home/voice/reply", json("tv_id", tv, "media_id", replyMediaId), result -> {
                        if (version == generation) {
                            finishReply(address, result instanceof JSONObject && ((JSONObject) result).optBoolean("played"));
                        }
                    });
                })), this::assistError);
        main.postDelayed(assistTimeout, 45000);
    }

    private void showAssistPanel() {
        Context theme = new ContextThemeWrapper(activity, R.style.Theme_LumaPanel);
        LinearLayout card = LumaPanel.messageCard(activity);

        TextView heading = new TextView(theme);
        heading.setText("Home Assistant");
        LumaPanel.text(heading, 21, LumaPanel.MUTED);
        Button closeButton = LumaPanel.closeButton(theme, "Close voice", this::closeAssist);
        card.addView(LumaPanel.heading(theme, heading, closeButton));

        assistStatus = new TextView(theme);
        assistStatus.setText("Connecting…");
        LumaPanel.text(assistStatus, 29, LumaPanel.TEXT);
        assistStatus.setPadding(0, px(14), 0, 0);
        assistStatus.setLineSpacing(0, 1.35f);
        assistStatus.setAccessibilityLiveRegion(View.ACCESSIBILITY_LIVE_REGION_POLITE);
        card.addView(assistStatus);

        assistTranscript = new TextView(theme);
        LumaPanel.text(assistTranscript, 20, LumaPanel.MUTED);
        assistTranscript.setPadding(0, px(17), 0, 0);
        assistTranscript.setLineSpacing(0, 1.4f);
        assistTranscript.setVisibility(View.GONE);
        card.addView(assistTranscript);

        LinearLayout actions = new LinearLayout(theme);
        actions.setGravity(Gravity.END);
        stopListening = new Button(theme);
        stopListening.setText("Stop listening");
        LumaPanel.text(stopListening, 20, LumaPanel.TEXT);
        stopListening.setAllCaps(false);
        stopListening.setEnabled(false);
        stopListening.setVisibility(View.GONE);
        stopListening.setOnClickListener(button -> { recording = false; status("Processing…"); });
        actions.addView(stopListening);
        card.addView(actions);

        panel = LumaPanel.dialog(activity).create();
        panel.setView(card, 0, 0, 0, 0);
        panel.setOnDismissListener(dialog -> closeAssist());
        if (overlay) panel.getWindow().setType(WindowManager.LayoutParams.TYPE_ACCESSIBILITY_OVERLAY);
        panel.show();
        Window window = panel.getWindow();
        if (window != null) LumaPanel.place(activity, window, Gravity.LEFT | Gravity.BOTTOM, px(LumaPanel.MESSAGE_WIDTH));
        positionCamera();
        closeButton.requestFocus();
    }

    private void assistEvent(String address, JSONObject event, int version, int listenSeconds, Runnable onReply) {
        if (version != generation) return;
        JSONObject data = event.optJSONObject("data");
        switch (event.optString("type")) {
            case "run-start":
                JSONObject runner = data == null ? null : data.optJSONObject("runner_data");
                int handler = runner == null ? -1 : runner.optInt("stt_binary_handler_id", -1);
                if (handler >= 0 && handler <= 255) capture((byte) handler, version, listenSeconds);
                break;
            case "stt-vad-end": recording = false; updateAssist("thinking", "Processing…"); break;
            case "stt-end":
                JSONObject recognized = data == null ? null : data.optJSONObject("stt_output");
                recognizedSpeech = recognized == null ? "" : recognized.optString("text", "");
                if (assistTranscript != null) {
                    assistTranscript.setText(recognizedSpeech);
                    assistTranscript.setVisibility(recognizedSpeech.isEmpty() ? View.GONE : View.VISIBLE);
                }
                updateAssist("thinking", "Thinking…");
                break;
            case "intent-end":
                JSONObject output = data == null ? null : data.optJSONObject("intent_output");
                JSONObject response = output == null ? null : output.optJSONObject("response");
                JSONObject speech = response == null ? null : response.optJSONObject("speech");
                JSONObject plain = speech == null ? null : speech.optJSONObject("plain");
                if (plain != null) {
                    replyText = plain.optString("speech", "Finished");
                    if (lgDisplay == null) status(replyText);
                }
                break;
            case "tts-end":
                JSONObject audio = data == null ? null : data.optJSONObject("tts_output");
                if (audio != null) {
                    String path = audio.optString("url");
                    if (path.startsWith(address + "/")) path = path.substring(address.length());
                    if (path.startsWith("/api/tts_proxy/")) audioPath = path;
                    replyMediaId = audio.optString("media_id");
                }
                break;
            case "error":
                assistError(data == null ? "Assist failed." : data.optString("message", "Assist failed."));
                break;
            case "run-end":
                recording = false;
                main.removeCallbacks(assistTimeout);
                voice.close();
                onReply.run();
                break;
        }
    }

    private void finishReply(String address, boolean delegated) {
        if (delegated) audioPath = "";
        if (lgDisplay != null) updateAssist("reply", replyText.isEmpty() ? "Finished" : replyText);
        else if (!audioPath.isEmpty()) play(address, audioPath);
        if (reply == null) scheduleAssistDismiss();
    }

    private void capture(byte handler, int version, int listenSeconds) {
        announcement.close();
        recording = true;
        updateAssist("listening", "Listening…");
        new Thread(() -> {
            AudioRecord mic = null;
            try {
                int size = AudioRecord.getMinBufferSize(SAMPLE_RATE, AudioFormat.CHANNEL_IN_MONO, AudioFormat.ENCODING_PCM_16BIT);
                mic = new AudioRecord(MediaRecorder.AudioSource.VOICE_RECOGNITION, SAMPLE_RATE,
                        AudioFormat.CHANNEL_IN_MONO, AudioFormat.ENCODING_PCM_16BIT, Math.max(size, 6400));
                mic.startRecording();
                byte[] packet = new byte[641];
                packet[0] = handler;
                long deadline = SystemClock.elapsedRealtime() + listenSeconds * 1000L;
                while (recording && version == generation && SystemClock.elapsedRealtime() < deadline) {
                    int count = mic.read(packet, 1, packet.length - 1);
                    if (count < 0) throw new IOException("Microphone read failed");
                    if (count > 0 && version == generation) voice.binary(Arrays.copyOf(packet, count + 1));
                }
            } catch (IOException | IllegalArgumentException | IllegalStateException | SecurityException error) {
                main.post(() -> { if (version == generation) assistError("No microphone is available to LumaX."); });
            } finally {
                if (mic != null) mic.release();
                main.post(() -> { if (version == generation) { recording = false; voice.binary(new byte[]{handler}); } });
            }
        }, "luma-microphone").start();
    }

    private void play(String address, String path) {
        if (!path.startsWith("/") || path.startsWith("//")) return;
        try {
            if (reply != null) reply.release();
            reply = new MediaPlayer();
            reply.setDataSource(URI.create(address).resolve(path).toString());
            reply.setOnPreparedListener(MediaPlayer::start);
            reply.setOnCompletionListener(player -> {
                if (reply == player) scheduleAssistDismiss();
            });
            reply.setOnErrorListener((player, what, extra) -> {
                if (reply == player) scheduleAssistDismiss();
                return true;
            });
            reply.prepareAsync();
        } catch (IOException | IllegalArgumentException ignored) {
            if (reply != null) { reply.release(); reply = null; }
            scheduleAssistDismiss();
        }
    }

    private void scheduleAssistDismiss() {
        main.removeCallbacks(dismissAssist);
        main.postDelayed(dismissAssist, ASSIST_DISMISS_DELAY_MS);
    }

    private void assistError(String message) {
        recording = false;
        main.removeCallbacks(assistTimeout);
        voice.close();
        updateAssist("error", message);
        scheduleAssistDismiss();
    }

    private void updateAssist(String phase, String message) {
        if (lgDisplay == null) {
            status(message);
            return;
        }
        boolean idle = displayUpdates.isEmpty();
        displayUpdates.add(json("tv_id", displayTv, "origin", "streamer", "renderer", "webos",
                "phase", phase, "message", limited(message, 4096),
                "transcript", limited(recognizedSpeech, 4096), "audio_path", limited(audioPath, 2048)));
        if (idle) sendDisplayUpdate();
    }

    private void sendDisplayUpdate() {
        int version = generation;
        lgDisplay.request("luma_home/voice/display", displayUpdates.getFirst(), result -> {
            if (version != generation) return;
            displayUpdates.removeFirst();
            if (!displayUpdates.isEmpty()) sendDisplayUpdate();
        });
    }

    private static String limited(String text, int max) {
        return text.length() > max ? text.substring(0, max) : text;
    }

    private void status(String text) {
        if (assistStatus != null) {
            assistStatus.setText(LumaPanel.format(text));
            stopListening.setEnabled(recording);
            stopListening.setVisibility(recording && !forwardedVoice ? View.VISIBLE : View.GONE);
        }
        else if (!audioOnlyAssist) android.widget.Toast.makeText(activity, text, android.widget.Toast.LENGTH_SHORT).show();
    }

    private int px(int value) { return LumaPanel.tvPx(activity, value); }

    void close() {
        dismissCamera();
        closeAssist();
        closeNotification();
        announcement.close();
    }

    private void closeAssist() {
        generation++;
        forwardedVoice = false;
        audioOnlyAssist = false;
        lgDisplay = null;
        displayTv = null;
        recognizedSpeech = "";
        replyText = "";
        audioPath = "";
        replyMediaId = "";
        displayUpdates.clear();
        recording = false;
        main.removeCallbacksAndMessages(null);
        voice.close();
        if (reply != null) { reply.release(); reply = null; }
        AlertDialog open = panel;
        panel = null;
        assistStatus = null;
        assistTranscript = null;
        stopListening = null;
        if (open != null) { open.setOnDismissListener(null); open.dismiss(); }
        positionCamera();
    }
}

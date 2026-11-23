package com.gathin.tvhome;

import android.app.AlertDialog;
import android.content.Context;
import android.graphics.Color;
import android.graphics.drawable.ColorDrawable;
import android.os.Handler;
import android.os.Looper;
import android.view.ContextThemeWrapper;
import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup;
import android.view.Window;
import android.view.WindowManager;
import android.widget.ArrayAdapter;
import android.widget.Button;
import android.widget.LinearLayout;
import android.widget.SeekBar;
import android.widget.TextView;
import android.widget.Toast;

import org.json.JSONArray;
import org.json.JSONObject;

import java.text.NumberFormat;
import java.util.ArrayList;
import java.util.List;
import java.util.function.Consumer;
import java.util.function.IntConsumer;

import static com.gathin.tvhome.LumaSocket.json;

/** Uses the same controls from the launcher and the remote's overlay. */
final class LumaRoomControls {
    static final String REVERSE_LIGHT_KEYS = "reverse-light-keys";
    private static final String[] SENSORS = {"temperature", "humidity", "co2"};
    private static final int[] SENSOR_ICONS = {R.drawable.ic_lumax_temperature, R.drawable.ic_lumax_humidity,
            R.drawable.ic_lumax_co2};
    private final Context activity;
    private final LumaSocket socket;
    private final boolean overlay;
    private final Consumer<JSONObject> cameraOpener;
    private final Handler main = new Handler(Looper.getMainLooper());
    private AlertDialog panel;
    private int generation;
    private Runnable visibilityChanged = () -> { };

    LumaRoomControls(Context context, LumaSocket socket, boolean overlay, Consumer<JSONObject> cameraOpener) {
        this.activity = context;
        this.socket = socket;
        this.overlay = overlay;
        this.cameraOpener = cameraOpener;
    }

    void onVisibilityChanged(Runnable changed) { visibilityChanged = changed; }

    static String controlService(String id) {
        int separator = id.indexOf('.');
        if (separator < 0) return "";
        switch (id.substring(0, separator)) {
            case "light": case "switch": case "fan": case "input_boolean": return "toggle";
            case "climate": return "power";
            case "cover": return "cover";
            case "lock": return "lock";
            case "media_player": return "media_play_pause";
            case "automation": return "trigger";
            case "scene": case "script": return "turn_on";
            case "button": case "input_button": return "press";
            default: return "";
        }
    }

    static boolean displayableEntity(String id) {
        return !controlService(id).isEmpty() || id.startsWith("camera.")
                || id.startsWith("number.") || id.startsWith("input_number.")
                || id.startsWith("select.") || id.startsWith("input_select.")
                || id.startsWith("sensor.") || id.startsWith("binary_sensor.");
    }

    static String entityLabel(JSONObject state) {
        String id = state.optString("entity_id");
        JSONObject attributes = state.optJSONObject("attributes");
        return attributes == null ? id : attributes.optString("friendly_name", id);
    }

    void show(String tv, JSONArray ids, JSONObject settings) {
        close();
        int request = generation;
        if (!socket.isReady()) { message("Connect Home Assistant first."); return; }
        boolean paired = !tv.isEmpty();
        JSONArray requested = new JSONArray();
        for (int i = 0; i < ids.length(); i++) requested.put(ids.optString(i));
        for (String key : SENSORS) {
            String sensor = settings.optString(paired ? key : "sensor_" + key);
            if (!sensor.isEmpty()) requested.put(sensor);
        }
        Consumer<Object> showStates = result -> {
            if (request != generation) return;
            if (result == null) { message("Room controls are unavailable."); return; }
            JSONArray states = array(result);
            List<JSONObject> options = new ArrayList<>();
            for (int i = 0; i < ids.length(); i++) {
                String id = ids.optString(i);
                if (!displayableEntity(id)) continue;
                for (int j = 0; j < states.length(); j++) {
                    JSONObject state = states.optJSONObject(j);
                    if (state == null || !id.equals(state.optString("entity_id"))) continue;
                    options.add(state);
                    break;
                }
            }
            boolean reverse = reverseLightKeys(activity, settings);
            Runnable back = () -> show(tv, ids, settings);
            LinearLayout title = header(settings, states, paired);
            if (options.isEmpty()) {
                TextView empty = new TextView(activity);
                LumaPanel.text(empty, 23, LumaPanel.MUTED);
                empty.setPadding(0, px(14), 0, 0);
                empty.setText("Choose room controls in Settings.");
                title.addView(empty);
            }
            ArrayAdapter<JSONObject> adapter = controlRows(options);
            AlertDialog dialog = showSidePanel(LumaPanel.dialog(activity)
                    .setCustomTitle(title)
                    .setAdapter(adapter, null));
            dialog.getListView().setPadding(px(34), px(5), px(34), px(5));
            dialog.getListView().setDivider(new ColorDrawable(Color.TRANSPARENT));
            dialog.getListView().setDividerHeight(px(10));
            dialog.getListView().setOnItemClickListener((parent, view, row, id) ->
                    activate(options.get(row), !reverse, back, adapter::notifyDataSetChanged));
            dialog.getListView().setOnItemLongClickListener((parent, view, row, id) -> {
                JSONObject state = options.get(row);
                if (!supportsBrightness(state)) return false;
                activate(state, reverse, back, adapter::notifyDataSetChanged);
                return true;
            });
        };
        if (paired) {
            socket.request("luma_home/states", json("tv_id", tv, "entity_ids", requested), result -> {
                if (request != generation) return;
                if (result == null && socket.isReady()) socket.request("get_states", json(), showStates);
                else showStates.accept(result);
            });
        } else socket.request("get_states", json(), showStates);
    }

    static boolean reverseLightKeys(Context context, JSONObject settings) {
        return settings.isNull("reverse_light_keys")
                ? context.getSharedPreferences(LumaRemoteOverlay.PREFS, Context.MODE_PRIVATE)
                        .getBoolean(REVERSE_LIGHT_KEYS, false)
                : settings.optBoolean("reverse_light_keys");
    }

    private LinearLayout header(JSONObject settings, JSONArray states, boolean paired) {
        Context theme = new ContextThemeWrapper(activity, R.style.Theme_LumaPanel);
        LinearLayout header = new LinearLayout(theme);
        header.setOrientation(LinearLayout.VERTICAL);
        header.setPadding(px(34), px(34), px(34), 0);
        TextView title = new TextView(theme);
        title.setText(settings.optString("room", "Home"));
        LumaPanel.text(title, 39, LumaPanel.TEXT);
        title.setFontVariationSettings("'wght' 500");
        Button dismiss = LumaPanel.closeButton(theme, "Close Room controls", this::close);
        header.addView(LumaPanel.heading(theme, title, dismiss));

        LinearLayout readings = new LinearLayout(theme);
        readings.setPadding(0, px(12), 0, px(10));
        if (settings.optBoolean("climate", true)) {
            for (int i = 0; i < SENSORS.length; i++) {
                String entity = settings.optString(paired ? SENSORS[i] : "sensor_" + SENSORS[i]);
                if (entity.isEmpty()) continue;
                for (int j = 0; j < states.length(); j++) {
                    JSONObject state = states.optJSONObject(j);
                    if (state == null || !entity.equals(state.optString("entity_id"))) continue;
                    String value = state.optString("state");
                    if (value.isEmpty() || "unavailable".equals(value) || "unknown".equals(value)) break;
                    JSONObject attrs = state.optJSONObject("attributes");
                    String units = attrs == null ? "" : attrs.optString("unit_of_measurement");
                    NumberFormat number = NumberFormat.getNumberInstance();
                    number.setMaximumFractionDigits(i == 0 ? 1 : 0);
                    try { value = number.format(Double.parseDouble(value)); }
                    catch (NumberFormatException ignored) { }
                    TextView reading = new TextView(theme);
                    reading.setText((value + " " + units).trim());
                    LumaPanel.text(reading, 23, LumaPanel.MUTED);
                    reading.setCompoundDrawablePadding(px(7));
                    android.graphics.drawable.Drawable icon = theme.getDrawable(SENSOR_ICONS[i]);
                    if (icon != null) icon.setBounds(0, 0, px(24), px(24));
                    reading.setCompoundDrawablesRelative(icon, null, null, null);
                    reading.setPadding(0, 0, px(18), px(6));
                    readings.addView(reading);
                    break;
                }
            }
        }
        if (readings.getChildCount() > 0) header.addView(readings);
        TextView label = new TextView(theme);
        label.setText("Quick controls");
        LumaPanel.text(label, 24, LumaPanel.MUTED);
        label.setPadding(0, px(12), 0, 0);
        header.addView(label);
        return header;
    }

    private ArrayAdapter<JSONObject> controlRows(List<JSONObject> controls) {
        Context theme = new ContextThemeWrapper(activity, R.style.Theme_LumaPanel);
        return new ArrayAdapter<JSONObject>(theme, 0, controls) {
            @Override public View getView(int position, View converted, ViewGroup parent) {
                TextView row;
                if (converted instanceof TextView) row = (TextView) converted;
                else {
                    row = new TextView(theme);
                    LumaPanel.text(row, 26, LumaPanel.TEXT);
                    row.setGravity(Gravity.CENTER_VERTICAL);
                    row.setMinHeight(px(66));
                    row.setPadding(px(20), px(12), px(20), px(12));
                    row.setBackground(LumaPanel.shape(theme, LumaPanel.CONTROL, 18, 0x28ffffff, 1));
                }
                JSONObject state = getItem(position);
                String display = state.optString("state");
                if ("on".equals(display) && supportsBrightness(state)) display = brightness(state) + "%";
                row.setText(entityLabel(state) + "  ·  " + display);
                return row;
            }
        };
    }

    private void activate(JSONObject state, boolean adjust, Runnable back, Runnable refresh) {
        String id = state.optString("entity_id");
        String current = state.optString("state");
        if ("unknown".equals(current) || "unavailable".equals(current)) return;
        if (adjust && supportsBrightness(state)) {
            close();
            showLight(state, back);
            return;
        }
        String domain = id.substring(0, id.indexOf('.'));
        if ("camera".equals(domain)) {
            if (cameraOpener == null) { message("Camera preview is unavailable."); return; }
            close();
            main.post(() -> cameraOpener.accept(state));
            return;
        }
        if ("number".equals(domain) || "input_number".equals(domain)) {
            close();
            showNumber(state, back);
            return;
        }
        if ("select".equals(domain) || "input_select".equals(domain)) {
            close();
            showOptions(state, back);
            return;
        }
        String service = controlService(id);
        if (service.isEmpty()) return;
        String command = service;
        if ("power".equals(command)) command = "off".equals(current) ? "turn_on" : "turn_off";
        else if ("cover".equals(command)) command = "closed".equals(current) ? "open_cover" : "close_cover";
        else if ("lock".equals(command)) command = "locked".equals(current) ? "unlock" : "lock";
        runControl(id, command, json("entity_id", id), () -> {
            if ("toggle".equals(service)) {
                LumaSocket.put(state, "state", "on".equals(state.optString("state")) ? "off" : "on");
                refresh.run();
            }
        });
    }

    private void showNumber(JSONObject state, Runnable back) {
        String id = state.optString("entity_id");
        JSONObject attributes = state.optJSONObject("attributes");
        double min = attributes == null ? 0 : attributes.optDouble("min", 0);
        double max = attributes == null ? 100 : attributes.optDouble("max", 100);
        double step = attributes == null ? 1 : attributes.optDouble("step", 1);
        if (!(max > min) || !(step > 0)) { message("This number control has no usable range."); back.run(); return; }
        int ticks = Math.max(1, Math.min(10_000, (int) Math.round((max - min) / step)));
        double current;
        try { current = Double.parseDouble(state.optString("state")); }
        catch (NumberFormatException ignored) { current = min; }
        int initial = Math.max(0, Math.min(ticks, (int) Math.round((current - min) / step)));
        LinearLayout content = new LinearLayout(activity); content.setOrientation(LinearLayout.VERTICAL);
        content.setPadding(px(34), px(14), px(34), px(34));
        String unit = attributes == null ? "" : attributes.optString("unit_of_measurement");
        SeekBar focus = addSlider(content, entityLabel(state), unit.isEmpty() ? "" : " " + unit,
                0, ticks, 1, initial, tick -> runControl(id, "set_value",
                        json("entity_id", id, "value", min + tick * step)));
        LinearLayout title = new LinearLayout(activity); title.setPadding(px(34), px(34), px(34), px(12));
        TextView name = new TextView(activity); name.setText(entityLabel(state)); LumaPanel.text(name, 39, LumaPanel.TEXT);
        title.addView(LumaPanel.heading(activity, name, LumaPanel.closeButton(activity, "Back to Room controls", () -> { close(); back.run(); })));
        showSidePanel(LumaPanel.dialog(activity).setCustomTitle(title).setView(content));
        panel.setOnDismissListener(dialog -> { visibilityChanged.run(); main.postDelayed(back, 250); });
        focus.requestFocus();
    }

    private void showOptions(JSONObject state, Runnable back) {
        String id = state.optString("entity_id");
        JSONObject attributes = state.optJSONObject("attributes");
        JSONArray choices = attributes == null ? new JSONArray() : array(attributes.opt("options"));
        if (choices.length() == 0) { message("This selector has no options."); back.run(); return; }
        String[] labels = new String[choices.length()];
        for (int i = 0; i < choices.length(); i++) labels[i] = choices.optString(i);
        LumaPanel.dialog(activity).setTitle(entityLabel(state)).setItems(labels, (dialog, row) ->
                runControl(id, "select_option", json("entity_id", id, "option", labels[row]), () -> {
                    LumaSocket.put(state, "state", labels[row]);
                    back.run();
                })).setOnDismissListener(dialog -> main.postDelayed(back, 250)).show();
    }

    private static boolean supportsBrightness(JSONObject state) {
        if (!state.optString("entity_id").startsWith("light.")) return false;
        JSONObject attributes = state.optJSONObject("attributes");
        if (attributes == null) return false;
        if (attributes.optInt("brightness", -1) >= 0) return true;
        JSONArray modes = array(attributes.opt("supported_color_modes"));
        for (int i = 0; i < modes.length(); i++) {
            String mode = modes.optString(i);
            if (!mode.isEmpty() && !"onoff".equals(mode) && !"unknown".equals(mode)) return true;
        }
        return false;
    }

    private static int brightness(JSONObject state) {
        JSONObject attributes = state.optJSONObject("attributes");
        int raw = attributes == null ? 255 : attributes.optInt("brightness", 255);
        return Math.max(1, Math.min(100, Math.round(raw * 100f / 255f)));
    }

    private void showLight(JSONObject state, Runnable back) {
        String id = state.optString("entity_id");
        boolean on = "on".equals(state.optString("state"));
        LinearLayout content = new LinearLayout(activity);
        content.setOrientation(LinearLayout.VERTICAL);
        content.setPadding(px(34), px(14), px(34), px(34));
        SeekBar focus = addSlider(content, "Brightness", "%", 0, 100, 10,
                on ? brightness(state) : 0, percent -> {
            if (percent == 0) runControl(id, "turn_off", json("entity_id", id));
            else runControl(id, "turn_on", json("entity_id", id, "brightness_pct", percent));
        });
        JSONObject attributes = state.optJSONObject("attributes");
        if (attributes != null && supportsWarmth(attributes)) {
            int min = kelvinLimit(attributes, "min_color_temp_kelvin", "max_mireds", 2000);
            int max = kelvinLimit(attributes, "max_color_temp_kelvin", "min_mireds", 6500);
            if (max > min) {
                int current = kelvinLimit(attributes, "color_temp_kelvin", "color_temp", (min + max) / 2);
                addSlider(content, "Warmth", " K", min, max, 100, current,
                        kelvin -> runControl(id, "turn_on", json("entity_id", id, "color_temp_kelvin", kelvin)));
            }
        }
        LinearLayout title = new LinearLayout(activity);
        title.setPadding(px(34), px(34), px(34), px(12));
        TextView name = new TextView(activity);
        name.setText(entityLabel(state));
        LumaPanel.text(name, 39, LumaPanel.TEXT);
        title.addView(LumaPanel.heading(activity, name,
                LumaPanel.closeButton(activity, "Back to Room controls", () -> {
                    close();
                    back.run();
                })));
        Button power = new Button(activity);
        LumaPanel.text(power, 26, LumaPanel.TEXT);
        power.setText(on ? "On" : "Off");
        power.setAllCaps(false);
        power.setGravity(Gravity.CENTER_VERTICAL);
        power.setPadding(px(20), px(12), px(20), px(12));
        power.setBackground(LumaPanel.shape(activity, LumaPanel.CONTROL, 18, 0x28ffffff, 1));
        LinearLayout.LayoutParams powerSize = new LinearLayout.LayoutParams(-1, px(66));
        powerSize.topMargin = 0;
        content.addView(power, powerSize);
        power.setOnClickListener(view -> runControl(id, "toggle", json("entity_id", id), () -> {
            boolean enabled = !"on".equals(state.optString("state"));
            LumaSocket.put(state, "state", enabled ? "on" : "off");
            power.setText(enabled ? "On" : "Off");
        }));
        showSidePanel(LumaPanel.dialog(activity).setCustomTitle(title).setView(content));
        panel.setOnDismissListener(dialog -> {
            visibilityChanged.run();
            main.postDelayed(back, 250);
        });
        focus.requestFocus();
    }

    private static boolean supportsWarmth(JSONObject attributes) {
        JSONArray modes = array(attributes.opt("supported_color_modes"));
        for (int i = 0; i < modes.length(); i++) if ("color_temp".equals(modes.optString(i))) return true;
        return false;
    }

    private static int kelvinLimit(JSONObject attributes, String kelvin, String mired, int fallback) {
        int degrees = attributes.optInt(kelvin);
        if (degrees > 0) return degrees;
        int reciprocal = attributes.optInt(mired);
        return reciprocal > 0 ? Math.round(1000000f / reciprocal) : fallback;
    }

    private SeekBar addSlider(LinearLayout content, String label, String unit, int min, int max,
                              int increment, int current, IntConsumer onChange) {
        TextView level = new TextView(activity);
        SeekBar slider = new SeekBar(activity);
        slider.setMax(max - min);
        slider.setKeyProgressIncrement(increment);
        slider.setProgress(current - min);
        slider.setContentDescription(label);
        slider.setFocusable(true);
        level.setText(label + " · " + (slider.getProgress() + min) + unit);
        LumaPanel.text(level, 26, LumaPanel.TEXT);
        android.graphics.drawable.GradientDrawable thumb = new android.graphics.drawable.GradientDrawable();
        thumb.setShape(android.graphics.drawable.GradientDrawable.OVAL);
        thumb.setColor(Color.WHITE); thumb.setStroke(px(3), 0xffd8dfed); thumb.setSize(px(34), px(34));
        slider.setThumb(thumb); slider.setThumbOffset(px(17));
        slider.setPadding(px(17), 0, px(17), 0);
        int[] colors = "Warmth".equals(label) ? new int[]{0xffffb64d, 0xffffe4b3, 0xffdeefff}
                : new int[]{0x40ffffff, 0x40ffffff};
        android.graphics.drawable.GradientDrawable track = new android.graphics.drawable.GradientDrawable(
                android.graphics.drawable.GradientDrawable.Orientation.LEFT_RIGHT, colors);
        track.setCornerRadius(px(12));
        android.graphics.drawable.LayerDrawable tracks = new android.graphics.drawable.LayerDrawable(
                new android.graphics.drawable.Drawable[]{track});
        tracks.setLayerHeight(0, px(12)); tracks.setLayerGravity(0, Gravity.CENTER_VERTICAL);
        slider.setProgressDrawable(tracks);
        content.addView(level);
        LinearLayout.LayoutParams sliderSize = new LinearLayout.LayoutParams(-1, px(48));
        sliderSize.topMargin = 0;
        sliderSize.bottomMargin = px(28);
        content.addView(slider, sliderSize);
        Runnable apply = () -> onChange.accept(slider.getProgress() + min);
        slider.setOnSeekBarChangeListener(new SeekBar.OnSeekBarChangeListener() {
            @Override public void onProgressChanged(SeekBar view, int progress, boolean fromUser) {
                level.setText(label + " · " + (progress + min) + unit);
                if (fromUser) {
                    main.removeCallbacks(apply);
                    main.postDelayed(apply, 250);
                }
            }
            @Override public void onStartTrackingTouch(SeekBar view) { }
            @Override public void onStopTrackingTouch(SeekBar view) { }
        });
        return slider;
    }

    private void runControl(String id, String service, JSONObject serviceData) {
        runControl(id, service, serviceData, () -> { });
    }

    private void runControl(String id, String service, JSONObject serviceData, Runnable success) {
        socket.request("call_service", json("domain", id.substring(0, id.indexOf('.')),
                "service", service, "service_data", serviceData),
                reply -> {
                    if (reply == null) message("Home Assistant could not run the control.");
                    else success.run();
                });
    }

    boolean isShowing() { return panel != null && panel.isShowing(); }

    void close() {
        generation++;
        main.removeCallbacksAndMessages(null);
        if (panel == null) return;
        panel.setOnDismissListener(null);
        panel.dismiss();
        panel = null;
        visibilityChanged.run();
    }

    private AlertDialog showSidePanel(AlertDialog.Builder builder) {
        panel = builder.create();
        Window window = panel.getWindow();
        if (window == null) return panel;
        if (overlay) window.setType(WindowManager.LayoutParams.TYPE_ACCESSIBILITY_OVERLAY);
        LumaPanel.sideSheet(activity, window);
        panel.show();
        LumaPanel.sideSheet(activity, window);
        if (panel.getListView() != null) panel.getListView().setSelector(LumaPanel.focusOutline(activity));
        if (panel.getListView() != null) panel.getListView().setDrawSelectorOnTop(true);
        panel.setOnDismissListener(dialog -> visibilityChanged.run());
        visibilityChanged.run();
        return panel;
    }

    private void message(String text) {
        Toast.makeText(activity, text, Toast.LENGTH_SHORT).show();
    }

    private int dp(int value) {
        return Math.round(value * activity.getResources().getDisplayMetrics().density);
    }

    private int px(int value) { return LumaPanel.tvPx(activity, value); }

    private static JSONArray array(Object value) {
        return value instanceof JSONArray ? (JSONArray) value : new JSONArray();
    }
}

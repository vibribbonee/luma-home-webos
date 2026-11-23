package com.gathin.tvhome;

import android.app.Dialog;
import android.app.AlertDialog;
import android.content.Context;
import android.graphics.Color;
import android.graphics.drawable.StateListDrawable;
import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup;
import android.view.Window;
import android.view.WindowManager;
import android.widget.ArrayAdapter;
import android.widget.Button;
import android.widget.CheckedTextView;
import android.widget.EditText;
import android.widget.LinearLayout;
import android.widget.ListView;
import android.widget.TextView;
import android.widget.Toast;
import org.json.JSONArray;
import org.json.JSONObject;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.function.Consumer;

/** A bounded scrolling list with fixed actions; search never changes the selection. */
final class LumaControlPicker {
    private final Context context;
    private final Consumer<JSONArray> save;
    private final boolean shared;
    private final Map<String, String> labels = new LinkedHashMap<>();
    private final LinkedHashSet<String> selected = new LinkedHashSet<>();
    private final List<String> visible = new ArrayList<>();
    private String query = "", filter = "selected";
    private Dialog dialog;
    private ListView list;
    private TextView summary;
    private Button filterButton;
    private boolean finished;

    LumaControlPicker(Context context, JSONArray states, JSONArray current, boolean shared, Consumer<JSONArray> save) {
        this.context = context;
        this.save = save;
        this.shared = shared;
        for (int i = 0; i < current.length(); i++) selected.add(current.optString(i));
        List<JSONObject> options = new ArrayList<>();
        for (int i = 0; i < states.length(); i++) {
            JSONObject state = states.optJSONObject(i);
            if (state != null && LumaRoomControls.displayableEntity(state.optString("entity_id"))) options.add(state);
        }
        options.sort((a, b) -> LumaRoomControls.entityLabel(a).compareToIgnoreCase(LumaRoomControls.entityLabel(b)));
        for (JSONObject state : options) labels.put(state.optString("entity_id"), LumaRoomControls.entityLabel(state));
        for (String id : selected) if (!labels.containsKey(id)) labels.put(id, id);
        if (selected.isEmpty()) filter = "all";
    }

    void show() {
        dialog = new Dialog(context, R.style.Theme_LumaPanel);
        LinearLayout root = new LinearLayout(context);
        root.setOrientation(LinearLayout.VERTICAL);
        root.setPadding(px(34), px(34), px(34), px(24));
        TextView title = new TextView(context);
        title.setText("Room controls"); LumaPanel.text(title, 39, LumaPanel.TEXT);
        root.addView(title);
        summary = new TextView(context); LumaPanel.text(summary, 20, LumaPanel.MUTED);
        summary.setPadding(0, px(12), 0, px(18)); root.addView(summary);
        LinearLayout actions = new LinearLayout(context);
        Button done = button("Save", () -> finish(true));
        Button cancel = button("Cancel", () -> finish(false));
        Button search = button("Search", this::search);
        filterButton = button("Selected", this::chooseFilter);
        for (Button button : new Button[]{done, cancel, search, filterButton}) {
            LinearLayout.LayoutParams size = new LinearLayout.LayoutParams(0, px(58), 1);
            size.setMarginEnd(px(6)); actions.addView(button, size);
        }
        root.addView(actions);
        list = new ListView(context); list.setId(View.generateViewId());
        list.setChoiceMode(ListView.CHOICE_MODE_MULTIPLE);
        list.setSelector(LumaPanel.focusOutline(context)); list.setDrawSelectorOnTop(true);
        list.setDivider(new android.graphics.drawable.ColorDrawable(Color.TRANSPARENT)); list.setDividerHeight(px(8));
        list.setPadding(0, px(16), 0, 0);
        for (Button button : new Button[]{done, cancel, search, filterButton}) button.setNextFocusDownId(list.getId());
        list.setNextFocusUpId(done.getId());
        root.addView(list, new LinearLayout.LayoutParams(-1, 0, 1));
        list.setOnItemClickListener((parent, view, position, item) -> {
            String id = visible.get(position);
            if (selected.contains(id)) selected.remove(id);
            else if (selected.size() < 200) selected.add(id);
            else {
                list.setItemChecked(position, false);
                Toast.makeText(context, "Choose up to 200 room controls.", Toast.LENGTH_SHORT).show();
            }
            if ("selected".equals(filter)) refresh(); else updateSummary();
        });
        dialog.setContentView(root, new ViewGroup.LayoutParams(-1, -1));
        dialog.setOnCancelListener(ignored -> finish(true));
        dialog.show();
        Window window = dialog.getWindow();
        if (window != null) LumaPanel.sideSheet(context, window);
        refresh(); done.requestFocus();
    }

    private Button button(String label, Runnable click) {
        Button button = new Button(context); button.setId(View.generateViewId());
        LumaPanel.text(button, 22, LumaPanel.TEXT); button.setAllCaps(false); button.setText(label);
        button.setPadding(0, 0, 0, 0);
        StateListDrawable background = new StateListDrawable();
        background.addState(new int[]{android.R.attr.state_focused}, LumaPanel.shape(context, 0xff343743, 12, Color.WHITE, 3));
        background.addState(new int[0], LumaPanel.shape(context, LumaPanel.CONTROL, 12, 0x28ffffff, 1));
        button.setBackground(background); button.setOnClickListener(view -> click.run());
        return button;
    }

    private void refresh() {
        visible.clear();
        for (Map.Entry<String, String> entry : labels.entrySet())
            if (LumaControlSearch.matches(entry.getKey(), entry.getValue(), query, filter, selected.contains(entry.getKey()))) visible.add(entry.getKey());
        list.setAdapter(new ArrayAdapter<String>(context, android.R.layout.simple_list_item_multiple_choice, visible) {
            @Override public View getView(int position, View convert, ViewGroup parent) {
                CheckedTextView row = (CheckedTextView) super.getView(position, convert, parent);
                String id = getItem(position);
                row.setText(labels.get(id) + "\n" + id);
                LumaPanel.text(row, 22, LumaPanel.TEXT);
                row.setMinHeight(px(80)); row.setPadding(px(16), px(10), px(12), px(10));
                row.setBackground(LumaPanel.shape(context, LumaPanel.CONTROL, 18, 0x28ffffff, 1));
                row.setCheckMarkTintList(android.content.res.ColorStateList.valueOf(LumaPanel.TEXT));
                return row;
            }
        });
        for (int i = 0; i < visible.size(); i++) list.setItemChecked(i, selected.contains(visible.get(i)));
        updateSummary();
    }

    private void updateSummary() {
        summary.setText(selected.size() + " selected · " + visible.size() + " shown\n"
                + (shared ? "Back saves. Also editable in HA → Luma Home → Configure." : "Back saves. Cancel discards changes."));
    }

    private void search() {
        EditText input = new EditText(context); input.setSingleLine(true); input.setText(query);
        AlertDialog searchDialog = LumaPanel.dialog(context).setTitle("Search names or entity IDs").setView(input)
                .setPositiveButton("Search", (ignored, which) -> {
                    query = input.getText().toString(); filter = "all"; filterButton.setText("All types"); refresh();
                }).setNeutralButton("Clear", (ignored, which) -> { query = ""; refresh(); })
                .setNegativeButton("Cancel", null).create();
        searchDialog.show(); input.requestFocus();
        if (searchDialog.getWindow() != null) searchDialog.getWindow().setSoftInputMode(WindowManager.LayoutParams.SOFT_INPUT_STATE_ALWAYS_VISIBLE);
    }

    private void chooseFilter() {
        String[] names = {"All types", "Lights", "Switches", "Fans", "Cameras and devices", "Scenes and actions", "Readings", "Selected"};
        String[] values = {"all", "light", "switch", "fan", "devices", "actions", "readings", "selected"};
        LumaPanel.dialog(context).setTitle("Filter controls").setItems(names, (ignored, which) -> {
            filter = values[which]; filterButton.setText(names[which]); refresh();
        }).show();
    }

    private void finish(boolean keep) {
        if (finished) return;
        finished = true;
        if (keep) save.accept(new JSONArray(selected));
        dialog.dismiss();
    }

    private int px(int value) { return LumaPanel.tvPx(context, value); }
}

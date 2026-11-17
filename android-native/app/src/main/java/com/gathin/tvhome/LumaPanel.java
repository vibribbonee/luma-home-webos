package com.gathin.tvhome;

import android.app.AlertDialog;
import android.content.Context;
import android.graphics.Color;
import android.graphics.drawable.ColorDrawable;
import android.graphics.drawable.GradientDrawable;
import android.graphics.drawable.StateListDrawable;
import android.graphics.Typeface;
import android.text.SpannableStringBuilder;
import android.text.style.StyleSpan;
import android.util.TypedValue;
import android.view.ViewGroup;
import android.view.Gravity;
import android.view.Window;
import android.view.WindowManager;
import android.widget.Button;
import android.widget.LinearLayout;
import android.widget.TextView;

import java.util.regex.Matcher;
import java.util.regex.Pattern;

/** Launcher colors and window treatment for the lightweight TV panels. */
final class LumaPanel {
    static final int SURFACE = 0xff1b1d24;
    static final int MEDIA = 0xff121319;
    static final int TEXT = 0xfff0f2f8;
    static final int MUTED = 0xffb8b9c1;
    static final int CONTROL = 0xff24262e;
    static final int EDGE = 38;
    static final int MESSAGE_WIDTH = 600;
    static final int PANEL_PADDING = 28;
    private static final int BORDER = 0x28ffffff;
    private static final Pattern EMPHASIS = Pattern.compile("\\*\\*([^*]+)\\*\\*");

    private LumaPanel() {}

    static AlertDialog.Builder dialog(Context context) {
        return new AlertDialog.Builder(context, R.style.Theme_LumaPanel);
    }

    static GradientDrawable card(Context context) {
        return shape(context, SURFACE, 24, BORDER, 1);
    }

    static void sideSheet(Context context, Window window) {
        window.clearFlags(WindowManager.LayoutParams.FLAG_DIM_BEHIND);
        window.setGravity(Gravity.END | Gravity.TOP);
        window.setLayout(context.getResources().getDisplayMetrics().widthPixels / 3,
                WindowManager.LayoutParams.MATCH_PARENT);
        window.setBackgroundDrawable(new ColorDrawable(SURFACE));
    }

    static int dp(Context context, int size) {
        return Math.round(size * context.getResources().getDisplayMetrics().density);
    }

    // webOS lays out overlays on a 1920-wide canvas. Scale those same measurements here.
    static int tvPx(Context context, int size) {
        return Math.round(size * context.getResources().getDisplayMetrics().widthPixels / 1920f);
    }

    static void text(TextView view, int size, int color) {
        view.setTypeface(view.getContext().getResources().getFont(R.font.luma_outfit));
        view.setTextSize(TypedValue.COMPLEX_UNIT_PX, tvPx(view.getContext(), size));
        view.setTextColor(color);
        view.setIncludeFontPadding(false);
    }

    static CharSequence format(String value) {
        SpannableStringBuilder formatted = new SpannableStringBuilder();
        Matcher matcher = EMPHASIS.matcher(value);
        int offset = 0;
        while (matcher.find()) {
            formatted.append(value, offset, matcher.start());
            int start = formatted.length();
            formatted.append(matcher.group(1));
            formatted.setSpan(new StyleSpan(Typeface.BOLD), start, formatted.length(), 0);
            offset = matcher.end();
        }
        return formatted.append(value, offset, value.length());
    }

    static GradientDrawable shape(Context context, int fill, int radius, int border, int stroke) {
        GradientDrawable background = new GradientDrawable();
        background.setColor(fill);
        background.setCornerRadius(tvPx(context, radius));
        background.setStroke(Math.max(1, tvPx(context, stroke)), border);
        return background;
    }

    static Button closeButton(Context context, String description, Runnable close) {
        Button button = new Button(context);
        text(button, 24, TEXT);
        button.setText("×");
        button.setContentDescription(description);
        button.setMinWidth(0);
        button.setMinHeight(0);
        button.setMinimumWidth(0);
        button.setMinimumHeight(0);
        button.setPadding(0, 0, 0, 0);
        StateListDrawable background = new StateListDrawable();
        background.addState(new int[]{android.R.attr.state_focused}, shape(context, 0xff343743, 12, Color.WHITE, 3));
        background.addState(new int[0], shape(context, CONTROL, 12, BORDER, 1));
        button.setBackground(background);
        button.setLayoutParams(new LinearLayout.LayoutParams(tvPx(context, 54), tvPx(context, 48)));
        button.setOnClickListener(view -> close.run());
        return button;
    }

    static LinearLayout heading(Context context, TextView title, Button close) {
        LinearLayout row = new LinearLayout(context);
        row.setGravity(Gravity.CENTER_VERTICAL);
        row.addView(title, new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1));
        row.addView(close);
        return row;
    }

    static LinearLayout messageCard(Context context) {
        LinearLayout card = new LinearLayout(context);
        card.setOrientation(LinearLayout.VERTICAL);
        int pad = tvPx(context, PANEL_PADDING);
        card.setPadding(pad, pad, pad, pad);
        card.setBackground(card(context));
        return card;
    }

    static void place(Context context, Window window, int gravity, int width) {
        window.setBackgroundDrawable(new ColorDrawable(Color.TRANSPARENT));
        window.clearFlags(WindowManager.LayoutParams.FLAG_DIM_BEHIND);
        WindowManager.LayoutParams layout = window.getAttributes();
        layout.gravity = gravity;
        layout.x = layout.y = tvPx(context, EDGE);
        layout.width = width;
        layout.height = WindowManager.LayoutParams.WRAP_CONTENT;
        window.setAttributes(layout);
    }
}

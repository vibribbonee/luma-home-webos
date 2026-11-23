package com.gathin.tvhome;

import java.text.Normalizer;
import java.util.Locale;

/** Search the same entity IDs that the shared HA room configuration stores. */
final class LumaControlSearch {
    private LumaControlSearch() { }

    static boolean matches(String id, String label, String query, String filter, boolean selected) {
        int dot = id.indexOf('.');
        if (dot < 1) return false;
        String domain = id.substring(0, dot);
        if ("selected".equals(filter) && !selected) return false;
        if ("switch".equals(filter) && !("switch".equals(domain) || "input_boolean".equals(domain))) return false;
        if ("readings".equals(filter) && !("sensor".equals(domain) || "binary_sensor".equals(domain))) return false;
        if ("actions".equals(filter) && !("scene".equals(domain) || "script".equals(domain)
                || "button".equals(domain) || "input_button".equals(domain))) return false;
        if (("light".equals(filter) || "fan".equals(filter)) && !filter.equals(domain)) return false;
        String searchable = fold(label + " " + id);
        for (String word : fold(query).trim().split("\\s+")) if (!searchable.contains(word)) return false;
        return true;
    }

    private static String fold(String value) {
        return Normalizer.normalize(value, Normalizer.Form.NFD).replaceAll("\\p{M}", "").toLowerCase(Locale.ROOT);
    }
}

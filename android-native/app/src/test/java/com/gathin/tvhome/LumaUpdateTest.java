package com.gathin.tvhome;

import org.json.JSONArray;
import org.junit.Test;

import java.util.Arrays;
import java.util.Collections;
import java.util.HashSet;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertNull;
import static org.junit.Assert.assertTrue;

public class LumaUpdateTest {
    private static JSONArray releases() throws Exception {
        return new JSONArray("[" +
                "{\"tag_name\":\"v0.4.31-preview\",\"draft\":false,\"prerelease\":true,\"assets\":[" +
                "  {\"name\":\"com.spinoff.lumahome_0.4.31_all.ipk\",\"browser_download_url\":\"https://github.com/x/ipk\"}," +
                "  {\"name\":\"lumax-native-preview_0.2.33.apk\",\"browser_download_url\":\"https://github.com/x/0.2.33.apk\",\"size\":5}]}," +
                "{\"tag_name\":\"draft\",\"draft\":true,\"assets\":[" +
                "  {\"name\":\"lumax-native-preview_0.9.0.apk\",\"browser_download_url\":\"https://github.com/x/draft.apk\"}]}," +
                "{\"tag_name\":\"v0.4.30-preview\",\"assets\":[" +
                "  {\"name\":\"lumax-native-preview_0.2.31.apk\",\"browser_download_url\":\"https://github.com/x/0.2.31.apk\"}," +
                "  {\"name\":\"lumax-native-preview_0.2.32.apk\",\"browser_download_url\":\"https://github.com/x/0.2.32.apk\"}]}]");
    }

    @Test public void newestPreviewApkIsOffered() throws Exception {
        LumaUpdate.Release release = LumaUpdate.newest(releases(), "0.2.32-native-preview");
        assertEquals("0.2.33", release.version);
        assertEquals("https://github.com/x/0.2.33.apk", release.url);
    }

    @Test public void draftsAndOlderVersionsAreIgnored() throws Exception {
        assertNull(LumaUpdate.newest(releases(), "0.2.33-native-preview"));
        assertNull(LumaUpdate.newest(new JSONArray("[]"), "0.2.32"));
    }

    @Test public void versionsCompareNumerically() {
        assertTrue(LumaUpdate.compare("0.2.10", "0.2.9") > 0);
        assertEquals(0, LumaUpdate.compare("0.2.32-native-preview", "0.2.32"));
        assertTrue(LumaUpdate.compare("1.0", "0.9.9") > 0);
        assertTrue(LumaUpdate.compare("", "0.0.1") < 0);
    }

    @Test public void onlyTheSameSigningKeyIsAccepted() {
        assertTrue(LumaUpdate.sameSigners(new HashSet<>(Arrays.asList("a")), new HashSet<>(Arrays.asList("a"))));
        assertFalse(LumaUpdate.sameSigners(new HashSet<>(Arrays.asList("a")), new HashSet<>(Arrays.asList("b"))));
        assertFalse(LumaUpdate.sameSigners(Collections.emptySet(), Collections.emptySet()));
    }
}

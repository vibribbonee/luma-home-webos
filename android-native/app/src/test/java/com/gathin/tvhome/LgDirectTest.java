package com.gathin.tvhome;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertNull;
import static org.junit.Assert.assertTrue;

import org.json.JSONArray;
import org.json.JSONObject;
import org.junit.Test;

import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Paths;

public class LgDirectTest {
    private static final String REPLY = "HTTP/1.1 200 OK\r\n"
            + "CACHE-CONTROL: max-age=1800\r\n"
            + "LOCATION: http://192.168.0.186:1957/abc\r\n"
            + "ST: urn:lge-com:service:webos-second-screen:1\r\n"
            + "USN: uuid:1a2b3c4d-0000-1111-2222-333344445555::urn:lge-com:service:webos-second-screen:1\r\n\r\n";

    @Test public void readsTheStableTvIdentityFromSsdp() {
        LgDirect.Target target = LgDirect.parseSsdp(REPLY, "192.168.0.186");
        assertEquals("1a2b3c4d-0000-1111-2222-333344445555", target.uuid);
        assertEquals("192.168.0.186", target.host);
    }

    @Test public void ignoresOtherSsdpDevices() {
        assertNull(LgDirect.parseSsdp("HTTP/1.1 200 OK\r\nST: urn:schemas-upnp-org:device:MediaRenderer:1\r\nUSN: uuid:x\r\n", "10.0.0.2"));
        assertNull(LgDirect.parseSsdp(REPLY.replace("USN", "XSN"), "10.0.0.2"));
    }

    private static JSONObject manifest() throws Exception {
        return new JSONObject(new String(Files.readAllBytes(Paths.get("src/main/res/raw/lg_register.json")), StandardCharsets.UTF_8));
    }

    @Test public void signedRegistrationKeepsTheSignatureAndAddsTheKey() throws Exception {
        JSONObject payload = LgDirect.registration(manifest(), "saved-key", true);
        assertEquals("PROMPT", payload.getString("pairingType"));
        assertEquals("saved-key", payload.getString("client-key"));
        JSONObject m = payload.getJSONObject("manifest");
        assertTrue(m.has("signed"));
        assertEquals(445, m.getJSONArray("signatures").getJSONObject(0).getString("signature").length());
    }

    @Test public void unsignedRegistrationMergesPermissionsLikeAiowebostv() throws Exception {
        JSONObject payload = LgDirect.registration(manifest(), "", false);
        assertFalse(payload.has("client-key"));
        JSONObject m = payload.getJSONObject("manifest");
        assertFalse(m.has("signed"));
        assertFalse(m.has("signatures"));
        JSONArray permissions = m.getJSONArray("permissions");
        String all = permissions.toString();
        assertTrue(all.contains("CONTROL_INPUT_TV"));
        assertTrue(all.contains("READ_LGE_TV_INPUT_EVENTS"));   // from the signed part
        for (int i = 1; i < permissions.length(); i++)
            assertTrue(permissions.getString(i - 1).compareTo(permissions.getString(i)) < 0);
    }

    @Test public void registrationDoesNotChangeTheSharedManifest() throws Exception {
        JSONObject base = manifest();
        String before = base.toString();
        LgDirect.registration(base, "k", false);
        assertEquals(before, base.toString());
    }

    @Test public void forwardsKeysOnlyWhenTheTvShowsSomethingElse() {
        assertTrue(LgDirect.nativeTarget("netflix", 1));
        assertTrue(LgDirect.nativeTarget("com.webos.app.hdmi2", 1));
        assertFalse(LgDirect.nativeTarget("com.webos.app.hdmi1", 1));
        assertFalse(LgDirect.nativeTarget("com.spinoff.lumahome.overlay", 1));
        assertFalse(LgDirect.nativeTarget("", 1));
        assertFalse(LgDirect.nativeTarget(null, 2));
    }
}

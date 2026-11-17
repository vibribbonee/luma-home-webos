package com.gathin.tvhome;

import org.junit.Test;

import java.net.InetAddress;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertNull;

public class LumaDiscoveryTest {
    private static InetAddress movedHomeAssistant() throws Exception {
        return InetAddress.getByAddress(new byte[]{(byte) 192, 0, 2, 42});
    }

    @Test public void currentDnsSdAddressReplacesOldAdvertisedIp() throws Exception {
        assertEquals("http://192.0.2.42:8123",
                LumaDiscovery.preferredAddress("http://192.0.2.10:8123", movedHomeAssistant(), 8123));
    }

    @Test public void stableHostnameAndConfiguredPortAreRetained() throws Exception {
        assertEquals("https://homeassistant.local:8443",
                LumaDiscovery.preferredAddress("https://homeassistant.local:8443/", movedHomeAssistant(), 8123));
    }

    @Test public void movingHttpsServiceKeepsHttps() throws Exception {
        assertEquals("https://192.0.2.42:8443",
                LumaDiscovery.preferredAddress("https://192.0.2.10:8443", movedHomeAssistant(), 8443));
    }

    @Test public void discoveryWithoutAValidEndpointReturnsNothing() {
        assertNull(LumaDiscovery.preferredAddress("ftp://homeassistant.local", null, 0));
    }
}

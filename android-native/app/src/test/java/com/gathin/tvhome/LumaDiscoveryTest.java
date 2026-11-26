package com.gathin.tvhome;

import org.junit.Test;

import java.net.InetAddress;
import java.util.Arrays;
import java.util.List;

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

    private static final List<LumaDiscovery.Host> NETWORK = Arrays.asList(
            new LumaDiscovery.Host("Neighbour", "http://192.0.2.7:8123", "aaaa"),
            new LumaDiscovery.Host("Home", "http://192.0.2.42:8123", "bbbb"));

    @Test public void sameHomeAssistantAtANewAddressIsFollowed() {
        assertEquals("http://192.0.2.42:8123",
                LumaDiscovery.movedAddress(NETWORK, "BBBB", "http://192.0.2.10:8123"));
    }

    @Test public void anotherHomeAssistantIsNeverChosen() {
        assertNull(LumaDiscovery.movedAddress(NETWORK, "cccc", "http://192.0.2.10:8123"));
        assertNull(LumaDiscovery.movedAddress(NETWORK, "", "http://192.0.2.10:8123"));
    }

    @Test public void unchangedAddressNeedsNoMove() {
        assertNull(LumaDiscovery.movedAddress(NETWORK, "bbbb", "http://192.0.2.42:8123"));
        assertEquals("bbbb", LumaDiscovery.uuidAt(NETWORK, "http://192.0.2.42:8123"));
        assertEquals("", LumaDiscovery.uuidAt(NETWORK, "http://192.0.2.99:8123"));
    }
}

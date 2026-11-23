package com.gathin.tvhome;

import org.junit.Test;
import static org.junit.Assert.*;

public class LumaControlSearchTest {
    @Test public void matchesNamesIdsAndAccents() {
        assertTrue(LumaControlSearch.matches("light.kitchen_ceiling", "Café ceiling", "cafe ceiling", "all", false));
        assertTrue(LumaControlSearch.matches("light.kitchen_ceiling", "Ceiling", "kitchen", "all", false));
        assertFalse(LumaControlSearch.matches("light.kitchen_ceiling", "Ceiling", "bedroom", "all", false));
    }

    @Test public void filtersTypesAndSelectedWithoutChangingTheQuery() {
        assertFalse(LumaControlSearch.matches("switch.kitchen", "Kitchen", "kitchen", "light", true));
        assertTrue(LumaControlSearch.matches("input_boolean.movie", "Movie mode", "movie", "switch", true));
        assertTrue(LumaControlSearch.matches("sensor.humidity", "Humidity", "", "readings", false));
        assertFalse(LumaControlSearch.matches("sensor.humidity", "Humidity", "", "selected", false));
        assertTrue(LumaControlSearch.matches("sensor.humidity", "Humidity", "", "selected", true));
        assertFalse(LumaControlSearch.matches("", "Missing", "", "all", true));
    }
}

package com.universal.obddashboard.telemetry

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Test

class SensorTrimsTest {

    @Test fun roundTrip() {
        val t = SensorTrims(1.5, -2.0, 12.0)
        assertEquals(t, SensorTrims.decode(t.encode()))
    }

    @Test fun missingOrBrokenIsNoTrim() {
        assertEquals(SensorTrims(), SensorTrims.decode(null))
        assertEquals(SensorTrims(), SensorTrims.decode("abc"))
        // Fora dos limites (prefs editadas ou backup estranho): ignora
        assertEquals(SensorTrims(), SensorTrims.decode("40;0;0"))
    }

    @Test fun limits() {
        assertNull(SensorTrims(15.0, -15.0, 45.0).problem())
        assertNotNull(SensorTrims(15.5, 0.0, 0.0).problem())
        assertNotNull(SensorTrims(0.0, 0.0, -46.0).problem())
        assertNotNull(SensorTrims(Double.NaN, 0.0, 0.0).problem())
    }
}

package com.universal.obddashboard.telemetry

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import kotlin.math.pow

class AltimeterTest {
    /** Pressão da atmosfera padrão numa altitude. */
    private fun hpa(altM: Double) = 1013.25 * (1 - altM / 44330.0).pow(5.255)

    @Test fun standardAtmosphereWithoutGps() {
        val a = Altimeter()
        a.onPressure(0, hpa(600.0))
        assertEquals(600.0, a.altitudeM!!, 1.0)
        assertFalse(a.calibrated)
    }

    @Test fun gpsFixesTheWeatherOffset() {
        val a = Altimeter()
        // Dia de pressão alta: a pressão diz 560 m, o lugar está a 600 m
        a.onPressure(0, hpa(560.0))
        a.onGps(601.0, 4f)
        assertTrue(a.calibrated)
        assertEquals(601.0, a.altitudeM!!, 0.5)
        // GPS ruim não mexe
        a.onGps(900.0, 60f)
        assertEquals(601.0, a.altitudeM!!, 0.5)
    }

    @Test fun trendUpDownAndSteady() {
        val a = Altimeter()
        var t = 0L
        for (i in 0..8) { a.onPressure(t, hpa(600.0 + i * 2.0)); t += 5000 }   // 0,4 m/s subindo
        assertEquals(1, a.trend)
        for (i in 0..8) { a.onPressure(t, hpa(616.0)); t += 5000 }
        assertEquals(0, a.trend)
        for (i in 0..8) { a.onPressure(t, hpa(616.0 - i * 2.0)); t += 5000 }
        assertEquals(-1, a.trend)
    }
}

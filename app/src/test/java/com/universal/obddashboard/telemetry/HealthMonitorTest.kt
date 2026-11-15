package com.universal.obddashboard.telemetry

import com.universal.obddashboard.telemetry.HealthHistory.Level
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class HealthMonitorTest {

    private var t = 0L

    private fun HealthMonitor.step(
        s: Double, rpm: Double?, speed: Double = 0.0, coolant: Double? = 90.0, map: Double? = 31.0, tps: Double = 0.0,
        baro: Double? = 95.0, volts: Double? = 14.1, ac: Boolean? = false, loads: Boolean = false,
    ) {
        var left = s
        while (left > 0) {
            t += 250
            left -= 0.25
            update(HealthMonitor.Input(t, 0.25, rpm, speed, coolant, map, tps, baro, volts, ac, loads, null, null, null))
        }
    }

    @Test
    fun coldStartWarmupAndHealthyIdleAndCharging() {
        val m = HealthMonitor()
        // Partida a frio: de 25 a 80 °C em 8 min rodando
        var c = 25.0
        repeat(8 * 60) { m.step(1.0, 1800.0, speed = 40.0, coolant = c); c += 55.0 / (8 * 60) }
        m.step(5.0, 1800.0, speed = 40.0, coolant = 82.0)
        // Marcha lenta quente, estável
        m.step(60.0, 850.0, coolant = 90.0, map = 31.0)
        val o = m.observations()
        assertEquals(8.0, o.getValue(HealthMonitor.WARMUP).value, 0.2)
        assertFalse(o.getValue(HealthMonitor.WARMUP).flagged)
        assertEquals(31.0 / 95.0, o.getValue(HealthMonitor.IDLE_VACUUM).value, 1e-6)
        assertFalse(o.getValue(HealthMonitor.IDLE_VACUUM).flagged)
        assertEquals(14.1, o.getValue(HealthMonitor.CHARGING).value, 1e-9)
        assertFalse(o.getValue(HealthMonitor.CHARGING).flagged)
        assertTrue(o.getValue(HealthMonitor.IDLE_RPM).value < 1)
    }

    @Test
    fun weakVacuumLowChargeAndUnstableIdleAreFlagged() {
        val m = HealthMonitor()
        m.step(120.0, 2000.0, speed = 50.0, volts = 12.9)
        var k = 0
        repeat(240) { m.step(0.25, if (k++ % 2 == 0) 700.0 else 1000.0, map = 44.0) }
        val o = m.observations()
        assertTrue(o.getValue(HealthMonitor.CHARGING).flagged)
        assertTrue(o.getValue(HealthMonitor.IDLE_VACUUM).flagged)
        assertTrue(o.getValue(HealthMonitor.IDLE_RPM).flagged)
    }

    @Test
    fun acOnAndColdEngineDoNotCountAsIdle() {
        val m = HealthMonitor()
        m.step(180.0, 850.0, map = 45.0, ac = true)
        m.step(180.0, 850.0, coolant = 60.0, map = 45.0)
        assertNull(m.observations()[HealthMonitor.IDLE_VACUUM])
    }

    @Test
    fun overheatIsSevereAtOnce() {
        val m = HealthMonitor(HealthMonitor.Thermal(fan2C = 103.0, criticalC = 105.0))
        m.step(60.0, 900.0, coolant = 107.0)
        val o = m.observations().getValue(HealthMonitor.OVERHEAT)
        assertTrue(o.flagged)
        assertTrue(o.severe)
    }

    @Test
    fun historyNeedsRepetitionAndRoundTrips() {
        val h = HealthHistory()
        val bad = mapOf(HealthMonitor.CHARGING to HealthMonitor.Observation(13.0, true))
        val ok = mapOf(HealthMonitor.CHARGING to HealthMonitor.Observation(14.1, false))
        h.record(1, 1, bad)
        h.record(2, 2, ok)
        h.record(3, 3, bad)
        assertEquals(Level.OK, h.check(HealthMonitor.CHARGING).level)   // 2 de 3: ainda não
        h.record(4, 4, bad)
        assertEquals(Level.WATCH, h.check(HealthMonitor.CHARGING).level)
        // A mesma viagem regravada substitui a anterior
        h.record(4, 5, ok)
        assertEquals(Level.OK, h.check(HealthMonitor.CHARGING).level)
        h.central = HealthHistory.Central(9, milOn = false, confirmed = emptyList(), pending = listOf("P0133"), incomplete = listOf("Catalisador"))
        val back = HealthHistory.decode(h.encode())
        assertEquals(h.check(HealthMonitor.CHARGING), back.check(HealthMonitor.CHARGING))
        assertEquals(h.central, back.central)
        assertEquals(Level.WATCH, back.subsystems().first { it.id == HealthHistory.CENTRAL }.level)
        assertEquals(Level.NO_DATA, back.subsystems().first { it.id == HealthHistory.IDLE }.level)
    }
}

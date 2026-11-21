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
        rest: Double? = null, crank: Double? = null, esp: Double? = null,
    ) {
        var left = s
        while (left > 0) {
            t += 250
            left -= 0.25
            update(HealthMonitor.Input(t, 0.25, rpm, speed, coolant, map, tps, baro, volts, ac, loads, null, rest, crank, esp))
        }
    }

    @Test
    fun espBatteryMatchingTheCarKeepsRestAndCrank() {
        val m = HealthMonitor()
        m.step(30.0, 0.0, volts = 12.5, rest = 12.5, esp = 12.4)
        m.step(60.0, 900.0, volts = 14.1, rest = 12.5, crank = 10.4, esp = 13.8)
        val o = m.observations()
        assertFalse(o.getValue(HealthMonitor.ESP_BATT).flagged)
        assertEquals(12.5, o.getValue(HealthMonitor.REST_V).value, 1e-9)
        assertEquals(10.4, o.getValue(HealthMonitor.CRANK_V).value, 1e-9)
    }

    @Test
    fun espBatteryFarFromTheCarDiscardsRestAndCrank() {
        // 16/11: rede em 12,5 / 14,1 V, ESP32 quase 2 V abaixo, "partida" de 7,57 V e repouso de 11,78 V
        val m = HealthMonitor()
        m.step(30.0, 0.0, volts = 12.5, rest = 11.78, esp = 10.5)
        m.step(60.0, 900.0, volts = 14.1, rest = 11.78, crank = 7.57, esp = 12.2)
        val o = m.observations()
        assertTrue(o.getValue(HealthMonitor.ESP_BATT).flagged)
        assertTrue(o.getValue(HealthMonitor.ESP_BATT).value < -1.5)
        assertNull(o[HealthMonitor.REST_V])
        assertNull(o[HealthMonitor.CRANK_V])
    }

    @Test
    fun espBatteryWithoutCarVoltageIsNotTrusted() {
        val m = HealthMonitor()
        m.step(60.0, 900.0, volts = null, rest = 12.5, crank = 10.4, esp = 13.8)
        val o = m.observations()
        assertNull(o[HealthMonitor.ESP_BATT])
        assertNull(o[HealthMonitor.REST_V])
    }

    @Test
    fun espBatteryCheckStaysOutOfTheSubsystems() {
        val h = HealthHistory()
        repeat(5) { h.record(it.toLong(), it * 1000L, mapOf(HealthMonitor.ESP_BATT to HealthMonitor.Observation(-1.8, true))) }
        assertTrue(h.check(HealthMonitor.ESP_BATT).last!!.flagged)
        assertTrue(h.subsystems().none { it.level == Level.WATCH || it.level == Level.ALERT })
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
        repeat(240) { m.step(0.25, if (k++ % 2 == 0) 700.0 else 1000.0, map = 54.0) }
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

    @Test
    fun electronicThrottleAtIdleStillCountsAsIdle() {
        // Uno: borboleta eletrônica em 4 a 5 % na marcha lenta (gravações de 15 e 16/11)
        val m = HealthMonitor()
        m.step(180.0, 840.0, map = 40.5, tps = 4.7, baro = 94.9)
        val o = m.observations()
        assertEquals(40.5 / 94.9, o.getValue(HealthMonitor.IDLE_VACUUM).value, 1e-6)
        assertFalse(o.getValue(HealthMonitor.IDLE_VACUUM).flagged)
    }

    @Test
    fun idleRpmSpreadIsMeasuredInsideEachStop() {
        // Duas paradas firmes em rotações diferentes (840 e 900): juntas dariam ±30, mas dentro de cada uma é zero
        val m = HealthMonitor()
        m.step(180.0, 840.0)
        m.step(5.0, 1800.0, speed = 30.0)
        m.step(30.0, 900.0)
        assertEquals(0.0, m.observations().getValue(HealthMonitor.IDLE_RPM).value, 1e-9)
    }

    @Test
    fun idleVacuumIsComparedWithTheCarsOwnNormal() {
        val h = HealthHistory()
        fun trip(id: Long, r: Double) = h.record(id, id, mapOf(HealthMonitor.IDLE_VACUUM to HealthMonitor.Observation(r, r > HealthMonitor.IDLE_MAP_RATIO_MAX)))
        trip(1, 0.42); trip(2, 0.43); trip(3, 0.43)
        assertEquals(Level.LEARNING, h.check(HealthMonitor.IDLE_VACUUM).level)
        trip(4, 0.44); trip(5, 0.42)
        assertEquals(0.43, h.baseline(HealthMonitor.IDLE_VACUUM)!!, 1e-9)
        assertEquals(Level.OK, h.check(HealthMonitor.IDLE_VACUUM).level)
        // Subiu 8 pontos acima do normal do carro em 3 viagens: atenção (o limite fixo de 55% nem foi tocado)
        trip(6, 0.51); trip(7, 0.51); trip(8, 0.52)
        assertEquals(Level.WATCH, h.check(HealthMonitor.IDLE_VACUUM).level)
        assertEquals(0.43, HealthHistory.decode(h.encode()).baseline(HealthMonitor.IDLE_VACUUM)!!, 1e-9)
    }

    @Test
    fun firmwareVersionCompare() {
        assertTrue(TelemetryEngine.firmwareAtLeast("1.7", 1, 7))
        assertTrue(TelemetryEngine.firmwareAtLeast("1.10", 1, 7))
        assertTrue(TelemetryEngine.firmwareAtLeast("2.0", 1, 7))
        assertFalse(TelemetryEngine.firmwareAtLeast("1.6", 1, 7))
        assertFalse(TelemetryEngine.firmwareAtLeast(null, 1, 7))
        assertFalse(TelemetryEngine.firmwareAtLeast("x", 1, 7))
    }

    // ---------------- Fase 2

    private val gears = listOf(6.0, 11.3, 17.5, 25.0, 29.5)

    private fun HealthMonitor.drive(
        s: Double, rpm: Double, speed: Double = 0.0, coolant: Double? = 90.0, map: Double? = 31.0, tps: Double = 0.0,
        baro: Double? = 95.0, stft: Double? = null, post: Double? = null, intake: Double? = null, refuelAt: Long? = null,
    ) {
        var left = s
        while (left > 0) {
            t += 250
            left -= 0.25
            update(
                HealthMonitor.Input(
                    t, 0.25, rpm, speed, coolant, map, tps, baro, 14.1, false, false, null, null, null, null,
                    stftPct = stft, lambdaPostV = post, intakeC = intake, refuelAt = refuelAt,
                ),
            )
        }
    }

    @Test
    fun mixtureHighOnlyAtIdlePointsToFalseAir() {
        val m = HealthMonitor()
        m.drive(150.0, 850.0, map = 31.0, tps = 4.0, stft = 22.0)                       // marcha lenta quente
        m.drive(180.0, 2200.0, speed = 50.0, map = 55.0, tps = 15.0, stft = 1.5)       // rodagem leve
        val o = m.observations()
        assertTrue(o.getValue(HealthMonitor.STFT_IDLE).flagged)                        // desvio grosseiro numa viagem
        assertEquals(22.0, o.getValue(HealthMonitor.STFT_IDLE).value, 1e-9)
        assertFalse(o.getValue(HealthMonitor.STFT_CRUISE).flagged)
    }

    @Test
    fun mixtureIgnoresFuelCutAndTheSecondsAfter() {
        val m = HealthMonitor()
        m.drive(150.0, 2200.0, speed = 50.0, map = 55.0, tps = 15.0, stft = 0.0)
        m.drive(20.0, 2500.0, speed = 50.0, map = 22.0, tps = 0.0, stft = -25.0)      // corte na desaceleração
        m.drive(8.0, 2200.0, speed = 45.0, map = 55.0, tps = 15.0, stft = -20.0)      // ainda se acertando
        val o = m.observations()
        assertEquals(0.0, o.getValue(HealthMonitor.STFT_CRUISE).value, 1e-9)
    }

    @Test
    fun mixtureWaitsAfterARefuel() {
        val m = HealthMonitor()
        val refuel = t - 20 * 60_000L   // abasteceu 20 min antes de sair
        m.drive(300.0, 850.0, map = 31.0, tps = 4.0, stft = 15.0, refuelAt = refuel)    // primeiros 5 min: não contam
        assertNull(m.observations()[HealthMonitor.STFT_IDLE])
        m.drive(400.0, 850.0, map = 31.0, tps = 4.0, stft = 2.0, refuelAt = refuel)     // depois dos 10 min, contam
        assertEquals(2.0, m.observations().getValue(HealthMonitor.STFT_IDLE).value, 1e-9)
    }

    @Test
    fun postCatalystLowForLongPointsToExhaustLeak() {
        val bad = HealthMonitor()
        bad.drive(200.0, 2200.0, speed = 50.0, map = 55.0, tps = 15.0, post = 0.74)   // catalisador ainda aquecendo
        bad.drive(200.0, 2200.0, speed = 50.0, map = 55.0, tps = 15.0, post = 0.20)
        val o = bad.observations().getValue(HealthMonitor.O2_POST)
        assertTrue(o.flagged)
        assertEquals(0.20, o.value, 1e-9)
        val good = HealthMonitor()
        good.drive(400.0, 2200.0, speed = 50.0, map = 55.0, tps = 15.0, post = 0.74)
        good.drive(30.0, 2500.0, speed = 50.0, map = 22.0, tps = 0.0, post = 0.05)    // corte: a sonda cai, não conta
        assertFalse(good.observations().getValue(HealthMonitor.O2_POST).flagged)
    }

    @Test
    fun temperatureSensorsAgreeAfterAColdStart() {
        val ok = HealthMonitor()
        ok.drive(30.0, 1100.0, coolant = 24.0, intake = 26.0)
        assertFalse(ok.observations().getValue(HealthMonitor.TEMP_PLAUS).flagged)
        val bad = HealthMonitor()
        bad.drive(30.0, 1100.0, coolant = 24.0, intake = 47.0)
        assertTrue(bad.observations().getValue(HealthMonitor.TEMP_PLAUS).flagged)
        val warm = HealthMonitor()   // partida com o motor quente: nada a conferir
        warm.drive(30.0, 900.0, coolant = 88.0, intake = 50.0)
        assertNull(warm.observations()[HealthMonitor.TEMP_PLAUS])
    }

    @Test
    fun clutchSlippingUnderLoadInAGear() {
        val m = HealthMonitor(gears = gears)
        m.drive(5.0, 3000.0, speed = 52.5, map = 50.0, tps = 10.0)                      // 3ª engatada, carga leve
        m.drive(10.0, 3333.0, speed = 52.5, map = 88.0, tps = 70.0)                     // carga: rotação 10% acima
        val o = m.observations().getValue(HealthMonitor.CLUTCH_SLIP)
        assertTrue(o.flagged)
        assertEquals(10.0, o.value, 0.1)
    }

    @Test
    fun clutchHoldingAndClutchPressedAreNotSlip() {
        val ok = HealthMonitor(gears = gears)
        ok.drive(5.0, 3000.0, speed = 52.5, map = 50.0, tps = 10.0)
        ok.drive(10.0, 3000.0, speed = 52.5, map = 88.0, tps = 70.0)                    // segura: mesma relação
        assertEquals(0.0, ok.observations().getValue(HealthMonitor.CLUTCH_SLIP).value, 1e-9)
        val pressed = HealthMonitor(gears = gears)
        pressed.drive(5.0, 3000.0, speed = 52.5, map = 50.0, tps = 10.0)
        pressed.drive(10.0, 4500.0, speed = 52.5, map = 88.0, tps = 70.0)               // 33%: embreagem pisada
        assertNull(pressed.observations()[HealthMonitor.CLUTCH_SLIP])
        val noGears = HealthMonitor()                                                   // perfil sem relações
        noGears.drive(5.0, 3000.0, speed = 52.5, map = 50.0, tps = 10.0)
        noGears.drive(10.0, 3333.0, speed = 52.5, map = 88.0, tps = 70.0)
        assertNull(noGears.observations()[HealthMonitor.CLUTCH_SLIP])
    }

    @Test
    fun mixtureLevelFollowsTheMedianOfRecentTrips() {
        val idle = HealthMonitor.STFT_IDLE
        fun history(vararg v: Double) = HealthHistory().apply {
            v.forEachIndexed { i, x -> record(i + 1L, i + 1L, mapOf(idle to HealthMonitor.Observation(x, kotlin.math.abs(x) > 20))) }
        }
        // como no Uno: viagens soltas de +17 % no meio de outras normais não dão atenção
        assertEquals(Level.OK, history(4.0, 17.0, -6.0, 18.0, 2.0).check(idle).level)
        // dez viagens seguidas pedindo mais combustível (11/11): a mediana passa de 15 % e dá atenção
        val lean = history(14.0, 17.0, 16.4, 18.0, 15.6)
        assertEquals(Level.WATCH, lean.check(idle).level)
        assertEquals(Level.WATCH, lean.subsystems().first { it.id == HealthHistory.MIXTURE }.level)
        assertEquals(Level.NO_DATA, lean.subsystems().first { it.id == HealthHistory.CLUTCH }.level)
        // mistura rica também conta, e menos de 3 viagens ainda não decidem
        assertEquals(Level.WATCH, history(-16.0, -17.0, -15.5).check(idle).level)
        assertEquals(Level.OK, history(-30.0, -30.0).check(idle).level)
    }
}

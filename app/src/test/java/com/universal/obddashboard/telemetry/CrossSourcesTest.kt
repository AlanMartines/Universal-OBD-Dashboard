package com.universal.obddashboard.telemetry

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import kotlin.math.PI
import kotlin.math.abs
import kotlin.math.cos

/** Fontes cruzadas: percurso estimado, fator da velocidade, votação do motor, inclinação, ambiente e bateria. */
class CrossSourcesTest {

    private fun fix(t: Long, lat: Double, lon: Double, kmh: Double = 50.0, bearing: Float? = 0f, acc: Float = 5f) =
        GpsFix(lat, lon, kmh, acc, bearing, t)

    private fun metersNorth(dLat: Double) = dLat * PI / 180 * 6_371_000.0

    // ---------------------------------------------------------------- DeadReckoning
    @Test
    fun estimatesAlongTheHeadingWhileGpsIsGoneAndCorrectsWhenItReturns() {
        val dr = DeadReckoning()
        dr.onGps(fix(0, -20.0, -54.0, bearing = 0f))   // rumo norte
        // GPS some; 36 km/h = 10 m/s, rumo norte pela bússola, por 20 s
        var est: DeadReckoning.Estimate? = null
        var t = 0L
        while (t < 25_000) {
            t += 250
            est = dr.tick(t, 0.25, 36.0, 0.0, null)
        }
        assertNotNull(est)
        // Começa a estimar só depois de 5 s sem GPS: 20 s × 10 m/s = 200 m
        assertEquals(200.0, metersNorth(est!!.latitude - -20.0), 3.0)
        assertEquals(-54.0, est.longitude, 1e-9)
        assertTrue(est.accuracyM > DeadReckoning.BASE_ACCURACY_M)
        // GPS volta 20 m mais ao norte do que o estimado: a correção vai a zero no começo e inteira no fim
        val real = est.latitude + 20 / 6_371_000.0 * 180 / PI
        val c = dr.onGps(fix(t, real, -54.0))!!
        assertEquals(0L, c.fromMs)
        assertEquals(t, c.toMs)
        assertEquals(20.0, metersNorth(c.dLat), 0.01)
        assertEquals(0.0, c.at(0).first, 1e-12)
        assertEquals(c.dLat / 2, c.at(t / 2).first, 1e-12)
        assertNull(dr.estimate)
    }

    @Test
    fun followsTheTurnWithTheGyroWithoutCompass() {
        val dr = DeadReckoning()
        dr.onGps(fix(0, -20.0, -54.0, bearing = 0f))
        var t = 0L
        // 5 s parado no tempo do GPS, depois 9 s virando à direita a 10 °/s (yaw negativo) até o leste
        while (t < 5000) { t += 250; dr.tick(t, 0.25, 36.0, null, 0.0) }
        while (t < 14_000) { t += 250; dr.tick(t, 0.25, 36.0, null, -10.0) }
        val before = dr.estimate!!
        while (t < 24_000) { t += 250; dr.tick(t, 0.25, 36.0, null, 0.0) }
        val after = dr.estimate!!
        // Nos últimos 10 s andou para o leste: a latitude quase não muda e a longitude cresce ~100 m
        assertEquals(0.0, metersNorth(after.latitude - before.latitude), 5.0)
        val east = (after.longitude - before.longitude) * PI / 180 * 6_371_000.0 * cos(-20.0 * PI / 180)
        assertEquals(100.0, east, 5.0)
    }

    @Test
    fun noEstimateWithoutStartingPointAndGivesUpAfterTheLimit() {
        val dr = DeadReckoning()
        assertNull(dr.tick(10_000, 0.25, 50.0, 0.0, null))
        dr.onGps(fix(0, -20.0, -54.0))
        assertNull(dr.tick(DeadReckoning.MAX_MS + 10_000, 0.25, 50.0, 0.0, null))
    }

    @Test
    fun badGpsIsNotAStartingPoint() {
        val dr = DeadReckoning()
        dr.onGps(fix(0, -20.0, -54.0, acc = 80f))
        assertNull(dr.tick(10_000, 0.25, 50.0, 0.0, null))
    }

    // ---------------------------------------------------------------- SpeedCalibrator
    @Test
    fun learnsTheFactorOnSteadyStretchesOnly() {
        val cal = SpeedCalibrator()
        var t = 0L
        // 10 min a 60 km/h do carro, GPS 2% abaixo: 10 km
        while (t < 600_000) {
            t += 250
            val carAt = t - t % 1000
            cal.update(t, 0.25, 60.0, carAt, 58.8, 4f, t, 0.0)
        }
        assertTrue(cal.ready)
        assertEquals(0.98, cal.factor!!, 0.001)
        // Arrancada forte (velocidade mudando rápido) e curva não entram na conta
        val km = cal.learnedKm
        var v = 30.0
        while (t < 620_000) {
            t += 250
            if (t % 1000 == 0L) v += 5
            cal.update(t, 0.25, v, t - t % 1000, v * 1.2, 4f, t, 0.0)
        }
        cal.update(t + 250, 0.25, 60.0, t, 50.0, 4f, t, 10.0)
        assertEquals(km, cal.learnedKm, 1e-9)
    }

    @Test
    fun speedStateRoundTrips() {
        val st = SpeedCalibrator.State(12.5, 12.3)
        assertEquals(st, SpeedCalibrator.State.decode(st.encode()))
        assertNull(SpeedCalibrator.State.decode("x"))
        assertNull(SpeedCalibrator(SpeedCalibrator.State(2.0, 2.0)).factor)   // antes de 5 km
    }

    // ---------------------------------------------------------------- EngineVote
    @Test
    fun rpmDecidesAndOthersStandInWhenItIsMissing() {
        assertEquals(true, EngineVote.decide(850.0, listOf(12.0), null).on)
        assertEquals(false, EngineVote.decide(0.0, listOf(14.2), 0.08).on)
        val volts = EngineVote.decide(null, listOf(14.1), null)
        assertEquals(true, volts.on)
        assertEquals(EngineVote.SOURCE_VOLTS, volts.source)
        assertEquals(false, EngineVote.decide(null, listOf(12.5), null).on)
        // Tensão no meio do caminho: a vibração decide (dados de 14/11: desligado 0,02–0,03 g, ligado 0,04–0,09 g)
        assertEquals(true, EngineVote.decide(null, listOf(13.1), 0.06).on)
        assertEquals(false, EngineVote.decide(null, listOf(13.1), 0.02).on)
        assertNull(EngineVote.decide(null, emptyList(), null).on)
    }

    // ---------------------------------------------------------------- SlopeCheck
    @Test
    fun slopeAgreesWithTheAltitudeAndFlagsAMisalignedSensor() {
        fun run(imuPct: Double): SlopeCheck {
            val c = SlopeCheck()
            var alt = 500.0
            repeat(4000) {   // 4000 × 0,5 s a 36 km/h = 20 km numa subida de 5%
                alt += 5.0 * 0.05
                c.update(0.5, 36.0, alt, imuPct)
            }
            return c
        }
        val ok = run(5.0)
        assertEquals(0.0, ok.differenceDeg!!, 0.05)
        assertFalse(ok.suspicious)
        assertEquals(5.0, ok.baroSlopePct!!, 0.01)
        val off = run(5.0 + 5.3)   // sensor torto uns 3°
        assertTrue(off.suspicious)
        assertTrue(abs(off.differenceDeg!! - 2.9) < 0.3)
    }

    // ---------------------------------------------------------------- AmbientEstimate
    @Test
    fun ambientFromTheIntakeOnAColdStartOrAtSpeed() {
        val a = AmbientEstimate()
        a.update(1.0, 24.0, 26.0, 0.0)
        assertEquals(24.0, a.ambientC!!, 1e-9)
        assertEquals(AmbientEstimate.SOURCE_COLD, a.source)
        val hot = AmbientEstimate()
        hot.update(1.0, 45.0, 88.0, 0.0)   // motor quente: a admissão está aquecida
        assertNull(hot.ambientC)
        repeat(200) { hot.update(1.0, 31.0, 90.0, 80.0) }
        assertEquals(31.0, hot.ambientC!!, 1e-9)
        assertEquals(AmbientEstimate.SOURCE_MOVING, hot.source)
    }

    // ---------------------------------------------------------------- BatteryWatch
    @Test
    fun crankDipOnlyAfterTheEngineStarted() {
        val b = BatteryWatch()
        b.update(12.6, 12.58, 12.55, null, false)
        assertEquals(12.58, b.restV!!, 1e-9)
        assertNull(b.crankV)
        b.update(14.1, 12.58, 9.9, 14.0, true)
        assertEquals(9.9, b.crankV!!, 1e-9)
        assertEquals(0.1, b.diffV!!, 1e-9)
    }
}

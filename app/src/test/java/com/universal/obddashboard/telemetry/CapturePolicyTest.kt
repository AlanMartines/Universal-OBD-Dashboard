package com.universal.obddashboard.telemetry

import com.universal.obddashboard.db.TripEntity
import com.universal.obddashboard.service.ObdForegroundService
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class CapturePolicyTest {

    private val min = 60_000L
    private val hour = 60 * min
    private val t0 = 1_761_220_800_000L
    private fun trip(end: Long?, profile: String = "fiat_uno_vivace_7gf") =
        TripEntity(id = 42, profileId = profile, startTime = t0 - 2 * hour, endTime = end)

    // ---------------- Retomada ----------------

    @Test fun resumesWithinWindow() {
        assertEquals(42L, CapturePolicy.tripToResume(trip(t0), t0, "fiat_uno_vivace_7gf", t0 + 18 * min, hour))
        assertEquals(42L, CapturePolicy.tripToResume(trip(t0), t0, "fiat_uno_vivace_7gf", t0 + hour, hour))
    }

    @Test fun startsNewTripAfterWindowOrOtherProfile() {
        assertNull(CapturePolicy.tripToResume(trip(t0), t0, "fiat_uno_vivace_7gf", t0 + 378 * min, hour)) // pernoite
        assertNull(CapturePolicy.tripToResume(trip(t0), t0, "generic_obd2", t0 + min, hour))
        assertNull(CapturePolicy.tripToResume(null, null, "fiat_uno_vivace_7gf", t0, hour))
        assertNull(CapturePolicy.tripToResume(trip(t0), t0, "fiat_uno_vivace_7gf", t0 + min, 0))
    }

    /** Processo morto pelo sistema: a viagem ficou sem end_time; vale a última amostra. */
    @Test fun danglingTripUsesLastSample() {
        assertEquals(42L, CapturePolicy.tripToResume(trip(null), t0, "fiat_uno_vivace_7gf", t0 + 10 * min, hour))
        assertNull(CapturePolicy.tripToResume(trip(null), t0 - 2 * hour, "fiat_uno_vivace_7gf", t0, hour))
    }

    /** Encerrar à mão (app, notificação, Android Auto ou "Encerrar agora") sempre começa uma viagem nova. */
    @Test fun manualStopNeverResumes() {
        for (reason in listOf("user_stop", "idle_confirmed")) {
            assertNull(reason, CapturePolicy.tripToResume(trip(t0).copy(endReason = reason), t0, "fiat_uno_vivace_7gf", t0 + min, hour))
        }
        for (reason in listOf("ignition_off", "bluetooth_disconnected", "idle_timeout", "adapter_unreachable", "ignition_not_detected", "interrupted")) {
            assertEquals(reason, 42L, CapturePolicy.tripToResume(trip(t0).copy(endReason = reason), t0, "fiat_uno_vivace_7gf", t0 + min, hour))
        }
        assertEquals(setOf(ObdForegroundService.REASON_USER_STOP, ObdForegroundService.REASON_IDLE_CONFIRMED), CapturePolicy.MANUAL_END_REASONS)
    }

    @Test fun clockGoingBackwardsDoesNotResume() {
        assertNull(CapturePolicy.tripToResume(trip(t0), t0, "fiat_uno_vivace_7gf", t0 - min, hour))
    }

    // ---------------- Varredura, inatividade, GPS ----------------

    @Test fun scanRunsOncePerDay() {
        assertTrue(CapturePolicy.scanDue(null, t0))
        assertFalse(CapturePolicy.scanDue(t0, t0 + 23 * hour))
        assertTrue(CapturePolicy.scanDue(t0, t0 + 24 * hour))
        assertTrue(CapturePolicy.scanDue(t0 + hour, t0)) // relógio voltou
    }

    @Test fun idleTimeoutFromUserSetting() {
        assertEquals(15 * 60L, CapturePolicy.idleTimeoutS(15, 300))
        assertNull(CapturePolicy.idleTimeoutS(0, 300))
        assertEquals(300L, CapturePolicy.idleTimeoutS(null, 300))
    }

    @Test fun gpsLostOnlyWhileMoving() {
        assertTrue(CapturePolicy.gpsLost(90.0, 3 * min))
        assertFalse(CapturePolicy.gpsLost(90.0, min))
        assertFalse(CapturePolicy.gpsLost(0.0, 30 * min)) // parado no posto
        assertFalse(CapturePolicy.gpsLost(null, 30 * min))
    }

    // ---------------- Distância sem GPS ----------------

    /** Viagem de teste: velocidade da ECU 2,6% abaixo do hodômetro do carro (406,6 × 418 km). */
    @Test fun obdDistanceUsesSpeedFactorWithoutGps() {
        val acc = TripAccumulator(1, t0, "p", obdSpeedFactor = 1.026)
        repeat(3600) { acc.onTick(t0 + it * 1000L, 1.0, obdSpeed = 100.0, gpsSpeed = null, rpm = 3000.0, coolant = 90.0, volts = 14.0, fuelLph = 6.0) }
        assertEquals(102.6, acc.distanceKm, 1e-6)
        assertEquals(100.0, acc.maxSpeedKmh, 0.0) // velocidade exibida não muda
    }

    // ---------------- Acumulador retomado ----------------

    @Test fun tripAccumulatorRestoresTotals() {
        val e = TripEntity(id = 7, profileId = "p", startTime = t0, distanceKm = 260.4, maxSpeedKmh = 136.0, maxRpm = 4900.0,
            maxCoolantC = 97.0, minVoltage = 12.1, fuelUsedL = 18.2)
        val acc = TripAccumulator(e.id, e.startTime, e.profileId).apply { restore(e) }
        acc.onTick(t0 + hour, 1.0, obdSpeed = 72.0, gpsSpeed = null, rpm = 2500.0, coolant = 90.0, volts = 14.0, fuelLph = 3.6)
        val out = acc.toEntity()
        assertEquals(260.42, out.distanceKm, 1e-9)
        assertEquals(136.0, out.maxSpeedKmh, 0.0)
        assertEquals(4900.0, out.maxRpm, 0.0)
        assertEquals(12.1, out.minVoltage!!, 0.0)
        assertEquals(18.201, out.fuelUsedL, 1e-9)
        assertEquals(t0, out.startTime)
    }
}

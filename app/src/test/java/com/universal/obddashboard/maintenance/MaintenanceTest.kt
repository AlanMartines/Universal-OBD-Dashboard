package com.universal.obddashboard.maintenance

import com.universal.obddashboard.maintenance.Maintenance.Level
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test
import java.util.Calendar
import java.util.TimeZone

class MaintenanceTest {

    private val tz = TimeZone.getTimeZone("America/Campo_Grande")
    private fun day(y: Int, m: Int, d: Int): Long =
        Calendar.getInstance(tz).apply { clear(); set(y, m - 1, d, 12, 0) }.timeInMillis

    @Test fun neverDoneIsUnknown() {
        val s = Maintenance.status(10_000.0, 12, null, null, 50_000.0, day(2026, 11, 11), tz)
        assertEquals(Level.UNKNOWN, s.level)
        assertNull(s.nextKm)
    }

    @Test fun okWhenFarFromBoth() {
        val s = Maintenance.status(10_000.0, 12, 180_000.0, day(2026, 6, 1), 183_000.0, day(2026, 11, 11), tz)
        assertEquals(Level.OK, s.level)
        assertEquals(190_000.0, s.nextKm!!, 0.01)
        assertEquals(7_000.0, s.remainingKm!!, 0.01)
        assertEquals(day(2027, 6, 1), s.nextAt)
    }

    @Test fun soonByKmUsesTenPercentCappedAt1000() {
        // 10% de 10.000 = 1.000 km: com 800 km faltando, já avisa
        val s = Maintenance.status(10_000.0, null, 180_000.0, day(2026, 6, 1), 189_200.0, day(2026, 11, 11), tz)
        assertEquals(Level.SOON, s.level)
        assertEquals(800.0, s.remainingKm!!, 0.01)
        // intervalo curto: piso de 300 km
        assertEquals(300.0, Maintenance.soonKm(2_000.0), 0.01)
        assertEquals(1_000.0, Maintenance.soonKm(50_000.0), 0.01)
    }

    @Test fun dueByKmEvenIfDateIsFine() {
        val s = Maintenance.status(10_000.0, 12, 180_000.0, day(2026, 10, 1), 190_100.0, day(2026, 11, 11), tz)
        assertEquals(Level.DUE, s.level)
        assertEquals(-100.0, s.remainingKm!!, 0.01)
    }

    @Test fun dueByDateWithoutKmInterval() {
        // fluido de freio: só data (24 meses)
        val s = Maintenance.status(null, 24, null, day(2024, 10, 1), 183_000.0, day(2026, 11, 11), tz)
        assertEquals(Level.DUE, s.level)
        assertNull(s.nextKm)
        assertEquals(day(2026, 10, 1), s.nextAt)
    }

    @Test fun soonByDateWithin30Days() {
        val s = Maintenance.status(null, 12, null, day(2025, 12, 1), null, day(2026, 11, 11), tz)
        assertEquals(Level.SOON, s.level)
        assertEquals(20L, s.remainingDays)
    }

    @Test fun kmIntervalWithoutRecordedKmFallsBackToDate() {
        // registro sem hodômetro: só a data decide
        val s = Maintenance.status(10_000.0, 12, null, day(2026, 6, 1), 183_000.0, day(2026, 11, 11), tz)
        assertEquals(Level.OK, s.level)
        assertNull(s.remainingKm)
    }

    @Test fun addMonthsKeepsEndOfMonthSane() {
        assertEquals(day(2027, 2, 28), Maintenance.addMonths(day(2026, 1, 31), 13, tz))
    }
}

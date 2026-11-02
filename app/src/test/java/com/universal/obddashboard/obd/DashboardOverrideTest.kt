package com.universal.obddashboard.obd

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File

class DashboardOverrideTest {
    private val valid = DashboardOverride(rpmMax = 8000.0, rpmRedline = 6500.0, speedMax = 180.0, speedCorrectionPct = 3.0)

    @Test fun validValuesAreAcceptedAndReplaceOnlyTheScales() {
        assertNull(valid.problem())
        val applied = valid.applyTo(DashboardSettings(voltageMin = 10.0))
        assertEquals(8000.0, applied.rpmMax, 0.0)
        assertEquals(180.0, applied.speedMax, 0.0)
        assertEquals(3.0, applied.speedCorrectionPct, 0.0)
        assertEquals(10.0, applied.voltageMin, 0.0)
    }

    @Test fun invalidValuesAreRefused() {
        listOf(
            valid.copy(rpmRedline = Double.NaN),
            valid.copy(rpmRedline = 8500.0),
            valid.copy(rpmRedline = 100.0),
            valid.copy(rpmMax = 500.0),
            valid.copy(speedMax = 20.0),
            valid.copy(speedCorrectionPct = 20.0),
            valid.copy(speedCorrectionPct = -11.0),
        ).forEach { assertNotNull(it.toString(), it.problem()) }
    }

    @Test fun savedValueRoundTripsAndBadOneFallsBackToProfile() {
        assertEquals(valid, DashboardOverride.decode(valid.encode()))
        assertNull(DashboardOverride.decode(null))
        assertNull(DashboardOverride.decode("não é json"))
        assertNull(DashboardOverride.decode(valid.copy(speedMax = 1.0).encode()))
    }

    @Test fun unoDiscardsOnlyImpossibleTimingAdvance() {
        val uno = ProfileParser.parse(File("src/main/assets/profiles/fiat_uno_vivace_7gf.json").readText())
        val timing = uno.outputs.getValue("timing_advance")
        assertTrue(timing.rejects(63.5))
        assertFalse(timing.rejects(60.0))
        assertFalse(timing.rejects(21.5))
        // Sinais sem a opção seguem como estão, mesmo fora da faixa do mostrador
        assertFalse(uno.outputs.getValue("stft_b1").rejects(-100.0))
    }
}

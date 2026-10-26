package com.universal.obddashboard.telemetry

import com.universal.obddashboard.obd.FuelSettings
import com.universal.obddashboard.obd.VariableResolver
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class FuelCalculatorTest {

    private val calc = FuelCalculator(FuelSettings(tankCapacityL = 48.0, displacementL = 0.999, volumetricEfficiency = 0.8))
    private val none = VariableResolver { Double.NaN }
    private fun lph(stft: Double?, ltft: Double?) =
        calc.litersPerHour(rpm = 3000.0, mapKpa = 70.0, iatC = 30.0, mafGs = null, stftPct = stft, ltftPct = ltft, ethanolPct = 0.0, vars = none)!!

    /** Viagem de teste: trims mal decodificados (-100%) davam consumo negativo. */
    @Test fun absurdTrimsCannotZeroOrInvertConsumption() {
        val base = lph(0.0, 0.0)
        assertTrue(base > 0)
        assertEquals(base * 0.7, lph(-100.0, -92.0), 1e-9)
        assertEquals(base * 1.3, lph(99.0, 99.0), 1e-9)
        assertEquals(base * 0.95, lph(-5.0, null), 1e-9)
    }
}

package com.universal.obddashboard.fuel

import com.universal.obddashboard.db.FuelSample
import com.universal.obddashboard.fuel.FuelCalibration.Check
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class FuelCalibrationTest {

    @Test fun integratesSkippingGapsAndNulls() {
        // 1 h a 6 L/h amostrado a cada 2 s, com uma lacuna de 5 min e amostras sem consumo
        val samples = (0..1800).map { FuelSample(it * 2000L, if (it % 100 == 0) null else 6.0) } +
            (0..150).map { FuelSample(3_900_000L + it * 2000L, 6.0) }
        // 1 h + 5 min, menos 18 trechos de 2 s com amostra nula; a lacuna entre os blocos não conta
        assertEquals(6.0 + 0.5 - 18 * 2 * 6.0 / 3600, FuelCalibration.integrateLiters(samples), 1e-6)
    }

    private fun c(from: Long, real: Double, est: Double) = Check(from, from + 1, real, est)

    @Test fun suggestsAfterThreeGoodIntervalsIgnoringOutliers() {
        // Ida da viagem de teste (real × estimado) e um intervalo com o etanol errado (+42%)
        val checks = listOf(c(1, 32.2, 31.6), c(2, 37.4, 37.5), c(3, 31.6, 45.0), c(4, 31.4, 32.4))
        val r = FuelCalibration.evaluate(checks, 1.0, since = 0)
        assertEquals(3, r.used.size)
        assertEquals(1, r.ignored.size)
        assertNull("desvio < 1%: não precisa", r.suggestedFactor)
        val off = FuelCalibration.evaluate(listOf(c(1, 30.0, 33.0), c(2, 30.0, 33.6), c(3, 30.0, 32.4)), 1.0, 0)
        assertEquals(30.0 * 3 / 99.0, off.suggestedFactor!!, 1e-9)       // app 10% acima → fator 0,909
        assertEquals(0.1, off.deviation!!, 1e-9)
    }

    @Test fun onlyIntervalsAfterTheLastChangeCount() {
        val checks = listOf(c(1, 30.0, 33.0), c(2, 30.0, 33.0), c(10, 30.0, 30.3), c(11, 30.0, 30.0))
        val r = FuelCalibration.evaluate(checks, 0.909, since = 10)
        assertEquals(2, r.used.size)
        assertEquals(1, r.missing)
        assertNull(r.suggestedFactor)
    }
}

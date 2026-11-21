package com.universal.obddashboard.telemetry

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class EthanolHintTest {

    /** Mistura como no perfil do Uno: gasolina C (13,0; 745 g/L) e etanol hidratado (8,4; 809 g/L), por massa. */
    private val afrOf: (Double) -> Double = { pct ->
        val v = (pct / 100).coerceIn(0.0, 1.0)
        val massE = v * 809.0
        val massG = (1 - v) * 745.0
        val w = massE / (massE + massG)
        w * 8.4 + (1 - w) * 13.0
    }

    private val refuel = 1_000_000L

    /** Rodagem leve com o motor quente, a partir de [start], por [s] segundos. */
    private fun EthanolHint.cruise(start: Long, s: Int, stft: Double, rpm: Double = 2200.0, speed: Double = 50.0, tps: Double = 15.0): Long {
        var t = start
        repeat(s * 4) {
            t += 250
            update(t, rpm, speed, 88.0, tps, stft)
        }
        return t
    }

    @Test
    fun inverseOfTheMixIsConsistent() {
        val h = EthanolHint(refuel, 0.0, 0.0, 0.0, afrOf)
        for (pct in listOf(0.0, 25.0, 50.0, 83.0, 100.0)) assertEquals(pct, h.pctForAfr(afrOf(pct)), 0.01)
        assertEquals(0.0, h.pctForAfr(14.0), 1e-9)
        assertEquals(100.0, h.pctForAfr(8.0), 1e-9)
    }

    @Test
    fun gasolineToEthanolAsInformedMatches() {
        // tanque de gasolina, 40 de 48 L de etanol: 83 % de etanol da bomba; a central salta ~42 % antes de aprender
        val after = 40.0 / 48 * 100
        val expected = (afrOf(0.0) / afrOf(after) - 1) * 100
        val h = EthanolHint(refuel, 0.0, after, 1.0, afrOf)
        h.cruise(refuel + 30 * 60_000L, 60, stft = 1.0 + expected)
        val r = h.result()!!
        assertEquals(expected, r.expectedPct, 1e-9)
        assertEquals(after, r.estimatedPct, 0.5)
        assertFalse(r.mismatch)
    }

    @Test
    fun hiddenEthanolInformedAsGasolineIsFlagged() {
        // informado: gasolina (0 %); a correção saltou 40 % sobre o normal de antes
        val h = EthanolHint(refuel, 0.0, 0.0, -1.0, afrOf)
        h.cruise(refuel + 20 * 60_000L, 60, stft = 39.0)
        val r = h.result()!!
        assertEquals(40.0, r.shiftPct, 1e-9)
        assertTrue(r.estimatedPct > 70)
        assertTrue(r.mismatch)
    }

    @Test
    fun usualCorrectionNoiseIsNotAWarning() {
        // gasolina como sempre; a correção rodando oscila ±7 % (como no Uno): sem aviso
        val h = EthanolHint(refuel, 0.0, 0.0, 0.0, afrOf)
        h.cruise(refuel + 10 * 60_000L, 60, stft = 7.0)
        val r = h.result()!!
        assertFalse(r.mismatch)
    }

    @Test
    fun onlyTheWindowRightAfterTheRefuelCounts() {
        // abastecimento de mais de 3 h atrás: a central já aprendeu
        val old = EthanolHint(refuel, 0.0, 0.0, 0.0, afrOf)
        old.cruise(refuel + 4 * 3600_000L, 60, stft = 40.0)
        assertNull(old.result())
        // marcha lenta e acelerador fundo não contam; poucas leituras não decidem
        val idle = EthanolHint(refuel, 0.0, 0.0, 0.0, afrOf)
        idle.cruise(refuel + 60_000L, 120, stft = 40.0, rpm = 850.0, speed = 0.0, tps = 4.0)
        assertNull(idle.result())
        // depois dos 3 min da janela a central já aprendeu: o que vem depois não muda a medida
        val h = EthanolHint(refuel, 0.0, 0.0, 0.0, afrOf)
        val t = h.cruise(refuel + 60_000L, 180, stft = 40.0)
        h.cruise(t, 300, stft = 0.0)
        assertEquals(40.0, h.result()!!.shiftPct, 1e-9)
    }
}

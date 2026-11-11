package com.universal.obddashboard.can

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class Esp32InfoTest {

    private fun feed(vararg lines: Pair<Long, String>): Esp32Info =
        lines.fold(Esp32Info()) { acc, (t, l) -> Esp32Info.apply(acc, l, t, 0) ?: acc }

    @Test fun bootLines() {
        val i = feed(0L to "# esp32-can-listen 1.4", 1L to "# listen-only 50 kbps", 2L to "# bmp180 ok", 3L to "# lsm6ds3 ok em 0x6A (id 0x69)")
        assertEquals("1.4", i.firmware)
        assertEquals(50, i.bitrateKbps)
        assertEquals("ok", i.bmp)
        assertEquals("ok", i.lsm)
        assertEquals(0, i.restarts)
    }

    @Test fun absentSensors() {
        val i = feed(0L to "# bmp180 ausente", 1L to "# lsm6ds3 sem resposta")
        assertEquals("ausente", i.bmp)
        assertEquals("sem resposta", i.lsm)
    }

    @Test fun framesPerSecondFromCumulativeCounters() {
        val i = feed(0L to "# stats quadros=1000 perdidos=0 erros=0", 10_000L to "# stats quadros=3500 perdidos=2 erros=1")
        assertEquals(250.0, i.framesPerSec!!, 0.01)
        assertEquals(2L, i.lost)
        assertEquals(1L, i.busErrors)
    }

    @Test fun firstStatsHasNoRate() {
        assertNull(feed(0L to "# stats quadros=10 perdidos=0 erros=0").framesPerSec)
    }

    @Test fun counterGoingBackIsRestart() {
        val i = feed(0L to "# stats quadros=9000 perdidos=0 erros=0", 10_000L to "# stats quadros=200 perdidos=0 erros=0")
        assertNull(i.framesPerSec)
        assertEquals(1, i.restarts)
    }

    @Test fun secondVersionLineIsRestart() {
        val i = feed(0L to "# esp32-can-listen 1.4", 5L to "# stats quadros=50 perdidos=0 erros=0", 9L to "# esp32-can-listen 1.4")
        assertEquals(1, i.restarts)
        assertNull(i.frames)
    }

    @Test fun restAndWake() {
        assertTrue(feed(0L to "# descanso: rede parada ha 120 s").resting)
        assertFalse(feed(0L to "# descanso: rede parada ha 120 s", 1L to "# acordou: atividade na rede CAN").resting)
    }

    @Test fun errorLine() {
        assertEquals("TWAI nao iniciou", feed(0L to "# ERRO TWAI nao iniciou").error)
    }

    @Test fun framesAndReadingsAreIgnored() {
        assertNull(Esp32Info.apply(Esp32Info(), "t2A04016200DE", 0, 0))
        assertNull(Esp32Info.apply(Esp32Info(), "# bmp180 temp=24.3C pressao=1013.2hPa", 0, 0))
    }
}

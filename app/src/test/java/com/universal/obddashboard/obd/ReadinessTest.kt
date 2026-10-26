package com.universal.obddashboard.obd

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File

class ReadinessTest {

    @Test fun unoAnswerAllComplete() {
        // Resposta real da IAW 7GF na viagem de teste: 41 01 00 05 61 00
        val r = Readiness.decode(0x05, 0x61, 0x00)!!
        assertFalse(r.compressionIgnition)
        assertEquals(listOf("misfire", "components", "catalyst", "o2_sensor", "o2_heater"), r.monitors.map { it.id })
        assertTrue(r.allComplete)
    }

    @Test fun incompleteMonitorsAfterBatteryDisconnect() {
        // Catalisador e sonda ainda em teste (bits 0 e 5 de D), sistema de combustível em teste (bit 5 de B)
        val r = Readiness.decode(0x07 or 0x20, 0x61, 0x21)!!
        assertEquals(setOf("fuel_system", "catalyst", "o2_sensor"), r.incomplete.map { it.id }.toSet())
        assertFalse(r.allComplete)
    }

    @Test fun dieselUsesTheOtherTableAndSkipsReservedBits() {
        val r = Readiness.decode(0x08 or 0x01, 0xFF, 0x00)!!
        assertTrue(r.compressionIgnition)
        assertTrue(r.monitors.none { it.id.startsWith("reserved") })
        assertTrue(r.monitors.any { it.id == "pm_filter" })
    }

    @Test fun missingBytesAndHiddenProfileOutputs() {
        assertNull(Readiness.decode(0x05, null, 0x00))
        val loaded = ProfileParser.parse(File("src/main/assets/profiles/fiat_uno_vivace_7gf.json").readText())
        listOf(Readiness.OUT_B, Readiness.OUT_C, Readiness.OUT_D).forEach { assertTrue(loaded.outputs[it]!!.hidden) }
        assertFalse(loaded.outputs["mil_on"]!!.hidden)
    }
}

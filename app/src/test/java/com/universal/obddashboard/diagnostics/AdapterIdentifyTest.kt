package com.universal.obddashboard.diagnostics

import com.universal.obddashboard.diagnostics.AdapterIdentify.Verdict
import com.universal.obddashboard.obd.ElmTransport
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class AdapterIdentifyTest {

    /** Adaptador de mentira: responde pelo mapa; o que não estiver lá vira "?". */
    private class Fake(private val replies: Map<String, String>) : ElmTransport {
        val sent = mutableListOf<String>()
        override suspend fun sendRaw(command: String, timeoutMs: Long): String {
            sent += command
            return replies[command] ?: "?\r\r"
        }
    }

    /** Respostas reais do adaptador do Uno ("OBD2 placa dupla v1.5 PIC18F25K80"), no console. */
    private val unoClone = mapOf(
        "ATZ" to "ATZ\rü\r\rELM327 v1.5\r\r", "ATE0" to "ATE0\rOK\r\r", "ATI" to "ELM327 v1.5\r\r",
        "ATRV" to "12.4V\r\r",
    )

    @Test fun flagsTheUnoAdapterAsCloneUsingOnlyAdapterCommands() = runTest {
        val fake = Fake(unoClone)
        val lines = mutableListOf<String>()
        val r = AdapterIdentify(fake, null, { lines += it }).run()
        assertEquals(Verdict.CLONE, r.verdict)
        assertEquals("v1.5", r.version)
        assertTrue(r.reasons.any { it.contains("nunca foi lançada") })
        assertTrue(r.reasons.any { it.contains("ATCSM") })
        // Só comandos internos do adaptador: AT... e STI (identificação de chip STN). Nada de modos OBD (01, 03, 09...).
        assertTrue(fake.sent.toString(), fake.sent.all { it.startsWith("AT") || it == "STI" })
        assertTrue(lines.none { it.contains("ü") })
    }

    @Test fun genuineLookingAdapterHasNoReasons() {
        val r = AdapterIdentify.judge(
            mapOf(
                "ATI" to "ELM327 v2.1", "AT@1" to "OBDII to RS232 Interpreter", "ATPPS" to "00:FF F 01:FF F",
                "ATCSM1" to "OK", "STI" to "?",
            ),
        )
        assertEquals(Verdict.PROBABLY_GENUINE, r.verdict)
        assertEquals("v2.1", r.version)
    }

    @Test fun claimedV2WithoutNewerCommandsIsClone() {
        val r = AdapterIdentify.judge(mapOf("ATI" to "ELM327 v2.1", "AT@1" to "OBDII to RS232 Interpreter", "ATPPS" to "?", "ATCSM1" to "?"))
        assertEquals(Verdict.CLONE, r.verdict)
        assertEquals(2, r.reasons.size)
    }

    @Test fun olderGenuineVersionsAreNotPenalisedForMissingNewerCommands() {
        val r = AdapterIdentify.judge(mapOf("ATI" to "ELM327 v1.3a", "AT@1" to "OBDII to RS232 Interpreter", "ATCSM1" to "?", "ATPPS" to "?"))
        assertEquals(Verdict.PROBABLY_GENUINE, r.verdict)
    }

    @Test fun stnChipAndSilence() {
        assertEquals(Verdict.STN, AdapterIdentify.judge(mapOf("ATI" to "ELM327 v1.4b", "STI" to "STN1110 v4.2.0")).verdict)
        assertEquals(Verdict.UNKNOWN, AdapterIdentify.judge(mapOf("ATI" to null, "ATZ" to null)).verdict)
    }
}

package com.universal.obddashboard.diagnostics

import com.universal.obddashboard.obd.ElmMonitorTransport
import kotlinx.coroutines.delay
import kotlinx.coroutines.test.runTest
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder

class CanListenerTest {

    @get:Rule val tmp = TemporaryFolder()

    /** Rede CAN de mentira: cada divisor de ATPB tem seu tráfego; um quadro a cada 10 ms (tempo virtual). */
    private class FakeBus(
        private val traffic: Map<Int, List<String>>,
        private val clock: () -> Long,
        private val csmReply: String = "OK",
        private val bufferFullEvery: Int = 0,
    ) : ElmMonitorTransport {
        val sent = mutableListOf<String>()
        var monitorCalls = 0
        private var divisor = 0

        override suspend fun sendRaw(command: String, timeoutMs: Long): String {
            sent += command
            if (command.startsWith("ATPBE0")) divisor = command.substring(6).toInt(16)
            return when (command) {
                "ATZ" -> "\r\rELM327 v1.5\r\r"
                "ATCSM1" -> "$csmReply\r\r"
                else -> "OK\r\r"
            }
        }

        override suspend fun monitor(command: String, durationMs: Long, onLine: (String) -> Unit) {
            sent += command
            monitorCalls++
            val lines = traffic[divisor].orEmpty()
            if (lines.isEmpty()) return delay(durationMs)
            val start = clock()
            var n = 0
            while (clock() - start < durationMs) {
                delay(10)
                onLine(lines[n++ % lines.size])
                if (bufferFullEvery > 0 && n % bufferFullEvery == 0) {
                    onLine("BUFFER FULL")
                    return
                }
            }
        }
    }

    /** Painel a 50 kbps: 0x3A5 com o byte 2 mudando (nível do tanque?), 0x2F0 fixo. */
    private val panel = listOf("3A5 01 00 5C 00", "2F0 11 22", "3A5 01 00 5B 00", "<RX ERROR")

    @Test fun parsesMonitorLines() {
        assertEquals(CanListener.Frame("3A5", listOf(1, 0, 0x5C)), CanListener.parseFrame("3A5 01 00 5C"))
        assertEquals(CanListener.Frame("18DAF110", listOf(2, 0x7E, 0)), CanListener.parseFrame("18 DA F1 10 02 7E 00"))
        assertEquals(CanListener.Frame("7E8", emptyList()), CanListener.parseFrame("7e8"))
        listOf("BUFFER FULL", "CAN ERROR", "<RX ERROR", "STOPPED", "OK", "?", "").forEach { assertNull(it, CanListener.parseFrame(it)) }
    }

    @Test fun findsTheBusSpeedListensAndOnlyEverSendsAtCommands() = runTest {
        val bus = FakeBus(mapOf(10 to panel), { testScheduler.currentTime })
        val file = tmp.newFile("diag_x_console-escuta.jsonl")
        val console = mutableListOf<String>()
        val result = DiagnosticRecorder(file).use { rec ->
            CanListener(bus, rec, { console += it }, { testScheduler.currentTime }).run(null, durationMs = 60_000)
        }

        assertEquals(CanListener.Baud.K50, result.baud)
        assertTrue(result.frames in 4400..4600)                     // 3 de cada 4 linhas são quadros, 1 a cada 10 ms
        assertEquals(setOf(2), result.stats["3A5"]!!.changedBytes)
        assertTrue(result.stats["2F0"]!!.changedBytes.isEmpty())
        // Passivo: só comandos AT (configuração do adaptador e ATMA); nenhum pedido ao carro.
        assertTrue(bus.sent.toString(), bus.sent.all { it.startsWith("AT") })
        assertTrue(bus.sent.indexOf("ATCSM1") < bus.sent.indexOf("ATMA"))
        assertTrue(console.any { it.startsWith("  3A5") && it.contains("variam b2") })

        val events = file.readLines().map { Json.parseToJsonElement(it).jsonObject }
        val summary = events.last { it["type"]!!.jsonPrimitive.content == "can_summary" }
        assertEquals("[2]", summary["ids"]!!.jsonObject["3A5"]!!.jsonObject["changed_bytes"]!!.jsonArray.toString())
        assertEquals(result.frames, events.count { it["type"]!!.jsonPrimitive.content == "can" && CanListener.parseFrame(it["l"]!!.jsonPrimitive.content) != null })
    }

    @Test fun refusesToListenWithoutSilentMode() = runTest {
        val bus = FakeBus(mapOf(1 to panel), { testScheduler.currentTime }, csmReply = "?")
        val r = runCatching { CanListener(bus, null, {}, { testScheduler.currentTime }).run(CanListener.Baud.K500) }
        assertTrue(r.exceptionOrNull() is CanListener.NotSilentException)
        assertEquals(0, bus.monitorCalls)
    }

    @Test fun restartsAfterBufferFullUntilTheTimeIsUp() = runTest {
        val bus = FakeBus(mapOf(1 to panel), { testScheduler.currentTime }, bufferFullEvery = 500)
        val result = CanListener(bus, null, {}, { testScheduler.currentTime }).run(CanListener.Baud.K500, durationMs = 60_000)
        assertTrue(bus.monitorCalls >= 12)                         // 500 linhas = 5 s por ATMA
        assertTrue(testScheduler.currentTime >= 60_000)
        assertTrue("buffer_full" in result.notes)
        assertTrue("<RX ERROR" in result.notes)
    }

    @Test fun reportsSilenceOnEverySpeed() = runTest {
        val bus = FakeBus(emptyMap(), { testScheduler.currentTime })
        val result = CanListener(bus, null, {}, { testScheduler.currentTime }).run(null)
        assertNull(result.baud)
        assertEquals(CanListener.Baud.entries.size, bus.monitorCalls)
    }
}

package com.universal.obddashboard.obd

import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.launch
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File

class EcuFreezeFrameTest {

    private val uno = ProfileParser.parse(File("src/main/assets/profiles/fiat_uno_vivace_7gf.json").readText())

    private class Fake(private val replies: Map<String, String>) : ElmTransport {
        val sent = mutableListOf<String>()
        override suspend fun sendRaw(command: String, timeoutMs: Long): String {
            sent += command
            return replies[command] ?: "NO DATA\r\r"
        }
    }

    private val noop = object : CommandQueue.Listener {
        override fun onValues(values: Map<String, Double>, timestamp: Long) {}
        override fun onDtcs(kind: DtcKind, codes: List<String>, timestamp: Long) {}
    }

    private suspend fun kotlinx.coroutines.test.TestScope.readWith(replies: Map<String, String>): Pair<CommandQueue.EcuFreezeFrame?, Fake> {
        val fake = Fake(replies)
        val q = CommandQueue(fake, uno, noop, clock = { testScheduler.currentTime })
        val result = CompletableDeferred<CommandQueue.EcuFreezeFrame?>()
        q.requestEcuFreezeFrame { result.complete(it) }
        val job = launch { runCatching { q.run() } }
        val ff = result.await()
        job.cancel()
        return ff to fake
    }

    @Test fun readsTheEcuFrameOnlyWithMode02Queries() = runTest {
        val (ff, fake) = readWith(
            mapOf(
                "020200" to "4202000420\r\r",   // quadro gerado pelo P0420
                "020C00" to "420C000D54\r\r",   // 853 rpm
                "020D00" to "420D0064\r\r",     // 100 km/h
                "020500" to "4205007E\r\r",     // 86 °C
            ),
        )
        assertEquals("P0420", ff!!.code)
        assertEquals(853.0, ff.values["rpm"]!!, 0.01)
        assertEquals(100.0, ff.values["speed"]!!, 0.01)
        assertEquals(86.0, ff.values["coolant_temp"]!!, 0.01)
        val frameQueries = fake.sent.takeWhile { it.startsWith("02") }
        assertTrue(frameQueries.isNotEmpty() && frameQueries.all { it.matches(Regex("^02[0-9A-F]{2}00$")) })
        assertTrue("0101 não entra no quadro", "020100" !in fake.sent)
    }

    @Test fun noFrameStored() = runTest {
        assertNull(readWith(mapOf("020200" to "4202000000\r\r")).first)
        assertNull(readWith(emptyMap()).first)
    }

    @Test fun dtcBytes() {
        assertEquals("P0420", dtcFromBytes(0x04, 0x20))
        assertEquals("C1234", dtcFromBytes(0x52, 0x34))
        assertEquals("U0100", dtcFromBytes(0xC1, 0x00))
        assertNull(dtcFromBytes(0, 0))
    }
}

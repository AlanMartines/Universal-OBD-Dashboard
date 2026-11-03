package com.universal.obddashboard.obd

import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File

/** "Ler falhas agora": só consultas, e cada modo sem resposta fica marcado como não informado. */
class DtcScanTest {
    private val uno = ProfileParser.parse(File("src/main/assets/profiles/fiat_uno_vivace_7gf.json").readText())

    private class Fake(private val replies: Map<String, String>) : ElmTransport {
        val sent = mutableListOf<String>()
        override suspend fun sendRaw(command: String, timeoutMs: Long): String {
            sent += command
            return replies[command] ?: "NO DATA\r\r"
        }
    }

    private val seen = mutableListOf<Pair<DtcKind, List<String>>>()
    private val listener = object : CommandQueue.Listener {
        override fun onValues(values: Map<String, Double>, timestamp: Long) {}
        override fun onDtcs(kind: DtcKind, codes: List<String>, timestamp: Long) { seen += kind to codes }
    }

    @Test fun readsAllModesWithoutWriting() = runTest {
        val fake = Fake(
            mapOf(
                "0101" to "4101810700\r\r",          // luz acesa, 1 código
                "03" to "430171000000\r\r",           // P0171 (linha K: 3 pares)
                "0A" to "?\r\r",                      // modo não suportado
                "020200" to "4202000171\r\r",
            ),
        )
        val q = CommandQueue(fake, uno, listener)
        val scan = q.scanDtcs()
        assertEquals(true, scan.milOn)
        assertEquals(1, scan.storedCount)
        assertEquals(listOf("P0171"), scan.codes[DtcKind.CONFIRMED])
        assertEquals("NO DATA na linha K é lista vazia", emptyList<String>(), scan.codes[DtcKind.PENDING])
        assertNull("sem resposta ao 0A", scan.codes[DtcKind.PERMANENT])
        assertEquals("P0171", scan.freezeFrame?.code)
        // A captura recebe as listas dos modos que já acompanha
        assertEquals(listOf(DtcKind.CONFIRMED to listOf("P0171"), DtcKind.PENDING to emptyList()), seen)
        // Nunca o modo 04 (apagar falhas) nem comandos de escrita
        assertTrue(fake.sent.toString(), fake.sent.none { it == "04" || it.startsWith("04") || it.startsWith("2E") || it.startsWith("3B") })
    }
}

package com.universal.obddashboard.diagnostics

import com.universal.obddashboard.obd.CommandQueue
import com.universal.obddashboard.obd.DtcKind
import com.universal.obddashboard.obd.ProfileParser
import com.universal.obddashboard.obd.sim.Elm327Simulator
import kotlinx.coroutines.launch
import kotlinx.coroutines.test.advanceTimeBy
import kotlinx.coroutines.test.runTest
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.long
import kotlinx.serialization.json.put
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder
import java.io.File

class DiagnosticRecordingTest {

    @get:Rule val tmp = TemporaryFolder()

    private val uno = ProfileParser.parse(File("src/main/assets/profiles/fiat_uno_vivace_7gf.json").readText())

    private fun lines(f: File): List<JsonObject> = f.readLines().map { Json.parseToJsonElement(it).jsonObject }
    private fun JsonObject.str(k: String) = this[k]?.jsonPrimitive?.content

    private val noop = object : CommandQueue.Listener {
        override fun onValues(values: Map<String, Double>, timestamp: Long) {}
        override fun onDtcs(kind: DtcKind, codes: List<String>, timestamp: Long) {}
    }

    @Test fun fullSessionThroughSimulatorIsRecordedAsValidJsonLines() = runTest {
        val sim = Elm327Simulator(Elm327Simulator.Protocol.KWP2000_FAST).apply {   // o Uno, na linha K (ATSP5)
            unsupportedPids += 0x42
            vehicle.confirmedDtcs += "P0133"
        }
        val file = DiagnosticRecorder.newFile(tmp.root, uno.id, now = 0)
        val rec = DiagnosticRecorder(file, clock = { testScheduler.currentTime })
        val transport = LoggingTransport(sim, rec, elapsedMs = { testScheduler.currentTime })
        val q = CommandQueue(transport, uno, noop, clock = { testScheduler.currentTime })

        val info = q.initialize()
        DiagnosticScan.run(transport, info.supportedPids, uno.profile.adapter, rec)
        val job = launch { q.run() }
        advanceTimeBy(3_000)
        sim.dropNext = 1
        advanceTimeBy(2_000)
        job.cancel()
        rec.close()

        val events = lines(file) // falha se alguma linha não for JSON válido
        val elm = events.filter { it.str("type") == "elm" }
        assertTrue(elm.size > 50)
        val rpm = elm.first { it.str("cmd") == "010C1" }
        assertTrue(rpm.str("rx")!!.contains("410C"))
        assertEquals(sim.latencyMs, rpm["ms"]!!.jsonPrimitive.long)
        assertTrue("timeout registrado", elm.any { it.str("err") == "timeout" })

        // Varredura: cada PID anunciado lido uma vez, sem sufixo; modo 09 e DTCs incluídos.
        assertEquals(listOf("start", "end"), events.filter { it.str("type") == "scan" }.map { it.str("phase") })
        val scanned = elm.map { it.str("cmd") }
        assertTrue(listOf("ATI", "AT@1", "ATDPN", "0105", "0114", "0902", "090A", "03").all { it in scanned })
        assertFalse("0142 não suportado fica fora da varredura", "0142" in scanned)
    }

    @Test fun truncatesAtMaxBytesAndStops() {
        val f = File(tmp.root, "diag_x.jsonl")
        val rec = DiagnosticRecorder(f, maxBytes = 200)
        repeat(20) { i -> rec.event("e") { put("i", i) } }
        rec.close()
        val events = lines(f)
        assertEquals("truncated", events.last().str("type"))
        assertTrue(f.length() < 300)
        assertFalse(rec.isActive)
        rec.event("depois") // não lança
    }

    @Test fun errorsKeepStackAndJsonStaysValid() {
        val f = File(tmp.root, "diag_y.jsonl")
        val rec = DiagnosticRecorder(f)
        rec.error("connection", IllegalStateException("linha 1\nlinha \"2\""))
        rec.close()
        val e = lines(f).single()
        assertEquals("connection", e.str("where"))
        assertTrue(e.str("stack")!!.contains("IllegalStateException"))
    }

    @Test fun cleanupRemovesOnlyOldDiagnosticFiles() {
        val old = File(tmp.root, "diag_old.jsonl").apply { writeText("{}"); setLastModified(0) }
        val oldCrash = File(tmp.root, "crash_old.txt").apply { writeText("x"); setLastModified(0) }
        val other = File(tmp.root, "outro.txt").apply { writeText("x"); setLastModified(0) }
        val fresh = File(tmp.root, "diag_new.jsonl").apply { writeText("{}") }
        DiagnosticRecorder.cleanup(tmp.root, maxAgeMs = 1000)
        assertFalse(old.exists() || oldCrash.exists())
        assertTrue(other.exists() && fresh.exists())
    }

    @Test fun fileNamesMatchExportWhitelist() {
        val f = DiagnosticRecorder.newFile(tmp.root, "perfil com espaço/../x")
        assertTrue(f.name, f.name.matches(DiagnosticRecorder.NAME_REGEX))
        assertEquals(tmp.root, f.parentFile)
        assertFalse("../etc".matches(DiagnosticRecorder.NAME_REGEX))
    }
}

package com.universal.obddashboard.obd

import com.universal.obddashboard.obd.sim.Elm327Simulator
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Job
import kotlinx.coroutines.launch
import kotlinx.coroutines.test.TestScope
import kotlinx.coroutines.test.advanceTimeBy
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Test
import java.io.File
import java.io.IOException

/** CommandQueue contra o ELM327 simulado, em tempo virtual (kotlinx-coroutines-test). */
class CommandQueueSimulatorTest {

    private class Recorder : CommandQueue.Listener {
        val values = HashMap<String, Double>()
        val counts = HashMap<String, Int>()
        val dtcs = HashMap<DtcKind, List<String>>()
        val dtcReads = HashMap<DtcKind, Int>()
        val disabled = mutableListOf<String>()
        val fallbacks = mutableListOf<String>()

        override fun onValues(values: Map<String, Double>, timestamp: Long) {
            this.values.putAll(values)
            values.keys.forEach { counts.merge(it, 1, Int::plus) }
        }

        override fun onDtcs(kind: DtcKind, codes: List<String>, timestamp: Long) {
            dtcs[kind] = codes
            dtcReads.merge(kind, 1, Int::plus)
        }

        override fun onCommandStatus(pidId: String, message: String, disabled: Boolean) {
            if (disabled) this.disabled += pidId else fallbacks += pidId
        }

        fun count(id: String) = counts[id] ?: 0
    }

    private fun profile(name: String) = ProfileParser.parse(File("src/main/assets/profiles/$name.json").readText())

    private val uno = profile("fiat_uno_vivace_7gf")
    private val generic = profile("generic_obd2")

    private fun TestScope.queue(sim: Elm327Simulator, p: LoadedProfile, rec: Recorder) =
        CommandQueue(sim, p, rec, clock = { testScheduler.currentTime })

    /** Executa o laço em segundo plano; [error] guarda a exceção que o encerrou, se houver. */
    private class Running(val job: Job) {
        var error: Throwable? = null
    }

    private fun TestScope.start(q: CommandQueue): Running {
        lateinit var r: Running
        val job = launch {
            try {
                q.run()
            } catch (e: CancellationException) {
                throw e
            } catch (e: Throwable) {
                r.error = e
            }
        }
        r = Running(job)
        return r
    }

    // ---------------- Inicialização ----------------

    @Test fun unoInitializesAndStreamsWithAtrvFallback() = runTest {
        val sim = Elm327Simulator().apply { unsupportedPids += 0x42 }
        val rec = Recorder()
        val q = queue(sim, uno, rec)

        val info = q.initialize()
        assertEquals("ELM327 v1.5", info.version)
        assertTrue(0x0C in info.supportedPids!! && 0x42 !in info.supportedPids!!)
        assertEquals(emptyList<String>(), info.disabledPids) // 0142 troca para ATRV, não desativa
        assertEquals(listOf("battery_volts"), rec.fallbacks)

        val run = start(q)
        advanceTimeBy(5_000)
        run.job.cancel()

        assertEquals(850.0, rec.values["rpm"]!!, 0.5)
        assertEquals(90.0, rec.values["coolant_temp"]!!, 0.0)
        assertEquals(14.2, rec.values["battery_volts"]!!, 1e-9)
        assertEquals(emptyList<String>(), rec.dtcs[DtcKind.CONFIRMED])
        assertTrue("sufixo de contagem de respostas", "010C1" in sim.log)
        assertTrue("ATRV" in sim.log)
    }

    @Test fun ignitionOffAtStartIsReportedAsEcuNotResponding() = runTest {
        val sim = Elm327Simulator().apply { vehicle.ignitionOn = false }
        try {
            queue(sim, uno, Recorder()).initialize()
            fail("esperado EcuNotRespondingException")
        } catch (e: EcuNotRespondingException) {
            assertTrue(e.message!!.contains("UNABLE TO CONNECT"))
        }
    }

    @Test fun unsupportedPidWithoutFallbackIsDisabled() = runTest {
        val sim = Elm327Simulator().apply { unsupportedPids += 0x15 }
        val info = queue(sim, uno, Recorder()).initialize()
        assertEquals(listOf("lambda_b1s2"), info.disabledPids)
    }

    // ---------------- Protocolo e DTCs ----------------

    @Test fun genericProfileOnCanCarDecodesMultiFrameDtcs() = runTest {
        val sim = Elm327Simulator(Elm327Simulator.Protocol.CAN_11BIT_500K).apply {
            vehicle.milOn = true
            vehicle.confirmedDtcs += listOf("P0133", "P0134", "P0300", "U0100") // 10 bytes: multi-frame
            vehicle.pendingDtcs += "P0171"
        }
        val rec = Recorder()
        val q = queue(sim, generic, rec)
        q.initialize()
        assertTrue("ATDPN" in sim.log)

        val run = start(q)
        advanceTimeBy(5_000)
        run.job.cancel()

        assertEquals(listOf("P0133", "P0134", "P0300", "U0100"), rec.dtcs[DtcKind.CONFIRMED])
        assertEquals(listOf("P0171"), rec.dtcs[DtcKind.PENDING])
        assertEquals(1.0, rec.values["mil_on"]!!, 0.0)
        assertEquals(4.0, rec.values["dtc_count"]!!, 0.0)
    }

    @Test fun kLineCarConnectsAndDecodesDtcs() = runTest {
        val sim = Elm327Simulator(Elm327Simulator.Protocol.ISO_9141_2).apply {
            vehicle.confirmedDtcs += listOf("P0133", "P0420", "P0300", "P0171") // duas linhas de 3 códigos
        }
        val rec = Recorder()
        val q = queue(sim, generic, rec)
        q.initialize()

        val run = start(q)
        advanceTimeBy(5_000)
        run.job.cancel()

        assertEquals(listOf("P0133", "P0420", "P0300", "P0171"), rec.dtcs[DtcKind.CONFIRMED])
        assertEquals(850.0, rec.values["rpm"]!!, 0.5)
    }

    /** Pela documentação (pág. 163), a IAW 7GF fala pela linha K (pino 7): o perfil do Uno não pode forçar CAN. */
    @Test fun unoProfileConnectsOnKLine() = runTest {
        val sim = Elm327Simulator(Elm327Simulator.Protocol.KWP2000_FAST).apply { vehicle.confirmedDtcs += "P0130" }
        val rec = Recorder()
        val q = queue(sim, uno, rec)
        val info = q.initialize()
        assertTrue(0x0C in info.supportedPids!!)

        val run = start(q)
        advanceTimeBy(5_000)
        run.job.cancel()

        assertEquals(850.0, rec.values["rpm"]!!, 0.5)
        assertEquals(listOf("P0130"), rec.dtcs[DtcKind.CONFIRMED])
    }

    // ---------------- Escalonador ----------------

    @Test fun edfKeepsEveryLaneAliveWhenAdapterIsSaturated() = runTest {
        val sim = Elm327Simulator().apply { latencyMs = 40 } // ~25 req/s, abaixo dos 40 req/s pedidos
        val rec = Recorder()
        val q = queue(sim, uno, rec)
        q.initialize()

        val run = start(q)
        advanceTimeBy(30_000)
        run.job.cancel()

        // Média (5 s): ~6 leituras em 30 s; diagnóstico (30 s): 1-2; alta (RPM, velocidade, MAP): o que sobrar.
        for (id in listOf("coolant_temp", "intake_temp", "battery_volts", "throttle", "stft_b1", "lambda_b1s2_v")) {
            assertTrue("$id lido ${rec.count(id)}x", rec.count(id) >= 5)
        }
        assertTrue((rec.dtcReads[DtcKind.CONFIRMED] ?: 0) >= 1)
        for (id in listOf("rpm", "speed", "map")) {
            assertTrue("$id lido ${rec.count(id)}x", rec.count(id) >= 150)
        }
    }

    @Test fun idleModeThrottlesPolling() = runTest {
        val sim = Elm327Simulator()
        val rec = Recorder()
        val q = queue(sim, uno, rec)
        q.initialize()

        val run = start(q)
        advanceTimeBy(10_000)
        val active = rec.count("rpm")
        q.idleMode = true
        advanceTimeBy(10_000)
        val idle = rec.count("rpm") - active
        run.job.cancel()

        assertTrue("ativo=$active ocioso=$idle", idle < active * 0.6)
        assertTrue(idle > 0)
    }

    // ---------------- Falhas ----------------

    @Test fun ignitionOffMidTripEndsWithEcuSilent() = runTest {
        val sim = Elm327Simulator()
        val q = queue(sim, uno, Recorder())
        q.initialize()

        val run = start(q)
        advanceTimeBy(10_000)
        sim.vehicle.ignitionOn = false
        advanceTimeBy(uno.profile.powerManagement.ecuSilenceTimeoutS * 1000 - 2_000)
        assertTrue("encerrou cedo demais: ${run.error}", run.error == null)
        advanceTimeBy(5_000)

        assertTrue("esperado EcuSilentException, veio ${run.error}", run.error is EcuSilentException)
    }

    @Test fun briefIgnitionDropDoesNotDisablePids() = runTest {
        val sim = Elm327Simulator()
        val rec = Recorder()
        val q = queue(sim, uno, rec)
        q.initialize()

        val run = start(q)
        advanceTimeBy(10_000)
        sim.vehicle.ignitionOn = false // motor apagou / partida
        advanceTimeBy(3_000)
        sim.vehicle.ignitionOn = true
        advanceTimeBy(2_000)
        val before = rec.count("rpm")
        advanceTimeBy(10_000)
        run.job.cancel()

        assertEquals(emptyList<String>(), rec.disabled)
        assertTrue("RPM voltou a ser lido", rec.count("rpm") - before > 30)
    }

    @Test fun pidAdvertisedButAlwaysNoDataIsDisabledWhileOthersRespond() = runTest {
        val sim = Elm327Simulator().apply { noDataPids += 0x0E }
        val rec = Recorder()
        val q = queue(sim, uno, rec)
        q.initialize()

        val run = start(q)
        advanceTimeBy(30_000)
        run.job.cancel()

        assertEquals(listOf("timing_advance"), rec.disabled)
        assertNotNull(rec.values["rpm"])
    }

    @Test fun frozenAdapterRaisesIOException() = runTest {
        val sim = Elm327Simulator()
        val q = queue(sim, uno, Recorder())
        q.initialize()

        val run = start(q)
        advanceTimeBy(2_000)
        sim.unresponsive = true
        advanceTimeBy(10_000)

        assertTrue("esperado IOException, veio ${run.error}", run.error is IOException)
    }

    @Test fun cloneWithoutResponseCountKeepsStreaming() = runTest {
        val sim = Elm327Simulator().apply { acceptsResponseCount = false; rejectedCommands += "ATAT1" }
        val rec = Recorder()
        val q = queue(sim, uno, rec)
        q.initialize()

        val run = start(q)
        advanceTimeBy(5_000)
        run.job.cancel()

        assertEquals(emptyList<String>(), rec.disabled)
        assertTrue(rec.count("rpm") > 10)
        assertTrue("sem sufixo após o '?'", sim.log.takeLast(20).none { it == "010C1" })
    }

    @Test fun bufferFullAndIsolatedTimeoutsAreTolerated() = runTest {
        val sim = Elm327Simulator()
        val rec = Recorder()
        val q = queue(sim, uno, rec)
        q.initialize()

        val run = start(q)
        advanceTimeBy(2_000)
        sim.bufferFullNext = 2
        sim.dropNext = 2
        advanceTimeBy(5_000)
        val before = rec.count("rpm")
        advanceTimeBy(3_000)
        run.job.cancel()

        assertTrue(run.error == null)
        assertFalse(rec.count("rpm") == before)
    }
}

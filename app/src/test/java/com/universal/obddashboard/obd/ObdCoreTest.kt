package com.universal.obddashboard.obd

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File

class ObdCoreTest {

    private fun eval(f: String, vararg bytes: Int) =
        FormulaEvaluator.evaluateBytes(FormulaEvaluator.compile(f), bytes)

    // ---------------- Fórmulas ----------------

    @Test fun rpmFormula() = assertEquals(1726.0, eval("((A*256)+B)/4", 0x1A, 0xF8), 1e-9)

    @Test fun coolantFormula() = assertEquals(92.0, eval("A-40", 132), 1e-9)

    @Test fun precedenceAndBitwise() {
        assertEquals(1.0, eval("(A >> 7) & 1", 0x83), 1e-9)
        assertEquals(3.0, eval("A & 127", 0x83), 1e-9)
        assertEquals(7.0, FormulaEvaluator.evaluate("1 + 2 * 3", emptyMap()), 1e-9)
        assertEquals(-2.0, FormulaEvaluator.evaluate("signed8(254)", emptyMap()), 1e-9)
        assertEquals(0.0, eval("B == 255 ? 0 : (B*100/128)-100", 0x40, 0xFF), 1e-9)
    }

    @Test fun alertConditionsWithMissingValues() {
        val vars = mapOf("coolant_temp" to 106.0)
        assertEquals(1.0, FormulaEvaluator.evaluate("coolant_temp > 105", vars), 1e-9)
        // Variável ausente → NaN → condição falsa (não dispara alerta com dado faltando)
        assertTrue(!FormulaEvaluator.truthy(FormulaEvaluator.evaluate("rpm > 6250", vars)))
        assertTrue(!FormulaEvaluator.truthy(FormulaEvaluator.evaluate("battery_volts < 12.5 && rpm > 700", vars)))
    }

    @Test(expected = FormulaException::class)
    fun invalidFormulaRejected() {
        FormulaEvaluator.compile("((A*256)+B")
    }

    // ---------------- Respostas ELM327 ----------------

    @Test fun singleFrameWithAndWithoutSpaces() {
        val a = ElmResponseParser.parse("41 0C 1A F8 \r\r") as ElmResult.Messages
        val b = ElmResponseParser.parse("SEARCHING...\r410C1AF8\r") as ElmResult.Messages
        assertEquals(listOf(0x41, 0x0C, 0x1A, 0xF8), a.messages[0].toList())
        assertEquals(a.messages[0].toList(), b.messages[0].toList())
    }

    @Test fun multiFrameDtcResponse() {
        val raw = "00A\r0:430401330134\r1:0300C1000000\r"
        val r = ElmResponseParser.parse(raw) as ElmResult.Messages
        assertEquals(10, r.messages[0].size)
        val codes = DtcDecoder.decode(r.messages, DtcKind.CONFIRMED, isCan = true)
        assertEquals(listOf("P0133", "P0134", "P0300", "U0100"), codes)
    }

    @Test fun noDtcsOnCan() {
        val r = ElmResponseParser.parse("4300\r") as ElmResult.Messages
        assertEquals(emptyList<String>(), DtcDecoder.decode(r.messages, DtcKind.CONFIRMED, isCan = true))
    }

    @Test fun errorsClassified() {
        assertEquals(ElmResult.NoData, ElmResponseParser.parse("NO DATA\r"))
        assertEquals(ElmErrorKind.UNABLE_TO_CONNECT, (ElmResponseParser.parse("UNABLE TO CONNECT\r") as ElmResult.Error).kind)
        assertEquals(ElmErrorKind.BUFFER_FULL, (ElmResponseParser.parse("BUFFER FULL\r") as ElmResult.Error).kind)
        assertEquals(ElmErrorKind.UNKNOWN_COMMAND, (ElmResponseParser.parse("?\r") as ElmResult.Error).kind)
    }

    @Test fun kLineBusInitOkIsNotAnError() {
        // Primeiro comando em K-Line (ISO 9141/KWP2000): o ELM327 imprime o status da inicialização do barramento.
        val r = ElmResponseParser.parse("BUS INIT: ...OK\r41 00 BE 1F A8 13\r") as ElmResult.Messages
        assertEquals(listOf(0x41, 0x00, 0xBE, 0x1F, 0xA8, 0x13), r.messages[0].toList())
        assertEquals(ElmErrorKind.UNABLE_TO_CONNECT, (ElmResponseParser.parse("BUS INIT: ...ERROR\r") as ElmResult.Error).kind)
    }

    @Test fun protocolNumberFromAtdpn() {
        assertEquals(true, ElmResponseParser.isCanProtocol("A6\r"))   // detectado automaticamente: CAN 11-bit 500k
        assertEquals(true, ElmResponseParser.isCanProtocol("6"))
        assertEquals(true, ElmResponseParser.isCanProtocol("AA\r"))   // J1939 detectado
        assertEquals(true, ElmResponseParser.isCanProtocol("A\r"))    // J1939 fixado com ATSPA
        assertEquals(false, ElmResponseParser.isCanProtocol("A3\r"))  // ISO 9141-2
        assertEquals(false, ElmResponseParser.isCanProtocol("5\r"))   // KWP2000 fast init
        assertEquals(null, ElmResponseParser.isCanProtocol("?\r"))
    }

    @Test fun canDtcsMisreadWithoutCountByte() {
        // Mesmo payload decodificado como CAN (correto) e como K-Line: por isso o protocolo precisa ser detectado.
        val m = listOf(intArrayOf(0x43, 0x02, 0x01, 0x33, 0x01, 0x34))
        assertEquals(listOf("P0133", "P0134"), DtcDecoder.decode(m, DtcKind.CONFIRMED, isCan = true))
        assertTrue("P0133" !in DtcDecoder.decode(m, DtcKind.CONFIRMED, isCan = false))
    }

    @Test fun atrvVoltage() = assertEquals(12.6, ElmResponseParser.parseVoltage("12.6V\r")!!, 1e-9)

    @Test fun supportedBitmap() {
        val set = ElmResponseParser.decodeSupportedBitmap(0x00, intArrayOf(0xBE, 0x1F, 0xA8, 0x13))
        assertTrue(0x01 in set && 0x0C in set && 0x0D in set && 0x20 in set)
        assertTrue(0x02 !in set)
    }

    // ---------------- Perfis embarcados ----------------

    private fun asset(name: String) = File("src/main/assets/profiles/$name").readText()

    @Test fun unoProfileCompiles() {
        val p = ProfileParser.parse(asset("fiat_uno_vivace_7gf.json"))
        assertEquals("fiat_uno_vivace_7gf", p.id)
        assertTrue("linha K pelo manual: protocolo detectado por ATDPN, não fixado em CAN", !p.isCan)
        assertTrue("ATSP5" in p.profile.initCommands)       // fixo: sem busca automática pelos protocolos CAN
        assertEquals("Sonda lambda pré-catalisador (HEGO 1)", p.profile.describeDtc("p0130"))
        assertEquals(27, p.profile.dtcDescriptions.size)
        assertEquals(6250.0, p.profile.dashboard.rpmRedline, 0.0)
        assertEquals(48.0, p.profile.fuel!!.tankCapacityL, 0.0)
        // Calibrados com os abastecimentos e o hodômetro da viagem de teste
        assertEquals(0.99, p.profile.fuel!!.volumetricEfficiency, 0.0)
        assertEquals(1.026, p.profile.obdSpeedFactor, 0.0)
        assertEquals(listOf(14.8, 28.2, 43.8, 61.4), p.profile.shiftIndicator!!.upshiftSpeedsKmh)
        val volts = p.commands.first { it.pidId == "battery_volts" }
        assertEquals("ATRV", volts.fallback!!.command)
        assertTrue(p.outputs.keys.containsAll(listOf("rpm", "speed", "mil_on", "dtc_count", "lambda_b1s2_v")))
        // Não confiáveis nesta ECU (viagem de teste): sonda pré (A=FF) e LTFT (salta a cada amostra)
        assertTrue("lambda_b1s1_v" !in p.outputs && "ltft_b1" !in p.outputs)
        assertEquals(null, p.profile.roles.ltft)
    }

    @Test fun genericProfileCompiles() {
        val p = ProfileParser.parse(asset("generic_obd2.json"))
        assertEquals("generic_obd2", p.id)
    }

    /** Bytes reais da IAW 7GF na viagem de teste. */
    @Test fun unoFormulasMatchRealEcuBytes() {
        val p = ProfileParser.parse(asset("fiat_uno_vivace_7gf.json"))
        fun value(pid: String, rx: String) =
            (p.commands.first { it.pidId == pid }.primary.interpret(rx, isCan = false) as CommandResult.Values).values[pid]!!
        assertEquals(5.0, value("timing_advance", "410E0A\r"), 1e-9)    // marcha lenta
        assertEquals(26.0, value("timing_advance", "410E34\r"), 1e-9)   // cruzeiro
        assertEquals(0.0, value("stft_b1", "410600\r"), 1e-9)
        assertEquals(-3.90625, value("stft_b1", "4106FB\r"), 1e-9)
        assertEquals(2.34375, value("stft_b1", "410603\r"), 1e-9)
        assertEquals(0.0, value("throttle", "41111D\r"), 1e-9)          // borboleta fechada (11,4% absoluto)
        assertEquals(100.0, value("throttle", "4111DE\r"), 0.2)         // toda aberta (87% absoluto)
        assertEquals(listOf(6.0, 11.3, 17.5, 25.0, 29.5), p.profile.shiftIndicator!!.gearKmhPer1000Rpm)
    }

    @Test fun decodeThroughVariant() {
        val p = ProfileParser.parse(asset("fiat_uno_vivace_7gf.json"))
        val rpm = p.commands.first { it.pidId == "rpm" }.primary
        val result = rpm.interpret("410C1AF8\r", isCan = true) as CommandResult.Values
        assertEquals(1726.0, result.values["rpm"]!!, 1e-9)
        // Resposta atrasada de outro PID não pode ser atribuída ao RPM
        assertTrue(rpm.interpret("410D3C\r", isCan = true) is CommandResult.Failure)
    }
}

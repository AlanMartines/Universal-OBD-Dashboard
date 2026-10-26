package com.universal.obddashboard.obd.sim

import com.universal.obddashboard.obd.ElmTimeoutException
import com.universal.obddashboard.obd.ElmTransport
import kotlinx.coroutines.delay
import java.util.Locale
import kotlin.math.roundToInt

/**
 * ELM327 simulado em JVM, para testar o [com.universal.obddashboard.obd.CommandQueue] sem
 * adaptador nem carro. Responde como um ELM327 v1.5 com ATCAF1/ATH0:
 *
 *  - comandos AT de configuração (ATZ, ATE, ATL, ATS, ATH, ATSP, ATDPN, ATRV...);
 *  - modo 01 calculado a partir de [vehicle], com bitmaps 0100/0120/0140 coerentes;
 *  - modos 03/07 em CAN (byte de contagem, multi-frame ISO-TP) e K-Line (3 códigos por linha);
 *  - "SEARCHING..." / "BUS INIT: ...OK" na primeira requisição, ignição desligada;
 *  - falhas injetáveis: latência, timeouts, "?" de clones, BUFFER FULL e PIDs mudos.
 *
 * Os atrasos usam [delay], então com `runTest` o tempo é virtual: minutos de captura em milissegundos.
 */
class Elm327Simulator(var protocol: Protocol = Protocol.CAN_11BIT_500K) : ElmTransport {

    enum class Protocol(val number: Char, val isCan: Boolean) {
        ISO_9141_2('3', false),
        KWP2000_FAST('5', false),
        CAN_11BIT_500K('6', true),
        CAN_29BIT_500K('7', true),
    }

    /** Estado do veículo que alimenta as respostas do modo 01. */
    class Vehicle {
        var ignitionOn = true
        var rpm = 850.0
        var speedKmh = 0.0
        var coolantC = 90.0
        var intakeC = 30.0
        var mapKpa = 35.0
        var throttlePct = 0.0
        var engineLoadPct = 20.0
        var timingAdvanceDeg = 10.0
        var stftPct = 0.0
        var ltftPct = 0.0
        var lambdaV = 0.45
        var mafGs = 3.0
        var fuelLevelPct = 50.0
        var moduleVolts = 14.1
        /** Tensão no pino 16 medida pelo próprio adaptador (ATRV); responde mesmo com a ignição desligada. */
        var adapterVolts = 14.2
        var milOn = false
        val confirmedDtcs = mutableListOf<String>()
        val pendingDtcs = mutableListOf<String>()
    }

    val vehicle = Vehicle()

    // ---------------- Comportamento do adaptador / falhas injetáveis ----------------

    var version = "ELM327 v1.5"
    var latencyMs = 40L
    /** PIDs do modo 01 ausentes do bitmap (a ECU não os suporta). */
    val unsupportedPids = mutableSetOf<Int>()
    /** PIDs anunciados no bitmap que mesmo assim respondem NO DATA (ECU "mentirosa"). */
    val noDataPids = mutableSetOf<Int>()
    /** Clones antigos rejeitam o sufixo de contagem de respostas ("010C1") com "?". */
    var acceptsResponseCount = true
    /** Comandos que o adaptador não reconhece (responde "?"), ex.: ATAT1 em clones. */
    val rejectedCommands = mutableSetOf<String>()
    /** Nº de próximos comandos que ficam sem prompt (timeout no app). */
    var dropNext = 0
    /** Adaptador travado: nenhum comando recebe resposta. */
    var unresponsive = false
    /** Nº de próximos comandos OBD respondidos com BUFFER FULL. */
    var bufferFullNext = 0

    /** Comandos recebidos, já normalizados (maiúsculas, sem espaços). */
    val log = mutableListOf<String>()

    // ---------------- Estado interno do ELM327 ----------------

    private var echo = true
    private var spaces = true
    private var selectedProtocol = '0' // 0 = automático
    private var busActive = false

    override suspend fun sendRaw(command: String, timeoutMs: Long): String {
        val cmd = command.replace(" ", "").uppercase()
        log += cmd
        if (unresponsive || dropNext > 0) {
            if (dropNext > 0) dropNext--
            delay(timeoutMs)
            throw ElmTimeoutException(command)
        }
        delay(latencyMs)
        val lines = respond(cmd)
        return (if (echo) "$command\r" else "") + lines.joinToString("\r") + "\r\r"
    }

    private fun respond(cmd: String): List<String> {
        if (cmd in rejectedCommands) return listOf("?")
        if (cmd.startsWith("AT")) return at(cmd.substring(2))
        if (cmd.isEmpty() || !cmd.all { it in HEX }) return listOf("?")
        return obd(cmd)
    }

    private fun at(a: String): List<String> = when {
        a == "Z" || a == "WS" -> { reset(); listOf("", version) }
        a == "I" -> listOf(version)
        a == "D" -> { reset(); listOf("OK") }
        a == "E0" || a == "E1" -> { echo = a == "E1"; listOf("OK") }
        a == "S0" || a == "S1" -> { spaces = a == "S1"; listOf("OK") }
        a in setOf("L0", "L1", "H0", "AT0", "AT1", "AT2", "CAF1") -> listOf("OK")
        a.startsWith("SP") && a.length == 3 -> { selectedProtocol = a[2]; busActive = false; listOf("OK") }
        // ATSP Ah: tenta o protocolo h e cai para a busca automática (aqui tratado como automático)
        a.startsWith("SPA") && a.length == 4 -> { selectedProtocol = '0'; busActive = false; listOf("OK") }
        a == "DPN" -> listOf(
            if (selectedProtocol == '0') "A" + (if (busActive) protocol.number else '0') else selectedProtocol.toString(),
        )
        a == "RV" -> listOf(String.format(Locale.US, "%.1fV", vehicle.adapterVolts))
        else -> listOf("?")
    }

    private fun reset() {
        echo = true
        spaces = true
        selectedProtocol = '0'
        busActive = false
    }

    private fun obd(raw: String): List<String> {
        var cmd = raw
        if (cmd.length % 2 == 1) { // sufixo de contagem de respostas
            if (!acceptsResponseCount) return listOf("?")
            cmd = cmd.dropLast(1)
        }
        if (bufferFullNext > 0) {
            bufferFullNext--
            return listOf("BUFFER FULL")
        }
        val busMatches = selectedProtocol == '0' || selectedProtocol == protocol.number
        if (!vehicle.ignitionOn || !busMatches) {
            return if (busActive) listOf("NO DATA") else listOfNotNull(searching(), "UNABLE TO CONNECT")
        }

        val prefix = if (busActive) emptyList() else listOfNotNull(
            searching(),
            "BUS INIT: ...OK".takeIf { !protocol.isCan },
        )
        busActive = true

        val message: List<Int> = when (cmd.substring(0, 2)) {
            "01" -> {
                if (cmd.length != 4) return prefix + "NO DATA"
                val pid = cmd.substring(2).toInt(16)
                val data = mode01(pid) ?: return prefix + "NO DATA"
                listOf(0x41, pid) + data
            }
            "03" -> return prefix + dtcFrames(0x43, vehicle.confirmedDtcs)
            "07" -> return prefix + dtcFrames(0x47, vehicle.pendingDtcs)
            "0A" -> return prefix + dtcFrames(0x4A, emptyList())
            else -> return prefix + "NO DATA"
        }
        return prefix + hex(message)
    }

    private fun searching() = "SEARCHING...".takeIf { selectedProtocol == '0' && !busActive }

    // ---------------- Modo 01 ----------------

    private val pidTable: Map<Int, () -> List<Int>> = mapOf(
        0x01 to {
            listOf((if (vehicle.milOn) 0x80 else 0) or vehicle.confirmedDtcs.size.coerceAtMost(0x7F), 0x07, 0xE5, 0x00)
        },
        0x04 to { b1(vehicle.engineLoadPct * 255 / 100) },
        0x05 to { b1(vehicle.coolantC + 40) },
        0x06 to { b1((vehicle.stftPct + 100) * 128 / 100) },
        0x07 to { b1((vehicle.ltftPct + 100) * 128 / 100) },
        0x0B to { b1(vehicle.mapKpa) },
        0x0C to { u16(vehicle.rpm * 4) },
        0x0D to { b1(vehicle.speedKmh) },
        0x0E to { b1((vehicle.timingAdvanceDeg + 64) * 2) },
        0x0F to { b1(vehicle.intakeC + 40) },
        0x10 to { u16(vehicle.mafGs * 100) },
        0x11 to { b1(vehicle.throttlePct * 255 / 100) },
        0x14 to { b1(vehicle.lambdaV * 200) + 0x80 },
        0x15 to { b1(vehicle.lambdaV * 200) + 0xFF },
        0x2F to { b1(vehicle.fuelLevelPct * 255 / 100) },
        0x42 to { u16(vehicle.moduleVolts * 1000) },
    )

    private val supported get() = pidTable.keys - unsupportedPids

    private fun isSupported(pid: Int): Boolean =
        if (pid % 0x20 == 0) pid == 0 || supported.any { it > pid } else pid in supported

    private fun mode01(pid: Int): List<Int>? {
        if (!isSupported(pid) || pid in noDataPids) return null
        if (pid % 0x20 == 0) {
            val bitmap = IntArray(4)
            for (p in pid + 1..pid + 0x20) {
                if (isSupported(p)) bitmap[(p - pid - 1) / 8] = bitmap[(p - pid - 1) / 8] or (0x80 shr ((p - pid - 1) % 8))
            }
            return bitmap.toList()
        }
        return pidTable.getValue(pid)()
    }

    // ---------------- Modos 03/07/0A ----------------

    private fun dtcFrames(sid: Int, codes: List<String>): List<String> {
        val bytes = codes.flatMap { encodeDtc(it) }
        if (!protocol.isCan) {
            // K-Line/J1850: cada linha traz o SID e exatamente 3 códigos (preenchidos com 00 00).
            val chunks = bytes.chunked(6).ifEmpty { listOf(emptyList()) }
            return chunks.map { hex(listOf(sid) + it + List(6 - it.size) { 0 }) }
        }
        val message = listOf(sid, codes.size) + bytes
        if (message.size <= 7) return listOf(hex(message))
        // ISO-TP com ATCAF1/ATH0: linha com o tamanho (3 dígitos hex) e quadros "n: ..." (6 + 7·k bytes).
        val lines = mutableListOf("%03X".format(message.size))
        val frames = listOf(message.take(6)) + message.drop(6).chunked(7)
        frames.forEachIndexed { i, f ->
            val padded = f + List((if (i == 0) 6 else 7) - f.size) { 0 }
            lines += "%X:".format(i % 16) + (if (spaces) " " else "") + hex(padded)
        }
        return lines
    }

    private fun encodeDtc(code: String): List<Int> {
        val system = "PCBU".indexOf(code[0].uppercaseChar())
        require(system >= 0 && code.length == 5) { "DTC inválido: $code" }
        val a = (system shl 6) or (code[1].digitToInt() shl 4) or code[2].digitToInt(16)
        return listOf(a, code.substring(3).toInt(16))
    }

    // ---------------- Formatação ----------------

    private fun hex(bytes: List<Int>) = bytes.joinToString(if (spaces) " " else "") { "%02X".format(it) }

    private fun b1(v: Double) = listOf(v.roundToInt().coerceIn(0, 0xFF))

    private fun u16(v: Double): List<Int> {
        val x = v.roundToInt().coerceIn(0, 0xFFFF)
        return listOf(x shr 8, x and 0xFF)
    }

    private companion object {
        const val HEX = "0123456789ABCDEF"
    }
}

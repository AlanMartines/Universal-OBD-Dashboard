package com.universal.obddashboard.obd

enum class DtcKind(val mode: String) {
    CONFIRMED("03"),
    PENDING("07"),
    PERMANENT("0A");

    companion object {
        fun fromMode(command: String): DtcKind? = entries.firstOrNull { it.mode == command }
    }
}

enum class ElmErrorKind { UNABLE_TO_CONNECT, BUS_ERROR, BUFFER_FULL, STOPPED, UNKNOWN_COMMAND, GARBAGE }

sealed interface ElmResult {
    /** Uma mensagem por ECU (ou por mensagem ISO-TP remontada), já em bytes. */
    class Messages(val messages: List<IntArray>) : ElmResult
    data object NoData : ElmResult
    class Error(val kind: ElmErrorKind, val raw: String) : ElmResult
}

/**
 * Interpreta o texto devolvido pelo ELM327 (até o prompt '>'), com ou sem espaços (ATS0/ATS1),
 * incluindo respostas multi-frame ISO 15765-4 no formato com ATCAF1/ATH0:
 *
 * ```
 * 00E
 * 0: 43 06 01 00 02 00
 * 1: 03 00 04 00 05 00 06
 * ```
 */
object ElmResponseParser {

    private val frameRegex = Regex("^([0-9A-F]):([0-9A-F]+)$")
    private val lengthRegex = Regex("^[0-9A-F]{3}$")
    private val voltageRegex = Regex("(\\d{1,2}(?:[.,]\\d{1,2})?)\\s*V", RegexOption.IGNORE_CASE)

    fun parse(raw: String): ElmResult {
        val lines = raw.replace("\u0000", "")
            .split('\r', '\n')
            .map { it.trim() }
            .filter { it.isNotEmpty() && !it.startsWith("SEARCHING", ignoreCase = true) }
            // K-Line: "BUS INIT: ...OK" antecede a primeira resposta e não é erro.
            .filterNot { it.startsWith("BUS INIT", ignoreCase = true) && it.endsWith("OK", ignoreCase = true) }
        if (lines.isEmpty()) return ElmResult.NoData

        val joined = lines.joinToString(" ").uppercase()
        when {
            "NO DATA" in joined -> return ElmResult.NoData
            "UNABLE TO CONNECT" in joined || "BUS INIT" in joined ->
                return ElmResult.Error(ElmErrorKind.UNABLE_TO_CONNECT, raw)
            "BUFFER FULL" in joined -> return ElmResult.Error(ElmErrorKind.BUFFER_FULL, raw)
            "STOPPED" in joined -> return ElmResult.Error(ElmErrorKind.STOPPED, raw)
            listOf("CAN ERROR", "BUS ERROR", "BUS BUSY", "FB ERROR", "DATA ERROR", "LV RESET", "RX ERROR")
                .any { it in joined } || Regex("\\bERR\\d+").containsMatchIn(joined) ->
                return ElmResult.Error(ElmErrorKind.BUS_ERROR, raw)
            lines.any { it == "?" } -> return ElmResult.Error(ElmErrorKind.UNKNOWN_COMMAND, raw)
        }

        val hexLines = lines.map { it.replace(" ", "").uppercase() }
        val messages = mutableListOf<IntArray>()

        if (hexLines.any { frameRegex.matches(it) }) {
            var expectedLength = -1
            val payload = StringBuilder()
            fun flush() {
                if (payload.isNotEmpty() && payload.length % 2 == 0) {
                    var bytes = hexToBytes(payload.toString())
                    if (expectedLength in 1 until bytes.size) bytes = bytes.copyOf(expectedLength)
                    messages += bytes
                }
                payload.clear()
                expectedLength = -1
            }
            for (line in hexLines) {
                val frame = frameRegex.matchEntire(line)
                when {
                    lengthRegex.matches(line) -> { flush(); expectedLength = line.toInt(16) }
                    frame != null -> payload.append(frame.groupValues[2])
                    isHex(line) && line.length % 2 == 0 -> { flush(); messages += hexToBytes(line) }
                }
            }
            flush()
        } else {
            for (line in hexLines) {
                if (isHex(line) && line.length % 2 == 0) messages += hexToBytes(line)
            }
        }
        return if (messages.isEmpty()) ElmResult.Error(ElmErrorKind.GARBAGE, raw) else ElmResult.Messages(messages)
    }

    /** Leitura do ATRV ("12.6V") — tensão no pino 16 do conector OBD medida pelo próprio adaptador. */
    fun parseVoltage(raw: String): Double? =
        voltageRegex.find(raw)?.groupValues?.get(1)?.replace(',', '.')?.toDoubleOrNull()

    /**
     * Interpreta a resposta do ATDPN ("6", ou "A6" quando detectado automaticamente).
     * Protocolos 6–9 e A–C são CAN; 1–5 são J1850/K-Line. Retorna null se não reconhecer.
     */
    fun isCanProtocol(atdpn: String): Boolean? {
        val s = atdpn.trim().uppercase()
        val code = (if (s.length == 2 && s[0] == 'A') s[1] else s.singleOrNull()) ?: return null
        return when (code) {
            in '1'..'5' -> false
            in '6'..'9', in 'A'..'C' -> true
            else -> null
        }
    }

    /** Decodifica o bitmap de PIDs suportados (resposta de 0100, 0120, 0140...). */
    fun decodeSupportedBitmap(base: Int, data: IntArray): Set<Int> {
        val out = mutableSetOf<Int>()
        for (i in 0 until 32) {
            val byte = data.getOrNull(i / 8) ?: break
            if (byte and (0x80 shr (i % 8)) != 0) out += base + i + 1
        }
        return out
    }

    fun hexToBytes(hex: String): IntArray = IntArray(hex.length / 2) { i ->
        hex.substring(i * 2, i * 2 + 2).toInt(16)
    }

    private fun isHex(s: String) = s.isNotEmpty() && s.all { it in '0'..'9' || it in 'A'..'F' }
}

object DtcDecoder {

    /**
     * Extrai os DTCs das respostas do modo 03/07/0A. Em CAN o byte após o SID é a contagem
     * de códigos; nos protocolos antigos (K-Line/J1850) cada linha traz 3 pares fixos.
     */
    fun decode(messages: List<IntArray>, kind: DtcKind, isCan: Boolean): List<String> {
        val sid = kind.mode.toInt(16) + 0x40
        val codes = LinkedHashSet<String>()
        for (m in messages) {
            if (m.isEmpty() || m[0] != sid) continue
            var end = m.size
            var i = 1
            if (isCan && m.size >= 2) {
                end = minOf(m.size, 2 + m[1] * 2)
                i = 2
            }
            while (i + 1 < end) {
                val a = m[i]
                val b = m[i + 1]
                if (a != 0 || b != 0) codes += format(a, b)
                i += 2
            }
        }
        return codes.toList()
    }

    /** Ex.: 0x01,0x33 → "P0133"; 0xC1,0x00 → "U0100". */
    fun format(a: Int, b: Int): String {
        val system = "PCBU"[(a shr 6) and 0x03]
        val first = (a shr 4) and 0x03
        return "%c%d%X%02X".format(system, first, a and 0x0F, b)
    }
}

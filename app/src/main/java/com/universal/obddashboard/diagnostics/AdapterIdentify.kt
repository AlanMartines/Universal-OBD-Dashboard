package com.universal.obddashboard.diagnostics

import com.universal.obddashboard.obd.ElmTimeoutException
import com.universal.obddashboard.obd.ElmTransport
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.put
import kotlinx.serialization.json.putJsonArray

/**
 * "Identificar adaptador" (console): só comandos internos do adaptador, nenhum pedido ao carro.
 * Compara o que ele diz ser com o que ele sabe fazer, para apontar clones de ELM327.
 */
class AdapterIdentify(
    private val link: ElmTransport,
    private val recorder: DiagnosticRecorder?,
    private val out: (String) -> Unit,
    private val elapsedMs: () -> Long = { System.nanoTime() / 1_000_000 },
) {

    enum class Verdict(val label: String) {
        CLONE("Clone de ELM327"),
        STN("Chip STN (OBDLink ou compatível), não é ELM327"),
        PROBABLY_GENUINE("Nenhum sinal de clone (não dá para provar que é legítimo)"),
        UNKNOWN("Não foi possível identificar"),
    }

    data class Result(val version: String?, val verdict: Verdict, val reasons: List<String>)

    /** Respostas brutas (sem eco, sem linhas vazias) por comando; null = sem resposta. */
    suspend fun run(): Result {
        val answers = LinkedHashMap<String, String?>()
        for ((cmd, timeout) in COMMANDS) answers[cmd] = command(cmd, timeout)
        command("ATZ", RESET_TIMEOUT_MS) // devolve o adaptador ao padrão
        val r = judge(answers)
        out("# Resultado: ${r.verdict.label}${r.version?.let { " — diz ser $it" } ?: ""}")
        r.reasons.forEach { out("  • $it") }
        recorder?.event("adapter_id") {
            put("version", r.version)
            put("verdict", r.verdict.name)
            putJsonArray("reasons") { r.reasons.forEach { add(JsonPrimitive(it)) } }
        }
        return r
    }

    private suspend fun command(cmd: String, timeoutMs: Long): String? {
        out("> $cmd")
        val start = elapsedMs()
        return try {
            val rx = link.sendRaw(cmd, timeoutMs)
            recorder?.event("elm") { put("cmd", cmd); put("rx", rx); put("ms", elapsedMs() - start) }
            clean(cmd, rx).also { lines -> lines.lines().forEach { out("  $it") } }
        } catch (e: ElmTimeoutException) {
            recorder?.event("elm") { put("cmd", cmd); put("err", "timeout"); put("ms", elapsedMs() - start) }
            out("  (sem resposta)")
            null
        }
    }

    companion object {
        private const val AT_TIMEOUT_MS = 1500L
        private const val RESET_TIMEOUT_MS = 4000L

        /** Todos ficam no adaptador: identificação, parâmetros, tensão. ATCSM1 só liga o modo mais seguro. */
        val COMMANDS = listOf(
            "ATZ" to RESET_TIMEOUT_MS, "ATE0" to AT_TIMEOUT_MS, "ATI" to AT_TIMEOUT_MS, "AT@1" to AT_TIMEOUT_MS,
            "AT@2" to AT_TIMEOUT_MS, "ATPPS" to 3000L, "ATCSM1" to AT_TIMEOUT_MS, "STI" to AT_TIMEOUT_MS,
            "ATRV" to AT_TIMEOUT_MS,
        )

        /** Versões publicadas pela Elm Electronics (não existe v1.5). */
        val GENUINE_VERSIONS = setOf("1.0", "1.0a", "1.1", "1.2", "1.2a", "1.3", "1.3a", "1.4", "1.4a", "1.4b", "2.0", "2.1", "2.2", "2.3")

        private val VERSION = Regex("ELM327\\s+v(\\d+\\.\\d+[a-z]?)", RegexOption.IGNORE_CASE)

        /** Tira o eco do comando, o lixo de reset (ex.: "ü") e linhas vazias. */
        fun clean(cmd: String, rx: String): String = rx.split('\r', '\n')
            .map { it.trim() }
            .filter { it.isNotEmpty() && !it.equals(cmd, ignoreCase = true) && (it == "?" || it.any { c -> c.isLetterOrDigit() && c.code < 128 }) }
            .joinToString("\n")

        private fun unsupported(s: String?) = s == null || s.isBlank() || s.trim() == "?"

        private fun atLeast(v: String, major: Int, minor: Int): Boolean {
            val (a, b) = v.trimEnd { it.isLetter() }.split('.').map { it.toInt() }
            return a > major || (a == major && b >= minor)
        }

        fun judge(answers: Map<String, String?>): Result {
            val sti = answers["STI"]
            if (!unsupported(sti) && sti!!.contains("STN", ignoreCase = true)) {
                return Result(sti.lines().first(), Verdict.STN, listOf("Responde a STI com \"${sti.lines().first()}\""))
            }
            val id = listOfNotNull(answers["ATI"], answers["ATZ"]).firstNotNullOfOrNull { VERSION.find(it) }
            val version = id?.groupValues?.get(1)?.lowercase()
            if (version == null) return Result(null, Verdict.UNKNOWN, listOf("Não respondeu com \"ELM327 vX.Y\" a ATI/ATZ"))
            val reasons = mutableListOf<String>()
            if (version !in GENUINE_VERSIONS) reasons += "A versão v$version nunca foi lançada pela Elm Electronics"
            if (atLeast(version, 1, 4)) {
                if (unsupported(answers["ATCSM1"])) reasons += "Diz ser v$version mas não conhece ATCSM (modo silencioso), presente desde a v1.4"
                if (unsupported(answers["ATPPS"])) reasons += "Diz ser v$version mas não lista os parâmetros programáveis (ATPPS)"
            }
            val at1 = answers["AT@1"]
            if (!unsupported(at1) && !at1!!.contains("OBDII to RS232 Interpreter", ignoreCase = true)) {
                reasons += "Descrição AT@1 diferente da original: \"${at1.lines().first()}\""
            }
            return Result("v$version", if (reasons.isEmpty()) Verdict.PROBABLY_GENUINE else Verdict.CLONE, reasons)
        }
    }
}

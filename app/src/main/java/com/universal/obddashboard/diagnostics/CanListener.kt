package com.universal.obddashboard.diagnostics

import com.universal.obddashboard.obd.ElmMonitorTransport
import com.universal.obddashboard.obd.ElmTimeoutException
import kotlinx.serialization.json.put
import kotlinx.serialization.json.putJsonArray
import kotlinx.serialization.json.putJsonObject
import kotlinx.serialization.json.JsonPrimitive

/**
 * Escuta passiva da rede CAN nos pinos 6/14 (console de diagnóstico): o ELM327 só ouve, em modo
 * silencioso (ATCSM1, sem confirmar quadros), e nada é transmitido para o carro.
 *
 * Cada linha recebida vai para o console ([out]) e para o arquivo ([recorder]). No fim, um resumo
 * por ID mostra quantos quadros chegaram e quais bytes mudaram, para comparar duas gravações
 * (antes e depois de abastecer) e achar onde está o nível de combustível.
 */
class CanListener(
    private val link: ElmMonitorTransport,
    private val recorder: DiagnosticRecorder?,
    private val out: (String) -> Unit,
    private val elapsedMs: () -> Long = { System.nanoTime() / 1_000_000 },
) {

    /** ATPB yy: divisor de 500 kbps. */
    enum class Baud(val label: String, val divisor: Int) {
        K500("500 kbps", 1), K250("250 kbps", 2), K125("125 kbps", 4), K100("100 kbps", 5),
        K83("83,3 kbps", 6), K50("50 kbps", 10), K33("33,3 kbps", 15);

        /** Transmite ID de 11 bits (não usado), DLC variável, recebe 11 e 29 bits, sem formatação ISO-TP. */
        val command get() = "ATPBE0%02X".format(divisor)
    }

    data class Frame(val id: String, val data: List<Int>)

    /** Estatística de um ID: quadros, conteúdos distintos e quais posições de byte variaram. */
    class IdStats(val id: String) {
        var count = 0
        var first: List<Int> = emptyList()
        var last: List<Int> = emptyList()
        val distinct = HashSet<List<Int>>()
        val changedBytes = sortedSetOf<Int>()

        fun add(data: List<Int>) {
            if (count == 0) first = data
            data.forEachIndexed { i, b -> if (i >= first.size || first[i] != b) changedBytes += i }
            if (distinct.size < MAX_DISTINCT) distinct += data
            last = data
            count++
        }
    }

    class Result(val baud: Baud?, val frames: Int, val stats: Map<String, IdStats>, val notes: List<String>)

    class NotSilentException : Exception("O adaptador não aceitou o modo silencioso (ATCSM1); escuta cancelada para não interferir na rede")

    private val stats = sortedMapOf<String, IdStats>()
    private val notes = mutableListOf<String>()
    private var frames = 0

    /**
     * [baud] null: experimenta cada velocidade por [probeMs] e escuta na que trouxe mais quadros.
     * @throws NotSilentException se o adaptador não confirmar o modo silencioso
     * @throws java.io.IOException se o link cair
     */
    suspend fun run(baud: Baud?, durationMs: Long = DEFAULT_DURATION_MS, probeMs: Long = DEFAULT_PROBE_MS): Result {
        setup()
        val chosen = baud ?: probe(probeMs)
        if (chosen == null) {
            out("Nenhum quadro CAN recebido em nenhuma velocidade.")
            notes += "sem_trafego"
            recorder?.event("can_listen") { put("phase", "no_traffic") }
            return Result(null, 0, stats, notes)
        }
        stats.clear()
        frames = 0
        out("# Escutando a ${chosen.label} por ${durationMs / 1000} s…")
        recorder?.event("can_listen") {
            put("phase", "start")
            put("baud", chosen.name)
            put("duration_ms", durationMs)
        }
        if (!selectBaud(chosen)) return Result(chosen, 0, stats, notes)
        listen(durationMs, record = true)
        summarize(chosen)
        return Result(chosen, frames, stats, notes)
    }

    private suspend fun setup() {
        command("ATZ", RESET_TIMEOUT_MS)
        for (c in listOf("ATE0", "ATL0", "ATS1", "ATH1", "ATAL", "ATCAF0")) command(c)
        val silent = command("ATCSM1")
        if (silent == null || !silent.contains("OK")) {
            recorder?.event("can_listen") { put("phase", "abort"); put("reason", "csm_unsupported") }
            throw NotSilentException()
        }
    }

    private suspend fun selectBaud(b: Baud): Boolean {
        val pb = command(b.command)
        val sp = command("ATSPB")
        if (pb?.contains("OK") != true || sp?.contains("OK") != true) {
            out("Velocidade ${b.label} não aceita pelo adaptador.")
            notes += "baud_rejeitado:${b.name}"
            return false
        }
        return true
    }

    private suspend fun probe(probeMs: Long): Baud? {
        out("# Procurando a velocidade da rede (${probeMs / 1000} s em cada)…")
        var best: Baud? = null
        var bestFrames = 0
        for (b in Baud.entries) {
            if (!selectBaud(b)) continue
            frames = 0
            listen(probeMs, record = false)
            out("  ${b.label}: $frames quadros")
            recorder?.event("can_probe") { put("baud", b.name); put("frames", frames) }
            if (frames > bestFrames) {
                best = b
                bestFrames = frames
            }
        }
        return best
    }

    /** Repete o ATMA até completar [durationMs]: o ELM327 para sozinho com BUFFER FULL. */
    private suspend fun listen(durationMs: Long, record: Boolean) {
        val start = elapsedMs()
        while (true) {
            val left = durationMs - (elapsedMs() - start)
            if (left <= 0) break
            try {
                link.monitor("ATMA", left) { line -> onLine(line, start, record) }
            } catch (e: ElmTimeoutException) {
                out("! O adaptador não parou a escuta no prazo")
                notes += "stop_timeout"
                break
            }
        }
    }

    private fun onLine(line: String, start: Long, record: Boolean) {
        val f = parseFrame(line)
        if (f != null) {
            frames++
            if (record) stats.getOrPut(f.id) { IdStats(f.id) }.add(f.data)
        } else if (record && line != "STOPPED") {
            val note = if (line.contains("BUFFER FULL")) "buffer_full" else line
            if (note !in notes && notes.size < MAX_NOTES) notes += note
        }
        if (record) {
            out(line)
            recorder?.event("can") {
                put("ms", elapsedMs() - start)
                put("l", line)
            }
        }
    }

    private fun summarize(b: Baud) {
        out("# Resumo: $frames quadros, ${stats.size} IDs a ${b.label}")
        for (s in stats.values) {
            val varying = if (s.changedBytes.isEmpty()) "fixo" else "variam " + s.changedBytes.joinToString(",") { "b$it" }
            out("  ${s.id.padEnd(11)} ×${s.count}  ${hex(s.last)}  ($varying)")
        }
        recorder?.event("can_summary") {
            put("baud", b.name)
            put("frames", frames)
            putJsonArray("notes") { notes.distinct().forEach { add(JsonPrimitive(it)) } }
            putJsonObject("ids") {
                for (s in stats.values) {
                    putJsonObject(s.id) {
                        put("count", s.count)
                        put("distinct", s.distinct.size)
                        put("first", hex(s.first))
                        put("last", hex(s.last))
                        putJsonArray("changed_bytes") { s.changedBytes.forEach { add(JsonPrimitive(it)) } }
                    }
                }
            }
        }
    }

    /** Envia um comando AT, ecoa no console e devolve a resposta; null em timeout. */
    private suspend fun command(cmd: String, timeoutMs: Long = AT_TIMEOUT_MS): String? {
        out("> $cmd")
        val start = elapsedMs()
        return try {
            link.sendRaw(cmd, timeoutMs).also { rx ->
                rx.split('\r', '\n').map { it.trim() }.filter { it.isNotEmpty() }.forEach { out("  $it") }
                recorder?.event("elm") { put("cmd", cmd); put("rx", rx); put("ms", elapsedMs() - start) }
            }
        } catch (e: ElmTimeoutException) {
            out("  (sem resposta)")
            recorder?.event("elm") { put("cmd", cmd); put("err", "timeout"); put("ms", elapsedMs() - start) }
            null
        }
    }

    companion object {
        const val DEFAULT_DURATION_MS = 60_000L
        const val DEFAULT_PROBE_MS = 4_000L
        private const val AT_TIMEOUT_MS = 1500L
        private const val RESET_TIMEOUT_MS = 4000L
        private const val MAX_DISTINCT = 256
        private const val MAX_NOTES = 20
        private val HEX2 = Regex("^[0-9A-Fa-f]{2}$")
        private val HEX3 = Regex("^[0-9A-Fa-f]{3}$")

        /**
         * Linha do ATMA com ATH1/ATS1: "3A5 01 02 03" (11 bits) ou "18 DA F1 10 02 7E 00" (29 bits).
         * Mensagens do adaptador (BUFFER FULL, CAN ERROR, <RX ERROR...) devolvem null.
         */
        fun parseFrame(line: String): Frame? {
            val t = line.trim().split(Regex("\\s+"))
            if (t.isEmpty()) return null
            return when {
                HEX3.matches(t[0]) && t.drop(1).all { HEX2.matches(it) } ->
                    Frame(t[0].uppercase(), t.drop(1).map { it.toInt(16) })
                t.size >= 4 && t.all { HEX2.matches(it) } ->
                    Frame(t.take(4).joinToString("").uppercase(), t.drop(4).map { it.toInt(16) })
                else -> null
            }
        }

        fun hex(data: List<Int>) = data.joinToString(" ") { "%02X".format(it) }
    }
}

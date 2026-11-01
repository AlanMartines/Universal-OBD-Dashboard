package com.universal.obddashboard.remote

import com.universal.obddashboard.db.TelemetryLogEntity
import java.io.IOException

/**
 * Envia a caixa preta em pacotes. A própria tabela de telemetria é a fila: sem sinal, nada se perde,
 * e um cursor guarda o último número enviado. O servidor ignora repetições, então reenviar é seguro.
 */
class RemoteUploader(private val source: Source, private val send: (String) -> Int) {

    interface Source {
        suspend fun samplesAfter(id: Long, limit: Int): List<TelemetryLogEntity>
        suspend fun maxId(): Long
        var cursor: Long
        val sendGps: Boolean
        fun currentDtcs(): List<String>
    }

    enum class Outcome { IDLE, SENT, RETRY, REVOKED }

    data class Result(val outcome: Outcome, val sent: Int = 0, val dropped: Int = 0)

    suspend fun drain(): Result {
        // Depois de restaurar um backup, os números recomeçam: o cursor não pode ficar à frente.
        val max = source.maxId()
        if (source.cursor > max) source.cursor = max
        var sent = 0
        var dropped = 0
        while (true) {
            val samples = source.samplesAfter(source.cursor, BATCH)
            if (samples.isEmpty()) return Result(if (sent + dropped > 0) Outcome.SENT else Outcome.IDLE, sent, dropped)
            val newest = samples.last().id
            val body = RemotePayload.batch(
                samples.map {
                    RemotePayload.sample(it, source.sendGps, if (it.id == newest) source.currentDtcs() else emptyList())
                },
            )
            val code = try {
                send(body)
            } catch (_: IOException) {
                return Result(Outcome.RETRY, sent, dropped)
            }
            when {
                code in 200..299 -> {
                    source.cursor = newest
                    sent += samples.size
                }
                // Pacote recusado não muda ao repetir: pular evita travar a fila para sempre.
                code == 400 || code == 413 -> {
                    source.cursor = newest
                    dropped += samples.size
                }
                code == 401 || code == 403 -> return Result(Outcome.REVOKED, sent, dropped)
                else -> return Result(Outcome.RETRY, sent, dropped)
            }
        }
    }

    companion object {
        const val BATCH = 200
        const val INTERVAL_MS = 5_000L
        private const val MAX_BACKOFF_MS = 5 * 60_000L

        const val LIVE_WATCHED_MS = 1_000L
        const val LIVE_IDLE_MS = 10_000L
        const val LIVE_ERROR_MS = 30_000L

        /** Com alguém olhando, uma leitura por segundo; sem ninguém, economiza dados móveis. */
        fun liveDelayMs(viewers: Int?): Long = when {
            viewers == null -> LIVE_ERROR_MS
            viewers > 0 -> LIVE_WATCHED_MS
            else -> LIVE_IDLE_MS
        }

        /** Espera entre tentativas: dobra a cada falha seguida, até 5 minutos. */
        fun backoffMs(failures: Int): Long {
            if (failures <= 0) return INTERVAL_MS
            return minOf(INTERVAL_MS shl minOf(failures, 10), MAX_BACKOFF_MS)
        }
    }
}

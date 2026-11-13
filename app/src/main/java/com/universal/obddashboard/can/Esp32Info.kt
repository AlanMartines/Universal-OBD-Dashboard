package com.universal.obddashboard.can

/**
 * Estado do adaptador de escuta (firmware esp32-can-listen), montado das linhas "# ..." que ele manda:
 * versão, velocidade da rede, sensores, contadores (a cada 10 s, acumulados desde que ligou), descanso e erro.
 * Só lê o que chega; nada é enviado ao ESP32.
 */
data class Esp32Info(
    val firmware: String? = null,
    val bitrateKbps: Int? = null,
    /** "ok", "ausente" ou "sem resposta"; null = ainda não informado. */
    val bmp: String? = null,
    val lsm: String? = null,
    /** Magnetômetro (bússola): "ok", "ausente" ou "sem resposta", e o modelo encontrado (qmc5883l, qmc5883p, hmc5883l). */
    val mag: String? = null,
    val magChip: String? = null,
    val frames: Long? = null,
    val lost: Long? = null,
    val busErrors: Long? = null,
    /** Quadros por segundo entre as duas últimas linhas de contadores. */
    val framesPerSec: Double? = null,
    val statsAt: Long? = null,
    /** Quadros que chegaram ao app nesta conexão (o que o Bluetooth entregou). */
    val appFrames: Long = 0,
    val resting: Boolean = false,
    val error: String? = null,
    /** Quantas vezes o ESP32 reiniciou nesta captura (contador voltou para trás ou nova linha de versão). */
    val restarts: Int = 0,
) {
    companion object {
        private val VERSION = Regex("^# esp32-can-listen (\\S+)$")
        private val BITRATE = Regex("^# listen-only (\\d+) kbps$")
        private val STATS = Regex("^# stats quadros=(\\d+) perdidos=(\\d+) erros=(\\d+)$")
        private val SENSOR = Regex("^# (bmp180|lsm6ds3) (ok|ausente|sem resposta)\\b.*$")
        private val MAG = Regex("^# mag (ok|ausente|sem resposta)(?: (qmc5883l|qmc5883p|hmc5883l)\\b)?.*$")
        private val ERROR = Regex("^# ERRO (.+)$")

        /** Novo estado se a linha diz algo do adaptador; null se não é linha de estado. */
        fun apply(cur: Esp32Info, line: String, now: Long, appFrames: Long): Esp32Info? {
            val l = line.trim()
            if (!l.startsWith("#")) return null
            VERSION.matchEntire(l)?.let { m ->
                // Linha de versão sai a cada vez que o ESP32 liga: depois da primeira, é um reinício
                val again = cur.firmware != null
                return cur.copy(
                    firmware = m.groupValues[1], resting = false, error = null,
                    restarts = cur.restarts + if (again) 1 else 0,
                    framesPerSec = null, statsAt = null, frames = null,
                )
            }
            BITRATE.matchEntire(l)?.let { return cur.copy(bitrateKbps = it.groupValues[1].toInt()) }
            SENSOR.matchEntire(l)?.let { m ->
                return if (m.groupValues[1] == "bmp180") cur.copy(bmp = m.groupValues[2]) else cur.copy(lsm = m.groupValues[2])
            }
            MAG.matchEntire(l)?.let { m ->
                val chip = m.groupValues[2].ifEmpty { null }
                return cur.copy(mag = m.groupValues[1], magChip = chip ?: cur.magChip.takeIf { m.groupValues[1] != "ausente" })
            }
            STATS.matchEntire(l)?.let { m ->
                val frames = m.groupValues[1].toLong()
                val prev = cur.frames
                val prevAt = cur.statsAt
                val reset = prev != null && frames < prev
                val fps = if (prev != null && prevAt != null && !reset && now > prevAt) (frames - prev) * 1000.0 / (now - prevAt) else null
                return cur.copy(
                    frames = frames, lost = m.groupValues[2].toLong(), busErrors = m.groupValues[3].toLong(),
                    framesPerSec = fps, statsAt = now, appFrames = appFrames, resting = false,
                    restarts = cur.restarts + if (reset && cur.firmware == null) 1 else 0,
                )
            }
            if (l.startsWith("# descanso")) return cur.copy(resting = true, framesPerSec = null)
            if (l.startsWith("# acordou")) return cur.copy(resting = false)
            ERROR.matchEntire(l)?.let { return cur.copy(error = it.groupValues[1]) }
            return null
        }
    }
}

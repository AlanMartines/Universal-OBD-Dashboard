package com.universal.obddashboard.telemetry

import java.util.Locale

/**
 * Ajuste fino à mão dos sensores do ESP32 (Ajustes → Calibração dos sensores), em graus, somado por cima do que o app
 * aprende sozinho. Cada módulo e cada montagem têm suas diferenças: aqui se corrige sem mexer no código e sem
 * estragar a calibração automática. Zero em tudo é o mesmo que não ter ajuste.
 */
data class SensorTrims(val pitchDeg: Double = 0.0, val rollDeg: Double = 0.0, val headingDeg: Double = 0.0) {

    fun encode(): String = listOf(pitchDeg, rollDeg, headingDeg).joinToString(";") { "%.2f".format(Locale.ROOT, it) }

    /** Mensagem de erro para mostrar, ou null se estiver tudo dentro dos limites. */
    fun problem(): String? = when {
        listOf(pitchDeg, rollDeg, headingDeg).any { !it.isFinite() } -> "Informe números válidos."
        abs(pitchDeg) > MAX_TILT_DEG || abs(rollDeg) > MAX_TILT_DEG -> "Inclinação: no máximo ${MAX_TILT_DEG.toInt()}° para cada lado."
        abs(headingDeg) > MAX_HEADING_DEG -> "Rumo: no máximo ${MAX_HEADING_DEG.toInt()}° para cada lado."
        else -> null
    }

    companion object {
        const val MAX_TILT_DEG = 15.0
        const val MAX_HEADING_DEG = 45.0

        private fun abs(x: Double) = kotlin.math.abs(x)

        fun decode(text: String?): SensorTrims = runCatching {
            val p = text!!.split(";").map { it.toDouble() }
            SensorTrims(p[0], p[1], p[2]).takeIf { it.problem() == null }
        }.getOrNull() ?: SensorTrims()
    }
}

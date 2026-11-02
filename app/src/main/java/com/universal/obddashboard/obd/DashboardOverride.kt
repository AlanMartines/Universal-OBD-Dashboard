package com.universal.obddashboard.obd

import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json

/** Escalas dos mostradores escolhidas em Ajustes, guardadas por perfil. Só mudam o que é exibido. */
@Serializable
data class DashboardOverride(
    val rpmMax: Double,
    val rpmRedline: Double,
    val speedMax: Double,
    val speedCorrectionPct: Double,
) {
    /** Motivo para recusar os valores, ou null se estão válidos. */
    fun problem(): String? = when {
        listOf(rpmMax, rpmRedline, speedMax, speedCorrectionPct).any { !it.isFinite() } -> "Preencha todos os campos."
        rpmMax !in RPM_MAX_RANGE -> "RPM máximo fora da faixa (1.000 a 20.000)."
        rpmRedline < RPM_REDLINE_MIN || rpmRedline > rpmMax -> "A faixa vermelha precisa ficar entre 500 RPM e o RPM máximo."
        speedMax !in SPEED_MAX_RANGE -> "Velocidade máxima fora da faixa (40 a 300 km/h)."
        speedCorrectionPct !in CORRECTION_RANGE -> "Correção da velocidade fora da faixa (-10% a +15%)."
        else -> null
    }

    fun applyTo(base: DashboardSettings) = base.copy(
        rpmMax = rpmMax,
        rpmRedline = rpmRedline,
        speedMax = speedMax,
        speedCorrectionPct = speedCorrectionPct,
    )

    fun encode(): String = Json.encodeToString(serializer(), this)

    companion object {
        private val RPM_MAX_RANGE = 1000.0..20000.0
        private const val RPM_REDLINE_MIN = 500.0
        private val SPEED_MAX_RANGE = 40.0..300.0
        private val CORRECTION_RANGE = -10.0..15.0

        /** Valor salvo ilegível ou inválido volta ao que o perfil define. */
        fun decode(text: String?): DashboardOverride? = text
            ?.let { runCatching { Json.decodeFromString(serializer(), it) }.getOrNull() }
            ?.takeIf { it.problem() == null }
    }
}

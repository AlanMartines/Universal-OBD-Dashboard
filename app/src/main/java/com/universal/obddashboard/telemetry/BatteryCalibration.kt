package com.universal.obddashboard.telemetry

import com.universal.obddashboard.can.Slcan
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json

/**
 * Calibração da tensão da bateria lida pelo ESP32 (divisor no D34), feita no app em vez de gravar firmware:
 * a pessoa mede a bateria com o multímetro e o app guarda o fator multímetro ÷ leitura do ESP32. Vale para as
 * quatro leituras de bateria do ESP32 (agora, mínima, em repouso e a menor da partida), por veículo.
 */
@Serializable
data class BatteryCalibration(val factor: Double, val multimeterV: Double, val espV: Double, val at: Long) {

    /** Aplica o fator às leituras de bateria do ESP32; o resto passa igual. */
    fun apply(values: Map<String, Double>): Map<String, Double> =
        if (values.keys.none { it in KEYS }) values else values.mapValues { (k, v) -> if (k in KEYS) v * factor else v }

    fun encode(): String = JSON.encodeToString(serializer(), this)

    companion object {
        /** Fora disso o problema é de fiação ou de terra, não de calibração. */
        const val MIN_FACTOR = 0.8
        const val MAX_FACTOR = 1.5
        val KEYS = setOf(Slcan.ESP_BATT_V, Slcan.ESP_BATT_MIN, Slcan.ESP_BATT_REST, Slcan.ESP_BATT_LOWEST)
        private val JSON = Json { ignoreUnknownKeys = true }

        /** Por que não dá para calibrar com esses valores; null quando dá. */
        fun problem(multimeterV: Double, espV: Double): String? = when {
            !multimeterV.isFinite() || multimeterV !in 8.0..16.0 ->
                "Digite a tensão do multímetro entre 8 e 16 V (a bateria fica perto de 12,6 V desligada e de 14 V com o motor ligado)."
            !espV.isFinite() || espV !in 3.0..20.0 -> "O ESP32 não mandou uma leitura válida da bateria agora."
            multimeterV / espV !in MIN_FACTOR..MAX_FACTOR ->
                "A diferença é grande demais para calibrar (fator ${"%.2f".format(multimeterV / espV)}). Confira a fiação do divisor, o fusível e o terra da placa."
            else -> null
        }

        /** Calibração a partir da leitura crua do ESP32 (sem fator) e do multímetro; null se [problem] recusar. */
        fun of(multimeterV: Double, rawEspV: Double, at: Long): BatteryCalibration? =
            if (problem(multimeterV, rawEspV) != null) null
            else BatteryCalibration(Math.round(multimeterV / rawEspV * 1000) / 1000.0, multimeterV, rawEspV, at)

        fun decode(json: String?): BatteryCalibration? =
            json?.let { runCatching { JSON.decodeFromString(serializer(), it) }.getOrNull() }
                ?.takeIf { it.factor.isFinite() && it.factor in MIN_FACTOR..MAX_FACTOR }
    }
}

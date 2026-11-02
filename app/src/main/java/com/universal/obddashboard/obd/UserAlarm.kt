package com.universal.obddashboard.obd

import kotlinx.serialization.Serializable
import kotlinx.serialization.builtins.ListSerializer
import kotlinx.serialization.json.Json
import java.math.BigDecimal

/** Alarme criado em Ajustes: um sinal do perfil acima ou abaixo de um limite. */
@Serializable
data class UserAlarm(
    val id: String,
    val output: String,
    val above: Boolean,
    val value: Double,
    val critical: Boolean = false,
) {
    fun toRule(meta: OutputMeta) = AlertRule(
        id = "user_$id",
        level = if (critical) "critical" else "warning",
        condition = "$output ${if (above) ">" else "<"} ${BigDecimal.valueOf(value).toPlainString()}",
        message = "${meta.name}: {$output} ${meta.unit}".trim(),
        sustainMs = SUSTAIN_MS,
    )

    companion object {
        const val MAX_ALARMS = 10
        private const val SUSTAIN_MS = 3000L
        private val LIST = ListSerializer(serializer())

        fun encode(list: List<UserAlarm>): String = Json.encodeToString(LIST, list)

        fun decode(text: String?): List<UserAlarm> =
            text?.let { runCatching { Json.decodeFromString(LIST, it) }.getOrNull() }.orEmpty()
    }
}

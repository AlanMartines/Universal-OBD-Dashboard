package com.universal.obddashboard.remote

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.put

/**
 * Escolha dos mostradores feita no app (tema, dia/noite e cor da Cápsula). Vai com a leitura ao vivo para
 * o painel web seguir a mesma tela. Lista fechada: valor fora dela é descartado.
 */
data class DashPrefs(val look: String, val mode: String, val tint: String) {

    fun toJson(): JsonObject = buildJsonObject {
        put("look", look)
        put("mode", mode)
        put("tint", tint)
    }

    fun encode(): String = toJson().toString()

    companion object {
        val LOOKS = setOf("minimal", "capsule", "hud", "sport", "classic", "horizon")
        val MODES = setOf("auto", "day", "night")
        val TINTS = setOf("green", "red")

        /** JSON vindo da tela ({ look, mode, tint }). Sem tema válido, null; o resto cai no padrão. */
        fun parse(json: String?): DashPrefs? {
            if (json.isNullOrBlank() || json.length > 256) return null
            val o = runCatching { Json.parseToJsonElement(json).jsonObject }.getOrNull() ?: return null
            fun text(key: String) = runCatching { o[key]?.jsonPrimitive?.contentOrNull }.getOrNull()
            val look = text("look")?.takeIf { it in LOOKS } ?: return null
            return DashPrefs(
                look = look,
                mode = text("mode")?.takeIf { it in MODES } ?: "auto",
                tint = text("tint")?.takeIf { it in TINTS } ?: "green",
            )
        }
    }
}

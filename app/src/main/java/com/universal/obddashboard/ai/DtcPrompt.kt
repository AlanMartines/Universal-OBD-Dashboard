package com.universal.obddashboard.ai

import com.universal.obddashboard.obd.VehicleProfile
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.doubleOrNull
import kotlinx.serialization.json.jsonPrimitive
import java.util.Locale
import kotlin.math.abs

/**
 * Pedido "Explicar com IA" de um código de falha. Só sai do celular o que está em [Request] e no
 * perfil (veículo, motor, ECU): nunca GPS, VIN ou horário. Campos extras recebidos da tela são
 * ignorados de propósito ([Request.fromJson] lê uma lista fechada).
 */
object DtcPrompt {

    private val CODE = Regex("^[PCBU][0-9A-F]{4}$")
    private val OUTPUT_ID = Regex("^[a-z][a-z0-9_]{0,40}$")
    private const val MAX_FRAME_VALUES = 20
    private val HIDDEN_FROM_PROMPT = setOf("readiness_b", "readiness_c", "readiness_d")

    /** Congelamento de quadro opcional: as leituras gravadas quando a falha apareceu. */
    data class Request(
        val code: String,
        val pending: Boolean,
        val rpm: Double? = null,
        val speedKmh: Double? = null,
        val engineLoadPct: Double? = null,
        val coolantC: Double? = null,
        /** Congelamento de quadro gravado pela ECU (modo 02): saída do perfil → valor. */
        val ecuFrame: Map<String, Double> = emptyMap(),
    ) {
        companion object {
            /** @throws IllegalArgumentException com código fora do formato P/C/B/U + 4 dígitos */
            fun fromJson(o: JsonObject): Request {
                fun num(k: String) = o[k]?.jsonPrimitive?.doubleOrNull?.takeIf { it.isFinite() }
                val code = o["code"]?.jsonPrimitive?.contentOrNull?.trim()?.uppercase(Locale.ROOT).orEmpty()
                require(CODE.matches(code)) { "Código de falha inválido: $code" }
                val kind = o["kind"]?.jsonPrimitive?.contentOrNull.orEmpty()
                val frame = (o["ecuFrame"] as? JsonObject).orEmpty().entries
                    .filter { OUTPUT_ID.matches(it.key) }
                    .mapNotNull { (k, v) -> (v as? JsonPrimitive)?.doubleOrNull?.takeIf { it.isFinite() }?.let { k to it } }
                    .take(MAX_FRAME_VALUES).toMap()
                return Request(code, kind.equals("pending", true), num("rpm"), num("speedKmh"), num("engineLoadPct"), num("coolantC"), frame)
            }
        }
    }

    const val SYSTEM = "Você é um mecânico automotivo experiente que explica falhas de forma clara para o dono do carro, " +
        "em português do Brasil. Responda em no máximo 250 palavras, em texto simples (sem tabelas), com estas partes: " +
        "1) O que o código significa; 2) Causas mais prováveis neste motor, da mais comum para a menos comum; " +
        "3) Gravidade: se dá para seguir viagem ou se é melhor parar; 4) O que verificar primeiro. " +
        "Se não tiver certeza sobre algo específico deste modelo, diga isso. " +
        "Termine lembrando que o diagnóstico deve ser confirmado por um mecânico."

    fun userText(r: Request, profile: VehicleProfile): String = buildString {
        appendLine("Veículo: ${profile.vehicleName}${profile.modelYear?.let { " ($it)" } ?: ""}")
        if (profile.engine.isNotBlank()) appendLine("Motor: ${profile.engine}")
        if (profile.ecuModel.isNotBlank()) appendLine("Injeção/ECU: ${profile.ecuModel}")
        appendLine("Código de falha: ${r.code} (${if (r.pending) "pendente" else "confirmado"})")
        profile.describeDtc(r.code)?.let { appendLine("Descrição no manual do veículo: $it") }
        val frame = listOfNotNull(
            r.rpm?.let { "rotação ${fmt(it, 0)} rpm" },
            r.speedKmh?.let { "velocidade ${fmt(it, 0)} km/h" },
            r.engineLoadPct?.let { "carga do motor ${fmt(it, 0)}%" },
            r.coolantC?.let { "temperatura do motor ${fmt(it, 0)} °C" },
        )
        if (frame.isNotEmpty()) appendLine("Leituras do app quando a falha apareceu: ${frame.joinToString(", ")}")
        val meta = outputMeta(profile)
        // Só saídas que existem no perfil (nunca um campo qualquer vindo da tela, como coordenadas)
        val ecu = r.ecuFrame.filterKeys { it in meta && it !in HIDDEN_FROM_PROMPT }
        if (ecu.isNotEmpty()) {
            appendLine("Congelamento de quadro gravado pela ECU: " + ecu.entries.joinToString(", ") { (id, v) ->
                val (name, unit) = meta.getValue(id)
                "$name ${fmt(v, if (abs(v) < 10) 1 else 0)}${if (unit.isNotBlank()) " $unit" else ""}"
            })
        }
        append("Explique esta falha.")
    }

    fun messages(r: Request, profile: VehicleProfile) = listOf(
        AiClient.Message("system", SYSTEM),
        AiClient.Message("user", userText(r, profile)),
    )

    /** Nome e unidade de cada saída do perfil. */
    private fun outputMeta(profile: VehicleProfile): Map<String, Pair<String, String>> =
        profile.pids.values.flatten().flatMap { p ->
            listOfNotNull(p.formula?.let { p.id to (p.name to p.unit) }) + p.outputs.map { it.id to (it.name to it.unit) }
        }.toMap()

    private fun fmt(v: Double, decimals: Int) = String.format(Locale("pt", "BR"), "%.${decimals}f", v)
}

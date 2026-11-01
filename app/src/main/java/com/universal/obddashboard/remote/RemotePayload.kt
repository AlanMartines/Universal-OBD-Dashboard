package com.universal.obddashboard.remote

import com.universal.obddashboard.db.TelemetryLogEntity
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonArray
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.doubleOrNull
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.put

/**
 * Converte uma amostra da caixa preta no formato do servidor. É uma lista fechada: só números de
 * sensores, o horário e o número da viagem. VIN e dados do adaptador não têm como sair por aqui,
 * e o GPS só entra se a pessoa ligar a opção.
 */
object RemotePayload {
    private val METRIC_ID = Regex("^[A-Za-z0-9_.-]{1,48}$")
    private val DTC = Regex("^[PCBU][0-9A-F]{4}$")
    private const val MAX_METRICS = 120
    private const val MAX_DTCS = 50

    fun sample(s: TelemetryLogEntity, sendGps: Boolean, dtcs: List<String> = emptyList()): JsonObject {
        val metrics = linkedMapOf<String, Double>()
        fun add(id: String, value: Double?) {
            if (value != null && value.isFinite() && metrics.size < MAX_METRICS && METRIC_ID.matches(id)) metrics[id] = value
        }
        add("rpm", s.rpm)
        add("speed", s.speedObdKmh ?: s.speedGpsKmh)
        add("throttle", s.throttlePct)
        add("map", s.mapKpa)
        add("coolant_temp", s.coolantC)
        add("intake_temp", s.intakeC)
        add("battery_volts", s.voltage)
        add("timing_advance", s.timingAdvance)
        add("engine_load", s.engineLoadPct)
        add("stft_b1", s.stftPct)
        add("ltft_b1", s.ltftPct)
        add("lambda_v", s.lambdaV)
        add("derived.fuelLph", s.fuelLph)
        s.extraJson?.let { raw ->
            runCatching { Json.parseToJsonElement(raw).jsonObject }.getOrNull()?.forEach { (id, value) ->
                add(id, runCatching { value.jsonPrimitive.doubleOrNull }.getOrNull())
            }
        }
        val validDtcs = dtcs.filter { DTC.matches(it) }.distinct().take(MAX_DTCS)
        return buildJsonObject {
            put("seq", s.id)
            put("ts", s.timestamp)
            put("tripId", s.tripId)
            put("metrics", JsonObject(metrics.mapValues { JsonPrimitive(it.value) }))
            if (validDtcs.isNotEmpty()) put("dtcs", buildJsonArray { validDtcs.forEach { add(JsonPrimitive(it)) } })
            val lat = s.latitude
            val lon = s.longitude
            if (sendGps && lat != null && lon != null && lat in -90.0..90.0 && lon in -180.0..180.0) {
                put(
                    "gps",
                    buildJsonObject {
                        put("lat", lat)
                        put("lon", lon)
                        s.speedGpsKmh?.takeIf { it.isFinite() && it in 0.0..1000.0 }?.let { put("speedKmh", it) }
                        s.gpsAccuracyM?.toDouble()?.takeIf { it.isFinite() && it in 0.0..100000.0 }?.let { put("accuracyM", it) }
                    },
                )
            }
        }
    }

    fun batch(samples: List<JsonObject>): String =
        buildJsonObject { put("samples", buildJsonArray { samples.forEach { add(it) } }) }.toString()
}

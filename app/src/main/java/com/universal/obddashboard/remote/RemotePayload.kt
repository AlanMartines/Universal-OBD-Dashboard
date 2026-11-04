package com.universal.obddashboard.remote

import com.universal.obddashboard.db.FuelUpEntity
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

    /**
     * Última leitura para o Painel do veículo: a mesma lista fechada, sem número de sequência, e com
     * os valores derivados e os limites dos mostradores. [extras] só aceita números finitos.
     */
    /** Alerta ativo no app, para o painel web mostrar o mesmo aviso. Só o nível e o texto. */
    data class LiveAlert(val level: String, val message: String)

    private const val MAX_ALERTS = 5
    private const val MAX_ALERT_TEXT = 160

    private val APP_VERSION = Regex("^[A-Za-z0-9._+-]{1,32}$")

    fun live(
        s: TelemetryLogEntity,
        sendGps: Boolean,
        dtcs: List<String>,
        extras: Map<String, Double?>,
        alerts: List<LiveAlert> = emptyList(),
        /** Versão instalada: o painel mostra a atual, não só a do pareamento. */
        appVersion: String? = null,
    ): String {
        val base = sample(s, sendGps, dtcs)
        val metrics = linkedMapOf<String, JsonPrimitive>()
        base["metrics"]?.jsonObject?.forEach { (k, v) -> metrics[k] = v.jsonPrimitive }
        extras.forEach { (id, value) ->
            if (value != null && value.isFinite() && metrics.size < MAX_METRICS && METRIC_ID.matches(id)) metrics[id] = JsonPrimitive(value)
        }
        return buildJsonObject {
            put("ts", s.timestamp)
            appVersion?.takeIf { APP_VERSION.matches(it) }?.let { put("appVersion", it) }
            put("metrics", JsonObject(metrics))
            base["dtcs"]?.let { put("dtcs", it) }
            base["gps"]?.let { put("gps", it) }
            // Sempre presente, mesmo vazia: é ela que tira do painel um alerta que já passou
            val shown = alerts.filter { it.level == "WARNING" || it.level == "CRITICAL" }.take(MAX_ALERTS)
            run {
                put(
                    "alerts",
                    buildJsonArray {
                        shown.forEach { a ->
                            add(buildJsonObject {
                                put("level", a.level)
                                put("message", a.message.filterNot { it.isISOControl() || it in "<>" }.take(MAX_ALERT_TEXT))
                            })
                        }
                    },
                )
            }
        }.toString()
    }

    /**
     * Abastecimentos do veículo, lista inteira. Nome do posto e observações ficam no celular:
     * revelariam por onde a pessoa anda.
     */
    fun fuelUps(list: List<FuelUpEntity>): String = buildJsonObject {
        put(
            "items",
            buildJsonArray {
                list.filter { it.id > 0 && it.liters > 0 && it.liters <= MAX_LITERS }.take(MAX_FUEL_UPS).forEach { f ->
                    add(buildJsonObject {
                        put("id", f.id)
                        put("ts", f.timestamp)
                        put("odometerKm", f.odometerKm?.takeIf { it.isFinite() && it >= 0 })
                        put("liters", f.liters)
                        put("totalPrice", f.totalPrice?.takeIf { it.isFinite() && it >= 0 })
                        put("pricePerLiter", f.pricePerLiter?.takeIf { it.isFinite() && it >= 0 })
                        put("fuelType", f.fuelType)
                        put("ethanolPct", f.ethanolPct?.takeIf { it.isFinite() }?.coerceIn(0.0, 100.0))
                        put("fullTank", f.fullTank)
                    })
                }
            },
        )
    }.toString()

    private const val MAX_FUEL_UPS = 1000
    private const val MAX_LITERS = 1000.0

    fun batch(samples: List<JsonObject>): String =
        buildJsonObject { put("samples", buildJsonArray { samples.forEach { add(it) } }) }.toString()
}

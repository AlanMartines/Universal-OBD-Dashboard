package com.universal.obddashboard.export

import com.universal.obddashboard.db.DiagnosticTroubleCodeEntity
import com.universal.obddashboard.db.TelemetryLogEntity
import com.universal.obddashboard.db.TripEntity
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.doubleOrNull
import java.math.BigDecimal
import java.time.Instant
import java.time.ZoneId
import java.time.format.DateTimeFormatter

/**
 * Converte a caixa preta de uma viagem em CSV (telemetria completa) e GPX 1.1 (trajeto,
 * com dados OBD nas extensões e as falhas como waypoints). Kotlin puro, sem Android.
 */
object TripExporter {

    const val GPX_NS = "http://www.topografix.com/GPX/1/1"
    const val OBD_NS = "https://github.com/AlanMartines/Universal-OBD-Dashboard/gpx/1"

    /** Intervalo sem fix de GPS acima do qual o trajeto é quebrado em outro segmento. */
    private const val SEGMENT_GAP_MS = 30_000L

    private val columns: List<Pair<String, (TelemetryLogEntity) -> Any?>> = listOf(
        "timestamp_ms" to { it.timestamp },
        "time_utc" to { Instant.ofEpochMilli(it.timestamp).toString() },
        "rpm" to { it.rpm },
        "speed_obd_kmh" to { it.speedObdKmh },
        "speed_gps_kmh" to { it.speedGpsKmh },
        "throttle_pct" to { it.throttlePct },
        "map_kpa" to { it.mapKpa },
        "coolant_c" to { it.coolantC },
        "intake_c" to { it.intakeC },
        "voltage" to { it.voltage },
        "timing_advance" to { it.timingAdvance },
        "engine_load_pct" to { it.engineLoadPct },
        "stft_pct" to { it.stftPct },
        "ltft_pct" to { it.ltftPct },
        "lambda_v" to { it.lambdaV },
        "fuel_lph" to { it.fuelLph },
        "latitude" to { it.latitude },
        "longitude" to { it.longitude },
        "gps_accuracy_m" to { it.gpsAccuracyM },
    )

    /** CSV RFC 4180 (vírgula, ponto decimal). Saídas extras do perfil viram colunas ao final. */
    fun csv(samples: List<TelemetryLogEntity>): String {
        val extras = samples.map { parseExtras(it.extraJson) }
        val extraKeys = extras.flatMapTo(sortedSetOf()) { it.keys }.toList()
        val sb = StringBuilder()
        (columns.map { it.first } + extraKeys).joinTo(sb, ",") { csvField(it) }
        sb.append("\r\n")
        samples.forEachIndexed { i, s ->
            val row = columns.map { (_, get) -> number(get(s)) } + extraKeys.map { number(extras[i][it]) }
            row.joinTo(sb, ",") { csvField(it) }
            sb.append("\r\n")
        }
        return sb.toString()
    }

    fun hasGps(samples: List<TelemetryLogEntity>) = samples.any { it.latitude != null && it.longitude != null }

    fun gpx(
        trip: TripEntity,
        samples: List<TelemetryLogEntity>,
        dtcs: List<DiagnosticTroubleCodeEntity>,
        zone: ZoneId = ZoneId.systemDefault(),
    ): String {
        val name = "Viagem " + DateTimeFormatter.ofPattern("dd/MM/yyyy HH:mm").format(Instant.ofEpochMilli(trip.startTime).atZone(zone))
        val sb = StringBuilder()
        sb.append("""<?xml version="1.0" encoding="UTF-8"?>""").append('\n')
        sb.append("""<gpx version="1.1" creator="Universal-OBD-Dashboard" xmlns="$GPX_NS" xmlns:obd="$OBD_NS">""").append('\n')
        sb.append("  <metadata><name>").append(xml(name)).append("</name><time>")
            .append(Instant.ofEpochMilli(trip.startTime)).append("</time></metadata>\n")

        // O esquema GPX exige os waypoints antes das trilhas.
        for (d in dtcs) {
            val lat = d.latitude ?: continue
            val lon = d.longitude ?: continue
            val desc = listOfNotNull(
                if (d.kind == "CONFIRMED") "Confirmada" else "Pendente",
                d.rpm?.let { "${number(it)} RPM" },
                d.speedKmh?.let { "${number(it)} km/h" },
                d.coolantC?.let { "${number(it)} °C" },
            ).joinToString(" · ")
            sb.append("  <wpt lat=\"").append(number(lat)).append("\" lon=\"").append(number(lon)).append("\">")
                .append("<time>").append(Instant.ofEpochMilli(d.detectedAt)).append("</time>")
                .append("<name>").append(xml(d.code)).append("</name>")
                .append("<desc>").append(xml(desc)).append("</desc>")
                .append("<type>dtc</type></wpt>\n")
        }

        sb.append("  <trk><name>").append(xml(name)).append("</name>\n")
        var lastAt: Long? = null
        for (s in samples) {
            val lat = s.latitude ?: continue
            val lon = s.longitude ?: continue
            val prev = lastAt
            if (prev == null || s.timestamp - prev > SEGMENT_GAP_MS) {
                if (prev != null) sb.append("    </trkseg>\n")
                sb.append("    <trkseg>\n")
            }
            lastAt = s.timestamp
            sb.append("      <trkpt lat=\"").append(number(lat)).append("\" lon=\"").append(number(lon)).append("\">")
                .append("<time>").append(Instant.ofEpochMilli(s.timestamp)).append("</time>")
            val ext = listOf(
                "speed_kmh" to (s.speedObdKmh ?: s.speedGpsKmh),
                "rpm" to s.rpm,
                "coolant_c" to s.coolantC,
                "throttle_pct" to s.throttlePct,
                "fuel_lph" to s.fuelLph,
            ).filter { it.second != null }
            if (ext.isNotEmpty()) {
                sb.append("<extensions>")
                ext.forEach { (k, v) -> sb.append("<obd:").append(k).append('>').append(number(v)).append("</obd:").append(k).append('>') }
                sb.append("</extensions>")
            }
            sb.append("</trkpt>\n")
        }
        if (lastAt != null) sb.append("    </trkseg>\n")
        sb.append("  </trk>\n</gpx>\n")
        return sb.toString()
    }

    /** Ex.: viagem_7_20251023-0900.csv (início da viagem no fuso local). */
    fun fileName(trip: TripEntity, extension: String, zone: ZoneId = ZoneId.systemDefault()): String =
        "viagem_${trip.id}_" + DateTimeFormatter.ofPattern("yyyyMMdd-HHmm").format(Instant.ofEpochMilli(trip.startTime).atZone(zone)) +
            ".$extension"

    private fun parseExtras(json: String?): Map<String, Double> {
        if (json.isNullOrBlank()) return emptyMap()
        val obj = runCatching { Json.parseToJsonElement(json) as? JsonObject }.getOrNull() ?: return emptyMap()
        return obj.mapNotNull { (k, v) -> (v as? JsonPrimitive)?.doubleOrNull?.let { k to it } }.toMap()
    }

    /** Números sem notação científica nem ".0" supérfluo; Float sem ruído binário (3.9f → "3.9"). */
    private fun number(v: Any?): String = when (v) {
        null -> ""
        is Double -> if (v.isFinite()) BigDecimal.valueOf(v).stripTrailingZeros().toPlainString() else ""
        is Float -> if (v.isFinite()) BigDecimal(v.toString()).stripTrailingZeros().toPlainString() else ""
        else -> v.toString()
    }

    private fun csvField(s: String) =
        if (s.any { it == ',' || it == '"' || it == '\n' || it == '\r' }) "\"" + s.replace("\"", "\"\"") + "\"" else s

    private fun xml(s: String) = buildString(s.length) {
        for (c in s) when (c) {
            '&' -> append("&amp;")
            '<' -> append("&lt;")
            '>' -> append("&gt;")
            '"' -> append("&quot;")
            else -> append(c)
        }
    }
}

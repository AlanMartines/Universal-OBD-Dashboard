package com.universal.obddashboard.bridge

import android.webkit.JavascriptInterface
import androidx.room.withTransaction
import com.universal.obddashboard.MainActivity
import com.universal.obddashboard.db.AppDatabase
import com.universal.obddashboard.export.TripExportFiles
import com.universal.obddashboard.orNull
import org.json.JSONArray
import org.json.JSONObject

/**
 * Ponte JavaScript "AndroidHistory": viagens gravadas e falhas (lista, exportação e remoção).
 * Registrada pela [MainActivity]; na tela, `bridge.x()` encontra o método no objeto certo.
 * Tudo aqui consulta o banco, então responde de forma assíncrona ([MainActivity.answerAsync]).
 */
class HistoryBridge(private val activity: MainActivity) {

    @JavascriptInterface
    fun getTrips(requestId: String, limit: Int) = activity.answerAsync(requestId) {
        val arr = JSONArray()
        AppDatabase.get(activity).tripDao().recentTrips(limit.coerceIn(1, 500)).forEach { t ->
            arr.put(
                JSONObject().put("id", t.id).put("profileId", t.profileId).put("startTime", t.startTime)
                    .put("endTime", t.endTime ?: JSONObject.NULL).put("distanceKm", t.distanceKm)
                    .put("maxSpeedKmh", t.maxSpeedKmh).put("maxRpm", t.maxRpm)
                    .put("maxCoolantC", t.maxCoolantC.orNull()).put("minVoltage", t.minVoltage.orNull())
                    .put("fuelUsedL", t.fuelUsedL).put("endReason", t.endReason ?: JSONObject.NULL),
            )
        }
        arr.toString()
    }

    /** Gera o CSV/GPX da viagem e abre o menu de compartilhamento. Retorna "ok" ou a mensagem de erro. */
    @JavascriptInterface
    fun exportTrip(requestId: String, tripId: Long, format: String) = activity.answerAsync(requestId) {
        try {
            val f = TripExportFiles.Format.valueOf(format.uppercase())
            val file = TripExportFiles.write(activity, tripId, f)
            activity.runOnUiThread { activity.startActivity(TripExportFiles.shareIntent(activity, file, f)) }
            "ok"
        } catch (e: TripExportFiles.ExportException) {
            e.message ?: "erro"
        } catch (e: Exception) {
            "Falha ao exportar: ${e.message}"
        }
    }

    /** Apaga uma viagem com a telemetria e as falhas dela. A viagem em andamento não pode ser apagada. */
    @JavascriptInterface
    fun deleteTrip(requestId: String, tripId: Long) = activity.answerAsync(requestId) {
        try {
            if (tripId == activity.activeTripId()) {
                "Esta viagem está em andamento: encerre a captura antes de apagar."
            } else {
                val db = AppDatabase.get(activity)
                db.withTransaction {
                    db.tripDao().deleteDtcsForTrip(tripId)
                    db.tripDao().deleteTrip(tripId) // telemetria sai em cascata
                    db.aiAnswerDao().delete("trip", tripId.toString())
                }
                "ok"
            }
        } catch (e: Exception) {
            "Falha ao apagar: ${e.message}"
        }
    }

    /** Apaga viagens, telemetria e falhas registradas, preservando a viagem em andamento. */
    @JavascriptInterface
    fun deleteAllHistory(requestId: String) = activity.answerAsync(requestId) {
        try {
            val keep = activity.activeTripId() ?: -1L
            val db = AppDatabase.get(activity)
            db.withTransaction {
                db.tripDao().deleteDtcsExcept(keep)
                db.tripDao().deleteTripsExcept(keep)
                db.aiAnswerDao().deleteKindExcept("trip", keep.toString())
            }
            if (keep >= 0) "ok:keep" else "ok"
        } catch (e: Exception) {
            "Falha ao apagar: ${e.message}"
        }
    }

    @JavascriptInterface
    fun getDtcHistory(requestId: String, limit: Int) = activity.answerAsync(requestId) {
        val arr = JSONArray()
        AppDatabase.get(activity).tripDao().recentDtcs(limit.coerceIn(1, 500)).forEach { d ->
            arr.put(
                JSONObject().put("code", d.code).put("kind", d.kind).put("detectedAt", d.detectedAt)
                    .put("tripId", d.tripId ?: JSONObject.NULL)
                    .put("rpm", d.rpm.orNull()).put("speedKmh", d.speedKmh.orNull())
                    .put("engineLoadPct", d.engineLoadPct.orNull()).put("coolantC", d.coolantC.orNull())
                    .put("lat", d.latitude.orNull()).put("lon", d.longitude.orNull())
                    .put("ecuFrame", d.ecuFreezeJson?.let { runCatching { JSONObject(it).optJSONObject("values") }.getOrNull() } ?: JSONObject.NULL),
            )
        }
        arr.toString()
    }
}

package com.universal.obddashboard.bridge

import android.webkit.JavascriptInterface
import androidx.room.withTransaction
import com.universal.obddashboard.MainActivity
import com.universal.obddashboard.Vehicles
import com.universal.obddashboard.db.AppDatabase
import com.universal.obddashboard.export.TripExportFiles
import com.universal.obddashboard.orNull
import com.universal.obddashboard.service.ObdForegroundService
import com.universal.obddashboard.telemetry.Leg
import com.universal.obddashboard.telemetry.SpeedCalibration
import com.universal.obddashboard.telemetry.TripComputer
import com.universal.obddashboard.telemetry.TripStats
import org.json.JSONArray
import org.json.JSONObject

/**
 * Ponte JavaScript "AndroidHistory": viagens gravadas e falhas (lista, exportação e remoção).
 * Registrada pela [MainActivity]; na tela, `bridge.x()` encontra o método no objeto certo.
 * Tudo aqui consulta o banco, então responde de forma assíncrona ([MainActivity.answerAsync]).
 */
class HistoryBridge(private val activity: MainActivity) {
    private companion object {
        const val SPEED_SAMPLE_LIMIT = 20_000
    }


    @JavascriptInterface
    fun getTrips(requestId: String, limit: Int) = activity.answerAsync(requestId) {
        val arr = JSONArray()
        AppDatabase.get(activity).tripDao().recentTrips(limit.coerceIn(1, 500), Vehicles.selectedId(activity)).forEach { t ->
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

    /**
     * Histórico → Resumo da viagem: refeito pelas amostras gravadas (a cada ~2 s). Tempo andando e parado,
     * velocidade média, km/l, litros, custo (preço do último abastecimento antes dela), marcha lenta,
     * km com a injeção cortada e % do tempo no verde, meio e vermelho.
     */
    @JavascriptInterface
    fun getTripSummary(requestId: String, tripId: Long) = activity.answerAsync(requestId) {
        val db = AppDatabase.get(activity)
        val trip = db.tripDao().getTrip(tripId) ?: return@answerAsync JSONObject().put("ok", false).put("error", "Viagem não encontrada.").toString()
        val logs = db.tripDao().telemetryForTrip(tripId)
        val ecoMid = activity.currentProfile().profile.fuel?.ecoMidLPer100km ?: TripStats.DEFAULT_ECO_MID
        val st = TripStats.fromLogs(logs, ecoMid)
        val price = db.fuelUpDao().all(trip.vehicleId).filter { it.timestamp <= (trip.endTime ?: Long.MAX_VALUE) }.maxByOrNull { it.timestamp }
            ?.let { f -> f.pricePerLiter ?: f.totalPrice?.takeIf { f.liters > 0 }?.div(f.liters) }
        val leg = Leg(trip.distanceKm, trip.fuelUsedL)
        JSONObject().put("ok", true).put("samples", logs.size)
            .put("km", trip.distanceKm).put("liters", trip.fuelUsedL).put("kmPerL", leg.kmPerL.orNull())
            .put("cost", price?.times(trip.fuelUsedL).orNull()).put("costPerKm", TripComputer.costPerKm(price, leg.kmPerL).orNull())
            .put("movingS", st.movingS).put("idleS", st.idleS).put("idleFuelL", st.idleFuelL)
            .put("idleCost", price?.times(st.idleFuelL).orNull()).put("avgMovingKmh", st.avgMovingKmh.orNull())
            .put("fuelCutKm", st.fuelCutKm).put("ecoPct", st.ecoPct()?.let { JSONArray(it) } ?: JSONObject.NULL)
            .toString()
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

    /** Ajustes → Mostradores: correção sugerida pela comparação entre GPS e ECU no histórico. */
    @JavascriptInterface
    fun getSpeedSuggestion(requestId: String) = activity.answerAsync(requestId) {
        val samples = AppDatabase.get(activity).tripDao().speedSamples(SPEED_SAMPLE_LIMIT, Vehicles.selectedId(activity)).asReversed()
            .map { SpeedCalibration.Sample(it.timestamp, it.obd, it.gps, it.accuracy) }
        SpeedCalibration.suggest(samples)
            ?.let { JSONObject().put("pct", it.pct).put("samples", it.samples).toString() } ?: "{}"
    }

    /** Exclui um veículo que não está selecionado, com viagens, falhas, abastecimentos e ajustes dele. */
    @JavascriptInterface
    fun deleteVehicle(requestId: String, id: String) = activity.answerAsync(requestId) {
        when {
            ObdForegroundService.isRunning -> "Encerre a captura antes de excluir um veículo."
            Vehicles.selectedId(activity) == id -> "Selecione outro veículo antes de excluir este."
            Vehicles.get(activity, id) == null -> "Veículo não encontrado."
            else -> {
                val db = AppDatabase.get(activity)
                db.withTransaction {
                    db.tripDao().deleteDtcsOfVehicle(id)
                    db.tripDao().deleteTripsOfVehicle(id)
                    db.fuelUpDao().deleteAll(id)
                }
                Vehicles.remove(activity, id)
                "ok"
            }
        }
    }

    /** Apaga viagens, telemetria e falhas registradas, preservando a viagem em andamento. */
    @JavascriptInterface
    fun deleteAllHistory(requestId: String) = activity.answerAsync(requestId) {
        try {
            val keep = activity.activeTripId() ?: -1L
            val db = AppDatabase.get(activity)
            db.withTransaction {
                db.tripDao().deleteDtcsExcept(keep, Vehicles.selectedId(activity))
                db.tripDao().deleteTripsExcept(keep, Vehicles.selectedId(activity))
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
        AppDatabase.get(activity).tripDao().recentDtcs(limit.coerceIn(1, 500), Vehicles.selectedId(activity)).forEach { d ->
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

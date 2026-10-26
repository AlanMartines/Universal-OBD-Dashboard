package com.universal.obddashboard.bridge

import android.webkit.JavascriptInterface
import androidx.room.withTransaction
import com.universal.obddashboard.AppSettings
import com.universal.obddashboard.MainActivity
import com.universal.obddashboard.db.AppDatabase
import com.universal.obddashboard.db.FuelUpEntity
import com.universal.obddashboard.export.TripExportFiles
import com.universal.obddashboard.fuel.FuelCalibration
import com.universal.obddashboard.fuel.FuelLog
import com.universal.obddashboard.orNull
import com.universal.obddashboard.telemetry.TelemetryHub
import java.util.Locale
import org.json.JSONArray
import org.json.JSONObject

/**
 * Ponte JavaScript "AndroidFuel": abastecimentos, calibração do consumo, nível do tanque e % de etanol.
 * Registrada pela [MainActivity]; na tela, `bridge.x()` encontra o método no objeto certo.
 * O que consulta o banco responde de forma assíncrona ([MainActivity.answerAsync]).
 */
class FuelBridge(private val activity: MainActivity) {

    /** {items, summary, intervals (com litros estimados pelo app no período), ve} */
    @JavascriptInterface
    fun getFuelUps(requestId: String) = activity.answerAsync(requestId) {
        val db = AppDatabase.get(activity)
        val list = db.fuelUpDao().all()
        val s = FuelLog.summary(list)
        val ve = runCatching { activity.currentProfile().profile.fuel?.volumetricEfficiency }.getOrNull()
        // Estimativa do app em cada intervalo: integral do consumo gravado entre os dois abastecimentos
        val checks = s.intervals.map { iv ->
            FuelCalibration.Check(iv.from.timestamp, iv.to.timestamp, iv.liters,
                FuelCalibration.integrateLiters(db.tripDao().fuelSamples(iv.from.timestamp, iv.to.timestamp)))
        }
        val profileId = runCatching { activity.currentProfile().id }.getOrDefault(AppSettings.selectedProfileId(activity))
        val corr = AppSettings.fuelCorrection(activity, profileId)
        val cal = FuelCalibration.evaluate(checks, corr.factor, corr.since)
        JSONObject()
            .put("items", JSONArray().apply { list.asReversed().forEach { put(fuelUpJson(it)) } })
            .put(
                "summary",
                JSONObject().put("count", s.count).put("totalLiters", s.totalLiters).put("totalCost", s.totalCost)
                    .put("avgKmPerL", s.avgKmPerL.orNull()).put("costPerKm", s.costPerKm.orNull())
                    .put("ethanolBreakEven", s.ethanolBreakEven.orNull())
                    .put("costByMonth", JSONObject(s.costByMonth as Map<*, *>)),
            )
            .put(
                "intervals",
                JSONArray().apply {
                    s.intervals.zip(checks).asReversed().forEach { (iv, check) ->
                        val est = check.estimatedL
                        put(
                            JSONObject().put("from", iv.from.timestamp).put("to", iv.to.timestamp).put("km", iv.distanceKm)
                                .put("liters", iv.liters).put("kmPerL", iv.kmPerL).put("cost", iv.cost.orNull())
                                .put("costPerKm", iv.costPerKm.orNull()).put("fuelType", iv.fuelType)
                                .put("estimatedLiters", est.takeIf { it > 0.5 }.orNull()),
                        )
                    }
                },
            )
            .put("ve", ve.orNull())
            .put(
                "calibration",
                JSONObject().put("factor", cal.currentFactor).put("since", corr.since)
                    .put("used", cal.used.size).put("ignored", cal.ignored.size).put("missing", cal.missing)
                    .put("deviation", cal.deviation.orNull()).put("suggested", cal.suggestedFactor.orNull()),
            )
            .toString()
    }

    /** Aplica o fator de correção do consumo (Abastecimentos → Calibração); 1 volta ao perfil. */
    @JavascriptInterface
    fun setFuelCorrection(factor: Double): String = try {
        require(factor in FuelCalibration.MIN_FACTOR..FuelCalibration.MAX_FACTOR) { "Fator fora da faixa" }
        val profileId = activity.currentProfile().id
        AppSettings.setFuelCorrection(activity, profileId, factor)
        TelemetryHub.requestFuelOverride(TelemetryHub.FuelOverride(fuelCorrection = factor))
        "ok"
    } catch (e: Exception) {
        e.message ?: "erro"
    }

    /** Salva um abastecimento (JSON do formulário). Tanque cheio recente → tanque e hodômetro do app atualizados. */
    @JavascriptInterface
    fun addFuelUp(requestId: String, json: String) = activity.answerAsync(requestId) { addFuelUp(json) }

    private suspend fun addFuelUp(json: String): String = try {
        val o = JSONObject(json)
        fun d(k: String) = o.optDouble(k, Double.NaN).takeIf { it.isFinite() }
        val liters = d("liters")?.takeIf { it > 0 } ?: throw IllegalArgumentException("Informe os litros")
        val total = d("totalPrice")
        val ppl = d("pricePerLiter") ?: total?.div(liters)
        val type = o.optString("fuelType", FuelLog.GASOLINE).takeIf { it in FuelLog.FUEL_TYPES } ?: FuelLog.GASOLINE
        val f = FuelUpEntity(
            timestamp = o.optLong("timestamp", System.currentTimeMillis()),
            profileId = runCatching { activity.currentProfile().id }.getOrDefault(AppSettings.selectedProfileId(activity)),
            odometerKm = d("odometerKm"), liters = liters, totalPrice = total ?: ppl?.times(liters), pricePerLiter = ppl,
            fuelType = type, ethanolPct = d("ethanolPct"), fullTank = o.optBoolean("fullTank", true),
            station = o.optString("station").ifBlank { null }, notes = o.optString("notes").ifBlank { null },
        )
        AppDatabase.get(activity).fuelUpDao().insert(f)
        if (System.currentTimeMillis() - f.timestamp < MainActivity.RECENT_FUEL_UP_MS) {
            f.odometerKm?.let { activity.applyOdometer(it) }
            applyFillUp(f)?.let { "ok|$it" } ?: "ok"
        } else {
            "ok|Registro antigo: nível e etanol do tanque não foram alterados"
        }
    } catch (e: Exception) {
        e.message ?: "erro"
    }

    @JavascriptInterface
    fun deleteFuelUp(requestId: String, id: Long) = activity.answerAsync(requestId) {
        try {
            AppDatabase.get(activity).fuelUpDao().delete(id)
            "ok"
        } catch (e: Exception) {
            "Falha ao apagar: ${e.message}"
        }
    }

    /** CSV com todos os abastecimentos, pelo menu de compartilhar. */
    @JavascriptInterface
    fun exportFuelUps(requestId: String) = activity.answerAsync(requestId) {
        try {
            val list = AppDatabase.get(activity).fuelUpDao().all()
            if (list.isEmpty()) throw IllegalStateException("Nenhum abastecimento registrado")
            val dir = java.io.File(activity.cacheDir, "exports").apply { mkdirs() }
            val stamp = java.text.SimpleDateFormat("yyyyMMdd-HHmm", java.util.Locale.US).format(java.util.Date())
            val file = java.io.File(dir, "abastecimentos_$stamp.csv").apply { writeText(FuelLog.toCsv(list)) }
            activity.runOnUiThread { activity.startActivity(TripExportFiles.shareIntent(activity, file, "text/csv")) }
            "ok"
        } catch (e: Exception) {
            e.message ?: "erro"
        }
    }

    /** Importa CSV no formato exportado; ignora linhas já registradas (mesma data e litros). */
    @JavascriptInterface
    fun pickFuelCsv() = activity.runOnUiThread {
        activity.fuelCsvPicker.launch(arrayOf("text/csv", "text/comma-separated-values", "text/plain", "application/csv", "application/vnd.ms-excel", "application/octet-stream"))
    }

    /** [replace]: apaga todos os abastecimentos antes (só depois de o CSV inteiro ser validado). */
    @JavascriptInterface
    fun importFuelUps(requestId: String, csv: String, replace: Boolean) = activity.answerAsync(requestId) { importFuelUps(csv, replace) }

    private suspend fun importFuelUps(csv: String, replace: Boolean): String = try {
        val profileId = runCatching { activity.currentProfile().id }.getOrDefault(AppSettings.selectedProfileId(activity))
        val parsed = FuelLog.fromCsv(csv, profileId)
        if (parsed.isEmpty()) throw IllegalArgumentException("Nenhum abastecimento no CSV")
        val db = AppDatabase.get(activity)
        val dao = db.fuelUpDao()
        val (added, removed) = db.withTransaction {
            val removed = if (replace) dao.all().size.also { dao.deleteAll() } else 0
            val fresh = parsed.filter { dao.countSame(it.timestamp, it.liters) == 0 }
            dao.insertAll(fresh)
            fresh.size to removed
        }
        JSONObject().put("ok", true).put("added", added).put("skipped", parsed.size - added).put("removed", removed).toString()
    } catch (e: Exception) {
        JSONObject().put("ok", false).put("error", e.message).toString()
    }

    @JavascriptInterface
    fun setEthanolPercent(pct: Double) {
        AppSettings.setEthanolPercent(activity, pct)
        TelemetryHub.requestFuelOverride(TelemetryHub.FuelOverride(ethanolPercent = pct.coerceIn(0.0, 100.0)))
    }

    @JavascriptInterface
    fun setFuelLevel(liters: Double) {
        AppSettings.setFuelLevel(activity, liters)
        TelemetryHub.requestFuelOverride(TelemetryHub.FuelOverride(fuelLevelL = liters.coerceAtLeast(0.0)))
    }

    @JavascriptInterface
    fun markTankFull(): Double {
        val capacity = runCatching { activity.currentProfile().profile.fuel?.tankCapacityL }.getOrNull() ?: return -1.0
        setFuelLevel(capacity)
        return capacity
    }

    private fun fuelUpJson(f: FuelUpEntity) = JSONObject()
        .put("id", f.id).put("timestamp", f.timestamp).put("odometerKm", f.odometerKm.orNull()).put("liters", f.liters)
        .put("totalPrice", f.totalPrice.orNull()).put("pricePerLiter", f.pricePerLiter.orNull()).put("fuelType", f.fuelType)
        .put("ethanolPct", f.ethanolPct.orNull()).put("fullTank", f.fullTank)
        .put("station", f.station ?: JSONObject.NULL).put("notes", f.notes ?: JSONObject.NULL)

    /**
     * Abastecimento feito agora: ajusta o nível estimado e, em carro flex, o % de etanol do tanque
     * (também durante a captura). Retorna o resumo para a tela, ou null sem dados de tanque no perfil.
     */
    private fun applyFillUp(f: FuelUpEntity): String? {
        val fuel = runCatching { activity.currentProfile().profile.fuel }.getOrNull() ?: return null
        val flex = fuel.ethanol != null
        val before = AppSettings.ethanolPercent(activity, fuel.defaultEthanolPct)
        val t = FuelLog.tankAfter(f, fuel.tankCapacityL, activity.currentFuelLevel(), before)
        AppSettings.setFuelLevel(activity, t.levelL)
        if (flex) AppSettings.setEthanolPercent(activity, t.ethanolPct)
        TelemetryHub.requestFuelOverride(TelemetryHub.FuelOverride(fuelLevelL = t.levelL, ethanolPercent = t.ethanolPct.takeIf { flex }))
        return "Tanque: %.1f L".format(Locale("pt", "BR"), t.levelL) +
            (if (flex) " · etanol %.0f%%".format(t.ethanolPct) else "")
    }
}

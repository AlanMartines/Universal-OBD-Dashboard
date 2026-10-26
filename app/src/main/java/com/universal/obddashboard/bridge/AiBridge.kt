package com.universal.obddashboard.bridge

import android.webkit.JavascriptInterface
import androidx.lifecycle.lifecycleScope
import com.universal.obddashboard.AppSettings
import com.universal.obddashboard.MainActivity
import com.universal.obddashboard.ai.AiClient
import com.universal.obddashboard.ai.AiProvider
import com.universal.obddashboard.ai.AiSettings
import com.universal.obddashboard.ai.DtcPrompt
import com.universal.obddashboard.ai.HistoryContext
import com.universal.obddashboard.ai.TripDigest
import com.universal.obddashboard.db.AiAnswerEntity
import com.universal.obddashboard.db.AppDatabase
import com.universal.obddashboard.obd.VehicleProfile
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.jsonObject
import org.json.JSONArray
import org.json.JSONObject

/**
 * Ponte JavaScript "AndroidAi": assistente IA (configuração, explicação de falhas, análise de viagens e perguntas).
 * Registrada pela [MainActivity]; na tela, `bridge.x()` encontra o método no objeto certo.
 */
class AiBridge(private val activity: MainActivity) {

    @JavascriptInterface
    fun getAiSettings(): String {
        val c = AiSettings.config(activity)
        return JSONObject()
            .put("enabled", c.enabled).put("provider", c.provider.name).put("baseUrl", c.baseUrl).put("model", c.model)
            .put("consents", JSONArray(c.consents.toList())).put("ready", c.ready && AiSettings.hasKey(activity))
            .put("keyMasked", AiSettings.maskedKey(activity) ?: JSONObject.NULL)
            .put("online", activity.isOnline())
            .put(
                "providers",
                JSONArray().apply {
                    AiProvider.entries.forEach {
                        put(JSONObject().put("id", it.name).put("label", it.label).put("baseUrl", it.baseUrl).put("modelHint", it.modelHint))
                    }
                },
            )
            .toString()
    }

    /** {enabled, provider, baseUrl, model, apiKey?}: apiKey vazio mantém a atual; "clearKey": true remove. */
    @JavascriptInterface
    fun saveAiSettings(json: String): String = try {
        val o = JSONObject(json)
        val provider = runCatching { AiProvider.valueOf(o.optString("provider")) }.getOrDefault(AiProvider.CUSTOM)
        AiSettings.save(activity, o.optBoolean("enabled"), provider, o.optString("baseUrl"), o.optString("model"))
        if (o.optBoolean("clearKey")) AiSettings.setApiKey(activity, null)
        o.optString("apiKey").takeIf { it.isNotBlank() }?.let { AiSettings.setApiKey(activity, it) }
        "ok"
    } catch (e: Exception) {
        e.message ?: "erro"
    }

    /** [kind]: "dtc", "trip" ou "ask", depois de o usuário ver o texto e tocar em Enviar. */
    @JavascriptInterface
    fun setAiConsent(kind: String) = runCatching { AiSettings.addConsent(activity, kind) }.isSuccess

    private fun dtcMessages(json: String) =
        DtcPrompt.messages(DtcPrompt.Request.fromJson(Json.parseToJsonElement(json).jsonObject), activity.currentProfile().profile)

    /** Texto exato que "Explicar com IA" enviaria para [json] ({code, kind, rpm, speedKmh, engineLoadPct, coolantC}). */
    @JavascriptInterface
    fun aiPreviewDtc(requestId: String, json: String) = previewJson(requestId) { dtcMessages(json) }

    /** Assíncrono: a resposta chega em activity.window.onAiResult({id, ok, text | error}). */
    @JavascriptInterface
    fun aiExplainDtc(requestId: String, json: String) {
        val code = runCatching { DtcPrompt.Request.fromJson(Json.parseToJsonElement(json).jsonObject).code }.getOrNull()
        runAi(requestId, "dtc", saveAs = code?.let { "dtc" to it }) { dtcMessages(json) }
    }

    /** Última resposta guardada para (kind, ref): {text, createdAt, model} ou null. */
    @JavascriptInterface
    fun aiSavedAnswer(requestId: String, kind: String, ref: String) = activity.answerAsync(requestId) {
        AppDatabase.get(activity).aiAnswerDao().get(kind, ref)?.let {
            JSONObject().put("text", it.text).put("createdAt", it.createdAt).put("model", it.model ?: JSONObject.NULL).toString()
        } ?: "null"
    }

    @JavascriptInterface
    fun aiPreviewTrip(requestId: String, tripId: Long) = previewJson(requestId) { tripMessages(tripId) }

    @JavascriptInterface
    fun aiAnalyzeTrip(requestId: String, tripId: Long) = runAi(requestId, "trip", saveAs = "trip" to tripId.toString()) { tripMessages(tripId) }

    /** [historyJson]: [{role: user|assistant, content}] das perguntas anteriores nesta conversa. */
    @JavascriptInterface
    fun aiPreviewAsk(requestId: String, question: String, historyJson: String) = previewJson(requestId) { askMessages(question, historyJson) }

    @JavascriptInterface
    fun aiAsk(requestId: String, question: String, historyJson: String) =
        runAi(requestId, "ask") { askMessages(question, historyJson) }

    @JavascriptInterface
    fun aiTest(requestId: String) = runAi(requestId, null, maxTokens = 50) {
        listOf(AiClient.Message("user", "Responda apenas: Conexão OK"))
    }

    /**
     * Monta o pedido ([build], fora da thread principal) e consulta a IA. [consentKind]: o envio só
     * acontece depois de o usuário ter visto e aceitado o texto desse tipo ao menos uma vez.
     */
    private fun runAi(
        requestId: String,
        consentKind: String?,
        maxTokens: Int = AiClient.DEFAULT_MAX_TOKENS,
        /** Guarda a resposta (kind, ref) para rever sem consultar de novo. */
        saveAs: Pair<String, String>? = null,
        build: suspend () -> List<AiClient.Message>,
    ) {
        val c = AiSettings.config(activity)
        val key = AiSettings.apiKey(activity)
        when {
            !c.ready || key == null -> return pushAiResult(requestId, null, "Configure o assistente em Ajustes → Assistente IA")
            consentKind != null && consentKind !in c.consents -> return pushAiResult(requestId, null, "Confira o texto que será enviado e toque em Enviar")
            !activity.isOnline() -> return pushAiResult(requestId, null, "Sem internet: o assistente IA só funciona online")
        }
        activity.lifecycleScope.launch(Dispatchers.IO) {
            val result = runCatching { AiClient(c.baseUrl, key!!, c.model).chat(build(), maxTokens) }
            val text = result.getOrNull()
            if (text != null && saveAs != null) {
                runCatching {
                    AppDatabase.get(activity).aiAnswerDao()
                        .save(AiAnswerEntity(kind = saveAs.first, ref = saveAs.second, text = text, model = c.model, createdAt = System.currentTimeMillis()))
                }
            }
            pushAiResult(requestId, text, result.exceptionOrNull()?.message)
        }
    }

    /** Texto exato do pedido, montado em IO (a análise de viagem lê toda a telemetria dela). */
    private fun previewJson(requestId: String, build: suspend () -> List<AiClient.Message>) = activity.answerAsync(requestId) {
        try {
            val m = build()
            JSONObject().put("ok", true).put("text", m.joinToString("\n\n") { "[${it.role}]\n${it.content}" }).toString()
        } catch (e: Exception) {
            JSONObject().put("ok", false).put("error", e.message ?: "erro").toString()
        }
    }

    private fun ethanolNow(p: VehicleProfile) = AppSettings.ethanolPercent(activity, p.fuel?.defaultEthanolPct ?: 0.0)

    private suspend fun tripMessages(tripId: Long): List<AiClient.Message> {
        val dao = AppDatabase.get(activity).tripDao()
        val trip = dao.getTrip(tripId) ?: throw IllegalArgumentException("Viagem não encontrada")
        val p = activity.currentProfile().profile
        val digest = TripDigest.compute(trip, dao.telemetryForTrip(tripId), p, dao.dtcsForTrip(tripId).map { it.code })
        if (digest.distanceKm < 0.5) throw IllegalArgumentException("Viagem curta demais para analisar")
        return TripDigest.messages(digest, p, ethanolNow(p))
    }

    private suspend fun askMessages(question: String, historyJson: String): List<AiClient.Message> {
        val db = AppDatabase.get(activity)
        val p = activity.currentProfile().profile
        val context = HistoryContext.text(
            p, db.tripDao().recentTrips(MainActivity.MAX_TRIPS_FOR_TOTALS), db.fuelUpDao().all(), db.tripDao().recentDtcs(200),
            ethanolNow(p), activity.currentFuelLevel(), activity.totalKm.takeIf { AppSettings.odometerRef(activity) != null },
        )
        val arr = runCatching { JSONArray(historyJson) }.getOrDefault(JSONArray())
        val turns = (0 until arr.length()).mapNotNull { i ->
            arr.optJSONObject(i)?.let { HistoryContext.Turn(it.optString("role"), it.optString("content")) }
        }
        return HistoryContext.messages(context, turns, question)
    }

    private fun pushAiResult(requestId: String, text: String?, error: String?) {
        val o = JSONObject().put("id", requestId).put("ok", text != null)
        if (text != null) o.put("text", text) else o.put("error", error ?: "erro")
        activity.pushJs("activity.window.onAiResult && activity.window.onAiResult($o)")
    }
}

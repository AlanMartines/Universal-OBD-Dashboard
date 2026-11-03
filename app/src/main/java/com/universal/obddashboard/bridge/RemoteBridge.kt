package com.universal.obddashboard.bridge

import android.webkit.JavascriptInterface
import com.universal.obddashboard.BuildConfig
import com.universal.obddashboard.MainActivity
import com.universal.obddashboard.Vehicles
import com.universal.obddashboard.db.AppDatabase
import com.universal.obddashboard.remote.RemoteClient
import com.universal.obddashboard.remote.RemoteSettings
import com.universal.obddashboard.remote.RemoteSync
import com.universal.obddashboard.remote.RemoteUploader
import org.json.JSONObject
import java.io.IOException

/** Ponte JavaScript "AndroidRemote": pareamento e envio da telemetria ao servidor da pessoa. */
class RemoteBridge(private val activity: MainActivity) {

    @JavascriptInterface
    fun getRemoteStatus(requestId: String) = activity.answerAsync(requestId) {
        val paired = RemoteSettings.token(activity) != null
        val dao = AppDatabase.get(activity).tripDao()
        JSONObject()
            .put("paired", paired)
            .put("enabled", RemoteSettings.enabled(activity))
            .put("sendGps", RemoteSettings.sendGps(activity))
            .put("baseUrl", RemoteSettings.baseUrl(activity))
            .put("deviceName", RemoteSettings.deviceName(activity))
            .put("installationId", RemoteSettings.installationId(activity))
            .put("pending", if (paired) dao.countTelemetryAfter(RemoteSettings.cursor(activity), Vehicles.selectedId(activity)) else 0)
            .put("vehicleName", Vehicles.selected(activity).name)
            .put("lastSentAt", RemoteSettings.lastSentAt(activity))
            .put("lastError", RemoteSettings.lastError(activity))
            .toString()
    }

    /** {baseUrl, code} → {ok} ou {ok: false, error}. */
    @JavascriptInterface
    fun remotePair(requestId: String, json: String) = activity.answerAsync(requestId) {
        try {
            val o = JSONObject(json)
            val url = RemoteClient.normalizeUrl(o.optString("baseUrl"))
            if (!activity.isOnline()) throw IllegalStateException("Sem internet: conecte para parear.")
            val pairing = RemoteClient(url).pair(o.optString("code"), RemoteSettings.installationId(activity), BuildConfig.VERSION_NAME)
            val cursor = AppDatabase.get(activity).tripDao().maxTelemetryId() ?: 0L
            RemoteSettings.savePairing(activity, url, pairing.deviceName, pairing.token, cursor)
            JSONObject().put("ok", true).toString()
        } catch (_: IOException) {
            JSONObject().put("ok", false).put("error", "Não foi possível falar com o servidor. Confira o endereço e a internet.").toString()
        } catch (e: Exception) {
            JSONObject().put("ok", false).put("error", e.message ?: "erro").toString()
        }
    }

    /** {enabled, sendGps} */
    @JavascriptInterface
    fun remoteSave(json: String): String = try {
        val o = JSONObject(json)
        RemoteSettings.setEnabled(activity, o.optBoolean("enabled") && RemoteSettings.token(activity) != null)
        RemoteSettings.setSendGps(activity, o.optBoolean("sendGps"))
        "ok"
    } catch (e: Exception) {
        e.message ?: "erro"
    }

    @JavascriptInterface
    fun remoteSendNow(requestId: String) = activity.answerAsync(requestId) {
        val r = RemoteSync.drain(activity)
        val text = when (r?.outcome) {
            null -> "O envio está desligado."
            RemoteUploader.Outcome.IDLE -> "Nada pendente."
            RemoteUploader.Outcome.SENT -> "${r.sent} leituras enviadas."
            RemoteUploader.Outcome.RETRY -> "Sem conexão com o servidor. ${r.sent} leituras enviadas antes da falha."
            RemoteUploader.Outcome.REVOKED -> "Este veículo foi revogado no painel."
        }
        JSONObject().put("ok", true).put("message", text).toString()
    }

    @JavascriptInterface
    fun remoteUnpair(): String {
        RemoteSettings.clearPairing(activity)
        return "ok"
    }
}

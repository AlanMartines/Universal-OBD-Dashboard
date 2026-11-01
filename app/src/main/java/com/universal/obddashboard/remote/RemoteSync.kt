package com.universal.obddashboard.remote

import android.content.Context
import android.util.Log
import com.universal.obddashboard.db.AppDatabase
import com.universal.obddashboard.db.TelemetryLogEntity
import com.universal.obddashboard.telemetry.TelemetryHub
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock

/** Liga o envio às configurações e ao banco do aparelho. Serviço e tela usam o mesmo caminho. */
object RemoteSync {
    private const val TAG = "RemoteSync"
    private val lock = Mutex()

    suspend fun drain(context: Context): RemoteUploader.Result? = lock.withLock {
        val c = context.applicationContext
        if (!RemoteSettings.enabled(c)) return@withLock null
        val token = RemoteSettings.token(c) ?: return@withLock null
        val client = RemoteClient(RemoteSettings.baseUrl(c))
        val dao = AppDatabase.get(c).tripDao()
        val source = object : RemoteUploader.Source {
            override suspend fun samplesAfter(id: Long, limit: Int): List<TelemetryLogEntity> = dao.telemetryAfter(id, limit)
            override suspend fun maxId(): Long = dao.maxTelemetryId() ?: 0L
            override var cursor: Long
                get() = RemoteSettings.cursor(c)
                set(value) = RemoteSettings.setCursor(c, value)
            override val sendGps: Boolean get() = RemoteSettings.sendGps(c)
            override fun currentDtcs(): List<String> = TelemetryHub.state.value.confirmedDtcs
        }
        val result = RemoteUploader(source) { body -> client.upload(token, body) }.drain()
        when (result.outcome) {
            RemoteUploader.Outcome.REVOKED -> {
                Log.w(TAG, "Dispositivo revogado no servidor")
                RemoteSettings.clearPairing(c, "Este celular foi revogado no painel. Pareie de novo para voltar a enviar.")
            }
            RemoteUploader.Outcome.RETRY -> RemoteSettings.recordResult(c, result.sent > 0, "Sem conexão com o servidor. Os dados ficam guardados e sobem depois.")
            else -> RemoteSettings.recordResult(c, result.sent > 0, null)
        }
        result
    }
}

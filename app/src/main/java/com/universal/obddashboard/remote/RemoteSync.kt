package com.universal.obddashboard.remote

import android.content.Context
import com.universal.obddashboard.Vehicles
import android.util.Log
import com.universal.obddashboard.db.AppDatabase
import com.universal.obddashboard.db.TelemetryLogEntity
import com.universal.obddashboard.telemetry.TelemetryHub
import kotlinx.coroutines.launch
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock

/** Liga o envio às configurações e ao banco do aparelho. Serviço e tela usam o mesmo caminho. */
object RemoteSync {
    private const val TAG = "RemoteSync"
    private val lock = Mutex()

    /** Envia o que falta de todos os veículos pareados. Devolve o resultado do veículo selecionado. */
    suspend fun drain(context: Context): RemoteUploader.Result? = lock.withLock {
        val c = context.applicationContext
        val selected = Vehicles.selectedId(c)
        var mine: RemoteUploader.Result? = null
        for (v in Vehicles.all(c)) {
            val r = drainVehicle(c, v.id, current = v.id == selected)
            if (v.id == selected) mine = r
        }
        mine
    }

    /** Lista de abastecimentos do veículo, enviada quando muda. Falha aqui não atrapalha a telemetria. */
    private suspend fun syncFuelUps(c: Context, v: String, client: RemoteClient, token: String) {
        val body = RemotePayload.fuelUps(AppDatabase.get(c).fuelUpDao().all(v))
        val hash = sha256(body)
        if (hash == RemoteSettings.fuelSentHash(c, v)) return
        try {
            val code = client.uploadFuelUps(token, body)
            if (code in 200..299) RemoteSettings.setFuelSentHash(c, hash, v) else Log.w(TAG, "Abastecimentos recusados: $code")
        } catch (e: java.io.IOException) {
            Log.i(TAG, "Abastecimentos ficam para o próximo envio: ${e.message}")
        }
    }

    private fun sha256(text: String): String =
        java.security.MessageDigest.getInstance("SHA-256").digest(text.toByteArray(Charsets.UTF_8)).joinToString("") { "%02x".format(it) }

    /** Abastecimento mudou: tenta enviar já, sem esperar a próxima captura. */
    fun syncSoon(context: Context) {
        val c = context.applicationContext
        if (!RemoteSettings.enabled(c) || RemoteSettings.token(c) == null) return
        scope.launch { runCatching { drain(c) } }
    }

    private val scope = kotlinx.coroutines.CoroutineScope(kotlinx.coroutines.SupervisorJob() + kotlinx.coroutines.Dispatchers.IO)

    private suspend fun drainVehicle(c: Context, v: String, current: Boolean): RemoteUploader.Result? {
        if (!RemoteSettings.enabled(c, v)) return null
        val token = RemoteSettings.token(c, v) ?: return null
        val client = RemoteClient(RemoteSettings.baseUrl(c))
        val dao = AppDatabase.get(c).tripDao()
        val source = object : RemoteUploader.Source {
            override suspend fun samplesAfter(id: Long, limit: Int): List<TelemetryLogEntity> = dao.telemetryAfter(id, v, limit)
            override suspend fun maxId(): Long = dao.maxTelemetryId() ?: 0L
            override var cursor: Long
                get() = RemoteSettings.cursor(c, v)
                set(value) = RemoteSettings.setCursor(c, value, v)
            override val sendGps: Boolean get() = RemoteSettings.sendGps(c, v)
            override fun currentDtcs(): List<String> = if (current) TelemetryHub.state.value.confirmedDtcs else emptyList()
        }
        val result = RemoteUploader(source) { body -> client.upload(token, body) }.drain()
        if (result.outcome != RemoteUploader.Outcome.REVOKED) syncFuelUps(c, v, client, token)
        when (result.outcome) {
            RemoteUploader.Outcome.REVOKED -> {
                Log.w(TAG, "Dispositivo revogado no servidor")
                RemoteSettings.clearPairing(c, "Este veículo foi revogado no painel. Pareie de novo para voltar a enviar.", v)
            }
            RemoteUploader.Outcome.RETRY -> RemoteSettings.recordResult(c, result.sent > 0, "Sem conexão com o servidor. Os dados ficam guardados e sobem depois.", v)
            else -> RemoteSettings.recordResult(c, result.sent > 0, null, v)
        }
        return result
    }
}

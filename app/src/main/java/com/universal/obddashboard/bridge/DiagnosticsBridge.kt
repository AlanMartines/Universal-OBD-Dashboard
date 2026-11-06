package com.universal.obddashboard.bridge

import android.webkit.JavascriptInterface
import com.universal.obddashboard.AppSettings
import com.universal.obddashboard.MainActivity
import com.universal.obddashboard.service.ObdForegroundService
import com.universal.obddashboard.can.CanListenLink
import com.universal.obddashboard.backup.BackupManager
import com.universal.obddashboard.diagnostics.CanListener
import com.universal.obddashboard.diagnostics.ConsoleSession
import com.universal.obddashboard.diagnostics.DiagnosticFiles
import com.universal.obddashboard.diagnostics.FaultScan
import com.universal.obddashboard.obd.BluetoothSerialManager
import com.universal.obddashboard.obd.DtcKind
import com.universal.obddashboard.export.TripExportFiles
import kotlinx.coroutines.launch
import org.json.JSONArray
import org.json.JSONObject

/**
 * Ponte JavaScript "AndroidDiag": gravação de diagnóstico, console da rede e backup completo.
 * Registrada pela [MainActivity]; na tela, `bridge.x()` encontra o método no objeto certo.
 */
class DiagnosticsBridge(private val activity: MainActivity) {

    @JavascriptInterface
    fun getDiagnostics(): String = JSONObject()
        .put("enabled", AppSettings.diagnosticRecording(activity))
        .put(
            "files",
            JSONArray().apply {
                DiagnosticFiles.list(activity).forEach {
                    put(
                        JSONObject().put("name", it.name).put("size", it.sizeBytes)
                            .put("modified", it.modifiedAt).put("active", it.active),
                    )
                }
            },
        )
        .toString()

    @JavascriptInterface
    fun setDiagnosticRecording(enabled: Boolean) = AppSettings.setDiagnosticRecording(activity, enabled)

    /**
     * Aba Falhas → "Ler falhas agora": {ok, viaCapture, milOn, storedCount, confirmed, pending, permanent,
     * freezeCode} ou {ok: false, error}. Uma lista null quer dizer que a injeção não respondeu àquele modo.
     */
    /**
     * Sem captura, a leitura conecta ao adaptador: só faz sentido com Bluetooth ligado e o adaptador
     * do veículo pareado. {ready, reason}. Com captura, quem decide é o estado da conexão (na tela).
     */
    @JavascriptInterface
    fun faultScanReadiness(): String {
        val serial = BluetoothSerialManager(activity)
        val names = runCatching { AppSettings.adapterNames(activity, activity.currentProfile().profile.adapter.deviceNames) }.getOrDefault(emptyList())
        val reason = when {
            ConsoleSession.isActive -> "Feche o console para ler as falhas."
            FaultScan.isActive -> "Leitura em andamento."
            !serial.hasConnectPermission() -> "Permita o Bluetooth para o app."
            !serial.isBluetoothOn() -> "Ligue o Bluetooth do celular."
            serial.findBondedDevice(names) == null -> "Pareie o adaptador OBD deste veículo no Bluetooth."
            else -> null
        }
        return JSONObject().put("ready", reason == null).put("reason", reason ?: "Com a ignição ligada, o app conecta, lê e desconecta.").toString()
    }

    /**
     * Ajustes → Escuta CAN → Testar: conecta ao ESP32 por [seconds] e devolve os últimos valores de cada
     * sinal do perfil. Só lê. Com captura em andamento o adaptador já está em uso por ela.
     */
    @JavascriptInterface
    fun testCanListen(requestId: String, seconds: Int) = activity.answerAsync(requestId) {
        val loaded = activity.currentProfile()
        val names = AppSettings.canAdapterNames(activity)
        when {
            ObdForegroundService.isRunning -> JSONObject().put("ok", false).put("error", "Durante a captura, veja os valores em Sensores.").toString()
            loaded.canSignals.isEmpty() -> JSONObject().put("ok", false).put("error", "O perfil deste veículo não tem sinais CAN mapeados.").toString()
            names.isEmpty() -> JSONObject().put("ok", false).put("error", "Escolha o adaptador de escuta e salve.").toString()
            else -> {
                val latest = java.util.concurrent.ConcurrentHashMap<String, Double>()
                var status = ""
                val link = CanListenLink(activity, loaded.canSignals, { v, _ -> latest.putAll(v) }, { status = it })
                link.run(names, seconds.coerceIn(5, 60) * 1000L)
                val values = JSONArray()
                loaded.canSignals.forEach { s ->
                    values.put(
                        JSONObject().put("id", s.def.id).put("name", s.def.name).put("unit", s.def.unit)
                            .put("decimals", s.def.decimals).put("value", latest[s.def.id] ?: JSONObject.NULL),
                    )
                }
                JSONObject().put("ok", link.frames > 0).put("frames", link.frames).put("values", values)
                    .put("error", if (link.frames > 0) JSONObject.NULL else status.ifEmpty { "Nenhum quadro recebido. Confira se a ignição está ligada." })
                    .toString()
            }
        }
    }

    @JavascriptInterface
    fun scanFaults(requestId: String) = activity.answerAsync(requestId) {
        try {
            val o = FaultScan.run(activity)
            fun list(kind: DtcKind): Any = o.scan.codes[kind]?.let { JSONArray(it) } ?: JSONObject.NULL
            JSONObject().put("ok", true).put("viaCapture", o.viaCapture)
                .put("milOn", o.scan.milOn ?: JSONObject.NULL).put("storedCount", o.scan.storedCount ?: JSONObject.NULL)
                .put("confirmed", list(DtcKind.CONFIRMED)).put("pending", list(DtcKind.PENDING)).put("permanent", list(DtcKind.PERMANENT))
                .put("freezeCode", o.scan.freezeFrame?.code ?: JSONObject.NULL)
                .toString()
        } catch (e: FaultScan.ScanException) {
            JSONObject().put("ok", false).put("error", e.message).toString()
        }
    }

    @JavascriptInterface
    fun exportDiagnostic(name: String): String = try {
        val file = DiagnosticFiles.exportGzip(activity, name)
        activity.runOnUiThread { activity.startActivity(TripExportFiles.shareIntent(activity, file, "application/gzip")) }
        "ok"
    } catch (e: DiagnosticFiles.DiagnosticFileException) {
        e.message ?: "erro"
    } catch (e: Exception) {
        "Falha ao exportar: ${e.message}"
    }

    @JavascriptInterface
    fun deleteDiagnostic(name: String): String = try {
        DiagnosticFiles.delete(activity, name)
        "ok"
    } catch (e: Exception) {
        e.message ?: "erro"
    }

    /** Últimas linhas (JSON Lines) de um arquivo de diagnóstico, para rever no console. */
    @JavascriptInterface
    fun readDiagnostic(name: String): String = try {
        JSONObject().put("lines", JSONArray(DiagnosticFiles.tail(activity, name, MainActivity.CONSOLE_REVIEW_LINES))).toString()
    } catch (e: Exception) {
        JSONObject().put("error", e.message ?: "erro").toString()
    }

    /** [baud]: nome de [CanListener.Baud] ou "auto". Retorna "ok" ou o motivo de não começar. */
    @JavascriptInterface
    fun consoleStart(baud: String): String =
        ConsoleSession.start(activity, CanListener.Baud.entries.firstOrNull { it.name == baud }) ?: "ok"

    /** Identificar adaptador: só comandos AT internos (ATI, AT@1, ATPPS...), nada para o carro. */
    @JavascriptInterface
    fun consoleIdentify(): String = ConsoleSession.start(activity, null, ConsoleSession.Mode.IDENTIFY) ?: "ok"

    @JavascriptInterface
    fun consoleStop() = ConsoleSession.stop()

    @JavascriptInterface
    fun consolePoll(since: Long): String = ConsoleSession.poll(since).let { s ->
        JSONObject().put("running", s.running).put("seq", s.seq).put("file", s.file ?: JSONObject.NULL)
            .put("lines", JSONArray(s.lines)).toString()
    }

    @JavascriptInterface
    fun exportBackup(webSettings: String?): String = try {
        val file = BackupManager.export(activity, webSettings)
        activity.runOnUiThread { activity.startActivity(TripExportFiles.shareIntent(activity, file, "application/zip")) }
        "ok"
    } catch (e: Exception) {
        "Falha ao gerar o backup: ${e.message}"
    }

    @JavascriptInterface
    fun pickBackup() = activity.runOnUiThread { activity.backupPicker.launch(arrayOf("application/zip", "application/x-zip-compressed", "application/octet-stream")) }
}

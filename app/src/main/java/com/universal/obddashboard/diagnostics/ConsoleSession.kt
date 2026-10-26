package com.universal.obddashboard.diagnostics

import android.content.Context
import android.os.Build
import com.universal.obddashboard.AppSettings
import com.universal.obddashboard.BuildConfig
import com.universal.obddashboard.obd.BluetoothSerialManager
import com.universal.obddashboard.obd.ProfileParser
import com.universal.obddashboard.service.ObdForegroundService
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.launch
import kotlinx.serialization.json.put

/**
 * Console de diagnóstico (Ajustes → Console da rede): uma escuta passiva de [CanListener] por vez,
 * com conexão Bluetooth própria. Cada execução vira um arquivo diag_<data>_console-escuta.jsonl,
 * listado, exportado e apagado como os demais arquivos de diagnóstico.
 *
 * As linhas ficam num buffer com número de sequência; a tela busca as novas a cada poucos
 * centésimos ([poll]), então sair e voltar para a tela não perde nada.
 */
object ConsoleSession {

    const val FILE_TAG = "console-escuta"
    const val FILE_TAG_IDENTIFY = "console-identificar"

    enum class Mode { LISTEN, IDENTIFY }
    private const val MAX_LINES = 2000

    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    private val lock = Any()
    private val lines = ArrayDeque<String>()
    private var seq = 0L
    private var job: Job? = null

    /** Enquanto true, o gatilho automático por Bluetooth não inicia a captura (o adaptador é do console). */
    @Volatile var isActive = false
        private set

    @Volatile var activeFile: String? = null
        private set

    class Snapshot(val running: Boolean, val seq: Long, val lines: List<String>, val file: String?)

    /** @return null se começou, ou o motivo de não poder começar. */
    fun start(context: Context, baud: CanListener.Baud?, mode: Mode = Mode.LISTEN): String? {
        val app = context.applicationContext
        synchronized(lock) {
            if (isActive) return "O console já está escutando"
            if (ObdForegroundService.isRunning) return "Encerre a captura antes de usar o console: o adaptador só atende um de cada vez"
            isActive = true
            lines.clear()
        }
        job = scope.launch { run(app, baud, mode) }
        return null
    }

    fun stop() {
        job?.cancel()
    }

    /** Linhas com sequência maior que [since] (no máximo as últimas [MAX_LINES]). */
    fun poll(since: Long): Snapshot = synchronized(lock) {
        val first = seq - lines.size + 1
        val from = maxOf(since + 1, first)
        Snapshot(isActive, seq, lines.drop((from - first).toInt()), activeFile)
    }

    private fun out(line: String) = synchronized(lock) {
        lines.addLast(line)
        if (lines.size > MAX_LINES) lines.removeFirst()
        seq++
    }

    private suspend fun run(context: Context, baud: CanListener.Baud?, mode: Mode) {
        val serial = BluetoothSerialManager(context)
        var recorder: DiagnosticRecorder? = null
        try {
            if (!serial.hasConnectPermission()) {
                out("! Sem permissão de Bluetooth")
                return
            }
            val defaults = runCatching { ProfileParser.loadSelected(context).profile.adapter.deviceNames }.getOrDefault(emptyList())
            val names = AppSettings.adapterNames(context, defaults)
            val device = serial.findBondedDevice(names)
            if (device == null) {
                out("! Adaptador não pareado (${names.joinToString()})")
                return
            }
            val dir = ObdForegroundService.diagnosticsDir(context)
            val rec = DiagnosticRecorder(DiagnosticRecorder.newFile(dir, if (mode == Mode.IDENTIFY) FILE_TAG_IDENTIFY else FILE_TAG))
            recorder = rec
            activeFile = rec.file.name
            rec.event("session") {
                put("mode", if (mode == Mode.IDENTIFY) "adapter_identify" else "can_listen")
                put("baud_requested", baud?.name ?: "auto")
                put("app_version", BuildConfig.VERSION_NAME)
                put("app_build", BuildConfig.VERSION_CODE)
                put("device", "${Build.MANUFACTURER} ${Build.MODEL}")
                put("adapter", device.address)
            }
            out("# Conectando a ${names.first()}…")
            serial.connect(device)
            if (mode == Mode.IDENTIFY) {
                out("# Conectado. Só comandos internos do adaptador: nada é enviado ao carro.")
                AdapterIdentify(serial, rec, ::out).run()
            } else {
                out("# Conectado. Modo somente escuta: nada é enviado ao carro.")
                CanListener(serial, rec, ::out).run(baud)
            }
            out("# Fim. Gravado em ${rec.file.name}")
        } catch (e: CancellationException) {
            out("# Interrompido")
            recorder?.event("can_listen") { put("phase", "cancelled") }
            throw e
        } catch (e: CanListener.NotSilentException) {
            out("! ${e.message}")
        } catch (e: Exception) {
            out("! Falha: ${e.message ?: e}")
            recorder?.error("console", e)
        } finally {
            serial.close()
            recorder?.close()
            activeFile = null
            isActive = false
        }
    }
}

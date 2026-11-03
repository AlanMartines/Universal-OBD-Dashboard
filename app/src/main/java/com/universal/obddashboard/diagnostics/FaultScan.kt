package com.universal.obddashboard.diagnostics

import android.content.Context
import com.universal.obddashboard.AppSettings
import com.universal.obddashboard.Vehicles
import com.universal.obddashboard.db.AppDatabase
import com.universal.obddashboard.db.DiagnosticTroubleCodeEntity
import com.universal.obddashboard.obd.BluetoothSerialManager
import com.universal.obddashboard.obd.CommandQueue
import com.universal.obddashboard.obd.DtcKind
import com.universal.obddashboard.obd.ProfileParser
import com.universal.obddashboard.service.ObdForegroundService
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import kotlinx.serialization.json.putJsonObject

/**
 * "Ler falhas agora" (aba Falhas). Com captura, pede a leitura a ela; sem captura, conecta ao
 * adaptador só para isso e desconecta. Só consulta: nenhum comando apaga falhas ou escreve na ECU.
 */
object FaultScan {
    /** Enquanto true, o gatilho automático não inicia a captura: o adaptador está ocupado. */
    @Volatile var isActive = false
        private set

    class Outcome(val scan: CommandQueue.DtcScan, val viaCapture: Boolean)

    class ScanException(message: String) : Exception(message)

    private val noop = object : CommandQueue.Listener {
        override fun onValues(values: Map<String, Double>, timestamp: Long) {}
        override fun onDtcs(kind: DtcKind, codes: List<String>, timestamp: Long) {}
    }

    /** Falhas lidas sem captura entram no histórico do veículo; a mesma falha não se repete em 12 h. */
    private const val REPEAT_WINDOW_MS = 12 * 60 * 60 * 1000L

    @Throws(ScanException::class)
    suspend fun run(context: Context): Outcome {
        val app = context.applicationContext
        if (ObdForegroundService.isRunning) {
            val scan = ObdForegroundService.scanFaultsLive()
                ?: throw ScanException("A captura ainda não conectou à injeção. Tente de novo em alguns segundos.")
            return Outcome(scan, viaCapture = true)
        }
        synchronized(this) {
            if (isActive) throw ScanException("Já há uma leitura em andamento.")
            if (ConsoleSession.isActive) throw ScanException("Feche o console antes de ler as falhas.")
            isActive = true
        }
        val serial = BluetoothSerialManager(app)
        try {
            if (!serial.hasConnectPermission()) throw ScanException("Sem permissão de Bluetooth.")
            val loaded = ProfileParser.loadSelected(app)
            val names = AppSettings.adapterNames(app, loaded.profile.adapter.deviceNames)
            val device = serial.findBondedDevice(names) ?: throw ScanException("Adaptador não pareado (${names.joinToString()}).")
            try {
                serial.connect(device)
                val queue = CommandQueue(serial, loaded, noop)
                queue.initialize()
                val scan = queue.scanDtcs()
                save(app, scan)
                return Outcome(scan, viaCapture = false)
            } catch (e: ScanException) {
                throw e
            } catch (e: Exception) {
                throw ScanException("Não foi possível ler a injeção: ${e.message ?: "sem resposta"}. Confira se a ignição está ligada.")
            }
        } finally {
            serial.close()
            isActive = false
        }
    }

    private suspend fun save(context: Context, scan: CommandQueue.DtcScan) {
        val dao = AppDatabase.get(context).tripDao()
        val vehicleId = Vehicles.selectedId(context)
        val now = System.currentTimeMillis()
        val frameJson = scan.freezeFrame?.let { ff ->
            buildJsonObject {
                put("code", ff.code)
                putJsonObject("values") { ff.values.forEach { (k, v) -> put(k, v) } }
            }.toString()
        }
        scan.codes.forEach { (kind, codes) ->
            codes.orEmpty().forEach { code ->
                if (dao.countRecentDtc(code, kind.name, vehicleId, now - REPEAT_WINDOW_MS) == 0) {
                    dao.insertDtc(
                        DiagnosticTroubleCodeEntity(
                            vehicleId = vehicleId, tripId = null, code = code, kind = kind.name, detectedAt = now,
                            milOn = scan.milOn, ecuFreezeJson = frameJson?.takeIf { scan.freezeFrame?.code == code },
                        ),
                    )
                }
            }
        }
    }
}

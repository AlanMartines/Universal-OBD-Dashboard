package com.universal.obddashboard.can

import android.content.Context
import android.util.Log
import com.universal.obddashboard.obd.BluetoothSerialManager
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.delay
import kotlinx.coroutines.withTimeoutOrNull
import java.io.IOException

/**
 * Conexão com o adaptador de escuta CAN (ESP32 com o firmware esp32-can-listen). O app só lê: nenhum
 * byte é enviado ao adaptador, e o firmware também ignora o que recebe.
 */
class CanListenLink(
    private val context: Context,
    private val signals: List<CompiledCanSignal>,
    private val onValues: (Map<String, Double>, Long) -> Unit,
    private val onStatus: (String) -> Unit = {},
) {
    private val decoder = CanDecoder(signals)

    @Volatile var frames = 0L
        private set
    @Volatile var decoded = 0L
        private set

    private fun handle(line: String) {
        val frame = Slcan.parse(line) ?: return
        frames++
        val values = decoder.decode(frame)
        if (values.isNotEmpty()) {
            decoded++
            onValues(values, System.currentTimeMillis())
        }
    }

    /** Conecta e lê até [durationMs] (null = até cancelar), reconectando se o link cair. */
    suspend fun run(names: List<String>, durationMs: Long? = null) {
        val serial = BluetoothSerialManager(context)
        try {
            if (durationMs == null) loop(serial, names) else withTimeoutOrNull(durationMs) { loop(serial, names) }
        } finally {
            serial.close()
        }
    }

    private suspend fun loop(serial: BluetoothSerialManager, names: List<String>) {
        var waitMs = RETRY_MIN_MS
        while (true) {
            if (!serial.hasConnectPermission()) { onStatus("Sem permissão de Bluetooth"); return }
            val device = serial.findBondedDevice(names)
            if (device == null) { onStatus("Adaptador de escuta não pareado"); return }
            try {
                onStatus("Conectando à escuta CAN…")
                serial.connect(device)
                onStatus("Escuta CAN conectada")
                waitMs = RETRY_MIN_MS
                serial.listenLines(::handle)
            } catch (e: CancellationException) {
                throw e
            } catch (e: IOException) {
                Log.i(TAG, "Escuta CAN: ${e.message}")
                onStatus("Escuta CAN sem conexão; tentando de novo")
            } finally {
                serial.close()
            }
            delay(waitMs)
            waitMs = (waitMs * 2).coerceAtMost(RETRY_MAX_MS)
        }
    }

    private companion object {
        const val TAG = "CanListen"
        const val RETRY_MIN_MS = 5_000L
        const val RETRY_MAX_MS = 60_000L
    }
}

/**
 * Nível do tanque pela rede CAN: andando, o valor balança com curvas e inclinação. Só vale a média
 * de leituras com o carro parado há [STILL_MS], e só muda a estimativa se diferir mais que [MIN_CHANGE_L].
 */
class TankAnchor(private val capacityL: Double) {
    private val window = ArrayDeque<Double>()
    private var stillSince: Long? = null

    /** @return novo nível em litros para a estimativa, ou null se ainda não há medida firme. */
    fun onReading(pct: Double, speedKmh: Double?, now: Long, currentEstimateL: Double?): Double? {
        if (speedKmh == null || speedKmh >= 1) {
            stillSince = null
            window.clear()
            return null
        }
        if (stillSince == null) stillSince = now
        window.addLast(pct)
        if (window.size > MAX_SAMPLES) window.removeFirst()
        if (now - stillSince!! < STILL_MS || window.size < MIN_SAMPLES) return null
        val liters = window.sorted()[window.size / 2] / 100 * capacityL
        return if (currentEstimateL == null || kotlin.math.abs(liters - currentEstimateL) > MIN_CHANGE_L) liters else null
    }

    private companion object {
        const val STILL_MS = 10_000L
        const val MIN_SAMPLES = 5
        const val MAX_SAMPLES = 60
        const val MIN_CHANGE_L = 1.0
    }
}

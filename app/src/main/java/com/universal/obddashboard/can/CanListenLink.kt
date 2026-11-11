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
    /** Cada linha recebida, como chegou (gravação de diagnóstico). */
    private val onRaw: ((String) -> Unit)? = null,
    /** Estado da conexão: [LINK_CONNECTING], [LINK_CONNECTED] ou [LINK_LOST]. */
    private val onLink: (String) -> Unit = {},
    /** Estado do adaptador (versão, sensores, contadores), a cada linha "# ..." que muda algo. */
    private val onInfo: (Esp32Info) -> Unit = {},
) {
    @Volatile var info = Esp32Info()
        private set

    private val decoder = CanDecoder(signals)

    @Volatile var frames = 0L
        private set
    @Volatile var decoded = 0L
        private set

    /** Conexão em uso: [close] a derruba na hora, sem esperar o cancelamento chegar à leitura. */
    @Volatile private var activeSerial: BluetoothSerialManager? = null

    /** Fecha a conexão com o ESP32 agora (ao encerrar a captura). O laço termina pelo cancelamento. */
    fun close() {
        activeSerial?.close()
    }

    private fun handle(line: String) {
        onRaw?.invoke(line)
        if (line.startsWith("#")) Esp32Info.apply(info, line, System.currentTimeMillis(), frames)?.let { info = it; onInfo(it); return }
        Slcan.parseAmbient(line)?.let { onValues(it, System.currentTimeMillis()); return }
        Slcan.parseImu(line)?.let { onValues(it, System.currentTimeMillis()); return }
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
        activeSerial = serial
        try {
            if (durationMs == null) loop(serial, names) else withTimeoutOrNull(durationMs) { loop(serial, names) }
        } finally {
            activeSerial = null
            serial.close()
        }
    }

    private suspend fun loop(serial: BluetoothSerialManager, names: List<String>) {
        var waitMs = RETRY_MIN_MS
        while (true) {
            if (!serial.hasConnectPermission()) { onStatus("Sem permissão de Bluetooth"); onLink(LINK_LOST); return }
            val device = serial.findBondedDevice(names)
            if (device == null) { onStatus("Adaptador de escuta não pareado"); onLink(LINK_LOST); return }
            try {
                onStatus("Conectando à escuta CAN…")
                onLink(LINK_CONNECTING)
                serial.connect(device)
                onStatus("Escuta CAN conectada")
                onLink(LINK_CONNECTED)
                waitMs = RETRY_MIN_MS
                serial.listenLines(::handle)
            } catch (e: CancellationException) {
                throw e
            } catch (e: IOException) {
                Log.i(TAG, "Escuta CAN: ${e.message}")
                onStatus("Escuta CAN sem conexão; tentando de novo")
                onLink(LINK_LOST)
            } finally {
                serial.close()
            }
            delay(waitMs)
            waitMs = (waitMs * 2).coerceAtMost(RETRY_MAX_MS)
        }
    }

    companion object {
        const val LINK_CONNECTING = "connecting"
        const val LINK_CONNECTED = "connected"
        const val LINK_LOST = "lost"
        private const val TAG = "CanListen"
        private const val RETRY_MIN_MS = 5_000L
        private const val RETRY_MAX_MS = 60_000L
    }
}

/**
 * Nível do tanque pela rede CAN: andando, o valor balança com curvas e inclinação. Só vale a média
 * de leituras com o carro parado há [STILL_MS], e só muda a estimativa se diferir mais que [MIN_CHANGE_L].
 *
 * O valor da rede é o do ponteiro do painel, amortecido: depois de abastecer ele só sobe com o motor
 * ligado, e devagar (no Uno, ~40 min de motor para ir de 17% a 97%). Por isso:
 * - subindo há menos de [SETTLE_MS], o ponteiro ainda está alcançando o tanque: só puxa a estimativa para cima;
 * - depois de um nível informado pela pessoa (abastecimento ou ajuste, [manualAt]), o ponteiro atrasado
 *   não baixa a estimativa até alcançá-la (ou por até [HOLD_MS], caso o registro estivesse errado).
 */
class TankAnchor(private val capacityL: Double) {
    private val window = ArrayDeque<Double>()
    private var stillSince: Long? = null
    private var lastPct: Double? = null
    private var lastRiseAt: Long? = null
    /** Nível informado cujo ponteiro já alcançou: a partir daí volta a valer o painel. */
    private var caughtUpFor: Long? = null

    /** @return novo nível em litros para a estimativa, ou null se ainda não há medida firme. */
    fun onReading(pct: Double, speedKmh: Double?, now: Long, currentEstimateL: Double?, manualAt: Long? = null): Double? {
        lastPct?.let { if (pct >= it + 1) lastRiseAt = now }
        lastPct = pct
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
        if (currentEstimateL == null) return liters
        val diff = liters - currentEstimateL
        val held = manualAt != null && now - manualAt in 0 until HOLD_MS && caughtUpFor != manualAt
        if (held && kotlin.math.abs(diff) <= MIN_CHANGE_L) caughtUpFor = manualAt
        val rising = lastRiseAt?.let { now - it < SETTLE_MS } == true
        if ((held || rising) && diff < 0) return null
        return if (kotlin.math.abs(diff) > MIN_CHANGE_L) liters else null
    }

    private companion object {
        const val STILL_MS = 10_000L
        const val MIN_SAMPLES = 5
        const val MAX_SAMPLES = 60
        const val MIN_CHANGE_L = 1.0
        const val SETTLE_MS = 10 * 60_000L
        const val HOLD_MS = 24 * 60 * 60_000L
    }
}

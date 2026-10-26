package com.universal.obddashboard.obd

import android.Manifest
import android.annotation.SuppressLint
import android.bluetooth.BluetoothDevice
import android.bluetooth.BluetoothManager
import android.bluetooth.BluetoothSocket
import android.content.Context
import android.content.pm.PackageManager
import android.os.Build
import android.util.Log
import androidx.core.content.ContextCompat
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.TimeoutCancellationException
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext
import kotlinx.coroutines.withTimeout
import kotlinx.coroutines.withTimeoutOrNull
import java.io.IOException
import java.io.InputStream
import java.io.OutputStream
import java.util.UUID

/**
 * Transporte serial Bluetooth clássico (SPP/RFCOMM) para adaptadores ELM327.
 *
 * Garante um único comando em voo: cada [sendRaw] escreve "<cmd>\r" e aguarda o prompt '>'.
 * Isso é o que impede o overflow do buffer do ELM327 — nunca há escrita antes do '>' anterior.
 */
class BluetoothSerialManager(private val context: Context) : ElmMonitorTransport {

    sealed interface LinkState {
        data object Disconnected : LinkState
        data class Connecting(val deviceName: String) : LinkState
        data class Connected(val deviceName: String, val address: String) : LinkState
        data class Lost(val reason: String) : LinkState
    }

    private val _state = MutableStateFlow<LinkState>(LinkState.Disconnected)
    val state: StateFlow<LinkState> = _state.asStateFlow()

    private val ioMutex = Mutex()
    private val lock = Any()
    private val rxBuffer = StringBuilder()
    private var pending: CompletableDeferred<String>? = null
    /** Durante [monitor]: recebe cada linha assim que chega, em vez de acumular até o '>'. */
    private var lineSink: ((String) -> Unit)? = null

    @Volatile private var socket: BluetoothSocket? = null
    @Volatile private var output: OutputStream? = null
    @Volatile private var readerThread: Thread? = null
    @Volatile private var closing = false

    private val adapter get() = context.getSystemService(BluetoothManager::class.java)?.adapter

    fun hasConnectPermission(): Boolean =
        Build.VERSION.SDK_INT < Build.VERSION_CODES.S ||
            ContextCompat.checkSelfPermission(context, Manifest.permission.BLUETOOTH_CONNECT) ==
            PackageManager.PERMISSION_GRANTED

    data class BondedDevice(val name: String?, val address: String)

    /** Dispositivos pareados no celular, por nome; null sem permissão BLUETOOTH_CONNECT ou sem Bluetooth. */
    @SuppressLint("MissingPermission")
    fun bondedDevices(): List<BondedDevice>? {
        if (!hasConnectPermission()) return null
        val bt = adapter ?: return null
        return try {
            bt.bondedDevices.orEmpty()
                .map { BondedDevice(it.name, it.address) }
                .sortedBy { (it.name ?: it.address).lowercase() }
        } catch (e: SecurityException) {
            null
        }
    }

    /** Procura entre os dispositivos pareados por nome (sem diferenciar maiúsculas) ou endereço MAC. */
    @SuppressLint("MissingPermission")
    fun findBondedDevice(namesOrAddresses: Collection<String>): BluetoothDevice? {
        if (!hasConnectPermission()) return null
        val bonded = adapter?.bondedDevices.orEmpty()
        for (wanted in namesOrAddresses) {
            bonded.firstOrNull { d ->
                d.address.equals(wanted, ignoreCase = true) || d.name?.equals(wanted, ignoreCase = true) == true
            }?.let { return it }
        }
        return null
    }

    @SuppressLint("MissingPermission")
    suspend fun connect(device: BluetoothDevice) = withContext(Dispatchers.IO) {
        close()
        closing = false
        val name = device.name ?: device.address
        _state.value = LinkState.Connecting(name)

        // Descoberta ativa degrada muito o throughput RFCOMM.
        try {
            adapter?.cancelDiscovery()
        } catch (_: SecurityException) {
            // BLUETOOTH_SCAN não concedida: seguimos sem cancelar.
        }

        val s = try {
            device.createRfcommSocketToServiceRecord(SPP_UUID).also { it.connect() }
        } catch (first: IOException) {
            Log.w(TAG, "Conexão SDP falhou, tentando canal RFCOMM 1 (clones ELM327)", first)
            try {
                @Suppress("DiscouragedPrivateApi")
                val m = device.javaClass.getMethod("createRfcommSocket", Int::class.javaPrimitiveType)
                (m.invoke(device, 1) as BluetoothSocket).also { it.connect() }
            } catch (second: Exception) {
                _state.value = LinkState.Lost("Falha ao conectar em $name: ${first.message}")
                throw IOException("Não foi possível conectar ao adaptador $name", second)
            }
        }

        socket = s
        output = s.outputStream
        startReader(s.inputStream)
        _state.value = LinkState.Connected(name, device.address)
    }

    /**
     * Envia um comando e aguarda o prompt '>'. Retorna o texto bruto (sem o prompt).
     * @throws ElmTimeoutException se o prompt não chegar a tempo (link segue aberto)
     * @throws IOException se o link Bluetooth caiu
     */
    override suspend fun sendRaw(command: String, timeoutMs: Long): String = ioMutex.withLock {
        if (output == null) throw IOException("Bluetooth desconectado")
        val deferred = CompletableDeferred<String>()
        synchronized(lock) {
            rxBuffer.setLength(0)      // descarta restos de uma resposta anterior que expirou
            pending = deferred
        }
        write(command + "\r")
        try {
            withTimeout(timeoutMs) { deferred.await() }
        } catch (e: TimeoutCancellationException) {
            synchronized(lock) { if (pending === deferred) pending = null }
            throw ElmTimeoutException(command)
        }
    }

    override suspend fun monitor(command: String, durationMs: Long, onLine: (String) -> Unit) = ioMutex.withLock {
        val deferred = CompletableDeferred<String>()
        synchronized(lock) {
            rxBuffer.setLength(0)
            pending = deferred
            lineSink = onLine
        }
        try {
            write(command + "\r")
            if (withTimeoutOrNull(durationMs) { deferred.await() } == null) {
                write("\r") // qualquer caractere interrompe o monitoramento
                try {
                    withTimeout(MONITOR_STOP_TIMEOUT_MS) { deferred.await() }
                } catch (e: TimeoutCancellationException) {
                    throw ElmTimeoutException(command)
                }
            }
        } finally {
            synchronized(lock) {
                lineSink = null
                if (pending === deferred) pending = null
            }
        }
    }

    private suspend fun write(text: String) {
        val out = output ?: throw IOException("Bluetooth desconectado")
        withContext(Dispatchers.IO) {
            try {
                out.write(text.toByteArray(Charsets.US_ASCII))
                out.flush()
            } catch (e: IOException) {
                onLinkLost("Falha de escrita: ${e.message}")
                throw e
            }
        }
    }

    fun isConnected() = _state.value is LinkState.Connected

    fun close() {
        closing = true
        readerThread?.interrupt()
        readerThread = null
        try {
            socket?.close()
        } catch (_: IOException) {
        }
        socket = null
        output = null
        synchronized(lock) {
            pending?.completeExceptionally(IOException("Conexão encerrada"))
            pending = null
            lineSink = null
            rxBuffer.setLength(0)
        }
        if (_state.value !is LinkState.Lost) _state.value = LinkState.Disconnected
    }

    private fun startReader(input: InputStream) {
        readerThread = Thread({
            val buf = ByteArray(256)
            try {
                while (!Thread.currentThread().isInterrupted) {
                    val n = input.read(buf)
                    if (n < 0) throw IOException("Fim de stream")
                    synchronized(lock) {
                        for (i in 0 until n) {
                            val c = (buf[i].toInt() and 0xFF).toChar()
                            val sink = lineSink
                            if (sink != null && (c == '\r' || c == '\n')) {
                                if (rxBuffer.isNotBlank()) sink(rxBuffer.toString().trim())
                                rxBuffer.setLength(0)
                            } else if (c == '>') {
                                if (sink != null && rxBuffer.isNotBlank()) sink(rxBuffer.toString().trim())
                                val response = rxBuffer.toString()
                                rxBuffer.setLength(0)
                                pending?.complete(response)   // resposta sem dono (atrasada) é descartada
                                pending = null
                            } else {
                                rxBuffer.append(c)
                            }
                        }
                    }
                }
            } catch (e: IOException) {
                if (!closing) onLinkLost(e.message ?: "Leitura interrompida")
            }
        }, "elm327-reader").apply {
            isDaemon = true
            start()
        }
    }

    private fun onLinkLost(reason: String) {
        if (closing) return
        Log.w(TAG, "Link Bluetooth perdido: $reason")
        _state.value = LinkState.Lost(reason)
        synchronized(lock) {
            pending?.completeExceptionally(IOException(reason))
            pending = null
        }
    }

    companion object {
        private const val TAG = "BtSerial"
        private const val MONITOR_STOP_TIMEOUT_MS = 3000L
        val SPP_UUID: UUID = UUID.fromString("00001101-0000-1000-8000-00805F9B34FB")
    }
}

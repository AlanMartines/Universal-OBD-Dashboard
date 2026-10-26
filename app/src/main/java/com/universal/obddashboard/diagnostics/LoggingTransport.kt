package com.universal.obddashboard.diagnostics

import com.universal.obddashboard.obd.ElmTimeoutException
import com.universal.obddashboard.obd.ElmTransport
import kotlinx.coroutines.CancellationException
import kotlinx.serialization.json.put

/**
 * Registra cada comando enviado ao ELM327 e a resposta bruta (ou o erro), com a latência:
 * `{"type":"elm","cmd":"010C1","rx":"410C0D54\r\r","ms":38}`.
 */
class LoggingTransport(
    private val delegate: ElmTransport,
    private val recorder: DiagnosticRecorder,
    private val elapsedMs: () -> Long = { System.nanoTime() / 1_000_000 },
) : ElmTransport {

    override suspend fun sendRaw(command: String, timeoutMs: Long): String {
        val start = elapsedMs()
        try {
            val rx = delegate.sendRaw(command, timeoutMs)
            recorder.event("elm") {
                put("cmd", command)
                put("rx", rx)
                put("ms", elapsedMs() - start)
            }
            return rx
        } catch (e: ElmTimeoutException) {
            recorder.event("elm") {
                put("cmd", command)
                put("err", "timeout")
                put("timeout_ms", timeoutMs)
                put("ms", elapsedMs() - start)
            }
            throw e
        } catch (e: CancellationException) {
            throw e
        } catch (e: Exception) {
            recorder.event("elm") {
                put("cmd", command)
                put("err", e.toString())
                put("ms", elapsedMs() - start)
            }
            throw e
        }
    }
}

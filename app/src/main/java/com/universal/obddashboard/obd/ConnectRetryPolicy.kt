package com.universal.obddashboard.obd

/**
 * Decide, após cada falha de conexão, entre tentar de novo e encerrar a captura.
 *
 * Separa dois casos que antes dividiam o mesmo contador:
 *  - **ECU sem resposta** (adaptador ok, ignição ainda desligada): espera até
 *    [PowerSettings.ignitionWaitS], sem consumir as tentativas de link;
 *  - **falha de link** (Bluetooth, adaptador travado ou reiniciando na partida):
 *    [PowerSettings.initialConnectAttempts] antes da primeira captura e
 *    [PowerSettings.reconnectAttempts] depois dela.
 */
class ConnectRetryPolicy(private val pm: PowerSettings, private val clock: () -> Long) {

    enum class GiveUpReason { ADAPTER_UNREACHABLE, LINK_LOST, IGNITION_NOT_DETECTED }

    sealed interface Decision {
        val delayMs: Long get() = 0

        /** [attempt]/[max] para falhas de link; [waitedS] para a espera pela ignição. */
        data class Retry(override val delayMs: Long, val attempt: Int = 0, val max: Int = 0, val waitedS: Long? = null) : Decision
        data class GiveUp(val reason: GiveUpReason) : Decision
    }

    private var linkFailures = 0
    private var ecuWaitSince: Long? = null

    var everStreamed = false
        private set

    fun onStreaming() {
        everStreamed = true
        linkFailures = 0
        ecuWaitSince = null
    }

    fun onEcuNotResponding(): Decision {
        val now = clock()
        val since = ecuWaitSince ?: now.also { ecuWaitSince = it }
        val waited = now - since
        return if (waited >= pm.ignitionWaitS * 1000) {
            Decision.GiveUp(GiveUpReason.IGNITION_NOT_DETECTED)
        } else {
            Decision.Retry(pm.reconnectDelayMs, waitedS = waited / 1000)
        }
    }

    fun onLinkFailure(): Decision {
        val max = if (everStreamed) pm.reconnectAttempts else pm.initialConnectAttempts
        linkFailures++
        return if (linkFailures >= max) {
            Decision.GiveUp(if (everStreamed) GiveUpReason.LINK_LOST else GiveUpReason.ADAPTER_UNREACHABLE)
        } else {
            Decision.Retry(pm.reconnectDelayMs, attempt = linkFailures, max = max)
        }
    }
}

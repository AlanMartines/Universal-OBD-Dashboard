package com.universal.obddashboard.obd

import com.universal.obddashboard.obd.ConnectRetryPolicy.Decision
import com.universal.obddashboard.obd.ConnectRetryPolicy.GiveUpReason
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class ConnectRetryPolicyTest {

    private var now = 0L
    private val pm = PowerSettings(ignitionWaitS = 300, initialConnectAttempts = 6, reconnectAttempts = 6, reconnectDelayMs = 5000)
    private val policy = ConnectRetryPolicy(pm) { now }

    /** Na viagem de teste, captura iniciada antes da ignição desistia após ~1 min ("adaptador inacessível"). */
    @Test fun waitsForIgnitionWithoutUsingLinkAttempts() {
        repeat(20) {
            val d = policy.onEcuNotResponding()
            assertTrue("tentativa $it", d is Decision.Retry)
            now += 11_000 // ~6 s de inicialização + 5 s de espera
        }
        assertTrue(policy.onLinkFailure() is Decision.Retry) // contador de link intacto
        now += 100_000
        assertEquals(Decision.GiveUp(GiveUpReason.IGNITION_NOT_DETECTED), policy.onEcuNotResponding())
    }

    @Test fun linkFailuresBeforeFirstCaptureMeanAdapterUnreachable() {
        repeat(5) { assertEquals(it + 1, (policy.onLinkFailure() as Decision.Retry).attempt) }
        assertEquals(Decision.GiveUp(GiveUpReason.ADAPTER_UNREACHABLE), policy.onLinkFailure())
    }

    /** Adaptador reinicia na partida do motor: mais tentativas, e o contador zera a cada captura bem-sucedida. */
    @Test fun streamingResetsCountersAndLaterFailuresMeanLinkLost() {
        repeat(3) { policy.onLinkFailure() }
        policy.onStreaming()
        repeat(5) { assertTrue(policy.onLinkFailure() is Decision.Retry) }
        assertEquals(Decision.GiveUp(GiveUpReason.LINK_LOST), policy.onLinkFailure())
    }

    @Test fun ignitionWaitRestartsAfterStreaming() {
        policy.onEcuNotResponding()
        now += 299_000
        policy.onStreaming()
        now += 10_000
        assertTrue(policy.onEcuNotResponding() is Decision.Retry)
        now += 200_000
        assertTrue(policy.onEcuNotResponding() is Decision.Retry)
    }
}

package com.universal.obddashboard.service

import com.universal.obddashboard.service.GpsSourcePolicy.Source
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class GpsSourcePolicyTest {
    @Test
    fun usesGoogleWhenAvailableAndNativeOtherwise() {
        assertEquals(Source.GOOGLE, GpsSourcePolicy.initial(googleAvailable = true))
        assertEquals(Source.NATIVE, GpsSourcePolicy.initial(googleAvailable = false))
    }

    @Test
    fun nativeBackupOnlyAfterGoogleSilentInHighAccuracy() {
        val limit = GpsSourcePolicy.GOOGLE_SILENT_MS
        assertFalse(GpsSourcePolicy.needsNativeBackup(Source.GOOGLE, highAccuracy = true, googleSilentMs = limit - 1))
        assertTrue(GpsSourcePolicy.needsNativeBackup(Source.GOOGLE, highAccuracy = true, googleSilentMs = limit))
        // Parado (baixa potência, 10 s entre posições): silêncio é normal
        assertFalse(GpsSourcePolicy.needsNativeBackup(Source.GOOGLE, highAccuracy = false, googleSilentMs = limit * 3))
        // Já no nativo: não há reserva a ligar
        assertFalse(GpsSourcePolicy.needsNativeBackup(Source.NATIVE, highAccuracy = true, googleSilentMs = limit * 3))
    }
}

package com.universal.obddashboard.bridge

import org.junit.Assert.assertEquals
import org.junit.Test

class ScreenBrightnessTest {
    @Test fun brilhoDaTelaANoiteOuDoSistema() {
        assertEquals(0.15f, AppBridge.windowBrightness(0.15), 0.0001f)
        assertEquals(0.05f, AppBridge.windowBrightness(0.05), 0.0001f)
        assertEquals(1f, AppBridge.windowBrightness(1.0), 0.0001f)
        // -1 (o app pede o do sistema), zero, acima de 1 e lixo voltam ao brilho do sistema
        for (v in listOf(-1.0, 0.0, 1.5, Double.NaN)) assertEquals(-1f, AppBridge.windowBrightness(v), 0.0001f)
    }
}

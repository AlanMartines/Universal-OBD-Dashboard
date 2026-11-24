package com.universal.obddashboard.telemetry

import com.universal.obddashboard.can.Slcan
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Test

class BatteryCalibrationTest {
    @Test fun fatorDoMultimetroCorrigeAsQuatroLeiturasDoEsp32() {
        // Lê 17 % abaixo: 10,46 V no ESP32 com 12,6 V no multímetro
        val c = BatteryCalibration.of(12.6, 10.46, 1L)!!
        assertEquals(1.205, c.factor, 0.0005)
        val raw = Slcan.parseBattery("# bateria v=10.46 min=10.40 repouso=10.44 menor=8.20")!! + ("rpm" to 900.0)
        val out = c.apply(raw)
        assertEquals(12.6, out.getValue(Slcan.ESP_BATT_V), 0.01)
        assertEquals(9.88, out.getValue(Slcan.ESP_BATT_LOWEST), 0.01)
        assertEquals(900.0, out.getValue("rpm"), 0.0)
        assertEquals(c, BatteryCalibration.decode(c.encode()))
    }

    @Test fun recusaValorFora() {
        assertNotNull(BatteryCalibration.problem(25.0, 12.0))
        assertNotNull(BatteryCalibration.problem(12.6, 6.0))     // fator 2,1: fiação, não calibração
        assertNull(BatteryCalibration.problem(12.6, 12.1))
        assertNull(BatteryCalibration.of(12.6, 6.0, 1L))
        assertNull(BatteryCalibration.decode("""{"factor":3.0,"multimeterV":12.6,"espV":4.2,"at":1}"""))
        assertNull(BatteryCalibration.decode("lixo"))
    }
}

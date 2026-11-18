package com.universal.obddashboard.telemetry

import com.universal.obddashboard.obd.ProfileParser
import com.universal.obddashboard.obd.VariableResolver
import org.junit.Assert.assertEquals
import org.junit.Test
import java.io.File

/** Alerta de bateria fraca do Uno: a queda com a lanterna ou o farol acesos não é bateria fraca (18/11/2026). */
class BatteryWeakAlertTest {

    private val uno = ProfileParser.parse(File("src/main/assets/profiles/fiat_uno_vivace_7gf.json").readText())

    private fun raised(vars: Map<String, Double>): List<String> {
        val engine = AlertEngine(uno.alerts.filter { it.rule.id == "battery_weak" })
        val r = VariableResolver { vars[it] ?: Double.NaN }
        engine.evaluate(0, r) { "" }
        return engine.evaluate(10_000, r) { "" }.first.map { it.id }
    }

    @Test
    fun lowVoltageWithLightsOnIsNotAWeakBattery() {
        assertEquals(emptyList<String>(), raised(mapOf("battery_volts" to 11.7, "rpm" to 0.0, "can_lights" to 1.0)))
    }

    @Test
    fun lowVoltageWithLightsOffStillWarns() {
        assertEquals(listOf("battery_weak"), raised(mapOf("battery_volts" to 11.7, "rpm" to 0.0, "can_lights" to 0.0)))
    }

    @Test
    fun withoutTheCanListenerTheAlertWorksAsBefore() {
        assertEquals(listOf("battery_weak"), raised(mapOf("battery_volts" to 11.7, "rpm" to 0.0)))
    }
}

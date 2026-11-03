package com.universal.obddashboard.telemetry

import com.universal.obddashboard.obd.ProfileParser
import com.universal.obddashboard.obd.UserAlarm
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File

/** Caminho completo: alarme criado em Ajustes → motor de alertas da captura. */
class UserAlarmEngineTest {
    @Test fun rpmAlarmRaisesAfterThreeSeconds() {
        val uno = ProfileParser.parse(File("src/main/assets/profiles/fiat_uno_vivace_7gf.json").readText())
        val alarms = ProfileParser.compileUserAlarms(uno, listOf(UserAlarm("a", "rpm", above = true, value = 1500.0)))
        val engine = TelemetryEngine(uno, 0.0, null, userAlerts = alarms)
        var raised = emptyList<ActiveAlert>()
        var active = emptyList<ActiveAlert>()
        for (i in 0..8) {
            val t = 1_000_000L + i * 500L
            val state = DashboardState(readings = mapOf("rpm" to Reading(2000.0, t)))
            val r = engine.compute(state, null, t, 0.5)
            raised = raised + r.newlyRaised
            active = r.alerts
        }
        assertEquals(listOf("user_a"), raised.map { it.id })
        assertTrue(active.any { it.id == "user_a" && it.message.contains("2000") })
    }
}

package com.universal.obddashboard.telemetry

import com.universal.obddashboard.obd.AlertLevel
import com.universal.obddashboard.obd.FormulaEvaluator
import com.universal.obddashboard.obd.ProfileParser
import com.universal.obddashboard.obd.UserAlarm
import com.universal.obddashboard.obd.VariableResolver
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File

class DrivingInsightsTest {
    @Test fun loadUsesPressureMeasuredWithEngineStopped() {
        val load = EstimatedLoad(null)
        assertNull("sem referência ainda", load.update(900.0, 50.0))
        assertNull("motor parado não tem carga", load.update(0.0, 95.0))
        assertEquals(95.0, load.atmosphericKpa!!, 0.0)
        assertEquals(50.0, load.update(2000.0, 47.5)!!, 1e-9)
        assertEquals("nunca passa de 100%", 100.0, load.update(2000.0, 120.0)!!, 0.0)
        assertEquals("referência salva vale ao ligar andando", 50.0, EstimatedLoad(90.0).update(900.0, 45.0)!!, 1e-9)
        load.update(0.0, 5.0)
        assertEquals("leitura impossível não vira referência", 95.0, load.atmosphericKpa!!, 0.0)
    }

    @Test fun ambientSensorGivesLiveLoadVacuumAndMapOffset() {
        val load = EstimatedLoad(95.0)
        // Na serra a pressão caiu para 90 kPa: pé no fundo (MAP 90) é carga plena, não 95%
        assertEquals(100.0, load.update(3000.0, 90.0, 90.0)!!, 1e-9)
        assertEquals(90.0, load.atmosphericKpa!!, 0.0)
        assertEquals(50.0, load.update(2000.0, 45.0, 90.0)!!, 1e-9)
        assertEquals("vácuo = atmosférica − MAP", 45.0, load.vacuumKpa!!, 1e-9)
        // Motor parado: o MAP deveria bater com o sensor; a diferença é o desvio do MAP
        assertNull(load.update(0.0, 92.0, 90.0))
        assertNull("sem vácuo com o motor parado", load.vacuumKpa)
        assertEquals(2.0, load.mapOffsetKpa!!, 1e-9)
        load.update(0.0, 91.0, 90.0)
        assertEquals("desvio suavizado", 1.8, load.mapOffsetKpa!!, 1e-9)
        assertEquals("com o sensor, o MAP parado não vira referência", 90.0, load.atmosphericKpa!!, 0.0)
        assertNull("leitura do sensor fora da faixa é ignorada", EstimatedLoad(null).update(2000.0, 45.0, 0.0))
    }

    private fun drive(vararg points: Pair<Long, Double>): List<TimedRun> {
        val timers = PerformanceTimers()
        return points.flatMap { (t, v) -> timers.onSpeed(t, v) }
    }

    @Test fun measuresStandingStartFromLastStoppedReading() {
        val runs = drive(0L to 0.0, 1000L to 0.0, 2000L to 10.0, 4000L to 30.0, 6000L to 50.0, 7000L to 60.0)
        assertEquals(6.0, runs.single { it.band == "0-60" }.seconds, 1e-9)
    }

    @Test fun interpolatesRollingBandCrossings() {
        // Passa por 40 km/h em t=1000 e por 60 km/h em t=5000
        val runs = drive(0L to 30.0, 2000L to 50.0, 4000L to 55.0, 6000L to 65.0)
        assertEquals("40-60", runs.single().band)
        assertEquals(4.0, runs.single().seconds, 1e-9)
    }

    @Test fun brakingOrGapsCancelTheRun() {
        assertTrue(drive(0L to 30.0, 1000L to 41.0, 2000L to 50.0, 3000L to 40.0, 4000L to 61.0).isEmpty())
        assertTrue(drive(0L to 30.0, 1000L to 41.0, 9000L to 61.0).isEmpty())
    }

    @Test fun impossibleAccelerationIsNotRecorded() {
        assertTrue(drive(0L to 0.0, 500L to 70.0).isEmpty())
    }

    private fun steady(ecu: Double, gps: Double, n: Int = 100, accuracy: Float? = 5f) =
        List(n) { SpeedCalibration.Sample(it * 2000L, ecu, gps, accuracy) }

    @Test fun suggestsMedianInHalfPercentSteps() {
        assertEquals(4.5, SpeedCalibration.suggest(steady(40.0, 41.8))!!.pct, 0.0)
    }

    @Test fun refusesWeakOrImplausibleData() {
        assertNull("poucas leituras", SpeedCalibration.suggest(steady(40.0, 41.8, n = 20)))
        assertNull("GPS impreciso", SpeedCalibration.suggest(steady(40.0, 41.8, accuracy = 30f)))
        assertNull("devagar demais", SpeedCalibration.suggest(steady(10.0, 11.0)))
        assertNull("fora da faixa do ajuste", SpeedCalibration.suggest(steady(40.0, 60.0)))
    }

    @Test fun userAlarmsCompileAgainstProfileAndIgnoreRemovedSignals() {
        val uno = ProfileParser.parse(File("src/main/assets/profiles/fiat_uno_vivace_7gf.json").readText())
        val alarms = ProfileParser.compileUserAlarms(
            uno,
            listOf(
                UserAlarm("a", "coolant_temp", above = true, value = 100.5, critical = true),
                UserAlarm("b", "stft_b1", above = false, value = -20.0),
                UserAlarm("c", "sinal_que_nao_existe", above = true, value = 1.0),
            ),
        )
        assertEquals(2, alarms.size)
        assertEquals(AlertLevel.CRITICAL, alarms[0].level)
        fun eval(i: Int, id: String, v: Double) =
            FormulaEvaluator.truthy(alarms[i].condition.eval(VariableResolver { if (it == id) v else Double.NaN }))
        assertTrue(eval(0, "coolant_temp", 101.0))
        assertFalse(eval(0, "coolant_temp", 100.0))
        assertTrue(eval(1, "stft_b1", -25.0))
        assertFalse(eval(1, "stft_b1", -10.0))
        assertFalse("sem leitura não dispara", eval(0, "outro", 0.0))
        assertEquals(alarms.map { it.rule.id }, listOf("user_a", "user_b"))
    }

    @Test fun alarmListRoundTrips() {
        val list = listOf(UserAlarm("a", "rpm", true, 6000.0))
        assertEquals(list, UserAlarm.decode(UserAlarm.encode(list)))
        assertTrue(UserAlarm.decode("lixo").isEmpty())
    }
}

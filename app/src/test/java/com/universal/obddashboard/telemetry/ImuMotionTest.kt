package com.universal.obddashboard.telemetry

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import kotlin.math.sqrt

/** O módulo vai torto de propósito: a orientação tem que sair só do uso (paradas, arrancadas e frenagens). */
class ImuMotionTest {
    private fun unit(v: DoubleArray): DoubleArray { val l = sqrt(v.sumOf { it * it }); return DoubleArray(3) { v[it] / l } }
    private fun dot(a: DoubleArray, b: DoubleArray) = a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
    private fun cross(a: DoubleArray, b: DoubleArray) =
        doubleArrayOf(a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0])

    // Eixos do carro (frente, esquerda, cima) escritos nos eixos do módulo
    private val up = unit(doubleArrayOf(0.1, 0.95, 0.3))
    private val fwd = unit(doubleArrayOf(0.8, -0.1, 0.5).let { v -> val k = dot(v, up); DoubleArray(3) { v[it] - k * up[it] } })
    private val left = cross(up, fwd)

    /** Força específica (o que o acelerômetro mede) dada nos eixos do carro, em g. */
    private fun sensor(f: Double, l: Double, u: Double) = DoubleArray(3) { f * fwd[it] + l * left[it] + u * up[it] }

    private var t = 0L
    private var speed = 0.0

    /** Anda [s] segundos com a velocidade mudando [kmhPerS], com a força nos eixos do carro; velocidade a cada 250 ms, sensor a cada 200 ms. */
    private fun ImuMotion.drive(s: Double, kmhPerS: Double, f: Double, l: Double, u: Double, peak: Double = 0.02, yawDps: Double = 0.0) {
        val end = t + (s * 1000).toLong()
        while (t < end) {
            t += 50
            speed = (speed + kmhPerS * 0.05).coerceAtLeast(0.0)
            if (t % 250 == 0L) onSpeed(t, Math.round(speed).toDouble())   // OBD em km/h inteiros
            if (t % 200 == 0L) update(t, 0.2, sensor(f, l, u), DoubleArray(3) { up[it] * yawDps }, peak)
        }
    }

    private fun learned(): ImuMotion {
        val m = ImuMotion()
        m.drive(5.0, 0.0, 0.0, 0.0, 1.0)
        assertEquals("parado aprende o cima", 1, m.stage)
        val a = 7.0 / 3.6 / ImuMotion.G
        repeat(2) {
            m.drive(9.0, 7.0, a, 0.0, 1.0)      // arrancada
            m.drive(8.0, -7.0, -a, 0.0, 1.0)    // frenagem
        }
        return m
    }

    @Test fun learnsMountingFromStopsAndSpeedChanges() {
        val m = learned()
        assertEquals("andando aprende a frente", 2, m.stage)
        val cal = m.calibration!!
        assertEquals(1.0, dot(cal.up.toDoubleArray(), up), 0.01)
        assertEquals(1.0, dot(cal.forward!!.toDoubleArray(), fwd), 0.02)
    }

    @Test fun slopeAccelerationAndLateral() {
        val m = learned()
        speed = 50.0
        // Subida de 5% em velocidade constante: o OBD não acusa aceleração, o que sobra é a rampa
        val s = 0.05 / sqrt(1 + 0.05 * 0.05)
        m.drive(15.0, 0.0, s, 0.0, sqrt(1 - s * s))
        assertEquals(5.0, m.slopePct!!, 0.6)
        assertEquals(0.0, m.accelG!!, 0.03)
        // Curva à esquerda, no plano
        m.drive(4.0, 0.0, 0.0, 0.3, 1.0, yawDps = 20.0)
        assertEquals(0.3, m.lateralG!!, 0.03)
        // Frenagem forte no plano
        m.drive(3.0, -15.0, -15.0 / 3.6 / ImuMotion.G, 0.0, 1.0)
        assertTrue(m.accelG!! < -0.3)
        assertTrue(m.maxBrakeG > 0.3)
        assertTrue(m.maxLateralG > 0.25)
    }

    @Test fun countsBumpsOncePerImpact() {
        val m = learned()
        speed = 40.0
        val before = m.bumps
        m.drive(0.4, 0.0, 0.0, 0.0, 1.0, peak = 0.7)   // duas linhas no mesmo buraco
        m.drive(2.0, 0.0, 0.0, 0.0, 1.0)
        m.drive(0.2, 0.0, 0.0, 0.0, 1.0, peak = 0.5)
        assertEquals(before + 2, m.bumps)
        speed = 0.0
        m.drive(0.2, 0.0, 0.0, 0.0, 1.0, peak = 0.9)   // parado (porta batendo) não conta
        assertEquals(before + 2, m.bumps)
    }

    @Test fun calibrationSurvivesRestartAndRemountResets() {
        val cal = learned().calibration!!
        val again = ImuMotion(ImuMotion.Calibration.decode(cal.encode()))
        assertEquals(2, again.stage)
        assertNull("sem leitura ainda", again.accelG)
        speed = 0.0
        again.drive(1.0, 0.0, 0.0, 0.0, 1.0)
        assertNotNull(again.slopePct)
        // Módulo remontado: parado, a gravidade aparece em outro eixo do módulo
        val m = ImuMotion(cal)
        val end = t + 12_000
        while (t < end) {
            t += 200
            m.onSpeed(t, 0.0)
            m.update(t, 0.2, doubleArrayOf(fwd[0], fwd[1], fwd[2]), DoubleArray(3), 0.0)
        }
        assertTrue("recomeça a aprender", m.stage < 2)
        assertNull(ImuMotion.Calibration.decode("lixo"))
    }
}

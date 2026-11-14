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
    /** Desvio do giroscópio do módulo (°/s, eixos do módulo): zero nos testes antigos. */
    private var bias = DoubleArray(3)

    /** Anda [s] segundos com a velocidade mudando [kmhPerS], com a força nos eixos do carro; velocidade a cada 250 ms, sensor a cada 200 ms. */
    private fun ImuMotion.drive(s: Double, kmhPerS: Double, f: Double, l: Double, u: Double, peak: Double = 0.02, yawDps: Double = 0.0) {
        val end = t + (s * 1000).toLong()
        while (t < end) {
            t += 50
            speed = (speed + kmhPerS * 0.05).coerceAtLeast(0.0)
            if (t % 250 == 0L) onSpeed(t, Math.round(speed).toDouble())   // OBD em km/h inteiros
            if (t % 200 == 0L) update(t, 0.2, sensor(f, l, u), DoubleArray(3) { up[it] * yawDps + bias[it] }, peak)
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

    @Test fun gyroBiasOfTheBenchModuleIsMeasuredAndRemoved() {
        // Desvio medido na bancada (13/11/2026): parado, o giro total passa de 3 °/s
        bias = doubleArrayOf(1.8, -3.0, -2.3)
        val m = learned()
        assertEquals("calibra mesmo com o desvio", 2, m.stage)
        val b = m.gyroBiasDps!!
        for (i in 0..2) assertEquals(bias[i], b[i], 0.05)
        // Reta: giro perto de zero, sem curva falsa
        m.drive(4.0, 0.0, 0.0, 0.0, 1.0)
        m.drive(3.0, 0.0, 0.0, 0.0, 1.0)
        assertEquals(0.0, m.yawDps!!, 0.2)
        // Curva à esquerda de 10 °/s
        speed = 40.0
        m.drive(3.0, 0.0, 0.0, 40 / 3.6 * Math.toRadians(10.0) / ImuMotion.G, 1.0, yawDps = 10.0)
        assertEquals(10.0, m.yawDps!!, 0.3)
    }

    @Test fun noYawBeforeTheBiasIsKnown() {
        bias = doubleArrayOf(1.8, -3.0, -2.3)
        val m = ImuMotion()
        speed = 40.0
        m.drive(3.0, 0.0, 0.0, 0.0, 1.0)
        assertNull(m.yawDps)
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
        // Curva à esquerda, no plano: 0,3 g a 50 km/h é um giro de v·ω = 0,3 g
        val yaw = Math.toDegrees(0.3 * ImuMotion.G / (50 / 3.6))
        m.drive(4.0, 0.0, 0.0, 0.3, 1.0, yawDps = yaw)
        assertEquals(0.3, m.lateralG!!, 0.03)
        assertEquals("curva não é inclinação", 0.0, m.rollDeg!!, 1.5)
        assertEquals(yaw, m.yawDps!!, 0.5)
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

    @Test fun fineTrimShiftsTheTiltAndZeroUndoesIt() {
        val m = learned()
        speed = 0.0
        m.drive(5.0, 0.0, 0.0, 0.0, 1.0)
        assertEquals(0.0, m.pitchDeg!!, 0.3)
        // Ajuste fino: +2° na frente e −1,5° de lado, por cima do aprendido
        m.pitchTrimDeg = 2.0
        m.rollTrimDeg = -1.5
        m.drive(1.0, 0.0, 0.0, 0.0, 1.0)
        assertEquals(2.0, m.pitchDeg!!, 0.3)
        assertEquals(-1.5, m.rollDeg!!, 0.3)
        assertEquals(Math.tan(Math.toRadians(2.0)) * 100, m.slopePct!!, 0.6)
        // A calibração aprendida não muda com o ajuste
        assertEquals(2, m.stage)
        m.pitchTrimDeg = 0.0
        m.rollTrimDeg = 0.0
        m.drive(1.0, 0.0, 0.0, 0.0, 1.0)
        assertEquals(0.0, m.pitchDeg!!, 0.3)
        assertEquals(0.0, m.rollDeg!!, 0.3)
    }

    @Test fun forgetStartsOverButKeepsTheGyroBias() {
        bias = doubleArrayOf(0.4, -0.1, -1.2)
        val m = learned()
        assertNotNull(m.calibration)
        m.forget()
        assertNull(m.calibration)
        assertEquals(0, m.stage)
        assertNull(m.pitchDeg)
        // O desvio é do chip, não da posição: continua valendo
        assertEquals(-1.2, m.gyroBiasDps!![2], 0.05)
        // Parado de novo, aprende o cima outra vez
        speed = 0.0
        m.drive(5.0, 0.0, 0.0, 0.0, 1.0)
        assertEquals(1, m.stage)
    }

    @Test fun mountShowsTheModuleAxisThatPointsUpAndForward() {
        // Módulo de pé, de lado: o eixo X aponta para baixo, uns 15° fora do prumo (como no teste da mesa)
        val tilt = Math.toRadians(15.0)
        val cal = ImuMotion.Calibration(listOf(-Math.cos(tilt), Math.sin(tilt), 0.0), 600.0, listOf(0.0, 0.0, 1.0), 30.0, upLocked = true)
        val m = cal.mount()
        assertEquals("−X", m.upAxis)
        assertEquals(15.0, m.upOffDeg, 0.1)
        assertTrue(m.upLocked)
        assertEquals("+Z", m.forwardAxis)
        assertEquals(0.0, m.forwardOffDeg!!, 0.1)
        // Sem frente aprendida
        val noFwd = ImuMotion.Calibration(listOf(0.0, 0.0, 1.0), 10.0, null, 0.0).mount()
        assertEquals("+Z", noFwd.upAxis)
        assertNull(noFwd.forwardAxis)
    }

    @Test fun lateralTiltParkedAndDriving() {
        val m = learned()
        // Parado com o lado direito 5° mais baixo: o eixo da esquerda aponta um pouco para cima
        val s5 = Math.sin(Math.toRadians(5.0))
        m.drive(8.0, 0.0, 0.0, s5, Math.cos(Math.toRadians(5.0)))
        assertEquals(5.0, m.rollDeg!!, 0.5)
        assertEquals(0.0, m.pitchDeg!!, 0.5)
        // Andando reto na mesma pista inclinada: continua 5°, e a força lateral é zero
        speed = 40.0
        m.drive(10.0, 0.0, 0.0, s5, Math.cos(Math.toRadians(5.0)))
        assertEquals(5.0, m.rollDeg!!, 0.6)
        assertEquals(0.0, m.lateralG!!, 0.02)
        assertTrue(m.maxRollDeg >= 4.5)
    }

    @Test fun parkDriveAndReverse() {
        val m = learned()
        speed = 0.0
        m.drive(2.0, 0.0, 0.0, 0.0, 1.0)
        assertEquals(ImuMotion.DIR_STOPPED, m.direction)
        // Arrancada de ré: a velocidade sobe, mas o sensor acusa aceleração para trás
        val a = 4.0 / 3.6 / ImuMotion.G
        m.drive(2.5, 4.0, -a, 0.0, 1.0)
        assertEquals(ImuMotion.DIR_REVERSE, m.direction)
        // Freando a ré continua ré até parar
        m.drive(1.0, -4.0, a, 0.0, 1.0)
        assertEquals(ImuMotion.DIR_REVERSE, m.direction)
        m.drive(3.0, -4.0, 0.0, 0.0, 1.0)
        assertEquals(ImuMotion.DIR_STOPPED, m.direction)
        // Arrancada para a frente
        m.drive(2.5, 4.0, a, 0.0, 1.0)
        assertEquals(ImuMotion.DIR_FORWARD, m.direction)
    }

    @Test fun levelButtonZeroesTheSlopeAndKeepsForward() {
        val m = learned()
        val fwdBefore = m.calibration!!.forward!!.toDoubleArray()
        speed = 0.0
        m.drive(120.0, 0.0, 0.0, 0.0, 1.0)   // bastante tempo parado no plano: o "cima" automático firma
        // Parado numa rampa de 3°: antes do ajuste aparece 3°
        val s3 = Math.sin(Math.toRadians(3.0))
        m.drive(6.0, 0.0, s3, 0.0, Math.cos(Math.toRadians(3.0)))
        assertEquals(3.0, m.pitchDeg!!, 0.5)
        m.requestLevel(t)
        assertEquals(ImuMotion.Action.LEVEL_PENDING, m.action(t))
        m.drive(6.0, 0.0, s3, 0.0, Math.cos(Math.toRadians(3.0)))
        assertEquals(ImuMotion.Action.LEVEL_DONE, m.action(t))
        assertEquals(0.0, m.pitchDeg!!, 0.3)
        val cal = m.calibration!!
        assertTrue(cal.upLocked)
        assertEquals("a frente fica", 1.0, dot(cal.forward!!.toDoubleArray(), fwdBefore), 0.01)
        // Travado: paradas depois não mexem no zero
        m.drive(30.0, 0.0, 0.0, 0.0, 1.0)
        assertEquals(-3.0, m.pitchDeg!!, 0.5)
        val back = ImuMotion.Calibration.decode(cal.encode())!!
        assertTrue(back.upLocked && !back.forwardLocked)
        // Calibração antiga (sem as travas) continua valendo
        assertTrue(!ImuMotion.Calibration.decode(cal.encode().substringBeforeLast(";"))!!.upLocked)
    }

    @Test fun levelFailsIfTheCarMoves() {
        val m = learned()
        speed = 0.0
        m.drive(2.0, 0.0, 0.0, 0.0, 1.0)
        m.requestLevel(t)
        m.drive(2.0, 4.0, 0.1, 0.0, 1.0)
        assertEquals(ImuMotion.Action.LEVEL_FAILED, m.action(t))
    }

    @Test fun forwardButtonUsesTheNextStraightLaunch() {
        val m = ImuMotion()
        speed = 0.0
        m.drive(5.0, 0.0, 0.0, 0.0, 1.0)
        assertEquals(1, m.stage)
        m.armForward(t)
        assertEquals(ImuMotion.Action.FORWARD_ARMED, m.action(t))
        // Uma arrancada só, de 0 a 25 km/h em reta, basta
        val a = 6.0 / 3.6 / ImuMotion.G
        m.drive(4.5, 6.0, a, 0.0, 1.0)
        assertEquals(ImuMotion.Action.FORWARD_DONE, m.action(t))
        assertEquals(2, m.stage)
        val cal = m.calibration!!
        assertTrue(cal.forwardLocked)
        assertEquals(1.0, dot(cal.forward!!.toDoubleArray(), fwd), 0.02)
    }

    @Test fun forwardButtonIgnoresALaunchInACurve() {
        val m = ImuMotion()
        speed = 0.0
        m.drive(5.0, 0.0, 0.0, 0.0, 1.0)
        m.armForward(t)
        val a = 6.0 / 3.6 / ImuMotion.G
        m.drive(4.5, 6.0, a, 0.2, 1.0, yawDps = 15.0)
        assertEquals(ImuMotion.Action.FORWARD_ARMED, m.action(t))
        // Apertar de novo cancela
        m.armForward(t)
        assertNull(m.action(t))
    }
}

package com.universal.obddashboard.telemetry

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import kotlin.math.abs
import kotlin.math.cos
import kotlin.math.sin
import kotlin.math.sqrt

/** O módulo vai torto, com "ferro" do carro e declinação: a bússola tem que acertar só com o GPS como referência. */
class CompassTest {
    private fun unit(v: DoubleArray): DoubleArray { val l = sqrt(v.sumOf { it * it }); return DoubleArray(3) { v[it] / l } }
    private fun dot(a: DoubleArray, b: DoubleArray) = a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
    private fun cross(a: DoubleArray, b: DoubleArray) =
        doubleArrayOf(a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0])

    private val up = unit(doubleArrayOf(0.1, 0.95, 0.3))
    private val fwd = unit(doubleArrayOf(0.8, -0.1, 0.5).let { v -> val k = dot(v, up); DoubleArray(3) { v[it] - k * up[it] } })
    private val left = cross(up, fwd)

    /** Declinação (o norte magnético fica 14° a oeste do geográfico) e o ferro do carro (µT, eixos do carro). */
    private val declination = -14.0
    private val iron = doubleArrayOf(12.0, -7.0, 20.0)

    /** O que o magnetômetro lê com o carro apontando [heading] (rumo verdadeiro). */
    private fun mag(heading: Double): DoubleArray {
        val a = Math.toRadians(heading - declination)   // norte magnético visto do carro, para a esquerda
        val h = 22.0
        val f = h * cos(a) + iron[0]
        val l = h * sin(a) + iron[1]
        val u = 10.0 + iron[2]
        return DoubleArray(3) { f * fwd[it] + l * left[it] + u * up[it] }
    }

    private var t = 0L

    /** Uma volta inteira devagar (2,4°/s), em reta para o GPS, com GPS bom. */
    private fun Compass.learnCircle() {
        var h = 0.0
        while (h < 360) {
            t += 200
            onGps(t, h.toFloat(), 30.0, 5f)
            onMag(t, mag(h), 2.4)
            update(t, 30.0)
            h += 2.4 * 0.2
        }
    }

    @Test fun gpsWinsWhenMovingWithGoodFix() {
        val c = Compass()
        t += 200
        c.onGps(t, 77f, 40.0, 4f)
        c.update(t, 40.0)
        assertEquals(77.0, c.headingDeg!!, 0.01)
        assertEquals(Compass.SOURCE_GPS, c.source)
    }

    @Test fun learnsFromGpsAndPointsRightWithoutIt() {
        val c = Compass()
        c.learnCircle()
        assertTrue(c.ready)
        assertTrue(c.progressPct >= 90)
        // Túnel: sem rumo do GPS, só a bússola
        for (h in listOf(5.0, 93.0, 181.0, 268.0, 333.0)) {
            repeat(20) {
                t += 200
                c.onGps(t, null, 30.0, 50f)
                c.onMag(t, mag(h), 0.0)
                c.update(t, 30.0)
            }
            assertEquals(Compass.SOURCE_MAG, c.source)
            assertEquals("rumo $h", 0.0, Compass.wrap(c.headingDeg!! - h), 2.0)
        }
        // A tabela sobrevive ao reinício do app
        val again = Compass(Compass.Calibration.decode(c.calibration.encode()))
        t += 200
        again.onMag(t, mag(140.0), 0.0)
        again.update(t, 0.0)
        assertEquals(140.0, again.headingDeg!!, 2.0)
    }

    @Test fun halfACircleIsNotEnough() {
        val c = Compass()
        var h = 0.0
        while (h < 170) {
            t += 200
            c.onGps(t, h.toFloat(), 30.0, 5f)
            c.onMag(t, mag(h), 2.0)
            h += 0.4
        }
        assertFalse(c.ready)
    }

    @Test fun stoppedKeepsTheLastGpsHeadingForAWhile() {
        val c = Compass()
        t += 200
        c.onGps(t, 200f, 30.0, 5f)
        c.update(t, 30.0)
        t += 10_000
        c.onGps(t, null, 0.0, 5f)
        c.update(t, 0.0)
        assertEquals(200.0, c.headingDeg!!, 0.01)
        t += Compass.GPS_HOLD_MS
        c.update(t, 0.0)
        assertNull(c.headingDeg)
    }

    @Test fun withoutGyroUsesTheGpsTurnRate() {
        val c = Compass()
        var h = 0.0
        while (h < 360) {
            t += 200
            c.onGps(t, h.toFloat(), 30.0, 5f)
            c.onMag(t, mag(h), null)
            h += 0.5
        }
        assertTrue(c.ready)
    }

    @Test fun movedModuleStartsOver() {
        val c = Compass()
        c.learnCircle()
        assertTrue(c.ready)
        // Módulo virado: a leitura não bate mais com o GPS, por mais de um minuto andando reto
        repeat(400) {
            t += 200
            c.onGps(t, 90f, 40.0, 5f)
            val m = mag(270.0)
            c.onMag(t, doubleArrayOf(m[1], m[2], m[0]), 0.0)
        }
        assertFalse(c.ready)
    }

    @Test fun cardinalPointsInPortuguese() {
        assertEquals("N", Compass.cardinal(359.0))
        assertEquals("NE", Compass.cardinal(45.0))
        assertEquals("L", Compass.cardinal(92.0))
        assertEquals("SO", Compass.cardinal(225.0))
        assertEquals("O", Compass.cardinal(268.0))
        assertTrue(abs(Compass.wrap(350.0 - 10.0) + 20.0) < 1e-9)
    }
}

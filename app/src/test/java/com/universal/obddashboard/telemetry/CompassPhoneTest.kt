package com.universal.obddashboard.telemetry

import com.universal.obddashboard.service.PhoneCompassSensor
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import kotlin.math.cos
import kotlin.math.sin

/** Bússola do celular como reserva e junto com o magnetômetro do ESP32. */
class CompassPhoneTest {

    private var t = 0L
    /** O celular está no suporte girado 70° em relação à frente do carro. */
    private val mount = 70.0

    /** Anda em reta com GPS bom no rumo [h], com o celular lendo o rumo do carro menos [mount]. */
    private fun Compass.drive(h: Double, seconds: Double, phoneMount: Double = mount) {
        var s = 0.0
        while (s < seconds) {
            t += 200
            onGps(t, h.toFloat(), 40.0, 5f)
            onPhone(t, Compass.norm(h - phoneMount), 2, true, 0.0)
            update(t, 40.0)
            s += 0.2
        }
    }

    /** Parado, sem GPS e sem o último rumo dele: só a bússola do celular pode responder. */
    private fun Compass.parked(h: Double, phoneMount: Double = mount, seconds: Double = 2.0) {
        var s = 0.0
        while (s < seconds) {
            t += 200
            onGps(t, null, 0.0, 50f)
            onPhone(t, Compass.norm(h - phoneMount), 2, true, null)
            update(t, 0.0)
            s += 0.2
        }
    }

    @Test fun learnsTheMountAngleAndPointsRightWhenParked() {
        val c = Compass()
        c.drive(120.0, 12.0)
        assertTrue(c.phoneReady)
        t += Compass.GPS_HOLD_MS + 1000   // o último rumo do GPS já não vale
        c.parked(120.0)
        assertEquals(Compass.SOURCE_PHONE, c.source)
        assertEquals(120.0, c.headingDeg!!, 1.0)
    }

    @Test fun fineTrimTurnsTheCompassesButNotTheGps() {
        val c = Compass()
        c.headingTrimDeg = 5.0
        c.drive(120.0, 12.0)
        // GPS é a referência: o ajuste não mexe nele
        assertEquals(Compass.SOURCE_GPS, c.source)
        assertEquals(120.0, c.headingDeg!!, 0.1)
        assertEquals(Compass.norm(mount), c.phoneMountDeg!!, 1.0)
        t += Compass.GPS_HOLD_MS + 1000
        c.parked(120.0)
        assertEquals(Compass.SOURCE_PHONE, c.source)
        assertEquals(125.0, c.headingDeg!!, 1.0)
    }

    @Test fun forgetPhoneRelearnsTheMount() {
        val c = Compass()
        c.drive(120.0, 12.0)
        assertTrue(c.phoneReady)
        c.forgetPhone()
        assertNull(c.phoneMountDeg)
        t += Compass.GPS_HOLD_MS + 1000
        c.parked(120.0)
        assertNull(c.headingDeg)
    }

    @Test fun needsSomeStraightDrivingBeforeTrustingThePhone() {
        val c = Compass()
        c.drive(120.0, 3.0)
        t += Compass.GPS_HOLD_MS + 1000
        c.parked(120.0)
        assertNull(c.headingDeg)
    }

    @Test fun phoneTurnedInTheMountWhileParkedIsForgotten() {
        val c = Compass()
        c.drive(120.0, 12.0)
        t += Compass.GPS_HOLD_MS + 1000
        c.parked(120.0)
        assertEquals(Compass.SOURCE_PHONE, c.source)
        // Carro parado, o rumo do celular muda 45°: foi o celular que girou
        c.parked(120.0, phoneMount = mount + 45)
        assertNull(c.headingDeg)
    }

    @Test fun phoneMovedWhileDrivingIsRelearned() {
        val c = Compass()
        c.drive(120.0, 12.0)
        // Agora o celular está a 10° (girou 60° no suporte): discorda do GPS e reaprende
        c.drive(120.0, 30.0, phoneMount = 10.0)
        t += Compass.GPS_HOLD_MS + 1000
        c.parked(200.0, phoneMount = 10.0)
        assertEquals(200.0, c.headingDeg!!, 1.0)
    }

    @Test fun bothCompassesAgreeingAreAveraged() {
        val c = Compass()
        c.drive(120.0, 12.0)
        // Magnetômetro do ESP32 já calibrado: aqui, simulado por um Compass que só tem a leitura dele pronta
        val fused = fuse(c, magDeg = 100.0, phoneDeg = 110.0)
        assertEquals(Compass.SOURCE_BOTH, fused.first)
        assertEquals(100.0 + 10.0 * Compass.PHONE_WEIGHT, fused.second, 0.5)
    }

    @Test fun disagreeingCompassesTrustTheEsp32() {
        val c = Compass()
        c.drive(120.0, 12.0)
        val fused = fuse(c, magDeg = 100.0, phoneDeg = 150.0)
        assertEquals(Compass.SOURCE_MAG, fused.first)
        assertEquals(100.0, fused.second, 0.5)
    }

    /**
     * Junta uma leitura do magnetômetro (já calibrado por uma volta com GPS) e a do celular, parado e sem GPS.
     * Devolve a fonte e o rumo escolhidos.
     */
    private fun fuse(phoneLearned: Compass, magDeg: Double, phoneDeg: Double): Pair<String?, Double> {
        val c = phoneLearned
        // Volta inteira com o magnetômetro para calibrar a bússola do ESP32 (campo ideal, sem ferro)
        var h = 0.0
        while (h < 360) {
            t += 200
            c.onGps(t, h.toFloat(), 30.0, 5f)
            c.onMag(t, field(h), 2.4)
            c.onPhone(t, Compass.norm(h - mount), 2, true, 2.4)
            c.update(t, 30.0)
            h += 2.4 * 0.2
        }
        assertTrue(c.ready)
        t += Compass.GPS_HOLD_MS + 1000
        repeat(20) {
            t += 200
            c.onGps(t, null, 0.0, 50f)
            c.onMag(t, field(magDeg), 0.0)
            c.onPhone(t, Compass.norm(phoneDeg - mount), 2, true, null)
            c.update(t, 0.0)
        }
        return c.source to c.headingDeg!!
    }

    private fun field(heading: Double): DoubleArray {
        val a = Math.toRadians(heading)
        return doubleArrayOf(22.0 * cos(a), 22.0 * sin(a), 10.0)
    }

    @Test fun picksTheMostHorizontalAxisOfThePhone() {
        // Celular em pé, tela para o motorista, olhando para o norte: a traseira aponta para o norte
        val upright = floatArrayOf(
            1f, 0f, 0f,
            0f, 0f, -1f,
            0f, 1f, 0f,
        )
        val (axis, deg) = PhoneCompassSensor.pickAxis(upright, null)!!
        assertEquals(2, axis)
        assertEquals(0.0, Compass.wrap(deg), 0.5)
        // Deitado, topo para o leste: o eixo é o topo
        val flat = floatArrayOf(
            0f, 1f, 0f,
            -1f, 0f, 0f,
            0f, 0f, 1f,
        )
        val (axis2, deg2) = PhoneCompassSensor.pickAxis(flat, null)!!
        assertEquals(1, axis2)
        assertEquals(90.0, deg2, 0.5)
    }
}

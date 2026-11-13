package com.universal.obddashboard.service

import android.hardware.Sensor
import android.hardware.SensorEvent
import android.hardware.SensorEventListener
import android.hardware.SensorManager
import com.universal.obddashboard.telemetry.PhoneHeading
import kotlin.math.abs
import kotlin.math.atan2
import kotlin.math.sqrt

/**
 * Bússola do celular, reserva para o rumo com o carro parado quando o ESP32 não tem magnetômetro.
 *
 * O sensor de rotação do Android dá a posição do aparelho em relação ao norte. O celular fica no suporte em qualquer
 * ângulo (em pé, deitado, na horizontal ou na vertical), então aqui só se escolhe o eixo do aparelho mais perto da
 * horizontal e se informa o rumo dele; a diferença para a frente do carro é aprendida com o GPS ([Compass]).
 * Até [MAX_RATE_MS] por leitura, para não encher o estado do app.
 */
class PhoneCompassSensor(private val sensors: SensorManager, private val onHeading: (PhoneHeading) -> Unit) : SensorEventListener {

    private var axis: Int? = null
    private var reliable = true
    private var lastAt = 0L
    private val rot = FloatArray(9)

    fun start(): Boolean {
        val s = sensors.getDefaultSensor(Sensor.TYPE_ROTATION_VECTOR)
            ?: sensors.getDefaultSensor(Sensor.TYPE_GEOMAGNETIC_ROTATION_VECTOR)
            ?: return false
        axis = null
        return sensors.registerListener(this, s, SensorManager.SENSOR_DELAY_UI)
    }

    fun stop() {
        sensors.unregisterListener(this)
    }

    override fun onAccuracyChanged(sensor: Sensor?, accuracy: Int) {
        reliable = accuracy != SensorManager.SENSOR_STATUS_UNRELIABLE
    }

    override fun onSensorChanged(event: SensorEvent) {
        val now = System.currentTimeMillis()
        if (now - lastAt < MAX_RATE_MS) return
        lastAt = now
        SensorManager.getRotationMatrixFromVector(rot, event.values)
        val pick = pickAxis(rot, axis) ?: return
        axis = pick.first
        onHeading(PhoneHeading(pick.second, pick.first, reliable, now))
    }

    companion object {
        const val MAX_RATE_MS = 200L
        /** Eixo trocado só quando o novo está bem mais na horizontal: sem pular de um para outro. */
        private const val SWITCH_MARGIN = 0.2
        /** Eixo a mais de ~60° da horizontal não dá rumo confiável. */
        private const val MIN_HORIZONTAL = 0.5

        /**
         * Escolhe o eixo do aparelho mais perto da horizontal e devolve (eixo, rumo em graus). [r] é a matriz de
         * rotação do Android (do aparelho para o mundo: x leste, y norte, z para cima), em linhas. Eixos: 0 = +X (lado
         * direito), 1 = +Y (topo), 2 = −Z (traseira, para onde a câmera aponta).
         */
        fun pickAxis(r: FloatArray, current: Int?): Pair<Int, Double>? {
            fun col(a: Int): DoubleArray {
                val sign = if (a == 2) -1.0 else 1.0
                return DoubleArray(3) { row -> sign * r[row * 3 + a] }
            }
            fun horiz(a: Int): Double { val v = col(a); return sqrt(v[0] * v[0] + v[1] * v[1]) }
            val best = listOf(2, 1, 0).maxBy { horiz(it) }   // empate: traseira, depois o topo
            val chosen = if (current != null && horiz(current) >= MIN_HORIZONTAL && horiz(best) - horiz(current) < SWITCH_MARGIN) current else best
            if (horiz(chosen) < MIN_HORIZONTAL) return null
            val v = col(chosen)
            if (abs(v[0]) + abs(v[1]) < 1e-6) return null
            val deg = Math.toDegrees(atan2(v[0], v[1]))
            return chosen to (if (deg < 0) deg + 360.0 else deg)
        }
    }
}

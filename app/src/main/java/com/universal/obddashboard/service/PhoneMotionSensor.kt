package com.universal.obddashboard.service

import android.hardware.Sensor
import android.hardware.SensorEvent
import android.hardware.SensorEventListener
import android.hardware.SensorManager
import com.universal.obddashboard.telemetry.PhoneSensors
import kotlin.math.abs
import kotlin.math.sqrt

/**
 * Acelerômetro, giroscópio e barômetro do próprio celular, como reserva dos sensores do ESP32: entram como leituras
 * "phone_*" no mesmo formato das linhas do LSM6DS3 (média de 200 ms em g e °/s, com o pico) e do BMP180 (hPa). O app
 * aprende a posição do celular no suporte do mesmo jeito que aprende a do módulo, numa calibração separada.
 *
 * Os valores chegam por [onValues] na thread principal.
 */
class PhoneMotionSensor(
    private val sensors: SensorManager,
    private val onValues: (Map<String, Double>, Long) -> Unit,
) : SensorEventListener {

    private val acc = DoubleArray(3)
    private val gyro = DoubleArray(3)
    private var nAcc = 0
    private var nGyro = 0
    private var peak = 0.0
    private var blockAt = 0L
    private var pressureSum = 0.0
    private var nPressure = 0
    private var pressureAt = 0L

    /** Liga o que o celular tiver. Devolve true se há pelo menos o acelerômetro ou o barômetro. */
    fun start(): Boolean {
        val a = sensors.getDefaultSensor(Sensor.TYPE_ACCELEROMETER)
        val g = sensors.getDefaultSensor(Sensor.TYPE_GYROSCOPE)
        val p = sensors.getDefaultSensor(Sensor.TYPE_PRESSURE)
        var any = false
        if (a != null && sensors.registerListener(this, a, SensorManager.SENSOR_DELAY_GAME)) any = true
        if (g != null) sensors.registerListener(this, g, SensorManager.SENSOR_DELAY_GAME)
        if (p != null && sensors.registerListener(this, p, SensorManager.SENSOR_DELAY_NORMAL)) any = true
        return any
    }

    fun stop() {
        sensors.unregisterListener(this)
    }

    override fun onAccuracyChanged(sensor: Sensor?, accuracy: Int) = Unit

    override fun onSensorChanged(event: SensorEvent) {
        val now = System.currentTimeMillis()
        val v = event.values
        when (event.sensor.type) {
            Sensor.TYPE_ACCELEROMETER -> {
                val x = v[0] / G
                val y = v[1] / G
                val z = v[2] / G
                acc[0] += x; acc[1] += y; acc[2] += z
                nAcc++
                val dev = abs(sqrt(x * x + y * y + z * z) - 1.0)
                if (dev > peak) peak = dev
            }
            Sensor.TYPE_GYROSCOPE -> {
                for (i in 0..2) gyro[i] += v[i] * RAD_TO_DEG
                nGyro++
            }
            Sensor.TYPE_PRESSURE -> {
                pressureSum += v[0]
                nPressure++
            }
        }
        if (blockAt == 0L) blockAt = now
        if (now - blockAt >= BLOCK_MS && nAcc > 0) {
            val out = HashMap<String, Double>(8)
            out[PhoneSensors.AX] = acc[0] / nAcc
            out[PhoneSensors.AY] = acc[1] / nAcc
            out[PhoneSensors.AZ] = acc[2] / nAcc
            out[PhoneSensors.GX] = if (nGyro > 0) gyro[0] / nGyro else 0.0
            out[PhoneSensors.GY] = if (nGyro > 0) gyro[1] / nGyro else 0.0
            out[PhoneSensors.GZ] = if (nGyro > 0) gyro[2] / nGyro else 0.0
            out[PhoneSensors.PEAK] = peak
            onValues(out, now)
            acc.fill(0.0); gyro.fill(0.0)
            nAcc = 0; nGyro = 0; peak = 0.0
            blockAt = now
        }
        if (pressureAt == 0L) pressureAt = now
        if (now - pressureAt >= PRESSURE_MS && nPressure > 0) {
            onValues(mapOf(PhoneSensors.PRESSURE to pressureSum / nPressure), now)
            pressureSum = 0.0
            nPressure = 0
            pressureAt = now
        }
    }

    companion object {
        const val BLOCK_MS = 200L
        const val PRESSURE_MS = 1000L
        private const val G = 9.80665
        private const val RAD_TO_DEG = 180.0 / Math.PI
    }
}

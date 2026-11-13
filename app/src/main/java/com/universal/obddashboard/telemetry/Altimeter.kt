package com.universal.obddashboard.telemetry

import kotlin.math.pow

/**
 * Altitude pela pressão do sensor ambiente do ESP32 (BMP180), acertada pela altitude do GPS.
 *
 * Pela pressão, a altitude acompanha bem a subida e a descida, mas o valor absoluto erra com o tempo (uma frente
 * fria muda a pressão como 100 m de serra). O GPS acerta o absoluto, mas oscila. Juntos: a pressão dá a forma,
 * o GPS (quando a precisão é boa) puxa devagar a diferença. Sem GPS, vale a atmosfera padrão e [calibrated] é false.
 *
 * A tendência sai da reta da altitude pela pressão nos últimos [TREND_WINDOW_MS]: +1 subindo, −1 descendo, 0 estável.
 */
class Altimeter {

    var altitudeM: Double? = null; private set
    var trend = 0; private set
    val calibrated: Boolean get() = offsetM != null

    private var offsetM: Double? = null
    private var baro: Double? = null
    private val history = ArrayDeque<Pair<Long, Double>>()

    /** Nova pressão (hPa). */
    fun onPressure(t: Long, hPa: Double) {
        if (hPa !in 300.0..1100.0) return
        val b = 44330.0 * (1 - (hPa / SEA_LEVEL_HPA).pow(1 / 5.255))
        baro = b
        history.addLast(t to b)
        while (history.size > 2 && t - history.first().first > TREND_WINDOW_MS) history.removeFirst()
        altitudeM = b + (offsetM ?: 0.0)
        trend = trendOf()
    }

    /** Altitude do GPS (m, acima do nível do mar) e a precisão vertical, quando houver. */
    fun onGps(altM: Double?, verticalAccuracyM: Float?) {
        val b = baro ?: return
        if (altM == null || !altM.isFinite()) return
        if (verticalAccuracyM != null && verticalAccuracyM > GPS_MAX_VACC_M) return
        val diff = altM - b
        // Primeira leitura boa acerta de uma vez; depois, só devagar (o GPS oscila uns metros)
        offsetM = offsetM?.let { it + (diff - it) * GPS_GAIN } ?: diff
        altitudeM = b + offsetM!!
    }

    private fun trendOf(): Int {
        if (history.size < 3) return 0
        val t0 = history.first().first
        if (history.last().first - t0 < TREND_WINDOW_MS / 2) return 0
        val n = history.size
        val mx = history.sumOf { (it.first - t0) / 1000.0 } / n
        val my = history.sumOf { it.second } / n
        var sxy = 0.0
        var sxx = 0.0
        for ((t, y) in history) {
            val x = (t - t0) / 1000.0 - mx
            sxy += x * (y - my)
            sxx += x * x
        }
        val mPerS = if (sxx < 1e-9) 0.0 else sxy / sxx
        return when {
            mPerS > TREND_M_PER_S -> 1
            mPerS < -TREND_M_PER_S -> -1
            else -> 0
        }
    }

    companion object {
        const val SEA_LEVEL_HPA = 1013.25
        const val TREND_WINDOW_MS = 30_000L
        /** 0,2 m/s = 12 m por minuto: uma ladeira, não a oscilação do sensor. */
        const val TREND_M_PER_S = 0.2
        const val GPS_MAX_VACC_M = 15f
        const val GPS_GAIN = 0.02
    }
}

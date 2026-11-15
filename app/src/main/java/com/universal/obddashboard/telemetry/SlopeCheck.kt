package com.universal.obddashboard.telemetry

import kotlin.math.abs
import kotlin.math.atan
import kotlin.math.PI

/**
 * Confere a inclinação do sensor de movimento pela subida medida na pressão: a cada [SEGMENT_M] andados, a variação da
 * altitude (BMP180) dividida pela distância dá a inclinação média da rua. Comparada com a média do sensor no mesmo
 * trecho, a diferença mostra se a calibração saiu do lugar (módulo mexido, "cima" aprendido torto).
 *
 * A diferença é uma média que esquece devagar, em graus: positiva quando o sensor marca mais subida que a pressão.
 * Só vale depois de [MIN_SEGMENTS] trechos; [suspicious] acende acima de [WARN_DEG].
 */
class SlopeCheck {

    private var startAlt: Double? = null
    private var distM = 0.0
    private var imuSum = 0.0
    private var imuDist = 0.0
    private var diffDeg: Double? = null
    var segments = 0; private set
    /** Inclinação do último trecho pela pressão (%). */
    var baroSlopePct: Double? = null; private set

    /** Diferença média sensor − pressão (graus), depois de [MIN_SEGMENTS] trechos. */
    val differenceDeg: Double? get() = diffDeg?.takeIf { segments >= MIN_SEGMENTS }
    val suspicious: Boolean get() = differenceDeg?.let { abs(it) > WARN_DEG } ?: false

    /**
     * Um passo: [speedKmh] (já com o fator), altitude pela pressão ([altitudeM], só a forma importa) e a inclinação do
     * sensor ([imuSlopePct]). Sem altitude ou parado, recomeça o trecho.
     */
    fun update(dtS: Double, speedKmh: Double?, altitudeM: Double?, imuSlopePct: Double?) {
        if (altitudeM == null || speedKmh == null || speedKmh < MIN_KMH) {
            restart(altitudeM)
            return
        }
        if (startAlt == null) restart(altitudeM)
        val d = speedKmh / 3.6 * dtS
        distM += d
        if (imuSlopePct != null) {
            imuSum += imuSlopePct * d
            imuDist += d
        }
        if (distM < SEGMENT_M) return
        val baro = (altitudeM - startAlt!!) / distM * 100
        baroSlopePct = baro
        if (imuDist >= distM * 0.8 && abs(baro) <= MAX_SLOPE_PCT) {
            val imu = imuSum / imuDist
            val diff = deg(imu) - deg(baro)
            diffDeg = diffDeg?.let { it + (diff - it) * GAIN } ?: diff
            segments++
        }
        restart(altitudeM)
    }

    private fun restart(alt: Double?) {
        startAlt = alt
        distM = 0.0
        imuSum = 0.0
        imuDist = 0.0
    }

    private fun deg(pct: Double) = atan(pct / 100) * 180 / PI

    companion object {
        /** Trecho de 200 m: a pressão erra uns 0,5 m, ou 0,25% de inclinação. */
        const val SEGMENT_M = 200.0
        const val MIN_KMH = 15.0
        const val MAX_SLOPE_PCT = 25.0
        const val GAIN = 0.1
        const val MIN_SEGMENTS = 10
        const val WARN_DEG = 1.5
    }
}

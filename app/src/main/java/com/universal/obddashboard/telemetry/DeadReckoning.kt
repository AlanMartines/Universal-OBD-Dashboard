package com.universal.obddashboard.telemetry

import kotlin.math.PI
import kotlin.math.cos
import kotlin.math.sin

/**
 * Percurso sem buracos: sem GPS bom (túnel, garagem, prédios), a posição continua pela velocidade do carro e pelo rumo
 * (bússola do ESP32 ou do celular, com o giro do sensor de movimento entre uma leitura e outra). Quando o GPS volta, a
 * diferença entre a posição estimada e a real vira uma [Correction], que espalha o erro pelo trecho estimado (zero no
 * começo, inteiro no fim): os pontos gravados no meio são acertados de uma vez.
 *
 * Só estima depois de um GPS bom (precisa de um ponto de partida) e desiste depois de [MAX_M] ou [MAX_MS], quando o erro
 * já seria grande demais para valer a pena.
 */
class DeadReckoning {

    /** Posição estimada agora e a incerteza (m), que cresce com a distância andada sem GPS. */
    data class Estimate(val latitude: Double, val longitude: Double, val accuracyM: Float, val sinceMs: Long, val distanceM: Double)

    /** Trecho estimado de [fromMs] a [toMs]: o ponto do instante t anda (t − from)/(to − from) de ([dLat], [dLon]). */
    data class Correction(val fromMs: Long, val toMs: Long, val dLat: Double, val dLon: Double, val distanceM: Double) {
        /** Quanto somar ao ponto gravado em [t] (lat, lon); zero fora do trecho. */
        fun at(t: Long): Pair<Double, Double> {
            if (t < fromMs || t > toMs || toMs <= fromMs) return 0.0 to 0.0
            val k = (t - fromMs).toDouble() / (toMs - fromMs)
            return dLat * k to dLon * k
        }
    }

    private var lat: Double? = null
    private var lon: Double? = null
    private var headingDeg: Double? = null
    private var lastFixAt = 0L
    private var estimating = false
    private var distanceM = 0.0
    private var gaveUp = false

    var estimate: Estimate? = null; private set

    /** GPS bom: vira o novo ponto de partida; se havia estimativa, devolve a correção do trecho. */
    fun onGps(fix: GpsFix): Correction? {
        if (fix.accuracyM > GOOD_ACCURACY_M) return null
        val la = lat
        val lo = lon
        val corr = if (estimating && la != null && lo != null && distanceM > 0) {
            Correction(lastFixAt, fix.timestamp, fix.latitude - la, fix.longitude - lo, distanceM)
        } else {
            null
        }
        lat = fix.latitude
        lon = fix.longitude
        if (fix.bearing != null && (fix.speedKmh ?: 0.0) >= BEARING_MIN_KMH) headingDeg = fix.bearing.toDouble()
        lastFixAt = fix.timestamp
        estimating = false
        gaveUp = false
        distanceM = 0.0
        estimate = null
        return corr
    }

    /**
     * A cada passo: sem GPS há [GAP_MS], anda [speedKmh] no rumo. [compassDeg] é o rumo que não vem do GPS (bússola);
     * [yawDps] é o giro do carro (positivo virando à esquerda), que acompanha as curvas entre uma leitura e outra.
     */
    fun tick(now: Long, dtS: Double, speedKmh: Double?, compassDeg: Double?, yawDps: Double?): Estimate? {
        val la = lat ?: return null
        val lo = lon ?: return null
        if (now - lastFixAt < GAP_MS) {
            estimate = null
            return null
        }
        if (gaveUp) return null
        if (distanceM > MAX_M || now - lastFixAt > MAX_MS) {
            gaveUp = true
            estimate = null
            return null
        }
        // Rumo: o giro acompanha as curvas; a bússola puxa devagar o valor certo (o giro sozinho deriva)
        var h = headingDeg
        if (h != null && yawDps != null) h -= yawDps * dtS
        if (compassDeg != null) h = if (h == null || yawDps == null) compassDeg else h + wrap(compassDeg - h) * (dtS / COMPASS_TAU_S).coerceAtMost(1.0)
        headingDeg = h?.let { norm(it) }
        val v = speedKmh
        val heading = headingDeg
        if (v == null || heading == null) return estimate
        estimating = true
        val d = v / 3.6 * dtS
        if (d > 0) {
            val r = heading * PI / 180
            val nLat = la + d * cos(r) / EARTH_M * 180 / PI
            val nLon = lo + d * sin(r) / (EARTH_M * cos(la * PI / 180)) * 180 / PI
            lat = nLat
            lon = nLon
            distanceM += d
        }
        estimate = Estimate(lat!!, lon!!, (BASE_ACCURACY_M + distanceM * ERROR_PER_M).toFloat(), now - lastFixAt, distanceM)
        return estimate
    }

    private fun wrap(d: Double): Double { var x = d % 360; if (x > 180) x -= 360; if (x < -180) x += 360; return x }
    private fun norm(d: Double): Double { val x = d % 360; return if (x < 0) x + 360 else x }

    companion object {
        /** GPS que serve de ponto de partida (m). */
        const val GOOD_ACCURACY_M = 25f
        /** Sem GPS há este tempo, começa a estimar. */
        const val GAP_MS = 5000L
        /** Desiste depois disto: o erro já seria grande. */
        const val MAX_M = 5000.0
        const val MAX_MS = 10 * 60 * 1000L
        const val BEARING_MIN_KMH = 8.0
        const val COMPASS_TAU_S = 3.0
        const val BASE_ACCURACY_M = 15.0
        /** O erro cresce uns 5% da distância andada sem GPS. */
        const val ERROR_PER_M = 0.05
        private const val EARTH_M = 6_371_000.0
    }
}

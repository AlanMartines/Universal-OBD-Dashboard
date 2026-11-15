package com.universal.obddashboard.telemetry

import kotlin.math.abs

/**
 * Fator da velocidade do carro aprendido pelo GPS: em trechos firmes (velocidade constante, GPS preciso, sem curva), soma
 * a distância pelo GPS e pela velocidade do carro. O fator (GPS ÷ carro) vale onde a velocidade do carro substitui o GPS:
 * a distância sem GPS e o percurso estimado ([DeadReckoning]). Pega a calibragem e a troca de pneus.
 *
 * As somas esquecem devagar (no máximo [MEMORY_KM] de carro), para acompanhar uma mudança de pneu. O fator só vale
 * depois de [READY_KM]; até lá, fica o do perfil.
 */
class SpeedCalibrator(saved: State? = null) {

    /** Somas em km, salvas entre as viagens (por veículo). */
    data class State(val carKm: Double, val gpsKm: Double) {
        fun encode() = "$carKm;$gpsKm"
        companion object {
            fun decode(text: String?): State? = runCatching {
                val (a, b) = text!!.split(';').map { it.toDouble() }
                State(a, b).takeIf { a >= 0 && b >= 0 && a.isFinite() && b.isFinite() }
            }.getOrNull()
        }
    }

    private var carKm = saved?.carKm ?: 0.0
    private var gpsKm = saved?.gpsKm ?: 0.0
    private var lastCar: Pair<Long, Double>? = null
    private var prevCar: Pair<Long, Double>? = null
    /** Quantas vezes as somas mudaram (para salvar de tempos em tempos). */
    var changes = 0; private set

    val state: State get() = State(carKm, gpsKm)
    val learnedKm: Double get() = carKm
    val ready: Boolean get() = carKm >= READY_KM

    /** Fator aprendido, ou null antes de [READY_KM]. */
    val factor: Double? get() = if (ready && carKm > 0) (gpsKm / carKm).takeIf { it in MIN_FACTOR..MAX_FACTOR } else null

    /**
     * Um passo de [dtS]: leitura da velocidade do carro (km/h da ECU, sem fator, e o instante dela), GPS (velocidade,
     * precisão e instante) e o giro (°/s). Só conta com as duas velocidades firmes e parecidas.
     */
    fun update(now: Long, dtS: Double, carKmh: Double?, carAt: Long?, gpsKmh: Double?, gpsAccuracyM: Float?, gpsAt: Long?, yawDps: Double?) {
        if (carKmh != null && carAt != null && carAt != lastCar?.first) {
            prevCar = lastCar
            lastCar = carAt to carKmh
        }
        if (carKmh == null || carAt == null || gpsKmh == null || gpsAccuracyM == null || gpsAt == null) return
        if (now - gpsAt > GPS_FRESH_MS || now - carAt > CAR_FRESH_MS) return
        if (carKmh < MIN_KMH || gpsKmh < MIN_KMH || gpsAccuracyM > MAX_ACCURACY_M) return
        if (yawDps != null && abs(yawDps) > MAX_YAW_DPS) return
        // Firme: a velocidade do carro mudou pouco entre as duas últimas leituras
        val prev = prevCar ?: return
        val gapS = (carAt - prev.first) / 1000.0
        if (gapS <= 0 || gapS > 3 || abs(carKmh - prev.second) / gapS > MAX_DV_KMH_S) return
        val ratio = gpsKmh / carKmh
        if (ratio !in MIN_FACTOR..MAX_FACTOR) return
        carKm += carKmh * dtS / 3600
        gpsKm += gpsKmh * dtS / 3600
        if (carKm > MEMORY_KM) {
            val k = MEMORY_KM / carKm
            carKm *= k
            gpsKm *= k
        }
        changes++
    }

    fun reset() {
        carKm = 0.0
        gpsKm = 0.0
        changes++
    }

    companion object {
        const val MIN_KMH = 30.0
        const val MAX_ACCURACY_M = 10f
        const val GPS_FRESH_MS = 2500L
        const val CAR_FRESH_MS = 2500L
        const val MAX_YAW_DPS = 3.0
        /** Variação máxima da velocidade do carro (km/h por segundo) para contar como firme. */
        const val MAX_DV_KMH_S = 1.5
        const val MIN_FACTOR = 0.85
        const val MAX_FACTOR = 1.15
        const val READY_KM = 5.0
        const val MEMORY_KM = 300.0
    }
}

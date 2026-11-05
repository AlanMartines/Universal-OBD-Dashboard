package com.universal.obddashboard.telemetry

import com.universal.obddashboard.db.TelemetryLogEntity
import kotlin.math.exp

/**
 * Computador de bordo da viagem: a cada leitura, acumula tempo andando e parado, marcha lenta (tempo e
 * litros), km com a injeção cortada e o tempo em cada faixa de economia. Serve tanto ao vivo (alimentado
 * pelo motor de telemetria) quanto ao resumo de uma viagem gravada (alimentado pelas amostras salvas).
 *
 * [ecoMidLPer100km] é o meio do indicador de economia: abaixo dele (com folga) é verde, acima é vermelho.
 */
class TripStats(private val ecoMidLPer100km: Double = DEFAULT_ECO_MID) {
    var movingS = 0.0; private set
    var movingKm = 0.0; private set
    var idleS = 0.0; private set
    var idleFuelL = 0.0; private set
    var fuelCutKm = 0.0; private set
    private val ecoS = DoubleArray(3)

    @Synchronized
    fun add(dtS: Double, speedKmh: Double?, rpm: Double?, fuelLph: Double?) {
        if (dtS <= 0 || dtS > MAX_GAP_S || speedKmh == null) return
        if (speedKmh >= MOVING_KMH) {
            movingS += dtS
            movingKm += speedKmh * dtS / 3600.0
            if (fuelLph != null && speedKmh >= ECO_MIN_KMH) {
                if (fuelLph < CUT_LPH) fuelCutKm += speedKmh * dtS / 3600.0
                else ecoS[band(fuelLph / speedKmh * 100.0, ecoMidLPer100km)] += dtS
            }
        } else if (rpm != null && rpm >= ENGINE_RUNNING_RPM) {
            idleS += dtS
            fuelLph?.let { idleFuelL += it * dtS / 3600.0 }
        }
    }

    /** Velocidade média andando (sem contar o tempo parado), em km/h. */
    val avgMovingKmh: Double? get() = if (movingS >= 30) movingKm / (movingS / 3600.0) else null

    /** % do tempo andando, com consumo medido, em cada faixa: verde, meio, vermelho. null sem dados. */
    fun ecoPct(): List<Double>? {
        val total = ecoS.sum()
        return if (total < 10) null else ecoS.map { it / total * 100.0 }
    }

    companion object {
        const val DEFAULT_ECO_MID = 10.0
        const val MOVING_KMH = 3.0
        const val ECO_MIN_KMH = 10.0
        const val CUT_LPH = 0.05
        const val ENGINE_RUNNING_RPM = 300.0
        /** Intervalo maior que isso entre duas leituras é uma falha de dados, não tempo parado. */
        const val MAX_GAP_S = 10.0

        /** 0 = verde, 1 = meio, 2 = vermelho, pelo consumo por distância (L/100 km). */
        fun band(lPer100km: Double, mid: Double = DEFAULT_ECO_MID): Int = when {
            lPer100km < mid * 0.95 -> 0
            lPer100km <= mid * 1.10 -> 1
            else -> 2
        }

        /** Refaz as contas de uma viagem a partir das amostras gravadas (a cada ~2 s). */
        fun fromLogs(logs: List<TelemetryLogEntity>, ecoMid: Double = DEFAULT_ECO_MID): TripStats {
            val s = TripStats(ecoMid)
            logs.zipWithNext().forEach { (a, b) ->
                s.add((b.timestamp - a.timestamp) / 1000.0, a.speedObdKmh ?: a.speedGpsKmh, a.rpm, a.fuelLph)
            }
            return s
        }
    }
}

/** Média móvel exponencial no tempo: o número na tela não pula a cada leitura. */
class Smoothed(private val tauS: Double = 3.0) {
    var value: Double? = null; private set

    fun update(sample: Double?, dtS: Double): Double? {
        if (sample == null) return value
        val prev = value
        value = if (prev == null || dtS <= 0 || dtS > TripStats.MAX_GAP_S) sample else prev + (sample - prev) * (1 - exp(-dtS / tauS))
        return value
    }

    fun reset() { value = null }
}

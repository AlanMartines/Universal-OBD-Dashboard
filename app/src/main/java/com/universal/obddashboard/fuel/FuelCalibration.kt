package com.universal.obddashboard.fuel

import com.universal.obddashboard.db.FuelSample
import kotlin.math.abs

/**
 * Calibração do consumo com os abastecimentos: compara, em cada intervalo entre tanques cheios,
 * os litros reais com os estimados pelo app (integral do consumo instantâneo gravado) e sugere
 * um fator de correção. Só sugere; quem aplica é o usuário.
 */
object FuelCalibration {

    const val MIN_INTERVALS = 3
    /** Intervalos que fogem mais que isso (abastecimento incompleto, % de etanol errado) ficam de fora. */
    const val MAX_DEVIATION = 0.25
    /** Abaixo disso não vale mexer (variação normal do enchimento na bomba). */
    const val MIN_CHANGE = 0.01
    const val MIN_FACTOR = 0.7
    const val MAX_FACTOR = 1.3
    private const val MAX_GAP_S = 10.0

    /** Litros consumidos segundo o app no período (lacunas acima de 10 s não contam). */
    fun integrateLiters(samples: List<FuelSample>): Double {
        var liters = 0.0
        for (i in 1 until samples.size) {
            val dt = (samples[i].timestamp - samples[i - 1].timestamp) / 1000.0
            val lph = samples[i].lph
            if (dt <= 0 || dt > MAX_GAP_S || lph == null || !lph.isFinite()) continue
            liters += lph * dt / 3600.0
        }
        return liters
    }

    data class Check(val from: Long, val to: Long, val realL: Double, val estimatedL: Double) {
        val deviation: Double get() = estimatedL / realL - 1
    }

    data class Result(
        val used: List<Check>,
        val ignored: List<Check>,
        val currentFactor: Double,
        /** null: poucos intervalos, ou a correção seria pequena demais. */
        val suggestedFactor: Double?,
    ) {
        val deviation: Double? get() = if (used.isEmpty()) null else used.sumOf { it.estimatedL } / used.sumOf { it.realL } - 1
        val missing: Int get() = (MIN_INTERVALS - used.size).coerceAtLeast(0)
    }

    /**
     * [checks] só dos intervalos que começaram depois da última mudança do fator ([since]): os
     * anteriores foram estimados com outro fator.
     */
    fun evaluate(checks: List<Check>, currentFactor: Double, since: Long): Result {
        val after = checks.filter { it.from >= since && it.realL > 0 && it.estimatedL > 0.5 }
        val (used, ignored) = after.partition { abs(it.deviation) <= MAX_DEVIATION }
        val suggested = if (used.size >= MIN_INTERVALS) {
            val ratio = used.sumOf { it.realL } / used.sumOf { it.estimatedL }
            (currentFactor * ratio).coerceIn(MIN_FACTOR, MAX_FACTOR).takeIf { abs(ratio - 1) >= MIN_CHANGE }
        } else null
        return Result(used, ignored, currentFactor, suggested)
    }
}

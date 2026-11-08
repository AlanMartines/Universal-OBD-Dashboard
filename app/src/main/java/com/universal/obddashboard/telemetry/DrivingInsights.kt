package com.universal.obddashboard.telemetry

import kotlin.math.abs

/** Carga pela pressão do coletor sobre a atmosférica, medida com o motor parado. Para ECUs cuja carga informada não acompanha o motor. */
/**
 * Carga estimada pelo coletor: MAP ÷ pressão atmosférica.
 *
 * A pressão atmosférica vem do sensor ambiente do ESP32 (BMP180) quando ele manda leitura: vale ao vivo,
 * também numa subida de serra. Sem o sensor, é o MAP lido com a chave ligada e o motor parado, guardado
 * entre viagens. Com os dois, mede também o vácuo do coletor e o desvio do sensor MAP (só diagnóstico:
 * o consumo não é corrigido por ele, porque a calibração pelos abastecimentos já absorve o erro médio).
 */
class EstimatedLoad(atmosphericKpa: Double?) {
    var atmosphericKpa: Double? = atmosphericKpa
        private set
    /** Pressão atmosférica menos o MAP, com o motor ligado (kPa). */
    var vacuumKpa: Double? = null
        private set
    /** MAP menos a pressão do sensor ambiente, com o motor parado (kPa), suavizado. */
    var mapOffsetKpa: Double? = null
        private set

    /** @param ambientKpa pressão do sensor ambiente (kPa), se houver leitura recente. */
    fun update(rpm: Double?, mapKpa: Double?, ambientKpa: Double? = null): Double? {
        val ambient = ambientKpa?.takeIf { it in ATMOSPHERIC_RANGE }
        if (ambient != null) atmosphericKpa = ambient
        vacuumKpa = null
        if (rpm == null || mapKpa == null) return null
        if (rpm < ENGINE_RUNNING_RPM) {
            if (ambient != null) {
                if (mapKpa in ATMOSPHERIC_RANGE) {
                    val d = mapKpa - ambient
                    mapOffsetKpa = mapOffsetKpa?.let { it + (d - it) * OFFSET_SMOOTHING } ?: d
                }
            } else if (mapKpa in ATMOSPHERIC_RANGE) {
                atmosphericKpa = mapKpa
            }
            return null
        }
        val atm = atmosphericKpa ?: return null
        vacuumKpa = (atm - mapKpa).coerceAtLeast(0.0)
        return (mapKpa / atm * 100).coerceIn(0.0, 100.0)
    }

    private companion object {
        const val ENGINE_RUNNING_RPM = 300.0
        val ATMOSPHERIC_RANGE = 50.0..110.0
        const val OFFSET_SMOOTHING = 0.2
    }
}

data class TimedRun(val band: String, val seconds: Double)

/** Mede sozinho arrancadas e retomadas enquanto a aceleração for contínua. */
class PerformanceTimers {
    private class Band(val from: Double, val to: Double) {
        val name = "${from.toInt()}-${to.toInt()}"
        var startedAt: Double? = null
        var peak = 0.0
    }

    private val bands = BANDS.map { (from, to) -> Band(from, to) }
    private var lastT: Long? = null
    private var lastSpeed = 0.0

    fun onSpeed(t: Long, speed: Double): List<TimedRun> {
        val prevT = lastT
        val prev = lastSpeed
        if (prevT != null && t <= prevT) return emptyList()
        lastT = t
        lastSpeed = speed
        val gap = prevT == null || t - prevT > MAX_GAP_MS
        val runs = mutableListOf<TimedRun>()
        for (b in bands) {
            if (gap) b.startedAt = null
            // Em arrancada, o relógio parte da última leitura parada
            if (b.from == 0.0 && speed < STOPPED_KMH) { b.startedAt = t.toDouble(); b.peak = speed; continue }
            if (gap) continue
            val start = b.startedAt
            if (start == null) {
                if (b.from > 0 && prev < b.from && speed >= b.from) {
                    b.startedAt = crossing(prevT!!, prev, t, speed, b.from)
                    b.peak = speed
                }
            } else if (speed < b.peak - MAX_DROP_KMH || t - start > MAX_RUN_MS) {
                b.startedAt = null
            } else {
                if (speed > b.peak) b.peak = speed
                if (prev < b.to && speed >= b.to) {
                    val seconds = (crossing(prevT!!, prev, t, speed, b.to) - start) / 1000.0
                    if (seconds > 0 && (b.to - b.from) / seconds <= MAX_KMH_PER_S) runs += TimedRun(b.name, seconds)
                    b.startedAt = null
                }
            }
        }
        return runs
    }

    private fun crossing(t0: Long, v0: Double, t1: Long, v1: Double, target: Double): Double =
        t0 + (t1 - t0) * (target - v0) / (v1 - v0)

    companion object {
        val BANDS = listOf(0.0 to 60.0, 0.0 to 100.0, 40.0 to 60.0, 60.0 to 80.0, 80.0 to 120.0)
        private const val STOPPED_KMH = 1.0
        private const val MAX_GAP_MS = 3000L
        private const val MAX_DROP_KMH = 5.0
        private const val MAX_RUN_MS = 60_000L
        /** Acima disso é erro de leitura, não aceleração de carro de rua. */
        private const val MAX_KMH_PER_S = 40.0
    }
}

/** Diferença entre GPS e ECU em trechos de velocidade estável, para sugerir a correção do mostrador. */
object SpeedCalibration {
    data class Sample(val timestamp: Long, val obd: Double, val gps: Double, val accuracy: Float?)
    data class Suggestion(val pct: Double, val samples: Int)

    private const val MIN_SPEED = 20.0
    private const val MAX_ACCURACY_M = 10f
    private const val MAX_STEP_KMH = 2.0
    private const val MAX_GAP_MS = 3000L
    private const val MIN_SAMPLES = 60
    private val ALLOWED = -10.0..15.0

    /** @param samples em ordem de tempo. */
    fun suggest(samples: List<Sample>): Suggestion? {
        val ratios = samples.zipWithNext().filter { (a, b) ->
            b.timestamp - a.timestamp in 1..MAX_GAP_MS &&
                b.obd >= MIN_SPEED && a.obd >= MIN_SPEED &&
                b.accuracy != null && b.accuracy <= MAX_ACCURACY_M &&
                abs(b.obd - a.obd) <= MAX_STEP_KMH && abs(b.gps - a.gps) <= MAX_STEP_KMH
        }.map { (_, b) -> b.gps / b.obd }.sorted()
        if (ratios.size < MIN_SAMPLES) return null
        val median = ratios[ratios.size / 2]
        val pct = Math.round((median - 1) * 200) / 2.0
        return if (pct in ALLOWED) Suggestion(pct, ratios.size) else null
    }
}

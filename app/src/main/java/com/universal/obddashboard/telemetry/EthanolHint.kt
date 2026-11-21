package com.universal.obddashboard.telemetry

import kotlin.math.abs

/**
 * Pista do % de etanol no tanque (a central do Uno não informa: sem o PID 0152).
 *
 * A central flex descobre o combustível novo pela sonda, nos primeiros minutos depois de abastecer: enquanto não aprende,
 * a correção de curto prazo (STFT) salta. Mais etanol que antes deixa a mistura pobre e a correção sobe; menos etanol, o
 * contrário. Pelo salto, a relação ar/combustível nova sai de `AFR_antes / (1 + salto/100)`, e dela a % de etanol.
 *
 * Só vale na primeira viagem depois de um abastecimento registrado até 3 h antes, com o normal do carro conhecido (a
 * mediana da correção rodando nas viagens antes do abastecimento) e só em rodagem leve com o motor quente: em marcha
 * lenta a correção varia demais. É uma pista: aparece como aviso só num desvio grande do que foi informado.
 */
class EthanolHint(
    /** Hora do abastecimento. */
    val refuelAt: Long,
    /** % de etanol da bomba no tanque antes e depois do abastecimento, pelo que foi informado. */
    private val pctBefore: Double,
    private val pctAfter: Double,
    /** Correção rodando antes do abastecimento (%), o normal do carro com o combustível antigo. */
    private val baselineStft: Double,
    /** Relação ar/combustível estequiométrica da mistura com essa % de etanol da bomba (perfil). */
    private val afrOf: (Double) -> Double,
) {
    data class Result(
        val refuelAt: Long,
        /** Salto medido da correção (%), sobre o normal de antes. */
        val shiftPct: Double,
        /** Salto esperado pelo que foi informado (%). */
        val expectedPct: Double,
        val informedPct: Double,
        val estimatedPct: Double,
        val samples: Int,
    ) {
        /** Não bate com o informado: a % estimada longe e o salto bem diferente do esperado. */
        val mismatch: Boolean get() = abs(estimatedPct - informedPct) >= MISMATCH_PCT && abs(shiftPct - expectedPct) >= MISMATCH_SHIFT_PCT
    }

    private var tripStartAt: Long? = null
    private var firstAt: Long? = null
    private val stft = ArrayList<Double>()
    private var lastAt = 0L

    /** Só a primeira viagem até 3 h depois do abastecimento. */
    val applies: Boolean get() = (tripStartAt ?: Long.MAX_VALUE) - refuelAt in 0..RECENT_MS

    fun update(now: Long, rpm: Double?, speedKmh: Double?, coolantC: Double?, throttlePct: Double?, stftPct: Double?) {
        if (tripStartAt == null) tripStartAt = now
        if (!applies || stftPct == null || rpm == null) return
        // A central aprende em poucos minutos: só a janela logo depois da primeira leitura válida conta
        val first = firstAt
        if (first != null && now - first > WINDOW_MS) return
        if (now - tripStartAt!! > TRIP_MAX_MS) return
        val tps = throttlePct ?: return
        val ok = (coolantC ?: 0.0) >= WARM_C && rpm in RPM_MIN..RPM_MAX && (speedKmh ?: 0.0) >= SPEED_MIN && tps in TPS_MIN..TPS_MAX
        if (!ok || now - lastAt < 500) return
        if (firstAt == null) firstAt = now
        stft += stftPct
        lastAt = now
    }

    fun result(): Result? {
        if (!applies || stft.size < MIN_SAMPLES) return null
        val early = HealthMonitor.median(stft)
        val shift = early - baselineStft
        val afrBefore = afrOf(pctBefore)
        val expected = (afrBefore / afrOf(pctAfter) - 1) * 100
        val afrNew = afrBefore / (1 + shift / 100)
        return Result(refuelAt, shift, expected, pctAfter, pctForAfr(afrNew), stft.size)
    }

    /** % de etanol da bomba cuja relação ar/combustível é [afr] (a relação cai com mais etanol): busca por bisseção. */
    fun pctForAfr(afr: Double): Double {
        if (afr >= afrOf(0.0)) return 0.0
        if (afr <= afrOf(100.0)) return 100.0
        var lo = 0.0
        var hi = 100.0
        repeat(40) {
            val mid = (lo + hi) / 2
            if (afrOf(mid) > afr) lo = mid else hi = mid
        }
        return (lo + hi) / 2
    }

    companion object {
        const val RECENT_MS = 3 * 3600_000L
        /** Janela depois da primeira leitura válida, antes de a central aprender o combustível novo. */
        const val WINDOW_MS = 180_000L
        /** A primeira leitura válida tem de aparecer nos primeiros 20 min da viagem. */
        const val TRIP_MAX_MS = 20 * 60_000L
        const val WARM_C = 70.0
        const val RPM_MIN = 1300.0
        const val RPM_MAX = 3500.0
        const val SPEED_MIN = 20.0
        const val TPS_MIN = 3.0
        const val TPS_MAX = 40.0
        const val MIN_SAMPLES = 20
        /** Diferença entre a % estimada e a informada para virar aviso (pontos de %). */
        const val MISMATCH_PCT = 30.0
        /** E o salto medido tem de fugir do esperado por pelo menos isso (%), acima da variação normal da correção. */
        const val MISMATCH_SHIFT_PCT = 10.0
    }
}

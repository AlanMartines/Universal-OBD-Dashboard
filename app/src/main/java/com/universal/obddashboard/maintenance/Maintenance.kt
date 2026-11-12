package com.universal.obddashboard.maintenance

import java.util.Calendar
import java.util.TimeZone
import kotlin.math.max
import kotlin.math.min

/**
 * Lembretes de manutenção: quando cada item vence, pelo km e pela data, o que vier primeiro.
 * Sem registro ainda, o item fica "sem histórico" até a pessoa marcar a primeira vez.
 */
object Maintenance {

    enum class Level { OK, SOON, DUE, UNKNOWN }

    data class Status(
        val level: Level,
        val nextKm: Double?,
        val remainingKm: Double?,
        val nextAt: Long?,
        val remainingDays: Long?,
    )

    /** Aviso antes do vencimento: 10% do intervalo de km (entre 300 e 1.000 km) ou 30 dias. */
    fun soonKm(intervalKm: Double) = min(1_000.0, max(300.0, intervalKm * 0.1))
    const val SOON_DAYS = 30L
    private const val DAY_MS = 24 * 60 * 60 * 1000L

    /**
     * @param lastKm hodômetro da última vez (null = não anotado); @param lastAt data da última vez (null = nunca feito);
     * @param currentKm hodômetro de agora (null = desconhecido).
     * @param setNextKm / @param setNextAt próxima troca anotada (o que o mecânico passou): vale no lugar do intervalo.
     */
    fun status(
        intervalKm: Double?, intervalMonths: Int?, lastKm: Double?, lastAt: Long?, currentKm: Double?, now: Long,
        tz: TimeZone = TimeZone.getDefault(), setNextKm: Double? = null, setNextAt: Long? = null,
    ): Status {
        if (lastAt == null && setNextKm == null && setNextAt == null) return Status(Level.UNKNOWN, null, null, null, null)
        val nextKm = setNextKm ?: if (intervalKm != null && intervalKm > 0 && lastKm != null) lastKm + intervalKm else null
        val remainingKm = if (nextKm != null && currentKm != null) nextKm - currentKm else null
        val nextAt = setNextAt ?: if (lastAt != null && intervalMonths != null && intervalMonths > 0) addMonths(lastAt, intervalMonths, tz) else null
        val remainingDays = nextAt?.let { Math.floorDiv(it - now, DAY_MS) }
        // Aviso antes do km: 10% do trecho entre a última vez e a próxima (ou do intervalo); sem nenhum dos dois, 500 km
        val spanKm = if (nextKm != null && lastKm != null && nextKm > lastKm) nextKm - lastKm else intervalKm?.takeIf { it > 0 } ?: 5_000.0
        val byKm = when {
            remainingKm == null -> null
            remainingKm <= 0 -> Level.DUE
            remainingKm <= soonKm(spanKm) -> Level.SOON
            else -> Level.OK
        }
        val byDate = when {
            remainingDays == null -> null
            remainingDays < 0 -> Level.DUE
            remainingDays <= SOON_DAYS -> Level.SOON
            else -> Level.OK
        }
        // O que vencer primeiro manda: DUE > SOON > OK. Sem km nem data para comparar, fica UNKNOWN.
        val level = listOfNotNull(byKm, byDate).maxByOrNull { it.ordinal } ?: Level.UNKNOWN
        return Status(level, nextKm, remainingKm, nextAt, remainingDays)
    }

    /** Complemento do aviso: ": vencida há 120 km", ": faltam 800 km", ": vence em 12 dias"... */
    fun describe(s: Status): String {
        val km = s.remainingKm
        val days = s.remainingDays
        val porKm = km != null && (days == null || km / 40.0 <= days)   // o que chega primeiro (~40 km por dia)
        return when {
            porKm && km!! <= 0 -> ": vencida há ${"%,.0f".format(-km).replace(',', '.')} km"
            porKm -> ": faltam ${"%,.0f".format(km).replace(',', '.')} km"
            days != null && days < 0 -> ": vencida há ${-days} dias"
            days != null -> ": vence em $days dias"
            else -> ""
        }
    }

    /** Lista sugerida: o plano do perfil do veículo (manual do proprietário) ou, sem ele, a genérica. */
    fun presetsFor(plan: List<Preset>?): List<Preset> = plan?.takeIf { it.isNotEmpty() } ?: PRESETS

    fun addMonths(at: Long, months: Int, tz: TimeZone = TimeZone.getDefault()): Long =
        Calendar.getInstance(tz).apply { timeInMillis = at; add(Calendar.MONTH, months) }.timeInMillis

    /** Itens sugeridos para começar (intervalos comuns em carros de passeio; confira no manual do proprietário). */
    data class Preset(val name: String, val intervalKm: Double?, val intervalMonths: Int?, val notes: String? = null)

    val PRESETS = listOf(
        Preset("Troca de óleo do motor", 10_000.0, 12),
        Preset("Filtro de óleo", 10_000.0, 12),
        Preset("Filtro de ar do motor", 20_000.0, 24),
        Preset("Filtro de combustível", 20_000.0, 24),
        Preset("Filtro de ar da cabine", 15_000.0, 12),
        Preset("Velas de ignição", 30_000.0, null),
        Preset("Correia dentada", 50_000.0, 48),
        Preset("Fluido de freio", null, 24),
        Preset("Líquido de arrefecimento", 40_000.0, 24),
        Preset("Alinhamento e balanceamento", 10_000.0, 12),
        Preset("Rodízio dos pneus", 10_000.0, null),
    )
}

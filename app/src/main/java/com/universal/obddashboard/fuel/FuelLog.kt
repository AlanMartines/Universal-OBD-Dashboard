package com.universal.obddashboard.fuel

import com.universal.obddashboard.db.FuelUpEntity
import java.time.Instant
import java.time.LocalDateTime
import java.time.OffsetDateTime
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.util.Locale

/**
 * Cálculos sobre os abastecimentos (aba Abastecimentos), sem Android.
 *
 * Consumo real = litros colocados até o próximo tanque cheio ÷ km do hodômetro entre os dois
 * tanques cheios. Abastecimentos parciais no meio do intervalo somam litros e custo.
 */
object FuelLog {

    const val GASOLINE = "gasoline"
    const val GASOLINE_PREMIUM = "gasoline_premium"
    const val ETHANOL = "ethanol"
    const val MIX = "mix"
    val FUEL_TYPES = listOf(GASOLINE, GASOLINE_PREMIUM, ETHANOL, MIX)

    data class Interval(
        val from: FuelUpEntity,
        val to: FuelUpEntity,
        val distanceKm: Double,
        val liters: Double,
        /** null se algum abastecimento do intervalo não tem valor pago. */
        val cost: Double?,
        /** Combustível que rodou no intervalo (o colocado em [from]); MIX se houve parciais de outro tipo. */
        val fuelType: String,
    ) {
        val kmPerL: Double get() = distanceKm / liters
        val costPerKm: Double? get() = cost?.div(distanceKm)
    }

    data class Summary(
        val count: Int,
        val totalLiters: Double,
        val totalCost: Double,
        val intervals: List<Interval>,
        /** km/l médio ponderado (km somados ÷ litros somados) dos intervalos medidos. */
        val avgKmPerL: Double?,
        val costPerKm: Double?,
        val costByMonth: Map<String, Double>,
        /**
         * Etanol compensa se preço do etanol < [ethanolBreakEven] × preço da gasolina
         * (km/l etanol ÷ km/l gasolina medidos neste carro). null sem intervalos dos dois tipos.
         */
        val ethanolBreakEven: Double?,
    )

    private fun isGasoline(t: String) = t == GASOLINE || t == GASOLINE_PREMIUM

    /** % de etanol do que foi colocado (gasolina = 0: a gasolina C do perfil já inclui o etanol anidro). null = desconhecido. */
    fun ethanolPctOf(f: FuelUpEntity): Double? = when (f.fuelType) {
        GASOLINE, GASOLINE_PREMIUM -> 0.0
        ETHANOL -> 100.0
        else -> f.ethanolPct?.coerceIn(0.0, 100.0)
    }

    /** Tanque depois de um abastecimento: nível (L) e % de etanol da mistura. */
    data class TankAfter(val levelL: Double, val ethanolPct: Double)

    /**
     * Tanque cheio: o que havia antes = capacidade − litros colocados. Parcial: soma ao nível
     * estimado [levelBeforeL] (sem ele, só o % muda se o tanque estava vazio). Mistura por volume.
     */
    fun tankAfter(f: FuelUpEntity, capacityL: Double, levelBeforeL: Double?, ethanolPctBefore: Double): TankAfter {
        val before = if (f.fullTank) (capacityL - f.liters).coerceAtLeast(0.0) else (levelBeforeL ?: 0.0).coerceIn(0.0, capacityL)
        val added = ethanolPctOf(f)
        val level = if (f.fullTank) capacityL else (before + f.liters).coerceAtMost(capacityL)
        val pct = if (added == null || before + f.liters <= 0) ethanolPctBefore
        else (before * ethanolPctBefore + f.liters * added) / (before + f.liters)
        return TankAfter(level, pct)
    }

    fun intervals(list: List<FuelUpEntity>): List<Interval> {
        val sorted = list.sortedBy { it.timestamp }
        val out = mutableListOf<Interval>()
        var start: FuelUpEntity? = null
        var liters = 0.0
        var cost: Double? = 0.0
        var types = mutableSetOf<String>()
        for (f in sorted) {
            val s = start
            if (s != null) {
                liters += f.liters
                cost = if (cost != null && f.totalPrice != null) cost + f.totalPrice else null
                if (!f.fullTank) types += f.fuelType
            }
            if (f.fullTank) {
                if (s != null && s.odometerKm != null && f.odometerKm != null && f.odometerKm > s.odometerKm && liters > 0) {
                    val kinds = types + s.fuelType
                    val type = when {
                        kinds.size == 1 -> s.fuelType
                        kinds.all(::isGasoline) -> GASOLINE
                        else -> MIX
                    }
                    out += Interval(s, f, f.odometerKm - s.odometerKm, liters, cost, type)
                }
                start = f
                liters = 0.0
                cost = 0.0
                types = mutableSetOf()
            }
        }
        return out
    }

    fun summary(list: List<FuelUpEntity>, zone: ZoneId = ZoneId.systemDefault()): Summary {
        val iv = intervals(list)
        val dist = iv.sumOf { it.distanceKm }
        val lit = iv.sumOf { it.liters }
        val priced = iv.filter { it.cost != null }
        val byMonth = list.filter { it.totalPrice != null }
            .groupBy { DateTimeFormatter.ofPattern("yyyy-MM").format(Instant.ofEpochMilli(it.timestamp).atZone(zone)) }
            .mapValues { (_, v) -> v.sumOf { it.totalPrice!! } }
            .toSortedMap()
        fun kml(sel: (Interval) -> Boolean): Double? {
            val s = iv.filter(sel)
            return if (s.isEmpty()) null else s.sumOf { it.distanceKm } / s.sumOf { it.liters }
        }
        val g = kml { isGasoline(it.fuelType) }
        val e = kml { it.fuelType == ETHANOL }
        return Summary(
            count = list.size,
            totalLiters = list.sumOf { it.liters },
            totalCost = list.sumOf { it.totalPrice ?: 0.0 },
            intervals = iv,
            avgKmPerL = if (lit > 0) dist / lit else null,
            costPerKm = if (priced.isNotEmpty()) priced.sumOf { it.cost!! } / priced.sumOf { it.distanceKm } else null,
            costByMonth = byMonth,
            ethanolBreakEven = if (g != null && e != null) e / g else null,
        )
    }

    // =========================================================================================
    //  CSV (exportar para análise / importar de volta). Vírgula, ponto decimal, data ISO com fuso.
    // =========================================================================================

    val CSV_HEADER = listOf("data_hora", "hodometro_km", "litros", "valor_total", "preco_litro", "combustivel",
        "etanol_pct", "tanque_cheio", "posto", "observacao")

    private fun n(v: Double?) = v?.let { java.math.BigDecimal.valueOf(it).stripTrailingZeros().toPlainString() } ?: ""
    private fun q(s: String?) = s.orEmpty().let { if (it.any { c -> c == ',' || c == '"' || c == '\n' }) "\"" + it.replace("\"", "\"\"") + "\"" else it }

    fun toCsv(list: List<FuelUpEntity>, zone: ZoneId = ZoneId.systemDefault()): String = buildString {
        append(CSV_HEADER.joinToString(",")).append("\r\n")
        for (f in list.sortedBy { it.timestamp }) {
            append(listOf(
                Instant.ofEpochMilli(f.timestamp).atZone(zone).toOffsetDateTime().format(DateTimeFormatter.ISO_OFFSET_DATE_TIME),
                n(f.odometerKm), n(f.liters), n(f.totalPrice), n(f.pricePerLiter), f.fuelType, n(f.ethanolPct),
                if (f.fullTank) "sim" else "nao", q(f.station), q(f.notes),
            ).joinToString(",")).append("\r\n")
        }
    }

    class CsvException(message: String) : Exception(message)

    /** Lê o CSV exportado (ou montado à mão com o mesmo cabeçalho). Data sem fuso usa [zone]. */
    fun fromCsv(text: String, profileId: String, zone: ZoneId = ZoneId.systemDefault()): List<FuelUpEntity> {
        val rows = parseCsv(text).filter { r -> r.any { it.isNotBlank() } }
        if (rows.isEmpty()) return emptyList()
        val header = rows[0].map { it.trim().lowercase(Locale.ROOT) }
        val idx = CSV_HEADER.associateWith { header.indexOf(it) }
        if (idx["data_hora"]!! < 0 || idx["litros"]!! < 0) throw CsvException("Cabeçalho precisa de data_hora e litros")
        return rows.drop(1).mapIndexed { i, r ->
            fun col(name: String) = idx[name]!!.takeIf { it >= 0 && it < r.size }?.let { r[it].trim() }.orEmpty()
            fun num(name: String) = col(name).replace(',', '.').takeIf { it.isNotEmpty() }?.toDoubleOrNull()
            val line = i + 2
            val ts = parseTime(col("data_hora"), zone) ?: throw CsvException("Linha $line: data_hora inválida (${col("data_hora")})")
            val liters = num("litros")?.takeIf { it > 0 } ?: throw CsvException("Linha $line: litros inválido")
            val type = col("combustivel").lowercase(Locale.ROOT).ifEmpty { GASOLINE }
            if (type !in FUEL_TYPES) throw CsvException("Linha $line: combustivel deve ser ${FUEL_TYPES.joinToString("/")}")
            val total = num("valor_total")
            val ppl = num("preco_litro") ?: total?.div(liters)
            FuelUpEntity(
                timestamp = ts, profileId = profileId, odometerKm = num("hodometro_km"), liters = liters,
                totalPrice = total ?: ppl?.times(liters), pricePerLiter = ppl, fuelType = type, ethanolPct = num("etanol_pct"),
                fullTank = col("tanque_cheio").lowercase(Locale.ROOT) !in setOf("nao", "não", "0", "false", "n"),
                station = col("posto").ifEmpty { null }, notes = col("observacao").ifEmpty { null },
            )
        }
    }

    private fun parseTime(s: String, zone: ZoneId): Long? = runCatching { OffsetDateTime.parse(s).toInstant().toEpochMilli() }.getOrNull()
        ?: runCatching { LocalDateTime.parse(s).atZone(zone).toInstant().toEpochMilli() }.getOrNull()

    private fun parseCsv(text: String): List<List<String>> {
        val rows = mutableListOf<List<String>>()
        var row = mutableListOf<String>()
        val cell = StringBuilder()
        var quoted = false
        var i = 0
        while (i < text.length) {
            val c = text[i]
            when {
                quoted && c == '"' && i + 1 < text.length && text[i + 1] == '"' -> { cell.append('"'); i++ }
                c == '"' -> quoted = !quoted
                !quoted && c == ',' -> { row += cell.toString(); cell.clear() }
                !quoted && (c == '\n' || c == '\r') -> {
                    if (c == '\r' && i + 1 < text.length && text[i + 1] == '\n') i++
                    row += cell.toString(); cell.clear(); rows += row; row = mutableListOf()
                }
                else -> cell.append(c)
            }
            i++
        }
        if (cell.isNotEmpty() || row.isNotEmpty()) { row += cell.toString(); rows += row }
        return rows
    }
}

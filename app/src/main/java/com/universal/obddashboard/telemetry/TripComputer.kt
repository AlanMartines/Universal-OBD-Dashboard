package com.universal.obddashboard.telemetry

/** Distância e combustível de um período do computador de bordo (viagem, desde o abastecimento, parcial A…). */
data class Leg(val km: Double, val liters: Double) {
    /** km/l só com dados suficientes: poucos metros ou mililitros dariam médias absurdas. */
    val kmPerL: Double? get() = if (km >= MIN_KM && liters >= MIN_LITERS) km / liters else null

    operator fun plus(o: Leg) = Leg(km + o.km, liters + o.liters)

    /** Diferença que nunca fica negativa (a viagem da marca pode ter sido apagada ou reiniciada). */
    operator fun minus(o: Leg) = Leg((km - o.km).coerceAtLeast(0.0), (liters - o.liters).coerceAtLeast(0.0))

    companion object {
        val ZERO = Leg(0.0, 0.0)
        const val MIN_KM = 1.0
        const val MIN_LITERS = 0.1
    }
}

/**
 * Início de um período (parcial A zerado ou abastecimento): o instante e, se havia viagem em andamento,
 * a distância e o combustível dela naquele momento, para somar só o que veio depois.
 */
data class TripMark(val since: Long, val tripId: Long?, val km: Double, val liters: Double) {
    val leg get() = Leg(km, liters)

    fun encode() = listOf(since, tripId ?: -1, km, liters).joinToString(";")

    companion object {
        fun decode(text: String): TripMark? = runCatching {
            val p = text.split(';')
            TripMark(p[0].toLong(), p[1].toLong().takeIf { it >= 0 }, p[2].toDouble(), p[3].toDouble())
        }.getOrNull()
    }
}

/** Contas do computador de bordo que não dependem do Android: médias, autonomia e custo. */
object TripComputer {
    const val RECENT_KM = 50.0
    /** Abaixo disso, a média desde o abastecimento ainda oscila demais para a autonomia. */
    const val MIN_KM_FOR_RANGE = 30.0

    /**
     * Últimos ~[targetKm]: a viagem em andamento mais as anteriores (da mais nova para a mais velha),
     * inteiras, até passar de [targetKm].
     */
    fun recent(current: Leg, previousNewestFirst: List<Leg>, targetKm: Double = RECENT_KM): Leg {
        var acc = current
        for (leg in previousNewestFirst) {
            if (acc.km >= targetKm) break
            acc += leg
        }
        return acc
    }

    /** Média para a autonomia: desde o abastecimento se já rodou o bastante, senão a média real dos abastecimentos, senão a recente. */
    fun rangeKmPerL(sinceFuelUp: Leg?, realKmPerL: Double?, recent: Leg?): Double? =
        sinceFuelUp?.takeIf { it.km >= MIN_KM_FOR_RANGE }?.kmPerL ?: realKmPerL ?: recent?.kmPerL

    /** Km até a reserva e até o tanque vazio. null sem nível ou sem média. */
    fun range(fuelL: Double?, kmPerL: Double?, reserveL: Double): Pair<Double?, Double?> {
        if (fuelL == null || kmPerL == null || kmPerL <= 0) return null to null
        val toEmpty = fuelL * kmPerL
        val toReserve = if (reserveL > 0) ((fuelL - reserveL) * kmPerL).coerceAtLeast(0.0) else null
        return toReserve to toEmpty
    }

    /**
     * Período desde a [mark]:
     * - [closedAfter]: viagens iniciadas depois da marca, sem a da marca e sem a em andamento;
     * - [markTripFinal]: totais finais da viagem da marca, se ela já terminou (conta só o que veio depois da marca);
     * - [current]: a viagem em andamento, que conta inteira se começou depois da marca, e só o resto se é a da marca.
     */
    fun sinceMark(mark: TripMark, closedAfter: Leg, markTripFinal: Leg?, current: Leg?, currentTripId: Long?, currentStartedAt: Long?): Leg {
        var acc = closedAfter
        if (markTripFinal != null) acc += markTripFinal - mark.leg
        if (current != null) {
            acc += when {
                currentTripId != null && currentTripId == mark.tripId -> current - mark.leg
                currentStartedAt != null && currentStartedAt >= mark.since -> current
                else -> Leg.ZERO
            }
        }
        return acc
    }

    /** R$/km a partir do preço por litro e do km/l. */
    fun costPerKm(pricePerL: Double?, kmPerL: Double?): Double? =
        if (pricePerL == null || kmPerL == null || kmPerL <= 0) null else pricePerL / kmPerL
}

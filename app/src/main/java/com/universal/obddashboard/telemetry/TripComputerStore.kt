package com.universal.obddashboard.telemetry

import android.content.Context
import com.universal.obddashboard.AppSettings
import com.universal.obddashboard.db.AppDatabase
import com.universal.obddashboard.obd.FuelSettings
import kotlin.math.abs

/**
 * Computador de bordo compartilhado pela tela do app e pela leitura ao vivo do painel web: a parte do
 * banco ([Base], relida de tempos em tempos) e o retrato do momento ([Snapshot]), somando a viagem em andamento.
 */
object TripComputerStore {
    /** Viagens anteriores lidas para os "últimos ~50 km". */
    private const val RECENT_TRIPS = 40
    /** A marca de abastecimento vale para o registro feito até este tanto antes ou depois dela. */
    private const val FUEL_MARK_MATCH_MS = 6 * 60 * 60 * 1000L

    /** Período a partir de uma marca: viagens já fechadas e, se a da marca terminou, o resto dela. */
    class Period(val mark: TripMark, val closedAfter: Leg, val markTripFinal: Leg?)

    /** O que vem do banco, sem a viagem em andamento. */
    class Base(
        val fuelUp: Period?,
        val tripA: Period?,
        /** Viagens anteriores, da mais nova para a mais velha. */
        val previous: List<Leg>,
        val pricePerL: Double?,
        val reserveL: Double,
    )

    suspend fun load(context: Context, db: AppDatabase, vehicleId: String, currentTripId: Long?, fuel: FuelSettings?): Base {
        val dao = db.tripDao()
        suspend fun period(mark: TripMark?): Period? {
            mark ?: return null
            val closed = dao.totalsSince(mark.since, vehicleId, currentTripId ?: -1, mark.tripId ?: -1).let { Leg(it.km, it.liters) }
            val markFinal = mark.tripId?.takeIf { it != currentTripId }?.let { id -> dao.getTrip(id)?.let { Leg(it.distanceKm, it.fuelUsedL) } }
            return Period(mark, closed, markFinal)
        }
        val lastFuelUp = db.fuelUpDao().all(vehicleId).maxByOrNull { it.timestamp }
        // A marca do abastecimento vale se for do último registrado; senão, conta desde o horário dele
        val fuelMark = AppSettings.tripMark(context, AppSettings.MARK_FUEL_UP)
        val fuelUp = lastFuelUp?.let { f ->
            period(fuelMark?.takeIf { abs(it.since - f.timestamp) <= FUEL_MARK_MATCH_MS } ?: TripMark(f.timestamp, null, 0.0, 0.0))
        }
        return Base(
            fuelUp = fuelUp,
            tripA = period(AppSettings.tripMark(context, AppSettings.MARK_TRIP_A)),
            previous = dao.recentTrips(RECENT_TRIPS, vehicleId).filter { it.id != currentTripId }.map { Leg(it.distanceKm, it.fuelUsedL) },
            pricePerL = lastFuelUp?.let { f -> f.pricePerLiter ?: f.totalPrice?.takeIf { f.liters > 0 }?.div(f.liters) },
            reserveL = fuel?.let { (it.reserveMinL + it.reserveMaxL) / 2 } ?: 0.0,
        )
    }

    class Snapshot(
        val instantLph: Double?,
        val instantKmPerL: Double?,
        val ecoBand: Int?,
        val costPerKmNow: Double?,
        val pricePerL: Double?,
        val trip: Leg?,
        val tripCost: Double?,
        val sinceFuelUp: Leg?,
        val fuelUpSince: Long?,
        val tripA: Leg?,
        val tripASince: Long?,
        val recent: Leg,
        val rangeKmPerL: Double?,
        val rangeToReserveKm: Double?,
        val rangeToEmptyKm: Double?,
        val movingS: Double,
        val idleS: Double,
        val idleFuelL: Double,
        val idleCost: Double?,
        val fuelCutKm: Double,
        val avgMovingKmh: Double?,
        val ecoPct: List<Double>?,
    ) {
        /** Para a leitura ao vivo do painel web (métricas "pc.*"; ausentes quando não há dado). */
        fun metrics(): Map<String, Double?> = mapOf(
            "pc.instantLph" to instantLph,
            "pc.instantKmPerL" to instantKmPerL,
            "pc.ecoBand" to ecoBand?.toDouble(),
            "pc.costPerKmNow" to costPerKmNow,
            "pc.pricePerL" to pricePerL,
            "pc.tripKm" to trip?.km,
            "pc.tripL" to trip?.liters,
            "pc.tripKmPerL" to trip?.kmPerL,
            "pc.tripCost" to tripCost,
            "pc.fuelUpKm" to sinceFuelUp?.km,
            "pc.fuelUpL" to sinceFuelUp?.liters,
            "pc.fuelUpKmPerL" to sinceFuelUp?.kmPerL,
            "pc.tripAKm" to tripA?.km,
            "pc.tripAL" to tripA?.liters,
            "pc.tripAKmPerL" to tripA?.kmPerL,
            "pc.recentKm" to recent.km,
            "pc.recentL" to recent.liters,
            "pc.recentKmPerL" to recent.kmPerL,
            "pc.rangeKmPerL" to rangeKmPerL,
            "pc.rangeReserveKm" to rangeToReserveKm,
            "pc.rangeEmptyKm" to rangeToEmptyKm,
            "pc.movingS" to movingS,
            "pc.idleS" to idleS,
            "pc.idleFuelL" to idleFuelL,
            "pc.fuelCutKm" to fuelCutKm,
            "pc.avgMovingKmh" to avgMovingKmh,
            "pc.ecoGreenPct" to ecoPct?.getOrNull(0),
            "pc.ecoMidPct" to ecoPct?.getOrNull(1),
            "pc.ecoRedPct" to ecoPct?.getOrNull(2),
        )
    }

    /** Retrato do momento: [base] do banco + viagem em andamento ([running]) + leituras derivadas. */
    fun snapshot(base: Base?, s: DashboardState, running: Boolean, realKmPerL: Double?, fuelL: Double?): Snapshot {
        val d = s.derived
        val current = if (running && s.tripId != null) Leg(s.tripDistanceKm, d.tripFuelUsedL) else null
        fun since(p: Period?) = p?.let { TripComputer.sinceMark(it.mark, it.closedAfter, it.markTripFinal, current, s.tripId, s.tripStartedAt) }
        val sinceFuel = since(base?.fuelUp)
        val recent = TripComputer.recent(current ?: Leg.ZERO, base?.previous.orEmpty())
        val rangeKmPerL = TripComputer.rangeKmPerL(sinceFuel, realKmPerL, recent)
        val (toReserve, toEmpty) = TripComputer.range(fuelL, rangeKmPerL, base?.reserveL ?: 0.0)
        val price = base?.pricePerL
        return Snapshot(
            instantLph = d.instantLph,
            instantKmPerL = d.instantKmPerL,
            ecoBand = d.ecoBand,
            costPerKmNow = TripComputer.costPerKm(price, d.instantKmPerL),
            pricePerL = price,
            trip = current,
            tripCost = d.tripCost,
            sinceFuelUp = sinceFuel,
            fuelUpSince = base?.fuelUp?.mark?.since,
            tripA = since(base?.tripA),
            tripASince = base?.tripA?.mark?.since,
            recent = recent,
            rangeKmPerL = rangeKmPerL,
            rangeToReserveKm = toReserve,
            rangeToEmptyKm = toEmpty,
            movingS = d.movingS,
            idleS = d.idleS,
            idleFuelL = d.idleFuelL,
            idleCost = price?.times(d.idleFuelL),
            fuelCutKm = d.fuelCutKm,
            avgMovingKmh = d.avgMovingKmh,
            ecoPct = d.ecoPct,
        )
    }
}

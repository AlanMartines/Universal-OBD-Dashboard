package com.universal.obddashboard.db

import androidx.room.Dao
import androidx.room.Insert
import androidx.room.Query
import androidx.room.Update

@Dao
interface TripDao {

    // ---------- trips ----------

    @Insert
    suspend fun insertTrip(trip: TripEntity): Long

    @Update
    suspend fun updateTrip(trip: TripEntity)

    @Query("SELECT * FROM trips WHERE id = :id")
    suspend fun getTrip(id: Long): TripEntity?

    /** Hodômetro do app: soma das distâncias gravadas (a ECU não informa o hodômetro). */
    @Query("SELECT COALESCE(SUM(distance_km), 0) FROM trips WHERE vehicle_id = :vehicleId")
    suspend fun totalDistanceKm(vehicleId: String): Double

    /** Distância das viagens iniciadas a partir de [since] (hodômetro informado em Ajustes). */
    @Query("SELECT COALESCE(SUM(distance_km), 0) FROM trips WHERE start_time >= :since AND vehicle_id = :vehicleId")
    suspend fun distanceSinceKm(since: Long, vehicleId: String): Double

    /** Litros estimados pelo app nas viagens iniciadas no período (comparação com abastecimentos reais). */
    @Query("SELECT COALESCE(SUM(fuel_used_l), 0) FROM trips WHERE start_time >= :from AND start_time < :to AND vehicle_id = :vehicleId")
    suspend fun fuelUsedBetween(from: Long, to: Long, vehicleId: String): Double

    /** Consumo instantâneo gravado no período (para comparar com o abastecimento real). */
    @Query(
        """SELECT l.timestamp, l.fuel_lph AS lph FROM telemetry_log l JOIN trips t ON t.id = l.trip_id
           WHERE l.timestamp >= :from AND l.timestamp < :to AND t.vehicle_id = :vehicleId ORDER BY l.timestamp""",
    )
    suspend fun fuelSamples(from: Long, to: Long, vehicleId: String): List<FuelSample>

    /** Distância e combustível das viagens iniciadas a partir de [since], sem duas viagens (a em andamento e a da marca). */
    @Query(
        "SELECT COALESCE(SUM(distance_km), 0) AS km, COALESCE(SUM(fuel_used_l), 0) AS liters FROM trips " +
            "WHERE vehicle_id = :vehicleId AND start_time >= :since AND id NOT IN (:excludeA, :excludeB)",
    )
    suspend fun totalsSince(since: Long, vehicleId: String, excludeA: Long, excludeB: Long): Totals

    @Query("SELECT * FROM trips WHERE vehicle_id = :vehicleId ORDER BY start_time DESC LIMIT 1")
    suspend fun lastTrip(vehicleId: String): TripEntity?

    /** Mais recentes primeiro, para limitar o trabalho em históricos longos. */
    @Query(
        """SELECT l.timestamp, l.speed_obd_kmh AS obd, l.speed_gps_kmh AS gps, l.gps_accuracy_m AS accuracy
           FROM telemetry_log l JOIN trips t ON t.id = l.trip_id
           WHERE l.speed_obd_kmh IS NOT NULL AND l.speed_gps_kmh IS NOT NULL AND t.vehicle_id = :vehicleId
           ORDER BY l.timestamp DESC LIMIT :limit""",
    )
    suspend fun speedSamples(limit: Int, vehicleId: String): List<SpeedSample>

    /** Reabre uma viagem encerrada para continuar gravando nela (retomada). */
    @Query("UPDATE trips SET end_time = NULL, end_reason = NULL WHERE id = :id")
    suspend fun reopenTrip(id: Long)

    @Query("SELECT * FROM trips WHERE vehicle_id = :vehicleId ORDER BY start_time DESC LIMIT :limit")
    suspend fun recentTrips(limit: Int, vehicleId: String): List<TripEntity>

    @Query("SELECT COUNT(*) FROM trips")
    suspend fun tripCount(): Int

    /** Fecha viagens que ficaram abertas porque o processo morreu sem encerrar o serviço. */
    @Query("UPDATE trips SET end_time = :now, end_reason = 'interrupted' WHERE end_time IS NULL")
    suspend fun closeDanglingTrips(now: Long)

    @Query("DELETE FROM trips WHERE id = :id")
    suspend fun deleteTrip(id: Long)

    /** Apaga o histórico, exceto a viagem [keepTripId] (a em andamento; -1 = nenhuma). Telemetria sai em cascata. */
    @Query("DELETE FROM trips WHERE id != :keepTripId AND vehicle_id = :vehicleId")
    suspend fun deleteTripsExcept(keepTripId: Long, vehicleId: String)

    // ---------- telemetry_log ----------

    @Insert
    suspend fun insertTelemetry(sample: TelemetryLogEntity): Long

    @Query("SELECT * FROM telemetry_log WHERE trip_id = :tripId ORDER BY timestamp")
    suspend fun telemetryForTrip(tripId: Long): List<TelemetryLogEntity>

    @Query("SELECT MAX(timestamp) FROM telemetry_log WHERE trip_id = :tripId")
    suspend fun lastTelemetryAt(tripId: Long): Long?

    @Query(
        """SELECT l.* FROM telemetry_log l JOIN trips t ON t.id = l.trip_id
           WHERE l.id > :afterId AND t.vehicle_id = :vehicleId ORDER BY l.id LIMIT :limit""",
    )
    suspend fun telemetryAfter(afterId: Long, vehicleId: String, limit: Int): List<TelemetryLogEntity>

    @Query("SELECT MAX(id) FROM telemetry_log")
    suspend fun maxTelemetryId(): Long?

    @Query("SELECT COUNT(*) FROM telemetry_log l JOIN trips t ON t.id = l.trip_id WHERE l.id > :afterId AND t.vehicle_id = :vehicleId")
    suspend fun countTelemetryAfter(afterId: Long, vehicleId: String): Int

    @Query("SELECT COUNT(*) FROM telemetry_log WHERE trip_id = :tripId")
    suspend fun telemetryCount(tripId: Long): Int

    // ---------- diagnostic_trouble_codes ----------

    @Insert
    suspend fun insertDtc(dtc: DiagnosticTroubleCodeEntity): Long

    @Query("SELECT COUNT(*) FROM diagnostic_trouble_codes WHERE trip_id = :tripId AND code = :code AND kind = :kind")
    suspend fun countDtc(tripId: Long, code: String, kind: String): Int

    @Query("SELECT * FROM diagnostic_trouble_codes WHERE vehicle_id = :vehicleId ORDER BY detected_at DESC LIMIT :limit")
    suspend fun recentDtcs(limit: Int, vehicleId: String): List<DiagnosticTroubleCodeEntity>

    @Query(
        """SELECT COUNT(*) FROM diagnostic_trouble_codes
           WHERE code = :code AND kind = :kind AND vehicle_id = :vehicleId AND detected_at >= :since""",
    )
    suspend fun countRecentDtc(code: String, kind: String, vehicleId: String, since: Long): Int

    @Query("SELECT * FROM diagnostic_trouble_codes WHERE trip_id = :tripId ORDER BY detected_at")
    suspend fun dtcsForTrip(tripId: Long): List<DiagnosticTroubleCodeEntity>

    /** Anexa o congelamento de quadro da ECU às falhas com esse código ainda sem ele nesta viagem. */
    @Query("UPDATE diagnostic_trouble_codes SET ecu_freeze_json = :json WHERE trip_id = :tripId AND code = :code AND ecu_freeze_json IS NULL")
    suspend fun setEcuFreeze(tripId: Long, code: String, json: String)

    @Query("DELETE FROM diagnostic_trouble_codes WHERE trip_id = :tripId")
    suspend fun deleteDtcsForTrip(tripId: Long)

    @Query("DELETE FROM diagnostic_trouble_codes WHERE (trip_id IS NULL OR trip_id != :keepTripId) AND vehicle_id = :vehicleId")
    suspend fun deleteDtcsExcept(keepTripId: Long, vehicleId: String)

    /** Ao excluir um veículo: viagens (com a telemetria, em cascata) e falhas dele. */
    @Query("DELETE FROM trips WHERE vehicle_id = :vehicleId")
    suspend fun deleteTripsOfVehicle(vehicleId: String)

    @Query("DELETE FROM diagnostic_trouble_codes WHERE vehicle_id = :vehicleId")
    suspend fun deleteDtcsOfVehicle(vehicleId: String)
}

/** Amostra de consumo instantâneo (L/h) da caixa preta. */
data class FuelSample(val timestamp: Long, val lph: Double?)

/** Soma de distância (km) e combustível (L) de um conjunto de viagens. */
data class Totals(val km: Double, val liters: Double)

/** Velocidade da ECU e do GPS no mesmo instante da caixa preta. */
data class SpeedSample(val timestamp: Long, val obd: Double, val gps: Double, val accuracy: Float?)

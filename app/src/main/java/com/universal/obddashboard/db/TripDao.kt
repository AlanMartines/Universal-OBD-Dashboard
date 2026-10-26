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
    @Query("SELECT COALESCE(SUM(distance_km), 0) FROM trips")
    suspend fun totalDistanceKm(): Double

    /** Distância das viagens iniciadas a partir de [since] (hodômetro informado em Ajustes). */
    @Query("SELECT COALESCE(SUM(distance_km), 0) FROM trips WHERE start_time >= :since")
    suspend fun distanceSinceKm(since: Long): Double

    /** Litros estimados pelo app nas viagens iniciadas no período (comparação com abastecimentos reais). */
    @Query("SELECT COALESCE(SUM(fuel_used_l), 0) FROM trips WHERE start_time >= :from AND start_time < :to")
    suspend fun fuelUsedBetween(from: Long, to: Long): Double

    /** Consumo instantâneo gravado no período (para comparar com o abastecimento real). */
    @Query("SELECT timestamp, fuel_lph AS lph FROM telemetry_log WHERE timestamp >= :from AND timestamp < :to ORDER BY timestamp")
    suspend fun fuelSamples(from: Long, to: Long): List<FuelSample>

    @Query("SELECT * FROM trips ORDER BY start_time DESC LIMIT 1")
    suspend fun lastTrip(): TripEntity?

    /** Reabre uma viagem encerrada para continuar gravando nela (retomada). */
    @Query("UPDATE trips SET end_time = NULL, end_reason = NULL WHERE id = :id")
    suspend fun reopenTrip(id: Long)

    @Query("SELECT * FROM trips ORDER BY start_time DESC LIMIT :limit")
    suspend fun recentTrips(limit: Int): List<TripEntity>

    /** Fecha viagens que ficaram abertas porque o processo morreu sem encerrar o serviço. */
    @Query("UPDATE trips SET end_time = :now, end_reason = 'interrupted' WHERE end_time IS NULL")
    suspend fun closeDanglingTrips(now: Long)

    @Query("DELETE FROM trips WHERE id = :id")
    suspend fun deleteTrip(id: Long)

    /** Apaga o histórico, exceto a viagem [keepTripId] (a em andamento; -1 = nenhuma). Telemetria sai em cascata. */
    @Query("DELETE FROM trips WHERE id != :keepTripId")
    suspend fun deleteTripsExcept(keepTripId: Long)

    // ---------- telemetry_log ----------

    @Insert
    suspend fun insertTelemetry(sample: TelemetryLogEntity): Long

    @Query("SELECT * FROM telemetry_log WHERE trip_id = :tripId ORDER BY timestamp")
    suspend fun telemetryForTrip(tripId: Long): List<TelemetryLogEntity>

    @Query("SELECT MAX(timestamp) FROM telemetry_log WHERE trip_id = :tripId")
    suspend fun lastTelemetryAt(tripId: Long): Long?

    @Query("SELECT COUNT(*) FROM telemetry_log WHERE trip_id = :tripId")
    suspend fun telemetryCount(tripId: Long): Int

    // ---------- diagnostic_trouble_codes ----------

    @Insert
    suspend fun insertDtc(dtc: DiagnosticTroubleCodeEntity): Long

    @Query("SELECT COUNT(*) FROM diagnostic_trouble_codes WHERE trip_id = :tripId AND code = :code AND kind = :kind")
    suspend fun countDtc(tripId: Long, code: String, kind: String): Int

    @Query("SELECT * FROM diagnostic_trouble_codes ORDER BY detected_at DESC LIMIT :limit")
    suspend fun recentDtcs(limit: Int): List<DiagnosticTroubleCodeEntity>

    @Query("SELECT * FROM diagnostic_trouble_codes WHERE trip_id = :tripId ORDER BY detected_at")
    suspend fun dtcsForTrip(tripId: Long): List<DiagnosticTroubleCodeEntity>

    /** Anexa o congelamento de quadro da ECU às falhas com esse código ainda sem ele nesta viagem. */
    @Query("UPDATE diagnostic_trouble_codes SET ecu_freeze_json = :json WHERE trip_id = :tripId AND code = :code AND ecu_freeze_json IS NULL")
    suspend fun setEcuFreeze(tripId: Long, code: String, json: String)

    @Query("DELETE FROM diagnostic_trouble_codes WHERE trip_id = :tripId")
    suspend fun deleteDtcsForTrip(tripId: Long)

    @Query("DELETE FROM diagnostic_trouble_codes WHERE trip_id IS NULL OR trip_id != :keepTripId")
    suspend fun deleteDtcsExcept(keepTripId: Long)
}

/** Amostra de consumo instantâneo (L/h) da caixa preta. */
data class FuelSample(val timestamp: Long, val lph: Double?)

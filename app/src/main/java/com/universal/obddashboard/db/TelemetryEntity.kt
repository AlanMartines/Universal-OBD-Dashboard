package com.universal.obddashboard.db

import androidx.room.ColumnInfo
import androidx.room.Entity
import androidx.room.ForeignKey
import androidx.room.Index
import androidx.room.PrimaryKey

/** Resumo de cada percurso (uma linha por viagem). */
@Entity(tableName = "trips", indices = [Index("start_time")])
data class TripEntity(
    @PrimaryKey(autoGenerate = true) val id: Long = 0,
    @ColumnInfo(name = "profile_id") val profileId: String,
    @ColumnInfo(name = "start_time") val startTime: Long,
    @ColumnInfo(name = "end_time") val endTime: Long? = null,
    @ColumnInfo(name = "distance_km") val distanceKm: Double = 0.0,
    @ColumnInfo(name = "max_speed_kmh") val maxSpeedKmh: Double = 0.0,
    @ColumnInfo(name = "max_rpm") val maxRpm: Double = 0.0,
    @ColumnInfo(name = "max_coolant_c") val maxCoolantC: Double? = null,
    @ColumnInfo(name = "min_voltage") val minVoltage: Double? = null,
    @ColumnInfo(name = "fuel_used_l") val fuelUsedL: Double = 0.0,
    /** user_stop | bluetooth_disconnected | ignition_off | idle_timeout | adapter_unreachable | interrupted */
    @ColumnInfo(name = "end_reason") val endReason: String? = null,
)

/**
 * Amostra periódica da caixa preta (a cada telemetry_log_interval_ms, padrão 2 s).
 * Colunas fixas para os papéis comuns; qualquer outra saída do perfil vai em [extraJson].
 */
@Entity(
    tableName = "telemetry_log",
    foreignKeys = [
        ForeignKey(
            entity = TripEntity::class,
            parentColumns = ["id"],
            childColumns = ["trip_id"],
            onDelete = ForeignKey.CASCADE,
        ),
    ],
    indices = [Index("trip_id"), Index("timestamp")],
)
data class TelemetryLogEntity(
    @PrimaryKey(autoGenerate = true) val id: Long = 0,
    @ColumnInfo(name = "trip_id") val tripId: Long,
    val timestamp: Long,
    val rpm: Double? = null,
    @ColumnInfo(name = "speed_obd_kmh") val speedObdKmh: Double? = null,
    @ColumnInfo(name = "speed_gps_kmh") val speedGpsKmh: Double? = null,
    @ColumnInfo(name = "throttle_pct") val throttlePct: Double? = null,
    @ColumnInfo(name = "map_kpa") val mapKpa: Double? = null,
    @ColumnInfo(name = "coolant_c") val coolantC: Double? = null,
    @ColumnInfo(name = "intake_c") val intakeC: Double? = null,
    val voltage: Double? = null,
    @ColumnInfo(name = "timing_advance") val timingAdvance: Double? = null,
    @ColumnInfo(name = "engine_load_pct") val engineLoadPct: Double? = null,
    @ColumnInfo(name = "stft_pct") val stftPct: Double? = null,
    @ColumnInfo(name = "ltft_pct") val ltftPct: Double? = null,
    @ColumnInfo(name = "lambda_v") val lambdaV: Double? = null,
    @ColumnInfo(name = "fuel_lph") val fuelLph: Double? = null,
    val latitude: Double? = null,
    val longitude: Double? = null,
    @ColumnInfo(name = "gps_accuracy_m") val gpsAccuracyM: Float? = null,
    @ColumnInfo(name = "extra_json") val extraJson: String? = null,
)

/** Falha registrada com o "freeze frame" capturado pelo app no instante da detecção. */
@Entity(
    tableName = "diagnostic_trouble_codes",
    foreignKeys = [
        ForeignKey(
            entity = TripEntity::class,
            parentColumns = ["id"],
            childColumns = ["trip_id"],
            onDelete = ForeignKey.SET_NULL,
        ),
    ],
    indices = [Index("trip_id"), Index("code")],
)
data class DiagnosticTroubleCodeEntity(
    @PrimaryKey(autoGenerate = true) val id: Long = 0,
    @ColumnInfo(name = "trip_id") val tripId: Long?,
    val code: String,
    /** CONFIRMED (modo 03) | PENDING (modo 07) | PERMANENT (modo 0A) */
    val kind: String,
    @ColumnInfo(name = "detected_at") val detectedAt: Long,
    @ColumnInfo(name = "mil_on") val milOn: Boolean? = null,
    val rpm: Double? = null,
    @ColumnInfo(name = "speed_kmh") val speedKmh: Double? = null,
    @ColumnInfo(name = "engine_load_pct") val engineLoadPct: Double? = null,
    @ColumnInfo(name = "coolant_c") val coolantC: Double? = null,
    @ColumnInfo(name = "throttle_pct") val throttlePct: Double? = null,
    val voltage: Double? = null,
    val latitude: Double? = null,
    val longitude: Double? = null,
    @ColumnInfo(name = "gps_accuracy_m") val gpsAccuracyM: Float? = null,
    /** Congelamento de quadro gravado pela própria ECU (modo 02): {"code": "...", "values": {saída: valor}}. */
    @ColumnInfo(name = "ecu_freeze_json") val ecuFreezeJson: String? = null,
)

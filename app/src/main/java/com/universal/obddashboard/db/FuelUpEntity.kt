package com.universal.obddashboard.db

import androidx.room.ColumnInfo
import androidx.room.Dao
import androidx.room.Entity
import androidx.room.Index
import androidx.room.Insert
import androidx.room.PrimaryKey
import androidx.room.Query
import androidx.room.Update

/**
 * Abastecimento registrado pelo usuário (aba Abastecimentos). O consumo real sai do intervalo entre
 * dois abastecimentos de tanque cheio: litros colocados no segundo ÷ km rodados entre eles.
 */
@Entity(tableName = "fuel_ups", indices = [Index("timestamp")])
data class FuelUpEntity(
    @PrimaryKey(autoGenerate = true) val id: Long = 0,
    val timestamp: Long,
    @ColumnInfo(name = "profile_id") val profileId: String,
    @ColumnInfo(name = "odometer_km") val odometerKm: Double? = null,
    val liters: Double,
    @ColumnInfo(name = "total_price") val totalPrice: Double? = null,
    @ColumnInfo(name = "price_per_liter") val pricePerLiter: Double? = null,
    /** gasoline | gasoline_premium | ethanol | mix */
    @ColumnInfo(name = "fuel_type") val fuelType: String,
    /** % de etanol em volume no que foi colocado (mix); null = padrão do tipo. */
    @ColumnInfo(name = "ethanol_pct") val ethanolPct: Double? = null,
    @ColumnInfo(name = "full_tank") val fullTank: Boolean = true,
    val station: String? = null,
    val notes: String? = null,
    /** Veículo dono do registro (ver Vehicles). Dados de antes da v4 ficam no primeiro veículo. */
    @ColumnInfo(name = "vehicle_id", defaultValue = "'v1'") val vehicleId: String = "v1",
)

@Dao
interface FuelUpDao {

    @Insert
    suspend fun insert(f: FuelUpEntity): Long

    @Insert
    suspend fun insertAll(list: List<FuelUpEntity>): List<Long>

    @Query("SELECT * FROM fuel_ups WHERE vehicle_id = :vehicleId ORDER BY timestamp")
    suspend fun all(vehicleId: String): List<FuelUpEntity>

    @Query("SELECT COUNT(*) FROM fuel_ups")
    suspend fun count(): Int

    @Query("DELETE FROM fuel_ups WHERE id = :id")
    suspend fun delete(id: Long)

    @Query("SELECT * FROM fuel_ups WHERE id = :id AND vehicle_id = :vehicleId")
    suspend fun get(id: Long, vehicleId: String): FuelUpEntity?

    @Update
    suspend fun update(f: FuelUpEntity)

    @Query("DELETE FROM fuel_ups WHERE vehicle_id = :vehicleId")
    suspend fun deleteAll(vehicleId: String)

    @Query("SELECT COUNT(*) FROM fuel_ups WHERE timestamp = :timestamp AND liters = :liters AND vehicle_id = :vehicleId")
    suspend fun countSame(timestamp: Long, liters: Double, vehicleId: String): Int
}

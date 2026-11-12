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
 * Item de manutenção de um veículo (aba Manutenção): o que fazer e a cada quantos km e/ou meses.
 * Sem intervalo de km, só vale a data; sem meses, só o km. A última vez feita é o registro mais novo.
 */
@Entity(tableName = "maintenance_items", indices = [Index("vehicle_id")])
data class MaintenanceItemEntity(
    @PrimaryKey(autoGenerate = true) val id: Long = 0,
    @ColumnInfo(name = "vehicle_id") val vehicleId: String,
    val name: String,
    @ColumnInfo(name = "interval_km") val intervalKm: Double? = null,
    @ColumnInfo(name = "interval_months") val intervalMonths: Int? = null,
    val notes: String? = null,
    @ColumnInfo(name = "created_at") val createdAt: Long,
    /** Próxima troca anotada (o que o mecânico passou): km do hodômetro e/ou data. Vale no lugar do intervalo. */
    @ColumnInfo(name = "next_km") val nextKm: Double? = null,
    @ColumnInfo(name = "next_at") val nextAt: Long? = null,
)

/** Uma vez em que o serviço foi feito: data, hodômetro, custo e observação. */
@Entity(tableName = "maintenance_records", indices = [Index("item_id"), Index("vehicle_id")])
data class MaintenanceRecordEntity(
    @PrimaryKey(autoGenerate = true) val id: Long = 0,
    @ColumnInfo(name = "item_id") val itemId: Long,
    @ColumnInfo(name = "vehicle_id") val vehicleId: String,
    val timestamp: Long,
    @ColumnInfo(name = "odometer_km") val odometerKm: Double? = null,
    val cost: Double? = null,
    val notes: String? = null,
)

@Dao
interface MaintenanceDao {

    @Insert
    suspend fun insertItem(item: MaintenanceItemEntity): Long

    @Update
    suspend fun updateItem(item: MaintenanceItemEntity)

    @Query("SELECT * FROM maintenance_items WHERE vehicle_id = :vehicleId ORDER BY name COLLATE NOCASE")
    suspend fun items(vehicleId: String): List<MaintenanceItemEntity>

    @Query("SELECT * FROM maintenance_items WHERE id = :id AND vehicle_id = :vehicleId")
    suspend fun item(id: Long, vehicleId: String): MaintenanceItemEntity?

    @Query("DELETE FROM maintenance_items WHERE id = :id AND vehicle_id = :vehicleId")
    suspend fun deleteItem(id: Long, vehicleId: String)

    @Insert
    suspend fun insertRecord(record: MaintenanceRecordEntity): Long

    @Query("SELECT * FROM maintenance_records WHERE vehicle_id = :vehicleId ORDER BY timestamp DESC")
    suspend fun records(vehicleId: String): List<MaintenanceRecordEntity>

    @Query("DELETE FROM maintenance_records WHERE id = :id AND vehicle_id = :vehicleId")
    suspend fun deleteRecord(id: Long, vehicleId: String)

    @Query("DELETE FROM maintenance_records WHERE item_id = :itemId AND vehicle_id = :vehicleId")
    suspend fun deleteRecordsOf(itemId: Long, vehicleId: String)
}

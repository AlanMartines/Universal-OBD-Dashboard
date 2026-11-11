package com.universal.obddashboard.maintenance

import com.universal.obddashboard.db.AppDatabase
import com.universal.obddashboard.db.MaintenanceItemEntity
import com.universal.obddashboard.db.MaintenanceRecordEntity

/** Itens de manutenção de um veículo, cada um com o histórico e a situação de agora. */
object MaintenanceStore {

    data class ItemView(
        val item: MaintenanceItemEntity,
        val records: List<MaintenanceRecordEntity>,
        val status: Maintenance.Status,
    ) {
        val last: MaintenanceRecordEntity? get() = records.firstOrNull()
    }

    /** Mais urgente primeiro: vencidos, perto de vencer, sem histórico e em dia. */
    private val ORDER = listOf(Maintenance.Level.DUE, Maintenance.Level.SOON, Maintenance.Level.UNKNOWN, Maintenance.Level.OK)

    suspend fun overview(db: AppDatabase, vehicleId: String, currentKm: Double?, now: Long = System.currentTimeMillis()): List<ItemView> {
        val dao = db.maintenanceDao()
        val byItem = dao.records(vehicleId).groupBy { it.itemId }
        return dao.items(vehicleId).map { item ->
            val recs = byItem[item.id].orEmpty()   // já vem do mais novo para o mais velho
            // O km da última vez é o do registro mais novo que tiver hodômetro anotado
            val lastKm = recs.firstOrNull { it.odometerKm != null }?.odometerKm
            val status = Maintenance.status(item.intervalKm, item.intervalMonths, lastKm, recs.firstOrNull()?.timestamp, currentKm, now)
            ItemView(item, recs, status)
        }.sortedWith(compareBy<ItemView> { ORDER.indexOf(it.status.level) }.thenBy { it.status.remainingKm ?: Double.MAX_VALUE })
    }
}

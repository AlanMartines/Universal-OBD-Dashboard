package com.universal.obddashboard.bridge

import android.webkit.JavascriptInterface
import com.universal.obddashboard.MainActivity
import com.universal.obddashboard.Vehicles
import com.universal.obddashboard.db.AppDatabase
import com.universal.obddashboard.db.MaintenanceItemEntity
import com.universal.obddashboard.db.MaintenanceRecordEntity
import com.universal.obddashboard.maintenance.Maintenance
import com.universal.obddashboard.maintenance.MaintenanceStore
import com.universal.obddashboard.orNull
import org.json.JSONArray
import org.json.JSONObject

/**
 * Ponte JavaScript "AndroidMaintenance": lembretes de manutenção do veículo selecionado (aba Manutenção).
 * Tudo responde de forma assíncrona ([MainActivity.answerAsync]); erros de validação voltam como {ok:false, error}.
 */
class MaintenanceBridge(private val activity: MainActivity) {

    private fun db() = AppDatabase.get(activity)
    private fun vehicle() = Vehicles.selectedId(activity)

    private fun JSONObject.optDoubleOrNull(k: String): Double? = if (isNull(k) || !has(k)) null else optDouble(k).takeIf { it.isFinite() }
    private fun JSONObject.optLongOrNull(k: String): Long? = if (isNull(k) || !has(k)) null else optLong(k)
    private fun JSONObject.optTextOrNull(k: String): String? = if (isNull(k) || !has(k)) null else optString(k).trim().take(300).ifEmpty { null }

    /** Plano do perfil do veículo (manual) ou a lista genérica. */
    private fun presets(): List<Maintenance.Preset> = Maintenance.presetsFor(
        runCatching { activity.currentProfile().profile.maintenancePlan }.getOrNull()
            ?.map { Maintenance.Preset(it.name, it.intervalKm, it.intervalMonths, it.notes) },
    )

    private fun err(msg: String) = JSONObject().put("ok", false).put("error", msg).toString()
    private val ok = JSONObject().put("ok", true).toString()

    /** {totalKm, items:[{id, name, intervalKm, intervalMonths, notes, status:{...}, records:[...]}], presets:[...]} */
    @JavascriptInterface
    fun getMaintenance(requestId: String) = activity.answerAsync(requestId) {
        activity.refreshTotalKm()
        val km = activity.totalKm
        val views = MaintenanceStore.overview(db(), vehicle(), km)
        val existing = views.map { it.item.name.lowercase() }.toSet()
        JSONObject()
            .put("totalKm", km.orNull())
            .put("items", JSONArray().apply {
                for (v in views) {
                    val s = v.status
                    put(
                        JSONObject()
                            .put("id", v.item.id)
                            .put("name", v.item.name)
                            .put("intervalKm", v.item.intervalKm.orNull())
                            .put("intervalMonths", v.item.intervalMonths ?: JSONObject.NULL)
                            .put("notes", v.item.notes ?: JSONObject.NULL)
                            .put("status", JSONObject()
                                .put("level", s.level.name)
                                .put("nextKm", s.nextKm.orNull())
                                .put("remainingKm", s.remainingKm.orNull())
                                .put("nextAt", s.nextAt ?: JSONObject.NULL)
                                .put("remainingDays", s.remainingDays ?: JSONObject.NULL))
                            .put("records", JSONArray().apply {
                                for (r in v.records) put(
                                    JSONObject().put("id", r.id).put("timestamp", r.timestamp)
                                        .put("odometerKm", r.odometerKm.orNull()).put("cost", r.cost.orNull())
                                        .put("notes", r.notes ?: JSONObject.NULL),
                                )
                            }),
                    )
                }
            })
            .put("presets", JSONArray().apply {
                for (p in presets()) put(
                    JSONObject().put("name", p.name).put("intervalKm", p.intervalKm.orNull())
                        .put("intervalMonths", p.intervalMonths ?: JSONObject.NULL).put("notes", p.notes ?: JSONObject.NULL)
                        .put("exists", p.name.lowercase() in existing),
                )
            })
            .put("presetsFromProfile", runCatching { activity.currentProfile().profile.maintenancePlan.isNotEmpty() }.getOrDefault(false))
            .toString()
    }

    /** Cria ({id} ausente) ou altera um item. Com "lastAt" (e "lastKm") num item novo, já registra a última vez. */
    @JavascriptInterface
    fun saveMaintenanceItem(requestId: String, json: String) = activity.answerAsync(requestId) {
        val o = JSONObject(json)
        val name = o.optTextOrNull("name") ?: return@answerAsync err("Dê um nome ao item.")
        val km = o.optDoubleOrNull("intervalKm")?.takeIf { it > 0 }
        val months = o.optLongOrNull("intervalMonths")?.toInt()?.takeIf { it in 1..240 }
        if (km == null && months == null) return@answerAsync err("Informe o intervalo em km, em meses ou nos dois.")
        if (km != null && km > 1_000_000) return@answerAsync err("Intervalo de km grande demais.")
        val notes = o.optTextOrNull("notes")
        val dao = db().maintenanceDao()
        val id = o.optLongOrNull("id")
        if (id != null) {
            val cur = dao.item(id, vehicle()) ?: return@answerAsync err("Item não encontrado.")
            dao.updateItem(cur.copy(name = name, intervalKm = km, intervalMonths = months, notes = notes))
        } else {
            val newId = dao.insertItem(MaintenanceItemEntity(vehicleId = vehicle(), name = name, intervalKm = km, intervalMonths = months, notes = notes, createdAt = System.currentTimeMillis()))
            o.optLongOrNull("lastAt")?.let { at ->
                dao.insertRecord(MaintenanceRecordEntity(itemId = newId, vehicleId = vehicle(), timestamp = at, odometerKm = o.optDoubleOrNull("lastKm")))
            }
        }
        ok
    }

    @JavascriptInterface
    fun deleteMaintenanceItem(requestId: String, id: Long) = activity.answerAsync(requestId) {
        val dao = db().maintenanceDao()
        dao.deleteRecordsOf(id, vehicle())
        dao.deleteItem(id, vehicle())
        ok
    }

    /** Registra uma vez feita: {itemId, timestamp, odometerKm?, cost?, notes?}. */
    @JavascriptInterface
    fun addMaintenanceRecord(requestId: String, json: String) = activity.answerAsync(requestId) {
        val o = JSONObject(json)
        val itemId = o.optLongOrNull("itemId") ?: return@answerAsync err("Item não informado.")
        val dao = db().maintenanceDao()
        dao.item(itemId, vehicle()) ?: return@answerAsync err("Item não encontrado.")
        val at = o.optLongOrNull("timestamp") ?: System.currentTimeMillis()
        if (at > System.currentTimeMillis() + 60_000) return@answerAsync err("A data não pode ser no futuro.")
        val km = o.optDoubleOrNull("odometerKm")?.takeIf { it >= 0 }
        val cost = o.optDoubleOrNull("cost")?.takeIf { it >= 0 }
        dao.insertRecord(MaintenanceRecordEntity(itemId = itemId, vehicleId = vehicle(), timestamp = at, odometerKm = km, cost = cost, notes = o.optTextOrNull("notes")))
        ok
    }

    @JavascriptInterface
    fun deleteMaintenanceRecord(requestId: String, id: Long) = activity.answerAsync(requestId) {
        db().maintenanceDao().deleteRecord(id, vehicle())
        ok
    }

    /** Acrescenta os itens sugeridos escolhidos (nomes em JSON) que ainda não existem. */
    @JavascriptInterface
    fun addMaintenancePresets(requestId: String, namesJson: String) = activity.answerAsync(requestId) {
        val names = JSONArray(namesJson).let { a -> (0 until a.length()).map { a.optString(it) } }.toSet()
        val dao = db().maintenanceDao()
        val existing = dao.items(vehicle()).map { it.name.lowercase() }.toSet()
        var added = 0
        for (p in presets()) {
            if (p.name !in names || p.name.lowercase() in existing) continue
            dao.insertItem(MaintenanceItemEntity(vehicleId = vehicle(), name = p.name, intervalKm = p.intervalKm, intervalMonths = p.intervalMonths, notes = p.notes, createdAt = System.currentTimeMillis()))
            added++
        }
        JSONObject().put("ok", true).put("added", added).toString()
    }
}

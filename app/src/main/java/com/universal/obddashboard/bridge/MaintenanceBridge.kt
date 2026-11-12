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
import com.universal.obddashboard.remote.RemoteSync
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
                            .put("setNextKm", v.item.nextKm.orNull())
                            .put("setNextAt", v.item.nextAt ?: JSONObject.NULL)
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
                        .put("intervalMonths", p.intervalMonths ?: JSONObject.NULL).put("notes", p.notes ?: JSONObject.NULL),
                )
            })
            .put("presetsFromProfile", runCatching { activity.currentProfile().profile.maintenancePlan.isNotEmpty() }.getOrDefault(false))
            .toString()
    }

    /**
     * Próxima troca de um formulário: km e data do que o mecânico passou. A data só vale se for futura (hoje ou
     * antes = sem data). Precisa de pelo menos um dos dois. Devolve (km, data) ou a mensagem de erro.
     */
    private fun nextDue(o: JSONObject, lastKm: Double?): Pair<Pair<Double?, Long?>?, String?> {
        val km = o.optDoubleOrNull("nextKm")?.takeIf { it > 0 }
        val at = o.optLongOrNull("nextAt")?.takeIf { it > System.currentTimeMillis() + DAY_MS / 2 }
        if (km == null && at == null) return null to "Informe a próxima troca: o km (ou daqui a quantos km) ou uma data futura."
        if (km != null && km > 3_000_000) return null to "Km da próxima troca grande demais."
        if (km != null && lastKm != null && km <= lastKm) return null to "O km da próxima troca precisa ser maior que o da última vez."
        return (km to at) to null
    }

    /** Intervalo guardado por trás (para sugerir o próximo): diferença entre a última vez e a próxima troca. */
    private fun intervals(lastKm: Double?, lastAt: Long?, nextKm: Double?, nextAt: Long?): Pair<Double?, Int?> {
        val km = if (lastKm != null && nextKm != null) (nextKm - lastKm).takeIf { it > 0 } else null
        val months = if (lastAt != null && nextAt != null) Math.round((nextAt - lastAt) / (DAY_MS * 30.44)).toInt().takeIf { it in 1..240 } else null
        return km to months
    }

    /**
     * Cria ({id} ausente) ou altera um item: {name, notes, nextKm, nextAt} e, num item novo, {lastAt, lastKm} da última
     * vez (registro). Ao alterar, a última vez continua a dos registros.
     */
    @JavascriptInterface
    fun saveMaintenanceItem(requestId: String, json: String) = activity.answerAsync(requestId) {
        val o = JSONObject(json)
        val name = o.optTextOrNull("name") ?: return@answerAsync err("Escolha o item ou dê um nome.")
        val notes = o.optTextOrNull("notes")
        val dao = db().maintenanceDao()
        val id = o.optLongOrNull("id")
        if (id != null) {
            val cur = dao.item(id, vehicle()) ?: return@answerAsync err("Item não encontrado.")
            val last = dao.records(vehicle()).filter { it.itemId == id }
            val lastKm = last.firstOrNull { it.odometerKm != null }?.odometerKm
            val (due, e) = nextDue(o, lastKm)
            if (due == null) return@answerAsync err(e!!)
            val (ik, im) = intervals(lastKm, last.firstOrNull()?.timestamp, due.first, due.second)
            dao.updateItem(cur.copy(name = name, notes = notes, nextKm = due.first, nextAt = due.second,
                intervalKm = ik ?: cur.intervalKm, intervalMonths = im ?: cur.intervalMonths))
        } else {
            val lastAt = o.optLongOrNull("lastAt") ?: System.currentTimeMillis()
            if (lastAt > System.currentTimeMillis() + 60_000) return@answerAsync err("A última vez não pode ser no futuro.")
            val lastKm = o.optDoubleOrNull("lastKm")?.takeIf { it >= 0 }
            val (due, e) = nextDue(o, lastKm)
            if (due == null) return@answerAsync err(e!!)
            val (ik, im) = intervals(lastKm, lastAt, due.first, due.second)
            val newId = dao.insertItem(MaintenanceItemEntity(vehicleId = vehicle(), name = name, intervalKm = ik, intervalMonths = im,
                notes = notes, createdAt = System.currentTimeMillis(), nextKm = due.first, nextAt = due.second))
            dao.insertRecord(MaintenanceRecordEntity(itemId = newId, vehicleId = vehicle(), timestamp = lastAt, odometerKm = lastKm))
        }
        RemoteSync.syncSoon(activity)
        ok
    }

    @JavascriptInterface
    fun deleteMaintenanceItem(requestId: String, id: Long) = activity.answerAsync(requestId) {
        val dao = db().maintenanceDao()
        dao.deleteRecordsOf(id, vehicle())
        dao.deleteItem(id, vehicle())
        RemoteSync.syncSoon(activity)
        ok
    }

    /**
     * Registra uma vez feita: {itemId, timestamp, odometerKm?, cost?, notes?, nextKm?, nextAt?}. A próxima troca
     * que o mecânico passou vira a do item; o intervalo por trás é atualizado para sugerir a seguinte.
     */
    @JavascriptInterface
    fun addMaintenanceRecord(requestId: String, json: String) = activity.answerAsync(requestId) {
        val o = JSONObject(json)
        val itemId = o.optLongOrNull("itemId") ?: return@answerAsync err("Item não informado.")
        val dao = db().maintenanceDao()
        val item = dao.item(itemId, vehicle()) ?: return@answerAsync err("Item não encontrado.")
        val at = o.optLongOrNull("timestamp") ?: System.currentTimeMillis()
        if (at > System.currentTimeMillis() + 60_000) return@answerAsync err("A data não pode ser no futuro.")
        val km = o.optDoubleOrNull("odometerKm")?.takeIf { it >= 0 }
        val (due, e) = nextDue(o, km)
        if (due == null) return@answerAsync err(e!!)
        val cost = o.optDoubleOrNull("cost")?.takeIf { it >= 0 }
        dao.insertRecord(MaintenanceRecordEntity(itemId = itemId, vehicleId = vehicle(), timestamp = at, odometerKm = km, cost = cost, notes = o.optTextOrNull("notes")))
        val (ik, im) = intervals(km, at, due.first, due.second)
        dao.updateItem(item.copy(nextKm = due.first, nextAt = due.second, intervalKm = ik ?: item.intervalKm, intervalMonths = im ?: item.intervalMonths))
        RemoteSync.syncSoon(activity)
        ok
    }

    @JavascriptInterface
    fun deleteMaintenanceRecord(requestId: String, id: Long) = activity.answerAsync(requestId) {
        db().maintenanceDao().deleteRecord(id, vehicle())
        RemoteSync.syncSoon(activity)
        ok
    }

    private companion object {
        const val DAY_MS = 24 * 60 * 60 * 1000L
    }
}

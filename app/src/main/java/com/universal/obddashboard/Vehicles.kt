package com.universal.obddashboard

import android.content.Context
import android.content.SharedPreferences
import androidx.core.content.edit
import com.universal.obddashboard.obd.ProfileParser
import kotlinx.serialization.Serializable
import kotlinx.serialization.builtins.ListSerializer
import kotlinx.serialization.json.Json
import java.util.UUID

/** Carro da pessoa. O perfil descreve o modelo; dois carros iguais são dois veículos com o mesmo perfil. */
@Serializable
data class Vehicle(val id: String, val name: String, val profileId: String, val plate: String? = null)

/**
 * Veículos cadastrados e o selecionado. Hodômetro, tanque, etanol, adaptador, gatilhos, mostradores,
 * alarmes, tempos, calibração e telemetria remota ficam guardados por veículo.
 */
object Vehicles {
    /** Id do veículo criado a partir dos dados de antes desta versão. As tabelas usam o mesmo valor como padrão. */
    const val FIRST_ID = "v1"
    const val MAX_NAME = 40
    const val MAX_PLATE = 10

    private const val FILE = "obd_dashboard_settings"
    private const val REMOTE_FILE = "remote_telemetry"
    private const val KEY_LIST = "vehicles"
    private const val KEY_SELECTED = "selected_vehicle"
    private const val KEY_PROFILE = "selected_profile"
    private val LIST = ListSerializer(Vehicle.serializer())

    /** Ajustes que eram gerais e passam a ser do veículo. */
    internal val SCOPED_KEYS = listOf(
        "ethanol_pct", "adapter_device_names", "extra_trigger_devices", "fuel_level_l", "fuel_level_updated_at",
        "odometer_ref_km", "odometer_ref_since",
    )

    /** Ajustes que eram por perfil e passam a ser do veículo. */
    internal val PROFILE_PREFIXES = listOf("fuel_correction_since_", "fuel_correction_", "dashboard_", "user_alarms_", "timed_runs_")

    internal val REMOTE_KEYS = listOf("base_url", "enabled", "send_gps", "device_name", "cursor", "token_enc", "last_sent_at", "last_error")

    private fun prefs(c: Context) = c.applicationContext.getSharedPreferences(FILE, Context.MODE_PRIVATE)

    fun scopedKey(key: String, vehicleId: String) = "$key@$vehicleId"

    /** Lista em memória: os ajustes do veículo são lidos a cada atualização da tela e da captura. */
    @Volatile private var cache: List<Vehicle>? = null

    fun all(c: Context): List<Vehicle> {
        cache?.let { return it }
        ensure(c)
        // Ajustes apagados por fora (ex.: limpeza de dados): recria o primeiro veículo
        val list = decode(prefs(c).getString(KEY_LIST, null)).ifEmpty { ensure(c, force = true); decode(prefs(c).getString(KEY_LIST, null)) }
        return list.also { cache = it }
    }

    fun selected(c: Context): Vehicle {
        val list = all(c)
        val id = selectedCache ?: prefs(c).getString(KEY_SELECTED, null).also { selectedCache = it }
        return list.firstOrNull { it.id == id } ?: list.first()
    }

    fun selectedId(c: Context): String = selected(c).id

    fun get(c: Context, id: String): Vehicle? = all(c).firstOrNull { it.id == id }

    /** O perfil ativo acompanha o veículo, para o resto do app continuar lendo o perfil selecionado. */
    fun select(c: Context, id: String) {
        val v = get(c, id) ?: return
        prefs(c).edit {
            putString(KEY_SELECTED, v.id)
            putString(KEY_PROFILE, v.profileId)
        }
        selectedCache = v.id
    }

    @Volatile private var selectedCache: String? = null

    /** Veículo que usa este adaptador Bluetooth (nome ou MAC informado em Ajustes), se houver. */
    fun byAdapter(c: Context, name: String?, address: String): Vehicle? {
        val p = prefs(c)
        return all(c).firstOrNull { v ->
            p.getString(scopedKey("adapter_device_names", v.id), null).orEmpty().split(',', ';').map { it.trim() }
                .any { it.isNotEmpty() && (it.equals(address, true) || (name != null && it.equals(name, true))) }
        }
    }

    fun add(c: Context, name: String, profileId: String, plate: String?): Vehicle {
        val v = Vehicle("v" + UUID.randomUUID().toString().replace("-", "").take(10), clean(name, MAX_NAME), profileId, plate?.let { clean(it, MAX_PLATE) }?.ifBlank { null })
        save(c, all(c) + v)
        return v
    }

    fun update(c: Context, v: Vehicle) {
        val fixed = v.copy(name = clean(v.name, MAX_NAME), plate = v.plate?.let { clean(it, MAX_PLATE) }?.ifBlank { null })
        save(c, all(c).map { if (it.id == v.id) fixed else it })
        if (selectedId(c) == v.id) prefs(c).edit { putString(KEY_PROFILE, fixed.profileId) }
    }

    /** Remove o cadastro e os ajustes dele. Os dados do banco são apagados por quem chama. */
    fun remove(c: Context, id: String) {
        val rest = all(c).filterNot { it.id == id }
        if (rest.isEmpty() || selectedId(c) == id) return
        save(c, rest)
        listOf(prefs(c), c.applicationContext.getSharedPreferences(REMOTE_FILE, Context.MODE_PRIVATE)).forEach { p ->
            p.edit { p.all.keys.filter { it.endsWith("@$id") || PROFILE_PREFIXES.any { pre -> it == pre + id } }.forEach { remove(it) } }
        }
    }

    private fun clean(text: String, max: Int) = text.filterNot { it.isISOControl() || it in "<>" }.trim().take(max)

    private fun save(c: Context, list: List<Vehicle>) {
        prefs(c).edit { putString(KEY_LIST, Json.encodeToString(LIST, list)) }
        cache = list
    }

    internal fun decode(text: String?): List<Vehicle> =
        text?.let { runCatching { Json.decodeFromString(LIST, it) }.getOrNull() }.orEmpty()

    /**
     * Cria o primeiro veículo com os dados de antes desta versão. Também roda depois de restaurar um
     * backup antigo: ajustes gerais que reaparecem vão para o veículo selecionado.
     */
    @Synchronized
    fun ensure(c: Context, force: Boolean = false) {
        if (ready && !force) return
        cache = null
        selectedCache = null
        val p = prefs(c)
        if (decode(p.getString(KEY_LIST, null)).isEmpty()) {
            val profileId = p.getString(KEY_PROFILE, null) ?: ProfileParser.DEFAULT_PROFILE_ID
            val name = runCatching { ProfileParser.load(c, profileId).profile.vehicleName }.getOrNull() ?: "Meu veículo"
            p.edit {
                putString(KEY_LIST, Json.encodeToString(LIST, listOf(Vehicle(FIRST_ID, name, profileId))))
                putString(KEY_SELECTED, FIRST_ID)
            }
        }
        val target = decode(p.getString(KEY_LIST, null)).let { list -> list.firstOrNull { it.id == p.getString(KEY_SELECTED, null) } ?: list.first() }
        moveLegacy(p, target)
        val remote = c.applicationContext.getSharedPreferences(REMOTE_FILE, Context.MODE_PRIVATE)
        if (REMOTE_KEYS.any { remote.contains(it) }) moveKeys(remote, REMOTE_KEYS, target.id)
        ready = true
    }

    @Volatile private var ready = false

    private fun moveLegacy(p: SharedPreferences, target: Vehicle) {
        moveKeys(p, SCOPED_KEYS, target.id)
        val all = p.all
        val renames = PROFILE_PREFIXES.mapNotNull { pre ->
            val old = pre + target.profileId
            // "fuel_correction_" também casaria com "fuel_correction_since_<perfil>": a busca é pela chave exata.
            if (all.containsKey(old)) old to pre + target.id else null
        }
        if (renames.isNotEmpty()) p.edit { renames.forEach { (from, to) -> copy(all[from], to); remove(from) } }
    }

    private fun moveKeys(p: SharedPreferences, keys: List<String>, id: String) {
        val all = p.all
        val present = keys.filter { all.containsKey(it) }
        if (present.isEmpty()) return
        p.edit { present.forEach { k -> copy(all[k], scopedKey(k, id)); remove(k) } }
    }

    private fun SharedPreferences.Editor.copy(value: Any?, key: String) {
        when (value) {
            is Boolean -> putBoolean(key, value)
            is Int -> putInt(key, value)
            is Long -> putLong(key, value)
            is Float -> putFloat(key, value)
            is String -> putString(key, value)
            is Set<*> -> putStringSet(key, value.filterIsInstance<String>().toSet())
        }
    }
}

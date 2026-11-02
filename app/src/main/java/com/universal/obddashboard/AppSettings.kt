package com.universal.obddashboard

import android.content.Context
import android.content.SharedPreferences
import androidx.core.content.edit
import com.universal.obddashboard.obd.DashboardOverride
import com.universal.obddashboard.obd.DashboardSettings
import com.universal.obddashboard.obd.LoadedProfile
import com.universal.obddashboard.obd.ProfileParser
import com.universal.obddashboard.obd.UserAlarm
import com.universal.obddashboard.telemetry.TimedRun
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json

@Serializable
data class TimedRunRecord(val best: Double, val last: Double, val at: Long)

/** Preferências do usuário (perfil ativo, combustível, gatilhos Bluetooth). */
object AppSettings {

    private const val FILE = "obd_dashboard_settings"
    private const val KEY_PROFILE = "selected_profile"
    private const val KEY_ETHANOL_PCT = "ethanol_pct"
    private const val KEY_EXTRA_TRIGGERS = "extra_trigger_devices"
    private const val KEY_ADAPTER_NAMES = "adapter_device_names"
    private const val KEY_FUEL_LEVEL = "fuel_level_l"
    private const val KEY_FUEL_LEVEL_AT = "fuel_level_updated_at"
    private const val KEY_DIAGNOSTICS = "diagnostic_recording"
    private const val KEY_IDLE_TIMEOUT_MIN = "idle_timeout_min"
    private const val KEY_RESUME_WINDOW_MIN = "resume_window_min"
    private const val KEY_LAST_SCAN_PREFIX = "last_scan_at_"
    private const val KEY_DIAG_TRIP_ID = "diag_trip_id"
    private const val KEY_DIAG_FILE = "diag_file"
    private const val KEY_ODOMETER_KM = "odometer_ref_km"
    private const val KEY_ODOMETER_SINCE = "odometer_ref_since"
    private const val KEY_FUEL_CORR_PREFIX = "fuel_correction_"
    private const val KEY_FUEL_CORR_SINCE_PREFIX = "fuel_correction_since_"
    private const val KEY_DASHBOARD_PREFIX = "dashboard_"
    private const val KEY_USER_ALARMS_PREFIX = "user_alarms_"
    private const val KEY_TIMED_RUNS_PREFIX = "timed_runs_"
    private const val KEY_ATMOSPHERIC_KPA = "atmospheric_kpa"

    private fun prefs(context: Context): SharedPreferences =
        context.applicationContext.getSharedPreferences(FILE, Context.MODE_PRIVATE)

    /** Mostradores do perfil com o que o usuário ajustou para ele. */
    fun dashboard(context: Context, loaded: LoadedProfile): DashboardSettings =
        DashboardOverride.decode(prefs(context).getString(KEY_DASHBOARD_PREFIX + loaded.id, null))
            ?.applyTo(loaded.profile.dashboard) ?: loaded.profile.dashboard

    fun hasDashboardOverride(context: Context, profileId: String): Boolean =
        prefs(context).contains(KEY_DASHBOARD_PREFIX + profileId)

    fun setDashboardOverride(context: Context, profileId: String, override: DashboardOverride) =
        prefs(context).edit { putString(KEY_DASHBOARD_PREFIX + profileId, override.encode()) }

    fun clearDashboardOverride(context: Context, profileId: String) =
        prefs(context).edit { remove(KEY_DASHBOARD_PREFIX + profileId) }

    fun userAlarms(context: Context, profileId: String): List<UserAlarm> =
        UserAlarm.decode(prefs(context).getString(KEY_USER_ALARMS_PREFIX + profileId, null))

    fun setUserAlarms(context: Context, profileId: String, alarms: List<UserAlarm>) =
        prefs(context).edit { putString(KEY_USER_ALARMS_PREFIX + profileId, UserAlarm.encode(alarms)) }

    /** Última pressão atmosférica medida: vale ao ligar o app com o motor já em funcionamento. */
    fun atmosphericKpa(context: Context): Double? =
        prefs(context).getFloat(KEY_ATMOSPHERIC_KPA, Float.NaN).toDouble().takeUnless { it.isNaN() }

    fun setAtmosphericKpa(context: Context, kpa: Double) {
        if (atmosphericKpa(context) != kpa) prefs(context).edit { putFloat(KEY_ATMOSPHERIC_KPA, kpa.toFloat()) }
    }

    /** Melhor e último tempo por faixa, em JSON: {"0-100":{"best":14.2,"last":15.1,"at":0}}. */
    fun timedRuns(context: Context, profileId: String): Map<String, TimedRunRecord> =
        prefs(context).getString(KEY_TIMED_RUNS_PREFIX + profileId, null)
            ?.let { runCatching { Json.decodeFromString<Map<String, TimedRunRecord>>(it) }.getOrNull() }.orEmpty()

    fun recordTimedRun(context: Context, profileId: String, run: TimedRun, now: Long) {
        val all = timedRuns(context, profileId).toMutableMap()
        val best = minOf(all[run.band]?.best ?: run.seconds, run.seconds)
        all[run.band] = TimedRunRecord(best, run.seconds, now)
        prefs(context).edit { putString(KEY_TIMED_RUNS_PREFIX + profileId, Json.encodeToString(all.toMap())) }
    }

    fun clearTimedRuns(context: Context, profileId: String) =
        prefs(context).edit { remove(KEY_TIMED_RUNS_PREFIX + profileId) }

    fun selectedProfileId(context: Context): String =
        prefs(context).getString(KEY_PROFILE, null) ?: ProfileParser.DEFAULT_PROFILE_ID

    fun setSelectedProfileId(context: Context, id: String) =
        prefs(context).edit { putString(KEY_PROFILE, id) }

    /** % (em volume) de etanol hidratado no tanque — define a estequiometria do cálculo de consumo. */
    fun ethanolPercent(context: Context, default: Double): Double =
        prefs(context).getFloat(KEY_ETHANOL_PCT, Float.NaN).toDouble().takeUnless { it.isNaN() } ?: default

    fun setEthanolPercent(context: Context, pct: Double) =
        prefs(context).edit { putFloat(KEY_ETHANOL_PCT, pct.coerceIn(0.0, 100.0).toFloat()) }

    /**
     * Nomes/MACs do adaptador OBD. Vazio = usa adapter.device_names do perfil.
     */
    fun adapterNames(context: Context, profileDefaults: List<String>): List<String> =
        csv(prefs(context).getString(KEY_ADAPTER_NAMES, null)).ifEmpty { profileDefaults }

    fun setAdapterNames(context: Context, csv: String) =
        prefs(context).edit { putString(KEY_ADAPTER_NAMES, csv) }

    /**
     * Dispositivos extras que, ao conectar, iniciam a captura (ex.: a central multimídia do carro).
     * Necessário porque o adaptador ELM327 é passivo: ele não "se conecta" sozinho ao telefone.
     */
    fun extraTriggerDevices(context: Context): List<String> =
        csv(prefs(context).getString(KEY_EXTRA_TRIGGERS, null))

    fun setExtraTriggerDevices(context: Context, csv: String) =
        prefs(context).edit { putString(KEY_EXTRA_TRIGGERS, csv) }

    /** Nível estimado de combustível (L), ou null se o usuário nunca informou um abastecimento. */
    fun fuelLevel(context: Context): Double? =
        prefs(context).getFloat(KEY_FUEL_LEVEL, Float.NaN).toDouble().takeUnless { it.isNaN() }

    fun setFuelLevel(context: Context, liters: Double) =
        prefs(context).edit {
            putFloat(KEY_FUEL_LEVEL, liters.coerceAtLeast(0.0).toFloat())
            putLong(KEY_FUEL_LEVEL_AT, System.currentTimeMillis())
        }

    /** Fator sobre o consumo calculado pelo perfil, calibrado com abastecimentos; [since] = quando mudou. */
    data class FuelCorrection(val factor: Double, val since: Long)

    fun fuelCorrection(context: Context, profileId: String): FuelCorrection {
        val p = prefs(context)
        return FuelCorrection(
            p.getFloat(KEY_FUEL_CORR_PREFIX + profileId, 1f).toDouble(),
            p.getLong(KEY_FUEL_CORR_SINCE_PREFIX + profileId, 0L),
        )
    }

    fun setFuelCorrection(context: Context, profileId: String, factor: Double, now: Long = System.currentTimeMillis()) =
        prefs(context).edit {
            putFloat(KEY_FUEL_CORR_PREFIX + profileId, factor.toFloat())
            putLong(KEY_FUEL_CORR_SINCE_PREFIX + profileId, now)
        }

    /** Grava tráfego OBD bruto, varredura da ECU e eventos em arquivos JSON Lines (ver DiagnosticRecorder). */
    fun diagnosticRecording(context: Context): Boolean = prefs(context).getBoolean(KEY_DIAGNOSTICS, false)

    fun setDiagnosticRecording(context: Context, enabled: Boolean) =
        prefs(context).edit { putBoolean(KEY_DIAGNOSTICS, enabled) }

    /** Minutos parado até perguntar se encerra a captura; 0 = nunca. */
    fun idleTimeoutMin(context: Context): Int = prefs(context).getInt(KEY_IDLE_TIMEOUT_MIN, 15)

    fun setIdleTimeoutMin(context: Context, minutes: Int) =
        prefs(context).edit { putInt(KEY_IDLE_TIMEOUT_MIN, minutes.coerceIn(0, 24 * 60)) }

    /** Uma captura que começa até este tanto depois do fim da anterior continua a mesma viagem. */
    fun resumeWindowMin(context: Context): Int = prefs(context).getInt(KEY_RESUME_WINDOW_MIN, 60)

    fun setResumeWindowMin(context: Context, minutes: Int) =
        prefs(context).edit { putInt(KEY_RESUME_WINDOW_MIN, minutes.coerceIn(0, 24 * 60)) }

    fun lastScanAt(context: Context, profileId: String): Long? =
        prefs(context).getLong(KEY_LAST_SCAN_PREFIX + profileId, -1).takeIf { it >= 0 }

    fun setLastScanAt(context: Context, profileId: String, at: Long) =
        prefs(context).edit { putLong(KEY_LAST_SCAN_PREFIX + profileId, at) }

    /** Arquivo de diagnóstico da última viagem, para continuar no mesmo arquivo ao retomá-la. */
    fun diagnosticFileForTrip(context: Context, tripId: Long): String? {
        val p = prefs(context)
        return if (p.getLong(KEY_DIAG_TRIP_ID, -1) == tripId) p.getString(KEY_DIAG_FILE, null) else null
    }

    fun setDiagnosticFileForTrip(context: Context, tripId: Long, fileName: String) =
        prefs(context).edit { putLong(KEY_DIAG_TRIP_ID, tripId).putString(KEY_DIAG_FILE, fileName) }

    /**
     * Hodômetro do carro informado pelo usuário: o "Total" do painel passa a ser [km] mais a distância
     * das viagens iniciadas a partir de [since]. null = Total é só a soma das viagens gravadas.
     */
    data class OdometerRef(val km: Double, val since: Long)

    fun odometerRef(context: Context): OdometerRef? {
        val p = prefs(context)
        val km = p.getFloat(KEY_ODOMETER_KM, Float.NaN).toDouble()
        return if (km.isNaN()) null else OdometerRef(km, p.getLong(KEY_ODOMETER_SINCE, 0))
    }

    fun setOdometerRef(context: Context, ref: OdometerRef?) = prefs(context).edit {
        if (ref == null) remove(KEY_ODOMETER_KM).remove(KEY_ODOMETER_SINCE)
        else putFloat(KEY_ODOMETER_KM, ref.km.toFloat()).putLong(KEY_ODOMETER_SINCE, ref.since)
    }

    private fun csv(value: String?): List<String> =
        value.orEmpty().split(',', ';').map { it.trim() }.filter { it.isNotEmpty() }
}

package com.universal.obddashboard

import android.content.Context
import android.content.SharedPreferences
import androidx.core.content.edit
import com.universal.obddashboard.obd.DashboardOverride
import com.universal.obddashboard.obd.DashboardSettings
import com.universal.obddashboard.obd.LoadedProfile
import com.universal.obddashboard.obd.ProfileParser
import com.universal.obddashboard.obd.UserAlarm
import com.universal.obddashboard.telemetry.ImuMotion
import com.universal.obddashboard.telemetry.TimedRun
import com.universal.obddashboard.telemetry.TripMark
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
    private const val KEY_FUEL_LEVEL_MANUAL_AT = "fuel_level_manual_at"
    private const val KEY_DIAGNOSTICS = "diagnostic_recording"
    private const val KEY_IDLE_TIMEOUT_MIN = "idle_timeout_min"
    private const val KEY_RESUME_WINDOW_MIN = "resume_window_min"
    private const val KEY_LAST_SCAN_PREFIX = "last_scan_at_"
    private const val KEY_DIAG_TRIP_ID = "diag_trip_id"
    private const val KEY_DIAG_FILE = "diag_file"
    private const val KEY_ODOMETER_KM = "odometer_ref_km"
    private const val KEY_ODOMETER_SINCE = "odometer_ref_since"
    private const val KEY_TRIP_MARK_PREFIX = "trip_mark_"
    const val MARK_TRIP_A = "a"
    const val MARK_FUEL_UP = "fuel"
    private const val KEY_FUEL_CORR_PREFIX = "fuel_correction_"
    private const val KEY_FUEL_CORR_SINCE_PREFIX = "fuel_correction_since_"
    private const val KEY_DASHBOARD_PREFIX = "dashboard_"
    private const val KEY_USER_ALARMS_PREFIX = "user_alarms_"
    private const val KEY_TIMED_RUNS_PREFIX = "timed_runs_"
    private const val KEY_ATMOSPHERIC_KPA = "atmospheric_kpa"
    private const val KEY_IMU_CALIBRATION = "imu_calibration"
    private const val KEY_COMPASS_CALIBRATION = "compass_calibration"
    private const val KEY_CAN_ADAPTER = "can_adapter_names"

    /** Chave do ajuste no veículo selecionado (ver [Vehicles]). */
    private fun sk(context: Context, key: String) = Vehicles.scopedKey(key, vid(context))

    private fun vid(context: Context) = Vehicles.selectedId(context)

    private fun prefs(context: Context): SharedPreferences =
        context.applicationContext.getSharedPreferences(FILE, Context.MODE_PRIVATE)

    /** Mostradores do perfil com o que o usuário ajustou para ele. */
    fun dashboard(context: Context, loaded: LoadedProfile): DashboardSettings =
        DashboardOverride.decode(prefs(context).getString(KEY_DASHBOARD_PREFIX + vid(context), null))
            ?.applyTo(loaded.profile.dashboard) ?: loaded.profile.dashboard

    fun hasDashboardOverride(context: Context): Boolean =
        prefs(context).contains(KEY_DASHBOARD_PREFIX + vid(context))

    fun setDashboardOverride(context: Context, override: DashboardOverride) =
        prefs(context).edit { putString(KEY_DASHBOARD_PREFIX + vid(context), override.encode()) }

    fun clearDashboardOverride(context: Context) =
        prefs(context).edit { remove(KEY_DASHBOARD_PREFIX + vid(context)) }

    fun userAlarms(context: Context): List<UserAlarm> =
        UserAlarm.decode(prefs(context).getString(KEY_USER_ALARMS_PREFIX + vid(context), null))

    fun setUserAlarms(context: Context, alarms: List<UserAlarm>) =
        prefs(context).edit { putString(KEY_USER_ALARMS_PREFIX + vid(context), UserAlarm.encode(alarms)) }

    /** Última pressão atmosférica medida: vale ao ligar o app com o motor já em funcionamento. */
    /** Orientação aprendida do sensor de movimento do ESP32 (LSM6DS3); vai no backup com os outros ajustes. */
    fun imuCalibration(context: Context): ImuMotion.Calibration? =
        ImuMotion.Calibration.decode(prefs(context).getString(KEY_IMU_CALIBRATION, null))

    fun setImuCalibration(context: Context, cal: ImuMotion.Calibration) {
        prefs(context).edit { putString(KEY_IMU_CALIBRATION, cal.encode()) }
    }

    /** Tabela da bússola (magnetômetro do ESP32 contra o rumo do GPS); também vai no backup. */
    fun compassCalibration(context: Context): com.universal.obddashboard.telemetry.Compass.Calibration? =
        com.universal.obddashboard.telemetry.Compass.Calibration.decode(prefs(context).getString(KEY_COMPASS_CALIBRATION, null))

    fun setCompassCalibration(context: Context, cal: com.universal.obddashboard.telemetry.Compass.Calibration) {
        prefs(context).edit { putString(KEY_COMPASS_CALIBRATION, cal.encode()) }
    }

    fun atmosphericKpa(context: Context): Double? =
        prefs(context).getFloat(KEY_ATMOSPHERIC_KPA, Float.NaN).toDouble().takeUnless { it.isNaN() }

    fun setAtmosphericKpa(context: Context, kpa: Double) {
        if (atmosphericKpa(context) != kpa) prefs(context).edit { putFloat(KEY_ATMOSPHERIC_KPA, kpa.toFloat()) }
    }

    /** Melhor e último tempo por faixa, em JSON: {"0-100":{"best":14.2,"last":15.1,"at":0}}. */
    fun timedRuns(context: Context): Map<String, TimedRunRecord> =
        prefs(context).getString(KEY_TIMED_RUNS_PREFIX + vid(context), null)
            ?.let { runCatching { Json.decodeFromString<Map<String, TimedRunRecord>>(it) }.getOrNull() }.orEmpty()

    fun recordTimedRun(context: Context, run: TimedRun, now: Long) {
        val all = timedRuns(context).toMutableMap()
        val best = minOf(all[run.band]?.best ?: run.seconds, run.seconds)
        all[run.band] = TimedRunRecord(best, run.seconds, now)
        prefs(context).edit { putString(KEY_TIMED_RUNS_PREFIX + vid(context), Json.encodeToString(all.toMap())) }
    }

    fun clearTimedRuns(context: Context) =
        prefs(context).edit { remove(KEY_TIMED_RUNS_PREFIX + vid(context)) }

    /** Adaptador de escuta CAN (ESP32) do veículo: nome ou MAC. Vazio = sem escuta. */
    fun canAdapterNames(context: Context): List<String> = csv(prefs(context).getString(sk(context, KEY_CAN_ADAPTER), null))

    fun setCanAdapterNames(context: Context, csv: String) =
        prefs(context).edit { putString(sk(context, KEY_CAN_ADAPTER), csv.trim()) }

    fun selectedProfileId(context: Context): String =
        prefs(context).getString(KEY_PROFILE, null) ?: ProfileParser.DEFAULT_PROFILE_ID

    fun setSelectedProfileId(context: Context, id: String) =
        prefs(context).edit { putString(KEY_PROFILE, id) }

    /** % (em volume) de etanol hidratado no tanque — define a estequiometria do cálculo de consumo. */
    fun ethanolPercent(context: Context, default: Double): Double =
        prefs(context).getFloat(sk(context, KEY_ETHANOL_PCT), Float.NaN).toDouble().takeUnless { it.isNaN() } ?: default

    fun setEthanolPercent(context: Context, pct: Double) =
        prefs(context).edit { putFloat(sk(context, KEY_ETHANOL_PCT), pct.coerceIn(0.0, 100.0).toFloat()) }

    /**
     * Nomes/MACs do adaptador OBD. Vazio = usa adapter.device_names do perfil.
     */
    fun adapterNames(context: Context, profileDefaults: List<String>): List<String> =
        csv(prefs(context).getString(sk(context, KEY_ADAPTER_NAMES), null)).ifEmpty { profileDefaults }

    fun setAdapterNames(context: Context, csv: String) =
        prefs(context).edit { putString(sk(context, KEY_ADAPTER_NAMES), csv) }

    /**
     * Dispositivos extras que, ao conectar, iniciam a captura (ex.: a central multimídia do carro).
     * Necessário porque o adaptador ELM327 é passivo: ele não "se conecta" sozinho ao telefone.
     */
    fun extraTriggerDevices(context: Context): List<String> =
        csv(prefs(context).getString(sk(context, KEY_EXTRA_TRIGGERS), null))

    fun setExtraTriggerDevices(context: Context, csv: String) =
        prefs(context).edit { putString(sk(context, KEY_EXTRA_TRIGGERS), csv) }

    /** Nível estimado de combustível (L), ou null se o usuário nunca informou um abastecimento. */
    fun fuelLevel(context: Context): Double? =
        prefs(context).getFloat(sk(context, KEY_FUEL_LEVEL), Float.NaN).toDouble().takeUnless { it.isNaN() }

    fun setFuelLevel(context: Context, liters: Double) =
        prefs(context).edit {
            putFloat(sk(context, KEY_FUEL_LEVEL), liters.coerceAtLeast(0.0).toFloat())
            putLong(sk(context, KEY_FUEL_LEVEL_AT), System.currentTimeMillis())
        }

    /** Quando a pessoa informou o nível (abastecimento ou ajuste): o ponteiro atrasado do painel não o desfaz. */
    fun fuelLevelManualAt(context: Context): Long? =
        prefs(context).getLong(sk(context, KEY_FUEL_LEVEL_MANUAL_AT), 0L).takeIf { it > 0 }

    fun markFuelLevelManual(context: Context, at: Long = System.currentTimeMillis()) =
        prefs(context).edit { putLong(sk(context, KEY_FUEL_LEVEL_MANUAL_AT), at) }

    /** Fator sobre o consumo calculado pelo perfil, calibrado com abastecimentos; [since] = quando mudou. */
    data class FuelCorrection(val factor: Double, val since: Long)

    fun fuelCorrection(context: Context): FuelCorrection {
        val p = prefs(context)
        return FuelCorrection(
            p.getFloat(KEY_FUEL_CORR_PREFIX + vid(context), 1f).toDouble(),
            p.getLong(KEY_FUEL_CORR_SINCE_PREFIX + vid(context), 0L),
        )
    }

    fun setFuelCorrection(context: Context, factor: Double, now: Long = System.currentTimeMillis()) =
        prefs(context).edit {
            putFloat(KEY_FUEL_CORR_PREFIX + vid(context), factor.toFloat())
            putLong(KEY_FUEL_CORR_SINCE_PREFIX + vid(context), now)
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

    /** Último aviso de manutenção mostrado para o veículo (no máximo um por dia). */
    fun maintenanceNotifiedAt(context: Context, vehicleId: String): Long? =
        prefs(context).getLong("maintenance_notified_$vehicleId", -1).takeIf { it >= 0 }

    fun setMaintenanceNotifiedAt(context: Context, vehicleId: String, at: Long) =
        prefs(context).edit { putLong("maintenance_notified_$vehicleId", at) }

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
        val km = p.getFloat(sk(context, KEY_ODOMETER_KM), Float.NaN).toDouble()
        return if (km.isNaN()) null else OdometerRef(km, p.getLong(sk(context, KEY_ODOMETER_SINCE), 0))
    }

    fun setOdometerRef(context: Context, ref: OdometerRef?) = prefs(context).edit {
        if (ref == null) remove(sk(context, KEY_ODOMETER_KM)).remove(sk(context, KEY_ODOMETER_SINCE))
        else putFloat(sk(context, KEY_ODOMETER_KM), ref.km.toFloat()).putLong(sk(context, KEY_ODOMETER_SINCE), ref.since)
    }

    /**
     * Marcas do computador de bordo, por veículo: o instante em que o parcial A foi zerado ou em que houve
     * abastecimento, com os totais da viagem em andamento naquele momento (para contar só o resto dela).
     */
    fun tripMark(context: Context, kind: String): TripMark? =
        prefs(context).getString(sk(context, KEY_TRIP_MARK_PREFIX + kind), null)?.let { TripMark.decode(it) }

    fun setTripMark(context: Context, kind: String, mark: TripMark) =
        prefs(context).edit { putString(sk(context, KEY_TRIP_MARK_PREFIX + kind), mark.encode()) }

    private fun csv(value: String?): List<String> =
        value.orEmpty().split(',', ';').map { it.trim() }.filter { it.isNotEmpty() }
}

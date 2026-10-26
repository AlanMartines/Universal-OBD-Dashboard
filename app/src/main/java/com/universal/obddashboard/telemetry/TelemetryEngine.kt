package com.universal.obddashboard.telemetry

import android.location.Location
import com.universal.obddashboard.db.TripEntity
import com.universal.obddashboard.obd.CompiledAlert
import com.universal.obddashboard.obd.FormulaEvaluator
import com.universal.obddashboard.obd.FuelSettings
import com.universal.obddashboard.obd.LoadedProfile
import com.universal.obddashboard.obd.ShiftIndicatorSettings
import com.universal.obddashboard.obd.VariableResolver
import java.util.Locale
import kotlin.math.abs

/**
 * Métricas derivadas (consumo, marcha, alertas) calculadas periodicamente a partir do
 * [DashboardState]. Não acessa Android além de [Location.distanceBetween].
 */
class TelemetryEngine(
    private val profile: LoadedProfile,
    var ethanolPercent: Double,
    /** Nível de combustível conhecido no início da viagem (L), ou null se desconhecido. */
    var fuelLevelL: Double?,
    /** Correção do consumo calibrada com abastecimentos reais (Abastecimentos → Calibração); 1 = perfil. */
    var fuelCorrection: Double = 1.0,
) {
    private val roles = profile.profile.roles
    private val fuelCalc = profile.profile.fuel?.let { FuelCalculator(it) }
    private val shiftAdvisor = profile.profile.shiftIndicator?.let { ShiftAdvisor(it) }
    private val alertEngine = AlertEngine(profile.alerts)

    class Result(val derived: DerivedMetrics, val alerts: List<ActiveAlert>, val newlyRaised: List<ActiveAlert>)

    fun compute(state: DashboardState, trip: TripAccumulator?, now: Long, dtS: Double): Result {
        val v = { id: String? -> state.value(id, now) }
        val rpm = v(roles.rpm)
        val speed = v(roles.speed)
        val tps = v(roles.throttle)

        val baseVars = VariableResolver { name -> state.value(name, now) ?: Double.NaN }

        val lph = fuelCalc?.litersPerHour(
            rpm = rpm,
            mapKpa = v(roles.map),
            iatC = v(roles.intakeTemp),
            mafGs = v(roles.maf),
            stftPct = v(roles.stft),
            ltftPct = v(roles.ltft),
            ethanolPct = ethanolPercent,
            vars = baseVars,
        )?.times(fuelCorrection)

        val consumedL = (lph ?: 0.0) * dtS / 3600.0
        fuelLevelL = fuelLevelL?.let { (it - consumedL).coerceAtLeast(0.0) }
        trip?.onTick(
            now = now,
            dtS = dtS,
            obdSpeed = speed,
            gpsSpeed = state.gps?.takeIf { now - it.timestamp < 5000 }?.speedKmh,
            rpm = rpm,
            coolant = v(roles.coolantTemp),
            volts = v(roles.batteryVolts),
            fuelLph = lph,
        )

        val instantKmL = if (lph != null && lph > 0.05 && speed != null && speed > 5) speed / lph else null
        val tripKmL = trip?.let { if (it.fuelUsedL > 0.05) it.distanceKm / it.fuelUsedL else null }
        val advice = shiftAdvisor?.advise(speed, rpm, tps)

        val derived = DerivedMetrics(
            fuelLph = lph,
            instantKmPerL = instantKmL,
            tripKmPerL = tripKmL,
            tripFuelUsedL = trip?.fuelUsedL ?: 0.0,
            fuelRemainingL = fuelLevelL,
            recommendedGear = advice?.recommendedGear,
            estimatedGear = advice?.estimatedGear,
            shiftUp = advice?.shiftUp ?: false,
        )

        val vars = VariableResolver { name ->
            when (name) {
                "gps_speed" -> state.gps?.takeIf { now - it.timestamp < 5000 }?.speedKmh ?: Double.NaN
                "fuel_lph" -> lph ?: Double.NaN
                "fuel_kml" -> instantKmL ?: Double.NaN
                "fuel_remaining_l" -> fuelLevelL ?: Double.NaN
                "trip_distance_km" -> trip?.distanceKm ?: Double.NaN
                "dtc_confirmed_count" -> state.confirmedDtcs.size.toDouble()
                "dtc_pending_count" -> state.pendingDtcs.size.toDouble()
                else -> state.value(name, now) ?: Double.NaN
            }
        }
        val (alerts, raised) = alertEngine.evaluate(now, vars) { id ->
            val value = vars.resolve(id)
            if (value.isNaN()) "--" else formatValue(value, profile.outputs[id]?.decimals ?: 1)
        }
        return Result(derived, alerts, raised)
    }

    companion object {
        fun formatValue(value: Double, decimals: Int): String =
            String.format(Locale.forLanguageTag("pt-BR"), "%.${decimals.coerceIn(0, 4)}f", value)
    }
}

/** Consumo instantâneo por speed-density (MAP/RPM/IAT) ou MAF, com correção pelos fuel trims. */
class FuelCalculator(private val s: FuelSettings) {

    private val decelCut = s.decelFuelCutCondition?.let { FormulaEvaluator.compile(it) }

    fun litersPerHour(
        rpm: Double?,
        mapKpa: Double?,
        iatC: Double?,
        mafGs: Double?,
        stftPct: Double?,
        ltftPct: Double?,
        ethanolPct: Double,
        vars: VariableResolver,
    ): Double? {
        if (rpm == null) return null
        if (rpm < 300) return 0.0                                    // motor desligado
        if (decelCut != null && FormulaEvaluator.truthy(decelCut.eval(vars))) return 0.0

        val airGs = when {
            s.method == "maf" && mafGs != null -> mafGs
            mapKpa != null -> {
                val iatK = (iatC ?: 25.0) + 273.15
                // m_ar [g/s] = P·V_cil·(RPM/120)·VE / (R·T)
                mapKpa * 1000.0 * (s.displacementL / 1000.0) * (rpm / 120.0) * s.volumetricEfficiency /
                    (R_AIR * iatK) * 1000.0
            }
            mafGs != null -> mafGs
            else -> return null
        }
        val (afr, density) = blend(ethanolPct)
        // Limita a correção: um PID de trim mal decodificado não pode zerar ou inverter o consumo.
        val trim = 1.0 + ((stftPct ?: 0.0) + (ltftPct ?: 0.0)).coerceIn(-MAX_TRIM_PCT, MAX_TRIM_PCT) / 100.0
        val fuelGs = airGs / afr * trim
        return fuelGs * 3600.0 / density
    }

    /** Mistura gasolina/etanol: AFR ponderado em massa, densidade ponderada em volume. */
    fun blend(ethanolPct: Double): Pair<Double, Double> {
        val g = s.gasoline
        val e = s.ethanol ?: return g.afr to g.densityGPerL
        val v = (ethanolPct / 100.0).coerceIn(0.0, 1.0)
        val massE = v * e.densityGPerL
        val massG = (1 - v) * g.densityGPerL
        val w = massE / (massE + massG)
        return (w * e.afr + (1 - w) * g.afr) to (massE + massG)
    }

    private companion object {
        const val R_AIR = 287.05 // J/(kg·K)
        const val MAX_TRIM_PCT = 30.0
    }
}

data class ShiftAdvice(val recommendedGear: Int?, val estimatedGear: Int?, val shiftUp: Boolean)

/** Indicador de troca de marcha baseado na tabela de velocidades econômicas do manual. */
class ShiftAdvisor(private val s: ShiftIndicatorSettings) {

    fun advise(speed: Double?, rpm: Double?, tps: Double?): ShiftAdvice {
        if (speed == null || speed < 3) return ShiftAdvice(if (speed != null) 1 else null, null, false)
        val recommended = 1 + s.upshiftSpeedsKmh.count { speed >= it }
        val estimated = estimateGear(speed, rpm)
        val lightLoad = tps == null || tps < s.maxTpsForHintPct
        val shiftUp = when {
            !lightLoad -> false
            estimated != null -> estimated < recommended
            // Sem relações calibradas: sugere subir se já passou do 1º limite e o giro está alto.
            rpm != null -> rpm > s.upshiftRpmHint && speed >= (s.upshiftSpeedsKmh.firstOrNull() ?: Double.MAX_VALUE)
            else -> false
        }
        return ShiftAdvice(recommended, estimated, shiftUp)
    }

    private fun estimateGear(speed: Double, rpm: Double?): Int? {
        if (s.gearKmhPer1000Rpm.isEmpty() || rpm == null || rpm < 900) return null
        val ratio = speed / (rpm / 1000.0)
        var best = -1
        var bestErr = Double.MAX_VALUE
        s.gearKmhPer1000Rpm.forEachIndexed { i, r ->
            val err = abs(ratio - r) / r
            if (err < bestErr) { bestErr = err; best = i }
        }
        return if (best >= 0 && bestErr <= s.gearMatchTolerance) best + 1 else null // embreagem/ponto morto
    }
}

/** Avalia as regras de alerta do perfil, com debounce (sustain_ms). */
class AlertEngine(private val rules: List<CompiledAlert>) {

    private val trueSince = HashMap<String, Long>()
    private val active = LinkedHashMap<String, ActiveAlert>()
    private val placeholder = Regex("\\{([A-Za-z_][A-Za-z0-9_]*)\\}")

    /** @return (alertas ativos ordenados por severidade, alertas que acabaram de disparar) */
    fun evaluate(
        now: Long,
        vars: VariableResolver,
        format: (String) -> String,
    ): Pair<List<ActiveAlert>, List<ActiveAlert>> {
        val raised = mutableListOf<ActiveAlert>()
        for (a in rules) {
            val id = a.rule.id
            if (FormulaEvaluator.truthy(a.condition.eval(vars))) {
                val since = trueSince.getOrPut(id) { now }
                if (now - since >= a.rule.sustainMs) {
                    val message = placeholder.replace(a.rule.message) { format(it.groupValues[1]) }
                    val existing = active[id]
                    val alert = ActiveAlert(id, a.level, message, existing?.since ?: now, a.rule.notify)
                    if (existing == null) raised += alert
                    active[id] = alert
                }
            } else {
                trueSince.remove(id)
                active.remove(id)
            }
        }
        val sorted = active.values.sortedWith(compareByDescending<ActiveAlert> { it.level }.thenBy { it.since })
        return sorted to raised
    }
}

/** Estatísticas de viagem acumuladas em memória e persistidas periodicamente na tabela `trips`. */
class TripAccumulator(
    val tripId: Long,
    val startTime: Long,
    val profileId: String,
    /** Ver VehicleProfile.obdSpeedFactor: só afeta a distância integrada pela velocidade da ECU. */
    private val obdSpeedFactor: Double = 1.0,
) {

    var distanceKm = 0.0; private set
    var maxSpeedKmh = 0.0; private set
    var maxRpm = 0.0; private set
    var maxCoolantC: Double? = null; private set
    var minVoltage: Double? = null; private set
    var fuelUsedL = 0.0; private set

    private var lastFix: GpsFix? = null
    private var lastGoodFixAt = 0L

    /** Continua os totais de uma viagem retomada (ver CapturePolicy.tripToResume). */
    @Synchronized
    fun restore(e: TripEntity) {
        distanceKm = e.distanceKm
        maxSpeedKmh = e.maxSpeedKmh
        maxRpm = e.maxRpm
        maxCoolantC = e.maxCoolantC
        minVoltage = e.minVoltage
        fuelUsedL = e.fuelUsedL
    }

    @Synchronized
    fun onGpsFix(fix: GpsFix) {
        if (fix.accuracyM > MAX_GPS_ACCURACY_M) return
        val prev = lastFix
        lastFix = fix
        lastGoodFixAt = fix.timestamp
        if (prev == null || (fix.speedKmh ?: 0.0) < 2.0) return
        val out = FloatArray(1)
        Location.distanceBetween(prev.latitude, prev.longitude, fix.latitude, fix.longitude, out)
        val dtS = (fix.timestamp - prev.timestamp) / 1000.0
        // Descarta saltos impossíveis (> 250 km/h entre dois fixes).
        if (dtS > 0 && out[0] / dtS < 70) distanceKm += out[0] / 1000.0
    }

    @Synchronized
    fun onTick(
        now: Long,
        dtS: Double,
        obdSpeed: Double?,
        gpsSpeed: Double?,
        rpm: Double?,
        coolant: Double?,
        volts: Double?,
        fuelLph: Double?,
    ) {
        // Sem GPS confiável recente, integra a velocidade da ECU.
        if (now - lastGoodFixAt > 5000 && obdSpeed != null) distanceKm += obdSpeed * obdSpeedFactor * dtS / 3600.0
        (obdSpeed ?: gpsSpeed)?.let { if (it > maxSpeedKmh) maxSpeedKmh = it }
        rpm?.let { if (it > maxRpm) maxRpm = it }
        coolant?.let { c -> if (maxCoolantC == null || c > maxCoolantC!!) maxCoolantC = c }
        volts?.takeIf { it > 6.0 }?.let { u -> if (minVoltage == null || u < minVoltage!!) minVoltage = u }
        fuelLph?.let { fuelUsedL += it * dtS / 3600.0 }
    }

    @Synchronized
    fun toEntity(endTime: Long? = null, endReason: String? = null) = TripEntity(
        id = tripId,
        profileId = profileId,
        startTime = startTime,
        endTime = endTime,
        distanceKm = distanceKm,
        maxSpeedKmh = maxSpeedKmh,
        maxRpm = maxRpm,
        maxCoolantC = maxCoolantC,
        minVoltage = minVoltage,
        fuelUsedL = fuelUsedL,
        endReason = endReason,
    )

    private companion object {
        const val MAX_GPS_ACCURACY_M = 25f
    }
}

package com.universal.obddashboard.telemetry

import android.location.Location
import com.universal.obddashboard.can.Slcan
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
    userAlerts: List<CompiledAlert> = emptyList(),
    atmosphericKpa: Double? = null,
    /** Preço do último abastecimento, para o custo da viagem. */
    private val fuelPricePerL: Double? = null,
    /** Correção escolhida em Mostradores: os cronômetros usam a mesma velocidade que a tela mostra. */
    speedCorrectionPct: Double = 0.0,
    /** Orientação aprendida do sensor de movimento do ESP32 (LSM6DS3), salva entre as capturas. */
    imuCalibration: ImuMotion.Calibration? = null,
    /** Tabela da bússola (magnetômetro do ESP32 contra o rumo do GPS), salva entre as capturas. */
    compassCalibration: Compass.Calibration? = null,
    /** Ajuste fino à mão (Ajustes → Calibração dos sensores). */
    trims: SensorTrims = SensorTrims(),
    /** Orientação aprendida do celular no suporte (reserva do sensor de movimento do ESP32). */
    phoneImuCalibration: ImuMotion.Calibration? = null,
    /** Fator da velocidade do carro aprendido pelo GPS (deste veículo). */
    speedCalibration: SpeedCalibrator.State? = null,
    /** Fator do perfil (velocidade da ECU → distância), até o aprendido ficar pronto. */
    private val profileSpeedFactor: Double = 1.0,
) {
    private val roles = profile.profile.roles
    private val fuelCalc = profile.profile.fuel?.let { FuelCalculator(it) }
    private val shiftAdvisor = profile.profile.shiftIndicator?.let { ShiftAdvisor(it) }
    private val alertEngine = AlertEngine(profile.alerts + userAlerts)
    private val estimatedLoad = EstimatedLoad(atmosphericKpa)
    private val timers = PerformanceTimers()
    private val speedFactor = 1 + speedCorrectionPct / 100
    private var lastSpeedAt = 0L
    private val imu = ImuMotion(imuCalibration)
    private var lastImuAt = 0L
    private var lastImuSaveAt = 0L
    private var savedManual = 0
    private val compass = Compass(compassCalibration)
    private var lastMagAt = 0L
    private var lastPhoneAt = 0L
    private var lastGpsAt = 0L
    private var savedCompass = 0
    private var lastCompassSaveAt = 0L
    private val altimeter = Altimeter()
    // Fontes cruzadas: reservas do celular, percurso estimado, fator da velocidade, motor, inclinação e ambiente
    private val phoneImu = ImuMotion(phoneImuCalibration)
    private var lastPhoneImuAt = 0L
    private var lastPhoneImuSaveAt = 0L
    private var savedPhoneManual = 0
    private val phoneAltimeter = Altimeter()
    private var lastPhonePressureAt = 0L
    private val dead = DeadReckoning()
    private var lastDeadGpsAt = 0L
    val speedCalibrator = SpeedCalibrator(speedCalibration)
    private var savedSpeedCal = 0
    private var lastSpeedCalSaveAt = 0L
    private val slopeCheck = SlopeCheck()
    private val ambient = AmbientEstimate()
    private val battery = BatteryWatch()
    private val vibration = ArrayDeque<Pair<Long, Double>>()
    private var lastPeakAt = 0L

    init { setTrims(trims) }

    /** Ajuste fino mudou em Ajustes: vale na hora, sem reiniciar a captura. */
    fun setTrims(t: SensorTrims) {
        imu.pitchTrimDeg = t.pitchDeg
        imu.rollTrimDeg = t.rollDeg
        phoneImu.pitchTrimDeg = t.pitchDeg
        phoneImu.rollTrimDeg = t.rollDeg
        compass.headingTrimDeg = t.headingDeg
    }

    private var lastPressureAt = 0L
    private val ecoMid = profile.profile.fuel?.ecoMidLPer100km ?: TripStats.DEFAULT_ECO_MID
    /** Computador de bordo da viagem; numa viagem retomada, refeito pelas amostras gravadas ([restoreStats]). */
    var stats = TripStats(ecoMid); private set
    private val smoothLph = Smoothed()
    private val smoothSpeed = Smoothed()

    fun restoreStats(logs: List<com.universal.obddashboard.db.TelemetryLogEntity>) {
        stats = TripStats.fromLogs(logs, ecoMid)
    }

    class Result(
        val derived: DerivedMetrics,
        val alerts: List<ActiveAlert>,
        val newlyRaised: List<ActiveAlert>,
        val timedRuns: List<TimedRun> = emptyList(),
        val atmosphericKpa: Double? = null,
        /** Orientação do sensor de movimento para salvar (no máximo a cada 30 s), ou null. */
        val imuCalibration: ImuMotion.Calibration? = null,
        /** Tabela da bússola para salvar, ou null. */
        val compassCalibration: Compass.Calibration? = null,
        /** Orientação do celular no suporte para salvar, ou null. */
        val phoneImuCalibration: ImuMotion.Calibration? = null,
        /** Somas do fator da velocidade para salvar, ou null. */
        val speedCalibration: SpeedCalibrator.State? = null,
        /** GPS voltou depois de um trecho estimado: acertar os pontos gravados nele. */
        val positionCorrection: DeadReckoning.Correction? = null,
    )

    /** Ajuste à mão pedido na tela (Zerar nível, Calibrar frente, esquecer calibrações). [TRIMS] vem por [setTrims]. */
    fun imuRequest(r: TelemetryHub.ImuRequest, now: Long) = when (r) {
        TelemetryHub.ImuRequest.LEVEL -> { imu.requestLevel(now); phoneImu.requestLevel(now) }
        TelemetryHub.ImuRequest.FORWARD -> { imu.armForward(now); phoneImu.armForward(now) }
        TelemetryHub.ImuRequest.FORGET_IMU -> { imu.forget(); phoneImu.forget() }
        TelemetryHub.ImuRequest.FORGET_COMPASS -> compass.reset()
        TelemetryHub.ImuRequest.FORGET_PHONE -> compass.forgetPhone()
        TelemetryHub.ImuRequest.TRIMS -> Unit
        TelemetryHub.ImuRequest.FORGET_SPEED -> speedCalibrator.reset()
    }

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

        stats.add(dtS, speed, rpm, lph)
        val sLph = smoothLph.update(lph, dtS)
        val sSpeed = smoothSpeed.update(speed, dtS)
        val instantKmL = if (sLph != null && sLph > TripStats.CUT_LPH && sSpeed != null && sSpeed > 5) sSpeed / sLph else null
        val ecoBand = if (sLph != null && sLph > TripStats.CUT_LPH && sSpeed != null && sSpeed >= TripStats.ECO_MIN_KMH) {
            TripStats.band(sLph / sSpeed * 100.0, ecoMid)
        } else {
            null
        }
        val tripKmL = trip?.let { if (it.fuelUsedL > 0.05) it.distanceKm / it.fuelUsedL else null }
        val advice = shiftAdvisor?.advise(speed, rpm, tps)
        // Pressão do sensor ambiente do ESP32 (hPa → kPa), quando houver: carga ao vivo, vácuo e desvio do MAP
        val loadPct = estimatedLoad.update(rpm, v(roles.map), v(Slcan.CABIN_PRESSURE)?.div(10.0))
        val fuelUsed = trip?.fuelUsedL ?: 0.0
        val speedReading = state.readings[roles.speed]
        val timedRuns = if (speedReading != null && speedReading.timestamp != lastSpeedAt) {
            lastSpeedAt = speedReading.timestamp
            imu.onSpeed(speedReading.timestamp, speedReading.value)
            phoneImu.onSpeed(speedReading.timestamp, speedReading.value)
            timers.onSpeed(speedReading.timestamp, speedReading.value * speedFactor)
        } else {
            emptyList()
        }

        // Sensor de movimento do ESP32: cada linha nova (5 por segundo) passa pelo ImuMotion
        val ax = state.readings[Slcan.IMU_AX]
        val imuFresh = ax != null && now - ax.timestamp < IMU_STALE_MS
        if (ax != null && imuFresh && ax.timestamp != lastImuAt) {
            val dt = if (lastImuAt == 0L) 0.2 else (ax.timestamp - lastImuAt) / 1000.0
            lastImuAt = ax.timestamp
            val r = { id: String -> state.readings[id]?.value ?: 0.0 }
            imu.update(
                ax.timestamp, dt,
                doubleArrayOf(ax.value, r(Slcan.IMU_AY), r(Slcan.IMU_AZ)),
                doubleArrayOf(r(Slcan.IMU_GX), r(Slcan.IMU_GY), r(Slcan.IMU_GZ)),
                r(Slcan.IMU_PEAK),
            )
        }
        // Reserva: acelerômetro e giroscópio do celular, aprendidos em paralelo (calibração própria)
        val pax = state.readings[PhoneSensors.AX]
        val phoneImuFresh = pax != null && now - pax.timestamp < IMU_STALE_MS
        if (pax != null && phoneImuFresh && pax.timestamp != lastPhoneImuAt) {
            val dt = if (lastPhoneImuAt == 0L) 0.2 else ((pax.timestamp - lastPhoneImuAt) / 1000.0).coerceAtMost(1.0)
            lastPhoneImuAt = pax.timestamp
            val r = { id: String -> state.readings[id]?.value ?: 0.0 }
            phoneImu.update(
                pax.timestamp, dt,
                doubleArrayOf(pax.value, r(PhoneSensors.AY), r(PhoneSensors.AZ)),
                doubleArrayOf(r(PhoneSensors.GX), r(PhoneSensors.GY), r(PhoneSensors.GZ)),
                r(PhoneSensors.PEAK),
            )
        }
        // O que vale na tela: o ESP32 (preso no carro); sem ele, o celular
        val usePhone = !imuFresh && phoneImuFresh
        val motion = if (usePhone) phoneImu else imu
        val motionFresh = imuFresh || phoneImuFresh
        val phoneManual = phoneImu.manualChanges != savedPhoneManual
        val phoneImuSave = phoneImu.calibration?.takeIf { phoneManual || now - lastPhoneImuSaveAt >= IMU_SAVE_MS }
            ?.also { lastPhoneImuSaveAt = now; savedPhoneManual = phoneImu.manualChanges }
        // Ajuste à mão salva na hora; o aprendizado automático, no máximo a cada 30 s
        val manual = imu.manualChanges != savedManual
        val imuSave = imu.calibration?.takeIf { manual || now - lastImuSaveAt >= IMU_SAVE_MS }?.also { lastImuSaveAt = now; savedManual = imu.manualChanges }
        val seenImu = lastImuAt != 0L || lastPhoneImuAt != 0L
        // Rumo: GPS andando; magnetômetro do ESP32 parado ou sem sinal (calibrado pelo próprio GPS)
        val gps = state.gps
        if (gps != null && gps.timestamp != lastGpsAt) {
            lastGpsAt = gps.timestamp
            compass.onGps(gps.timestamp, gps.bearing, gps.speedKmh, gps.accuracyM)
            altimeter.onGps(gps.altitudeM, gps.verticalAccuracyM)
            phoneAltimeter.onGps(gps.altitudeM, gps.verticalAccuracyM)
        }
        val mx = state.readings[Slcan.MAG_X]
        val magFresh = mx != null && now - mx.timestamp < IMU_STALE_MS
        if (mx != null && magFresh && mx.timestamp != lastMagAt) {
            lastMagAt = mx.timestamp
            val r = { id: String -> state.readings[id]?.value ?: 0.0 }
            compass.onMag(mx.timestamp, doubleArrayOf(mx.value, r(Slcan.MAG_Y), r(Slcan.MAG_Z)), motion.yawDps.takeIf { motionFresh })
        }
        // Bússola do celular: reserva parado, quando o ESP32 não tem magnetômetro
        val ph = state.phoneHeading
        if (ph != null && ph.timestamp != lastPhoneAt) {
            lastPhoneAt = ph.timestamp
            compass.onPhone(ph.timestamp, ph.azimuthDeg, ph.axis, ph.reliable, motion.yawDps.takeIf { motionFresh })
        }
        compass.update(now, speed)
        val compassSave = compass.calibration.takeIf { compass.changes != savedCompass && now - lastCompassSaveAt >= IMU_SAVE_MS }
            ?.also { savedCompass = compass.changes; lastCompassSaveAt = now }

        // Altitude pela pressão do ESP32
        val pressure = state.readings[Slcan.CABIN_PRESSURE]
        if (pressure != null && pressure.timestamp != lastPressureAt) {
            lastPressureAt = pressure.timestamp
            altimeter.onPressure(pressure.timestamp, pressure.value)
        }
        val pressureFresh = pressure != null && now - pressure.timestamp < DashboardState.STALE_AFTER_MS
        // Reserva: barômetro do celular (outra altitude, acertada pelo GPS do mesmo jeito)
        val phonePressure = state.readings[PhoneSensors.PRESSURE]
        if (phonePressure != null && phonePressure.timestamp != lastPhonePressureAt) {
            lastPhonePressureAt = phonePressure.timestamp
            phoneAltimeter.onPressure(phonePressure.timestamp, phonePressure.value)
        }
        val phonePressureFresh = phonePressure != null && now - phonePressure.timestamp < DashboardState.STALE_AFTER_MS
        val alt = when {
            pressureFresh -> altimeter
            phonePressureFresh -> phoneAltimeter
            else -> null
        }

        // Fator da velocidade aprendido pelo GPS; vale na distância sem GPS e no percurso estimado
        val gpsNow = state.gps
        speedCalibrator.update(
            now, dtS, speed, speedReading?.timestamp, gpsNow?.speedKmh, gpsNow?.accuracyM, gpsNow?.timestamp,
            motion.yawDps.takeIf { motionFresh && motion.stage >= 1 },
        )
        val factor = speedCalibrator.factor ?: profileSpeedFactor
        trip?.obdSpeedFactor = factor
        val speedCalSave = speedCalibrator.state.takeIf { speedCalibrator.changes != savedSpeedCal && now - lastSpeedCalSaveAt >= IMU_SAVE_MS }
            ?.also { savedSpeedCal = speedCalibrator.changes; lastSpeedCalSaveAt = now }

        // Percurso sem buracos: sem GPS, anda pela velocidade e pelo rumo da bússola e do giro
        var correction: DeadReckoning.Correction? = null
        if (gpsNow != null && gpsNow.timestamp != lastDeadGpsAt) {
            lastDeadGpsAt = gpsNow.timestamp
            correction = dead.onGps(gpsNow)
        }
        val estimate = dead.tick(
            now, dtS, speed?.times(factor),
            compass.headingDeg.takeIf { compass.source != Compass.SOURCE_GPS },
            motion.yawDps.takeIf { motionFresh && motion.stage >= 1 },
        )

        // Motor ligado: RPM, tensão (qualquer fonte) ou vibração parado
        val peak = state.readings[Slcan.IMU_PEAK]
        if (peak != null && peak.timestamp != lastPeakAt && imuFresh) {
            lastPeakAt = peak.timestamp
            if ((speed ?: gpsNow?.speedKmh ?: 0.0) < 1.0) vibration.addLast(peak.timestamp to peak.value) else vibration.clear()
        }
        while (vibration.isNotEmpty() && now - vibration.first().first > VIBRATION_WINDOW_MS) vibration.removeFirst()
        val vibrationG = vibration.takeIf { it.size >= 5 }?.map { it.second }?.sorted()?.let { it[it.size / 2] }
        val rpmAny = rpm ?: state.value(PhoneSensors.CAN_RPM, now)
        val espVolts = state.value(Slcan.ESP_BATT_V, now)
        val carVolts = state.value(PhoneSensors.CAN_VOLTAGE, now) ?: v(roles.batteryVolts)
        val engine = EngineVote.decide(rpmAny, listOfNotNull(carVolts, v(roles.batteryVolts), espVolts), vibrationG)

        // Inclinação conferida pela subida medida na pressão
        slopeCheck.update(dtS, speed?.times(factor) ?: gpsNow?.takeIf { now - it.timestamp < 3000 }?.speedKmh,
            alt?.altitudeM, motion.slopePct.takeIf { motionFresh && motion.stage == 2 })
        // Temperatura de fora pela admissão
        ambient.update(dtS, v(roles.intakeTemp), v(roles.coolantTemp) ?: state.value(PhoneSensors.CAN_COOLANT, now), speed)
        // Bateria pelo ESP32, conferida com a da rede
        battery.update(espVolts, state.value(Slcan.ESP_BATT_REST, now), state.value(Slcan.ESP_BATT_LOWEST, now), carVolts, engine.on)

        val derived = DerivedMetrics(
            fuelLph = lph,
            instantKmPerL = instantKmL,
            tripKmPerL = tripKmL,
            tripFuelUsedL = trip?.fuelUsedL ?: 0.0,
            fuelRemainingL = fuelLevelL,
            recommendedGear = advice?.recommendedGear,
            estimatedGear = advice?.estimatedGear,
            shiftUp = advice?.shiftUp ?: false,
            estimatedLoadPct = loadPct,
            vacuumKpa = estimatedLoad.vacuumKpa,
            mapOffsetKpa = estimatedLoad.mapOffsetKpa,
            imuStage = if (motionFresh) motion.stage else null,
            accelG = motion.accelG.takeIf { motionFresh },
            lateralG = motion.lateralG.takeIf { motionFresh },
            slopePct = motion.slopePct.takeIf { motionFresh },
            impactG = motion.impactG.takeIf { motionFresh },
            bumps = motion.bumps,
            maxBrakeG = motion.maxBrakeG.takeIf { seenImu },
            maxAccelG = motion.maxAccelG.takeIf { seenImu },
            maxLateralG = motion.maxLateralG.takeIf { seenImu },
            pitchDeg = motion.pitchDeg.takeIf { motionFresh },
            rollDeg = motion.rollDeg.takeIf { motionFresh },
            yawDps = motion.yawDps.takeIf { motionFresh && motion.stage >= 1 },
            maxPitchDeg = motion.maxPitchDeg.takeIf { seenImu && motion.stage == 2 },
            maxRollDeg = motion.maxRollDeg.takeIf { seenImu && motion.stage == 2 },
            // Sem velocidade nova há tanto tempo quanto uma leitura velha, sem sentido
            driveState = motion.direction.takeIf { speed != null },
            imuAction = motion.action(now)?.name,
            headingDeg = compass.headingDeg,
            headingSource = compass.source,
            compassPct = compass.progressPct.takeIf { magFresh },
            compassReady = compass.ready,
            gyroBiasX = imu.gyroBiasDps?.get(0)?.takeIf { imuFresh },
            gyroBiasY = imu.gyroBiasDps?.get(1)?.takeIf { imuFresh },
            gyroBiasZ = imu.gyroBiasDps?.get(2)?.takeIf { imuFresh },
            phoneMountDeg = compass.phoneMountDeg,
            trimPitchDeg = imu.pitchTrimDeg.takeIf { it != 0.0 },
            trimRollDeg = imu.rollTrimDeg.takeIf { it != 0.0 },
            trimHeadingDeg = compass.headingTrimDeg.takeIf { it != 0.0 },
            altitudeM = alt?.altitudeM,
            altitudeTrend = alt?.trend,
            altitudeGps = alt?.calibrated ?: altimeter.calibrated,
            tripCost = fuelPricePerL?.let { it * fuelUsed },
            instantLph = sLph,
            ecoBand = ecoBand,
            movingS = stats.movingS,
            idleS = stats.idleS,
            idleFuelL = stats.idleFuelL,
            fuelCutKm = stats.fuelCutKm,
            avgMovingKmh = stats.avgMovingKmh,
            ecoPct = stats.ecoPct(),
            imuSource = if (usePhone) SOURCE_PHONE else if (imuFresh) SOURCE_ESP32 else null,
            pressureSource = if (pressureFresh) SOURCE_ESP32 else if (phonePressureFresh) SOURCE_PHONE else null,
            positionEstimated = estimate != null,
            estLatitude = estimate?.latitude,
            estLongitude = estimate?.longitude,
            estAccuracyM = estimate?.accuracyM?.toDouble(),
            estDistanceM = estimate?.distanceM,
            speedFactor = speedCalibrator.factor,
            speedFactorKm = speedCalibrator.learnedKm,
            engineOn = engine.on,
            engineSource = engine.source,
            slopeBaroPct = slopeCheck.baroSlopePct,
            slopeDiffDeg = slopeCheck.differenceDeg,
            slopeSuspicious = slopeCheck.suspicious,
            ambientC = ambient.ambientC,
            ambientSource = ambient.source,
            battRestV = battery.restV,
            battCrankV = battery.crankV,
            battDiffV = battery.diffV,
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
        return Result(derived, alerts, raised, timedRuns, estimatedLoad.atmosphericKpa, imuSave, compassSave, phoneImuSave, speedCalSave, correction)
    }

    companion object {
        /** Sem linha do sensor de movimento há tanto tempo, os valores somem da tela. */
        const val IMU_STALE_MS = 2000L
        const val IMU_SAVE_MS = 30_000L
        const val VIBRATION_WINDOW_MS = 3000L
        const val SOURCE_ESP32 = "esp32"
        const val SOURCE_PHONE = "celular"

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
    /** Ver VehicleProfile.obdSpeedFactor: só afeta a distância integrada pela velocidade da ECU. Trocado pelo aprendido. */
    obdSpeedFactor: Double = 1.0,
    val vehicleId: String = "v1",
) {

    @Volatile var obdSpeedFactor: Double = obdSpeedFactor

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
        vehicleId = vehicleId,
    )

    private companion object {
        const val MAX_GPS_ACCURACY_M = 25f
    }
}

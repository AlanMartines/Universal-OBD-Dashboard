package com.universal.obddashboard.service

import android.Manifest
import android.annotation.SuppressLint
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.os.BatteryManager
import android.content.pm.PackageManager
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.IBinder
import android.os.Looper
import android.os.PowerManager
import android.os.SystemClock
import android.util.Log
import androidx.car.app.notification.CarAppExtender
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import androidx.core.app.ServiceCompat
import androidx.core.content.ContextCompat
import com.google.android.gms.location.FusedLocationProviderClient
import com.google.android.gms.location.LocationCallback
import com.google.android.gms.location.LocationRequest
import com.google.android.gms.location.LocationResult
import com.google.android.gms.location.LocationServices
import com.google.android.gms.location.Priority
import com.universal.obddashboard.AppSettings
import com.universal.obddashboard.BuildConfig
import com.universal.obddashboard.MainActivity
import com.universal.obddashboard.R
import com.universal.obddashboard.db.AppDatabase
import com.universal.obddashboard.db.DiagnosticTroubleCodeEntity
import com.universal.obddashboard.db.TelemetryLogEntity
import com.universal.obddashboard.db.TripEntity
import com.universal.obddashboard.diagnostics.ConsoleSession
import com.universal.obddashboard.diagnostics.DiagnosticRecorder
import com.universal.obddashboard.diagnostics.DiagnosticScan
import com.universal.obddashboard.diagnostics.LoggingTransport
import com.universal.obddashboard.obd.AlertLevel
import com.universal.obddashboard.obd.BluetoothSerialManager
import com.universal.obddashboard.obd.CommandQueue
import com.universal.obddashboard.obd.ConnectRetryPolicy
import com.universal.obddashboard.obd.DtcKind
import com.universal.obddashboard.obd.EcuNotRespondingException
import com.universal.obddashboard.obd.EcuSilentException
import com.universal.obddashboard.obd.ElmTransport
import com.universal.obddashboard.obd.LoadedProfile
import com.universal.obddashboard.obd.ProfileParser
import com.universal.obddashboard.telemetry.ActiveAlert
import com.universal.obddashboard.telemetry.CapturePolicy
import com.universal.obddashboard.telemetry.ConnectionStatus
import com.universal.obddashboard.telemetry.DashboardState
import com.universal.obddashboard.telemetry.GpsFix
import com.universal.obddashboard.telemetry.PowerState
import com.universal.obddashboard.telemetry.TelemetryEngine
import com.universal.obddashboard.telemetry.TelemetryHub
import com.universal.obddashboard.telemetry.TripAccumulator
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.NonCancellable
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.cancelAndJoin
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import kotlinx.serialization.json.JsonObjectBuilder
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import kotlinx.serialization.json.putJsonArray
import kotlinx.serialization.json.putJsonObject
import org.json.JSONObject
import java.io.File
import java.util.concurrent.atomic.AtomicBoolean

/**
 * Serviço de captura em primeiro plano ("caixa preta").
 *
 * Integra: Bluetooth SPP → [CommandQueue] → [TelemetryHub]; GPS (Fused Location); métricas
 * derivadas e alertas ([TelemetryEngine]); gravação Room; e a máquina de estados de energia:
 *
 * ```
 *   ACTIVE ──(CAN e GPS ≤ limiar)──► STATIONARY ──(idle_timeout_s)──► IDLE_CONFIRMATION
 *     ▲                                   │                               │       │
 *     └───────────(movimento)─────────────┴──────(movimento / "Continuar")┘       │
 *                                                       (idle_confirm_timeout_s) ▼
 *                                                                          SHUTTING_DOWN
 * ```
 * Também encerra (salvando a viagem) quando o Bluetooth cai sem reconexão ou a ECU silencia.
 */
class ObdForegroundService : Service(), CommandQueue.Listener {

    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Default)
    private var sessionJob: Job? = null
    private val finishing = AtomicBoolean(false)

    private lateinit var serial: BluetoothSerialManager
    @Volatile private var queue: CommandQueue? = null
    @Volatile private var engine: TelemetryEngine? = null
    @Volatile private var trip: TripAccumulator? = null

    private var wakeLock: PowerManager.WakeLock? = null
    private var fused: FusedLocationProviderClient? = null
    private var locationCallback: LocationCallback? = null
    private var locationAllowed = false

    /** Tempo parado até perguntar se encerra (null = nunca), do ajuste do usuário. */
    @Volatile private var idleTimeoutS: Long? = null
    @Volatile private var lastGpsFixMono = 0L
    @Volatile private var gpsLostSince: Long? = null
    private var snapshotCount = 0

    @Volatile private var stationarySince: Long? = null
    @Volatile private var idleConfirmDeadline: Long? = null

    /** Gravação de diagnóstico da sessão atual (null quando desligada em Ajustes). */
    @Volatile private var recorder: DiagnosticRecorder? = null
    private var scanDone = false

    private val recordedDtcs = HashSet<String>()
    private val lastAlertNotifiedAt = HashMap<String, Long>()

    private val dao by lazy { AppDatabase.get(this).tripDao() }

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onCreate() {
        super.onCreate()
        isRunning = true
        serial = BluetoothSerialManager(this)
        createChannels(this)
        installCrashHandler(this)
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        when (intent?.action) {
            ACTION_STOP -> requestStop(intent.getStringExtra(EXTRA_REASON) ?: REASON_USER_STOP)
            ACTION_KEEP_ALIVE -> keepAlive()
            ACTION_LINK_LOST -> {
                Log.i(TAG, "ACL_DISCONNECTED do adaptador recebido")
                serial.close() // a CommandQueue recebe IOException e o laço de conexão decide
            }
            else -> startSession(intent?.getStringExtra(EXTRA_REASON) ?: "sticky_restart")
        }
        return START_STICKY
    }

    override fun onDestroy() {
        isRunning = false
        closeRecorder()
        scope.cancel()
        stopLocationUpdates()
        serial.close()
        releaseWakeLock()
        super.onDestroy()
    }

    // =================================================================================
    //  Sessão de captura
    // =================================================================================

    private fun startSession(trigger: String) {
        if (sessionJob?.isActive == true) return
        if (!promoteToForeground()) {
            stopSelf()
            return
        }
        finishing.set(false)
        Log.i(TAG, "Iniciando captura (gatilho: $trigger)")
        acquireWakeLock()
        sessionJob = scope.launch { runSession(trigger) }
    }

    private suspend fun runSession(trigger: String) {
        val loaded = try {
            ProfileParser.loadSelected(this)
        } catch (e: Exception) {
            Log.e(TAG, "Perfil inválido", e)
            TelemetryHub.update { it.copy(connection = ConnectionStatus.ERROR, statusMessage = e.message ?: "Perfil inválido") }
            requestStop(REASON_PROFILE_ERROR)
            return
        }
        TelemetryHub.reset(loaded)
        idleTimeoutS = CapturePolicy.idleTimeoutS(AppSettings.idleTimeoutMin(this), loaded.profile.powerManagement.idleTimeoutS)
        lastGpsFixMono = SystemClock.elapsedRealtime()
        gpsLostSince = null

        // Retomada: uma captura que começa logo depois da anterior continua a mesma viagem.
        val now = System.currentTimeMillis()
        val last = dao.lastTrip()
        val lastSampleAt = last?.let { dao.lastTelemetryAt(it.id) }
        val resumeId = CapturePolicy.tripToResume(last, lastSampleAt, loaded.id, now, AppSettings.resumeWindowMin(this) * 60_000L)
        dao.closeDanglingTrips(now)
        val acc = if (resumeId != null && last != null) {
            dao.reopenTrip(resumeId)
            TripAccumulator(resumeId, last.startTime, loaded.id, loaded.profile.obdSpeedFactor).apply { restore(last) }
        } else {
            TripAccumulator(dao.insertTrip(TripEntity(profileId = loaded.id, startTime = now)), now, loaded.id, loaded.profile.obdSpeedFactor)
        }
        trip = acc
        val tripId = acc.tripId
        val gapS = if (resumeId != null) (now - maxOf(last?.endTime ?: 0L, lastSampleAt ?: 0L)) / 1000 else null
        Log.i(TAG, if (gapS != null) "Retomando a viagem $tripId (pausa de ${gapS}s)" else "Nova viagem $tripId")
        openRecorder(loaded, trigger, tripId, gapS)
        synchronized(recordedDtcs) { recordedDtcs.clear() }
        engine = TelemetryEngine(
            profile = loaded,
            ethanolPercent = AppSettings.ethanolPercent(this, loaded.profile.fuel?.defaultEthanolPct ?: 0.0),
            fuelLevelL = AppSettings.fuelLevel(this),
            fuelCorrection = AppSettings.fuelCorrection(this, loaded.id).factor,
        )
        TelemetryHub.update { it.copy(tripId = tripId, tripStartedAt = acc.startTime, tripDistanceKm = acc.distanceKm) }
        startLocationUpdates(highAccuracy = true)

        val reason = coroutineScope {
            val workers = listOfNotNull(
                launch { derivedLoop(loaded) },
                launch { telemetryLogLoop(loaded) },
                launch { statusNotificationLoop() },
                recorder?.let { launch { diagnosticSnapshotLoop() } },
            )
            val r = connectionLoop(loaded)
            workers.forEach { it.cancel() }
            r
        }
        requestStop(reason)
    }

    /** Conecta, inicializa e executa a fila; reconecta em quedas. Retorna o motivo de encerramento. */
    private suspend fun connectionLoop(loaded: LoadedProfile): String {
        val policy = ConnectRetryPolicy(loaded.profile.powerManagement) { SystemClock.elapsedRealtime() }

        while (true) {
            var decision: ConnectRetryPolicy.Decision? = null
            if (!serial.hasConnectPermission()) return REASON_BT_PERMISSION
            val names = AppSettings.adapterNames(this, loaded.profile.adapter.deviceNames)
            val device = serial.findBondedDevice(names) ?: return REASON_NOT_PAIRED

            try {
                setStatus(if (policy.everStreamed) ConnectionStatus.RECONNECTING else ConnectionStatus.CONNECTING, "Conectando a ${names.first()}…")
                serial.connect(device)
                setStatus(ConnectionStatus.INITIALIZING, "Inicializando ELM327 (${loaded.profile.protocol})…")

                val rec = recorder
                val transport: ElmTransport = rec?.let { LoggingTransport(serial, it) } ?: serial
                val q = CommandQueue(transport, loaded, this)
                queue = q
                val info = q.initialize()
                TelemetryHub.update {
                    it.copy(adapterVersion = info.version, disabledPids = info.disabledPids)
                }
                rec?.event("adapter") {
                    put("device", device.address)
                    put("version", info.version)
                    putJsonArray("supported_pids") { info.supportedPids?.sorted()?.forEach { add(JsonPrimitive("%02X".format(it))) } }
                    putJsonArray("disabled_pids") { info.disabledPids.forEach { add(JsonPrimitive(it)) } }
                }
                if (rec != null && !scanDone) {
                    scanDone = true
                    setStatus(ConnectionStatus.INITIALIZING, "Varredura de diagnóstico da ECU…")
                    DiagnosticScan.run(transport, info.supportedPids, loaded.profile.adapter, rec)
                    AppSettings.setLastScanAt(this, loaded.id, System.currentTimeMillis())
                }
                setStatus(ConnectionStatus.STREAMING, "Capturando • ${loaded.profile.ecuModel}")
                policy.onStreaming()
                q.idleMode = idleConfirmDeadline != null
                q.run()
            } catch (e: CancellationException) {
                throw e
            } catch (e: EcuSilentException) {
                Log.i(TAG, e.message ?: "ECU em silêncio")
                recorder?.error("connection", e)
                return REASON_IGNITION_OFF
            } catch (e: EcuNotRespondingException) {
                Log.w(TAG, e.message ?: "ECU não respondeu")
                recorder?.error("connection", e)
                decision = policy.onEcuNotResponding()
            } catch (e: Exception) {
                Log.w(TAG, "Falha no link OBD", e)
                recorder?.error("connection", e)
                decision = policy.onLinkFailure()
            } finally {
                queue = null
                serial.close()
            }

            when (val d = decision ?: policy.onLinkFailure()) { // run() só termina por exceção
                is ConnectRetryPolicy.Decision.GiveUp -> return when (d.reason) {
                    ConnectRetryPolicy.GiveUpReason.ADAPTER_UNREACHABLE -> REASON_ADAPTER_UNREACHABLE
                    ConnectRetryPolicy.GiveUpReason.LINK_LOST -> REASON_BT_DISCONNECTED
                    ConnectRetryPolicy.GiveUpReason.IGNITION_NOT_DETECTED -> REASON_IGNITION_NOT_DETECTED
                }
                is ConnectRetryPolicy.Decision.Retry -> {
                    setStatus(
                        ConnectionStatus.RECONNECTING,
                        if (d.waitedS != null) "Aguardando ignição… (${d.waitedS} s)" else "Tentando reconectar (${d.attempt}/${d.max})…",
                    )
                    delay(d.delayMs)
                }
            }
        }
    }

    // ---------------- CommandQueue.Listener ----------------

    override fun onValues(values: Map<String, Double>, timestamp: Long) =
        TelemetryHub.mergeValues(values, timestamp)

    override fun onDtcs(kind: DtcKind, codes: List<String>, timestamp: Long) {
        recorder?.event("dtcs") {
            put("kind", kind.name)
            putJsonArray("codes") { codes.forEach { add(JsonPrimitive(it)) } }
        }
        TelemetryHub.update {
            when (kind) {
                DtcKind.CONFIRMED -> it.copy(confirmedDtcs = codes)
                DtcKind.PENDING -> it.copy(pendingDtcs = codes)
                DtcKind.PERMANENT -> it
            }
        }
        val t = trip ?: return
        val newCodes = synchronized(recordedDtcs) { codes.filter { recordedDtcs.add("${kind.name}:$it") } }
        if (newCodes.isEmpty()) return

        val snapshot = TelemetryHub.state.value
        val profile = TelemetryHub.profile ?: return
        scope.launch(Dispatchers.IO) {
            for (code in newCodes) {
                try {
                    if (dao.countDtc(t.tripId, code, kind.name) == 0) {
                        dao.insertDtc(freezeFrame(code, kind, t.tripId, timestamp, snapshot, profile))
                    }
                } catch (e: Exception) {
                    Log.e(TAG, "Falha ao gravar DTC $code", e)
                }
            }
            // Congelamento de quadro da própria ECU (modo 02), lido uma vez por falha nova; só consulta.
            queue?.requestEcuFreezeFrame { ff -> ff?.let { saveEcuFreezeFrame(t.tripId, it) } }
        }
        if (kind == DtcKind.CONFIRMED) {
            val described = newCodes.joinToString { code -> profile.profile.describeDtc(code)?.let { "$code ($it)" } ?: code }
            notifyAlert(
                ActiveAlert("dtc_${newCodes.joinToString("_")}", AlertLevel.CRITICAL,
                    "Nova falha registrada: $described", timestamp, notify = true),
            )
        }
    }

    override fun onCommandStatus(pidId: String, message: String, disabled: Boolean) {
        Log.i(TAG, "PID $pidId: $message")
        recorder?.event("pid_status") {
            put("pid", pidId)
            put("message", message)
            put("disabled", disabled)
        }
        if (disabled) TelemetryHub.update { it.copy(disabledPids = (it.disabledPids + pidId).distinct()) }
    }

    private fun saveEcuFreezeFrame(tripId: Long, ff: CommandQueue.EcuFreezeFrame) {
        val json = buildJsonObject {
            put("code", ff.code)
            putJsonObject("values") { ff.values.forEach { (k, v) -> put(k, v) } }
        }.toString()
        recorder?.event("ecu_freeze_frame") { put("code", ff.code); put("values", json) }
        scope.launch(Dispatchers.IO) {
            try {
                dao.setEcuFreeze(tripId, ff.code, json)
            } catch (e: Exception) {
                Log.e(TAG, "Falha ao gravar o congelamento de quadro da ECU", e)
            }
        }
    }

    private fun freezeFrame(
        code: String,
        kind: DtcKind,
        tripId: Long,
        timestamp: Long,
        s: DashboardState,
        profile: LoadedProfile,
    ): DiagnosticTroubleCodeEntity {
        val r = profile.profile.roles
        val gps = s.gps?.takeIf { timestamp - it.timestamp < 30_000 }
        return DiagnosticTroubleCodeEntity(
            tripId = tripId,
            code = code,
            kind = kind.name,
            detectedAt = timestamp,
            milOn = s.value(r.milOn, timestamp, 30_000)?.let { it >= 1.0 },
            rpm = s.value(r.rpm, timestamp),
            speedKmh = s.value(r.speed, timestamp) ?: gps?.speedKmh,
            engineLoadPct = s.value(r.engineLoad, timestamp),
            coolantC = s.value(r.coolantTemp, timestamp),
            throttlePct = s.value(r.throttle, timestamp),
            voltage = s.value(r.batteryVolts, timestamp),
            latitude = gps?.latitude,
            longitude = gps?.longitude,
            gpsAccuracyM = gps?.accuracyM,
        )
    }

    // =================================================================================
    //  Laços periódicos
    // =================================================================================

    private suspend fun derivedLoop(loaded: LoadedProfile) {
        var last = SystemClock.elapsedRealtime()
        while (true) {
            delay(DERIVED_TICK_MS)
            val mono = SystemClock.elapsedRealtime()
            val dtS = (mono - last) / 1000.0
            last = mono
            val now = System.currentTimeMillis()
            val state = TelemetryHub.state.value
            val eng = engine ?: continue
            TelemetryHub.takeFuelOverride()?.let { o ->
                o.ethanolPercent?.let { eng.ethanolPercent = it }
                o.fuelLevelL?.let { eng.fuelLevelL = it }
                o.fuelCorrection?.let { eng.fuelCorrection = it }
                recorder?.event("fuel_settings") {
                    o.ethanolPercent?.let { put("ethanol_pct", it) }
                    o.fuelLevelL?.let { put("fuel_level_l", it) }
                    o.fuelCorrection?.let { put("fuel_correction", it) }
                }
            }

            val result = eng.compute(state, trip, now, dtS)
            val gpsAlert = gpsLostAlert(loaded, state, now, mono)
            TelemetryHub.update {
                it.copy(derived = result.derived, alerts = result.alerts + listOfNotNull(gpsAlert), tripDistanceKm = trip?.distanceKm ?: 0.0)
            }
            result.newlyRaised.forEach { a ->
                recorder?.event("alert") {
                    put("id", a.id)
                    put("level", a.level.name)
                    put("message", a.message)
                }
            }
            result.newlyRaised.filter { it.notify && it.level != AlertLevel.INFO }.forEach { notifyAlert(it) }
            powerTick(loaded, state, now)
        }
    }

    private suspend fun telemetryLogLoop(loaded: LoadedProfile) {
        var iteration = 0
        while (true) {
            delay(loaded.profile.telemetryLogIntervalMs)
            val t = trip ?: continue
            val s = TelemetryHub.state.value
            if (s.connection != ConnectionStatus.STREAMING && s.gps == null) continue
            try {
                dao.insertTelemetry(buildSample(loaded, t.tripId, s))
                if (++iteration % TRIP_FLUSH_EVERY == 0) {
                    dao.updateTrip(t.toEntity())
                    engine?.fuelLevelL?.let { AppSettings.setFuelLevel(this, it) }
                }
            } catch (e: Exception) {
                Log.e(TAG, "Falha ao gravar telemetria", e)
            }
        }
    }

    private fun buildSample(loaded: LoadedProfile, tripId: Long, s: DashboardState): TelemetryLogEntity {
        val now = System.currentTimeMillis()
        val r = loaded.profile.roles
        val roleIds = setOf(
            r.rpm, r.speed, r.throttle, r.map, r.coolantTemp, r.intakeTemp, r.batteryVolts,
            r.timingAdvance, r.engineLoad, r.stft, r.ltft, r.lambdaVoltage,
        )
        val extras = JSONObject()
        for ((id, reading) in s.readings) {
            if (id !in roleIds && now - reading.timestamp <= DashboardState.STALE_AFTER_MS) extras.put(id, reading.value)
        }
        val gps = s.gps?.takeIf { now - it.timestamp < 5000 }
        return TelemetryLogEntity(
            tripId = tripId,
            timestamp = now,
            rpm = s.value(r.rpm, now),
            speedObdKmh = s.value(r.speed, now),
            speedGpsKmh = gps?.speedKmh,
            throttlePct = s.value(r.throttle, now),
            mapKpa = s.value(r.map, now),
            coolantC = s.value(r.coolantTemp, now),
            intakeC = s.value(r.intakeTemp, now),
            voltage = s.value(r.batteryVolts, now),
            timingAdvance = s.value(r.timingAdvance, now),
            engineLoadPct = s.value(r.engineLoad, now),
            stftPct = s.value(r.stft, now),
            ltftPct = s.value(r.ltft, now),
            lambdaV = s.value(r.lambdaVoltage, now),
            fuelLph = s.derived.fuelLph,
            latitude = gps?.latitude,
            longitude = gps?.longitude,
            gpsAccuracyM = gps?.accuracyM,
            extraJson = if (extras.length() > 0) extras.toString() else null,
        )
    }

    /**
     * Alerta quando o carro anda sem posição de GPS (na viagem de teste o GPS parou em 24 s e
     * ninguém percebeu por 2,6 h). A distância continua pela velocidade da ECU.
     */
    private fun gpsLostAlert(loaded: LoadedProfile, state: DashboardState, now: Long, mono: Long): ActiveAlert? {
        if (!hasPermission(Manifest.permission.ACCESS_FINE_LOCATION)) return null
        val speed = state.value(loaded.profile.roles.speed, now, maxAgeMs = 5000)
        val lost = CapturePolicy.gpsLost(speed, mono - lastGpsFixMono)
        val since = gpsLostSince
        if (!lost) return null
        if (since == null) {
            gpsLostSince = now
            recorder?.event("gps_lost") { put("last_fix_age_s", (mono - lastGpsFixMono) / 1000) }
        }
        val minutes = (mono - lastGpsFixMono) / 60_000
        val alert = ActiveAlert(
            "gps_lost", AlertLevel.WARNING,
            "GPS sem sinal há $minutes min: a distância segue pela velocidade da ECU. Verifique a localização \"o tempo todo\" e a economia de bateria.",
            since ?: now, notify = true,
        )
        if (since == null) notifyAlert(alert)
        return alert
    }

    /** 1×/s: estado completo (leituras frescas, métricas derivadas, GPS) para a gravação de diagnóstico. */
    private suspend fun diagnosticSnapshotLoop() {
        while (true) {
            delay(DIAG_SNAPSHOT_MS)
            val rec = recorder ?: return
            val s = TelemetryHub.state.value
            val now = System.currentTimeMillis()
            rec.event("snapshot") {
                put("connection", s.connection.name)
                put("power", s.power.name)
                putJsonObject("readings") {
                    for ((id, r) in s.readings) if (now - r.timestamp <= DashboardState.STALE_AFTER_MS) num(id, r.value)
                }
                putJsonObject("derived") {
                    val d = s.derived
                    num("fuel_lph", d.fuelLph)
                    num("km_per_l", d.instantKmPerL)
                    num("trip_km_per_l", d.tripKmPerL)
                    num("trip_fuel_l", d.tripFuelUsedL)
                    num("fuel_remaining_l", d.fuelRemainingL)
                    d.recommendedGear?.let { put("recommended_gear", it) }
                    d.estimatedGear?.let { put("estimated_gear", it) }
                    put("shift_up", d.shiftUp)
                    num("trip_km", s.tripDistanceKm)
                }
                if (snapshotCount++ % PHONE_STATS_EVERY == 0) putJsonObject("phone") { phoneStats(this) }
                s.gps?.takeIf { now - it.timestamp < 5000 }?.let { g ->
                    putJsonObject("gps") {
                        num("lat", g.latitude)
                        num("lon", g.longitude)
                        num("speed_kmh", g.speedKmh)
                        num("accuracy_m", g.accuracyM.toDouble())
                        g.bearing?.let { num("bearing", it.toDouble()) }
                    }
                }
            }
            rec.flush()
        }
    }

    /** Bateria, carregamento, temperatura e restrições de energia: mostram se o sistema está cortando o app. */
    private fun phoneStats(b: JsonObjectBuilder) {
        val bat = ContextCompat.registerReceiver(this, null, IntentFilter(Intent.ACTION_BATTERY_CHANGED), ContextCompat.RECEIVER_NOT_EXPORTED)
        if (bat != null) {
            val level = bat.getIntExtra(BatteryManager.EXTRA_LEVEL, -1)
            val scale = bat.getIntExtra(BatteryManager.EXTRA_SCALE, 100)
            if (level >= 0 && scale > 0) b.put("battery_pct", level * 100 / scale)
            b.put("charging", bat.getIntExtra(BatteryManager.EXTRA_PLUGGED, 0) != 0)
            bat.getIntExtra(BatteryManager.EXTRA_TEMPERATURE, Int.MIN_VALUE).takeIf { it != Int.MIN_VALUE }?.let { b.put("battery_temp_c", it / 10.0) }
        }
        val pm = getSystemService(PowerManager::class.java)
        b.put("screen_on", pm.isInteractive)
        b.put("power_save", pm.isPowerSaveMode)
        b.put("battery_unrestricted", pm.isIgnoringBatteryOptimizations(packageName))
    }

    private fun JsonObjectBuilder.num(key: String, v: Double?) {
        if (v != null && v.isFinite()) put(key, v)
    }

    /** [resumeGapS] != null: viagem retomada; continua no mesmo arquivo se ele ainda existir. */
    private fun openRecorder(loaded: LoadedProfile, trigger: String, tripId: Long, resumeGapS: Long?) {
        scanDone = !CapturePolicy.scanDue(AppSettings.lastScanAt(this, loaded.id), System.currentTimeMillis())
        if (!AppSettings.diagnosticRecording(this)) return
        try {
            val dir = diagnosticsDir(this)
            val previous = if (resumeGapS != null) AppSettings.diagnosticFileForTrip(this, tripId)?.let { File(dir, it) }?.takeIf { it.isFile } else null
            val file = previous ?: DiagnosticRecorder.newFile(dir, loaded.id)
            DiagnosticRecorder.cleanup(dir, DIAG_MAX_AGE_MS, keep = file)
            val rec = DiagnosticRecorder(file)
            AppSettings.setDiagnosticFileForTrip(this, tripId, file.name)
            if (previous != null) rec.event("resume") { put("trip_id", tripId); put("gap_s", resumeGapS) }
            rec.event("session") {
                put("trip_id", tripId)
                put("resumed", resumeGapS != null)
                put("scan_due", !scanDone)
                put("app_version", BuildConfig.VERSION_NAME)
                put("app_build", BuildConfig.VERSION_CODE)
                put("build_type", BuildConfig.BUILD_TYPE)
                put("trigger", trigger)
                put("profile", loaded.id)
                put("vehicle", loaded.profile.vehicleName)
                put("ecu", loaded.profile.ecuModel)
                put("device", "${Build.MANUFACTURER} ${Build.MODEL}")
                put("android_sdk", Build.VERSION.SDK_INT)
                put("gps_allowed", locationAllowed)
                // Ajustes que mudam o consumo calculado: sem eles, a gravação não explica o km/l da viagem
                put("ethanol_pct", AppSettings.ethanolPercent(this@ObdForegroundService, loaded.profile.fuel?.defaultEthanolPct ?: 0.0))
                put("fuel_correction", AppSettings.fuelCorrection(this@ObdForegroundService, loaded.id).factor)
                put("fuel_level_l", AppSettings.fuelLevel(this@ObdForegroundService))
                putJsonArray("adapter_names") {
                    AppSettings.adapterNames(this@ObdForegroundService, loaded.profile.adapter.deviceNames)
                        .forEach { add(JsonPrimitive(it)) }
                }
            }
            rec.flush()
            recorder = rec
            activeDiagnosticFile = file.name
        } catch (e: Exception) {
            Log.e(TAG, "Não foi possível iniciar a gravação de diagnóstico", e)
        }
    }

    private fun closeRecorder() {
        recorder?.close()
        recorder = null
        activeDiagnosticFile = null
    }

    private suspend fun statusNotificationLoop() {
        while (true) {
            delay(STATUS_NOTIFICATION_MS)
            safeNotify(NOTIF_STATUS, buildStatusNotification(statusLine(TelemetryHub.state.value)))
        }
    }

    // =================================================================================
    //  Máquina de estados de energia (estilo Radarbot)
    // =================================================================================

    private fun powerTick(loaded: LoadedProfile, state: DashboardState, now: Long) {
        val pm = loaded.profile.powerManagement
        val obdSpeed = state.value(loaded.profile.roles.speed, now, maxAgeMs = 3000)
        val gpsSpeed = state.gps?.takeIf { now - it.timestamp < 5000 }?.speedKmh
        val moving = (obdSpeed ?: 0.0) > pm.obdIdleSpeedKmh || (gpsSpeed ?: 0.0) > pm.gpsIdleSpeedKmh

        if (moving) {
            if (stationarySince != null || idleConfirmDeadline != null) leaveIdle()
            return
        }

        val since = stationarySince ?: now.also { stationarySince = it }
        val deadline = idleConfirmDeadline
        when {
            deadline != null && now >= deadline -> requestStop(REASON_IDLE_TIMEOUT)
            deadline == null && idleTimeoutS?.let { now - since >= it * 1000 } == true -> enterIdleConfirmation(loaded, now)
            deadline == null && state.power != PowerState.STATIONARY ->
                TelemetryHub.update { it.copy(power = PowerState.STATIONARY) }
        }
    }

    private fun enterIdleConfirmation(loaded: LoadedProfile, now: Long) {
        val pm = loaded.profile.powerManagement
        idleConfirmDeadline = now + pm.idleConfirmTimeoutS * 1000
        recorder?.event("power") { put("state", PowerState.IDLE_CONFIRMATION.name) }
        queue?.idleMode = true                       // reduz a taxa de polling enquanto aguarda
        startLocationUpdates(highAccuracy = false)   // GPS em baixa potência
        TelemetryHub.update { it.copy(power = PowerState.IDLE_CONFIRMATION) }

        val minutes = (idleTimeoutS ?: pm.idleTimeoutS) / 60
        val text = "Veículo parado há $minutes min. A captura será encerrada em ${pm.idleConfirmTimeoutS}s para poupar bateria."
        val notification = NotificationCompat.Builder(this, CHANNEL_ALERTS)
            .setSmallIcon(R.drawable.ic_stat_obd)
            .setColor(getColor(R.color.ic_launcher_background))
            .setContentTitle("Encerrar captura?")
            .setContentText(text)
            .setStyle(NotificationCompat.BigTextStyle().bigText(text))
            .setPriority(NotificationCompat.PRIORITY_HIGH)
            .setCategory(NotificationCompat.CATEGORY_REMINDER)
            .setTimeoutAfter(pm.idleConfirmTimeoutS * 1000)
            .addAction(0, "Continuar gravando", servicePendingIntent(ACTION_KEEP_ALIVE, 1))
            .addAction(0, "Encerrar agora", servicePendingIntent(ACTION_STOP, 2, REASON_IDLE_CONFIRMED))
            .extend(
                CarAppExtender.Builder()
                    .setContentTitle("Encerrar captura?")
                    .setContentText("Veículo parado há $minutes min")
                    .setSmallIcon(R.drawable.ic_stat_obd)
                    .setImportance(NotificationManagerCompat.IMPORTANCE_HIGH)
                    .addAction(R.drawable.ic_stat_obd, "Continuar", servicePendingIntent(ACTION_KEEP_ALIVE, 3))
                    .addAction(R.drawable.ic_stat_obd, "Encerrar", servicePendingIntent(ACTION_STOP, 4, REASON_IDLE_CONFIRMED))
                    .build(),
            )
            .build()
        safeNotify(NOTIF_IDLE, notification)
    }

    private fun leaveIdle() {
        val wasConfirming = idleConfirmDeadline != null
        if (wasConfirming) recorder?.event("power") { put("state", PowerState.ACTIVE.name) }
        stationarySince = null
        idleConfirmDeadline = null
        queue?.idleMode = false
        if (wasConfirming) {
            startLocationUpdates(highAccuracy = true)
            NotificationManagerCompat.from(this).cancel(NOTIF_IDLE)
        }
        TelemetryHub.update { it.copy(power = PowerState.ACTIVE) }
    }

    /** "Continuar gravando": reinicia a contagem de inatividade. */
    private fun keepAlive() {
        if (sessionJob?.isActive != true) return
        leaveIdle()
        stationarySince = System.currentTimeMillis()
    }

    // =================================================================================
    //  Encerramento
    // =================================================================================

    private fun requestStop(reason: String) {
        if (!finishing.compareAndSet(false, true)) return
        Log.i(TAG, "Encerrando captura: $reason")
        scope.launch {
            TelemetryHub.update { it.copy(power = PowerState.SHUTTING_DOWN, statusMessage = reasonLabel(reason)) }
            val job = sessionJob
            if (job != null && job !== coroutineContext[Job]) job.cancelAndJoin()
            recorder?.event("stop") { put("reason", reason) }
            withContext(NonCancellable + Dispatchers.IO) {
                persistTripEnd(reason)
                closeRecorder()
            }
            withContext(Dispatchers.Main) {
                stopLocationUpdates()
                serial.close()
                releaseWakeLock()
                NotificationManagerCompat.from(this@ObdForegroundService).cancel(NOTIF_IDLE)
                TelemetryHub.update {
                    it.copy(connection = ConnectionStatus.STOPPED, power = PowerState.ACTIVE, statusMessage = reasonLabel(reason))
                }
                ServiceCompat.stopForeground(this@ObdForegroundService, ServiceCompat.STOP_FOREGROUND_REMOVE)
                stopSelf()
            }
        }
    }

    private suspend fun persistTripEnd(reason: String) {
        val t = trip ?: return
        trip = null
        try {
            if (dao.telemetryCount(t.tripId) == 0) {
                dao.deleteTrip(t.tripId) // nenhuma amostra: não polui o histórico
            } else {
                dao.updateTrip(t.toEntity(endTime = System.currentTimeMillis(), endReason = reason))
            }
            engine?.fuelLevelL?.let { AppSettings.setFuelLevel(this, it) }
        } catch (e: Exception) {
            Log.e(TAG, "Falha ao salvar viagem", e)
        }
    }

    // =================================================================================
    //  Foreground, WakeLock, GPS, notificações
    // =================================================================================

    // Tipos de FGS são do Android 10 (API 29); abaixo disso o ServiceCompat ignora o tipo.
    @SuppressLint("InlinedApi")
    private fun promoteToForeground(): Boolean {
        val notification = buildStatusNotification("Conectando ao adaptador OBD…")
        locationAllowed = hasPermission(Manifest.permission.ACCESS_FINE_LOCATION)
        val withLocation = ServiceInfo.FOREGROUND_SERVICE_TYPE_CONNECTED_DEVICE or ServiceInfo.FOREGROUND_SERVICE_TYPE_LOCATION
        return try {
            ServiceCompat.startForeground(
                this, NOTIF_STATUS, notification,
                if (locationAllowed) withLocation else ServiceInfo.FOREGROUND_SERVICE_TYPE_CONNECTED_DEVICE,
            )
            true
        } catch (e: SecurityException) {
            // Iniciado a partir de segundo plano sem localização "sempre": segue só com Bluetooth.
            Log.w(TAG, "Sem FGS de localização; GPS desativado nesta sessão", e)
            locationAllowed = false
            try {
                ServiceCompat.startForeground(this, NOTIF_STATUS, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_CONNECTED_DEVICE)
                true
            } catch (e2: Exception) {
                Log.e(TAG, "Não foi possível entrar em primeiro plano", e2)
                false
            }
        } catch (e: Exception) {
            Log.e(TAG, "Não foi possível entrar em primeiro plano", e)
            false
        }
    }

    @SuppressLint("WakelockTimeout")
    private fun acquireWakeLock() {
        if (wakeLock?.isHeld == true) return
        val pm = getSystemService(PowerManager::class.java)
        wakeLock = pm.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "UniversalObd:capture").apply {
            setReferenceCounted(false)
            acquire(WAKELOCK_MAX_MS)
        }
    }

    private fun releaseWakeLock() {
        wakeLock?.takeIf { it.isHeld }?.release()
        wakeLock = null
    }

    @SuppressLint("MissingPermission")
    private fun startLocationUpdates(highAccuracy: Boolean) {
        if (!locationAllowed || !hasPermission(Manifest.permission.ACCESS_FINE_LOCATION)) return
        val client = fused ?: LocationServices.getFusedLocationProviderClient(this).also { fused = it }
        val callback = locationCallback ?: object : LocationCallback() {
            override fun onLocationResult(result: LocationResult) {
                val loc = result.lastLocation ?: return
                val fix = GpsFix(
                    latitude = loc.latitude,
                    longitude = loc.longitude,
                    speedKmh = if (loc.hasSpeed()) loc.speed * 3.6 else null,
                    accuracyM = loc.accuracy,
                    bearing = if (loc.hasBearing()) loc.bearing else null,
                    timestamp = System.currentTimeMillis(),
                )
                lastGpsFixMono = SystemClock.elapsedRealtime()
                if (gpsLostSince != null) {
                    gpsLostSince = null
                    recorder?.event("gps_ok") {}
                }
                trip?.onGpsFix(fix)
                TelemetryHub.update { it.copy(gps = fix) }
            }
        }.also { locationCallback = it }

        val request = if (highAccuracy) {
            // 2 s basta para o trajeto (a velocidade instantânea vem da ECU) e poupa bateria.
            LocationRequest.Builder(Priority.PRIORITY_HIGH_ACCURACY, 2000L).setMinUpdateIntervalMillis(1000L).build()
        } else {
            LocationRequest.Builder(Priority.PRIORITY_BALANCED_POWER_ACCURACY, 10_000L).build()
        }
        // Reutilizar o mesmo callback substitui a requisição anterior.
        client.requestLocationUpdates(request, callback, Looper.getMainLooper())
    }

    private fun stopLocationUpdates() {
        locationCallback?.let { fused?.removeLocationUpdates(it) }
        locationCallback = null
    }

    private fun setStatus(status: ConnectionStatus, message: String) {
        recorder?.event("status") {
            put("connection", status.name)
            put("message", message)
        }
        TelemetryHub.update { it.copy(connection = status, statusMessage = message) }
        safeNotify(NOTIF_STATUS, buildStatusNotification(statusLine(TelemetryHub.state.value)))
    }

    private fun statusLine(s: DashboardState): String {
        val r = TelemetryHub.profile?.profile?.roles ?: return s.statusMessage
        if (s.connection != ConnectionStatus.STREAMING) return s.statusMessage
        val parts = listOfNotNull(
            s.value(r.rpm)?.let { "%.0f RPM".format(it) },
            s.value(r.speed)?.let { "%.0f km/h".format(it) },
            s.value(r.coolantTemp)?.let { "%.0f °C".format(it) },
            s.value(r.batteryVolts)?.let { "%.1f V".format(it) },
            "%.1f km".format(s.tripDistanceKm),
        )
        return parts.joinToString(" • ")
    }

    /** Notificação fixa da captura (estilo Radarbot): ícone na barra de status, cronômetro da viagem e ações. */
    private fun buildStatusNotification(text: String): Notification {
        val s = TelemetryHub.state.value
        val vehicle = s.vehicleName.ifEmpty { getString(R.string.app_name) }
        return NotificationCompat.Builder(this, CHANNEL_STATUS)
            .setSmallIcon(R.drawable.ic_stat_obd)
            .setColor(getColor(R.color.ic_launcher_background))
            .setContentTitle("Universal OBD em execução")
            .setSubText(vehicle)
            .setContentText(text)
            .setStyle(NotificationCompat.BigTextStyle().bigText(text))
            .setOngoing(true)
            .setOnlyAlertOnce(true)
            .setSilent(true)
            .setPriority(NotificationCompat.PRIORITY_DEFAULT)
            .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
            .setCategory(NotificationCompat.CATEGORY_SERVICE)
            .setForegroundServiceBehavior(NotificationCompat.FOREGROUND_SERVICE_IMMEDIATE)
            .setContentIntent(activityPendingIntent())
            .addAction(0, "Abrir", activityPendingIntent())
            .addAction(0, "Encerrar viagem", servicePendingIntent(ACTION_STOP, 10, REASON_USER_STOP))
            .apply {
                s.tripStartedAt?.let {
                    setWhen(it)
                    setShowWhen(true)
                    setUsesChronometer(true)
                }
            }
            .build()
    }

    private fun notifyAlert(alert: ActiveAlert) {
        val now = System.currentTimeMillis()
        synchronized(lastAlertNotifiedAt) {
            val last = lastAlertNotifiedAt[alert.id]
            if (last != null && now - last < ALERT_REPEAT_MS) return
            lastAlertNotifiedAt[alert.id] = now
        }
        val title = if (alert.level == AlertLevel.CRITICAL) "⚠ Alerta crítico" else "Atenção"
        val notification = NotificationCompat.Builder(this, CHANNEL_ALERTS)
            .setSmallIcon(R.drawable.ic_stat_obd)
            .setColor(getColor(R.color.ic_launcher_background))
            .setContentTitle(title)
            .setContentText(alert.message)
            .setPriority(NotificationCompat.PRIORITY_HIGH)
            .setCategory(NotificationCompat.CATEGORY_ALARM)
            .setAutoCancel(true)
            .setContentIntent(activityPendingIntent())
            .extend(
                CarAppExtender.Builder()
                    .setContentTitle(title)
                    .setContentText(alert.message)
                    .setSmallIcon(R.drawable.ic_stat_obd)
                    .setImportance(NotificationManagerCompat.IMPORTANCE_HIGH)
                    .build(),
            )
            .build()
        safeNotify(NOTIF_ALERT_BASE + (alert.id.hashCode() and 0x3FF), notification)
    }

    @SuppressLint("MissingPermission")
    private fun safeNotify(id: Int, notification: Notification) {
        if (Build.VERSION.SDK_INT >= 33 && !hasPermission(Manifest.permission.POST_NOTIFICATIONS)) return
        try {
            NotificationManagerCompat.from(this).notify(id, notification)
        } catch (e: SecurityException) {
            Log.w(TAG, "Sem permissão de notificação", e)
        }
    }

    private fun activityPendingIntent(): PendingIntent = PendingIntent.getActivity(
        this, 0,
        Intent(this, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP),
        PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
    )

    private fun servicePendingIntent(action: String, requestCode: Int, reason: String? = null): PendingIntent =
        PendingIntent.getService(
            this, requestCode,
            Intent(this, ObdForegroundService::class.java).setAction(action).apply {
                reason?.let { putExtra(EXTRA_REASON, it) }
            },
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
        )

    private fun hasPermission(p: String) =
        ContextCompat.checkSelfPermission(this, p) == PackageManager.PERMISSION_GRANTED

    companion object {
        private const val TAG = "ObdService"

        const val ACTION_START = "com.universal.obddashboard.action.START"
        const val ACTION_STOP = "com.universal.obddashboard.action.STOP"
        const val ACTION_KEEP_ALIVE = "com.universal.obddashboard.action.KEEP_ALIVE"
        const val ACTION_LINK_LOST = "com.universal.obddashboard.action.LINK_LOST"
        const val EXTRA_REASON = "reason"

        /** v2: canal antigo era IMPORTANCE_LOW (sem ícone na barra em vários aparelhos) e não pode ser alterado. */
        const val CHANNEL_STATUS = "obd_status_v2"
        private const val CHANNEL_STATUS_OLD = "obd_status"
        const val CHANNEL_ALERTS = "obd_alerts"
        private const val NOTIF_STATUS = 1001
        private const val NOTIF_IDLE = 1002
        private const val NOTIF_ALERT_BASE = 2000

        const val REASON_USER_STOP = "user_stop"
        const val REASON_BT_DISCONNECTED = "bluetooth_disconnected"
        const val REASON_IGNITION_OFF = "ignition_off"
        const val REASON_IDLE_TIMEOUT = "idle_timeout"
        const val REASON_IDLE_CONFIRMED = "idle_confirmed"
        const val REASON_ADAPTER_UNREACHABLE = "adapter_unreachable"
        const val REASON_NOT_PAIRED = "adapter_not_paired"
        const val REASON_BT_PERMISSION = "bluetooth_permission_missing"
        const val REASON_PROFILE_ERROR = "profile_error"
        const val REASON_IGNITION_NOT_DETECTED = "ignition_not_detected"

        private const val DERIVED_TICK_MS = 250L
        private const val STATUS_NOTIFICATION_MS = 5000L
        private const val ALERT_REPEAT_MS = 60_000L
        private const val TRIP_FLUSH_EVERY = 15                 // × 2 s = 30 s
        private const val WAKELOCK_MAX_MS = 12 * 60 * 60 * 1000L
        private const val DIAG_SNAPSHOT_MS = 1000L
        private const val PHONE_STATS_EVERY = 10
        private const val DIAG_MAX_AGE_MS = 30L * 24 * 60 * 60 * 1000

        /** Nome do arquivo de diagnóstico sendo gravado agora, ou null. */
        @Volatile var activeDiagnosticFile: String? = null
            private set

        fun diagnosticsDir(context: Context) = File(context.filesDir, "diagnostics")

        private var crashHandlerInstalled = false

        /** Falhas fatais viram crash_<data>.txt na pasta de diagnóstico (exportável em Ajustes). */
        @Synchronized
        fun installCrashHandler(context: Context) {
            if (crashHandlerInstalled) return
            crashHandlerInstalled = true
            val dir = diagnosticsDir(context.applicationContext)
            val previous = Thread.getDefaultUncaughtExceptionHandler()
            Thread.setDefaultUncaughtExceptionHandler { thread, e ->
                DiagnosticRecorder.writeCrash(dir, thread, e)
                previous?.uncaughtException(thread, e)
            }
        }

        @Volatile var isRunning = false
            private set

        /**
         * @return false se o sistema bloqueou o início em segundo plano (Android 12+). Com o console
         * de diagnóstico em uso não inicia: o adaptador atende uma conexão por vez.
         */
        fun start(context: Context, reason: String): Boolean = if (ConsoleSession.isActive) {
            Log.i(TAG, "Captura não iniciada ($reason): console de diagnóstico em uso")
            true
        } else try {
            ContextCompat.startForegroundService(
                context,
                Intent(context, ObdForegroundService::class.java).setAction(ACTION_START).putExtra(EXTRA_REASON, reason),
            )
            true
        } catch (e: IllegalStateException) { // inclui ForegroundServiceStartNotAllowedException
            Log.w(TAG, "Início do serviço bloqueado: ${e.message}")
            false
        }

        fun stop(context: Context, reason: String = REASON_USER_STOP) {
            if (!isRunning) return
            send(context, ACTION_STOP, reason)
        }

        fun send(context: Context, action: String, reason: String? = null) {
            try {
                context.startService(
                    Intent(context, ObdForegroundService::class.java).setAction(action).apply {
                        reason?.let { putExtra(EXTRA_REASON, it) }
                    },
                )
            } catch (e: IllegalStateException) {
                Log.w(TAG, "Não foi possível enviar $action: ${e.message}")
            }
        }

        fun reasonLabel(reason: String): String = when (reason) {
            REASON_USER_STOP -> "Viagem encerrada pelo usuário"
            REASON_BT_DISCONNECTED -> "Bluetooth desconectado (carro desligado)"
            REASON_IGNITION_OFF -> "ECU sem resposta (ignição desligada)"
            REASON_IDLE_TIMEOUT -> "Encerrada por inatividade"
            REASON_IDLE_CONFIRMED -> "Encerrada após confirmação de inatividade"
            REASON_ADAPTER_UNREACHABLE -> "Adaptador OBD inacessível"
            REASON_NOT_PAIRED -> "Adaptador OBD não pareado (ex.: \"OBDII\")"
            REASON_BT_PERMISSION -> "Permissão de Bluetooth não concedida"
            REASON_PROFILE_ERROR -> "Erro no perfil do veículo"
            REASON_IGNITION_NOT_DETECTED -> "Ignição não detectada (ECU sem resposta)"
            else -> reason
        }

        fun createChannels(context: Context) {
            val nm = context.getSystemService(NotificationManager::class.java)
            nm.deleteNotificationChannel(CHANNEL_STATUS_OLD)
            nm.createNotificationChannel(
                NotificationChannel(CHANNEL_STATUS, "Captura em andamento", NotificationManager.IMPORTANCE_DEFAULT).apply {
                    description = "Indica que a telemetria OBD está sendo capturada em segundo plano"
                    setSound(null, null)
                    enableVibration(false)
                    setShowBadge(false)
                    lockscreenVisibility = Notification.VISIBILITY_PUBLIC
                },
            )
            nm.createNotificationChannel(
                NotificationChannel(CHANNEL_ALERTS, "Alertas do veículo", NotificationManager.IMPORTANCE_HIGH)
                    .apply { description = "Superaquecimento, falhas (DTC) e inatividade" },
            )
        }
    }
}

package com.universal.obddashboard

import android.Manifest
import android.annotation.SuppressLint
import android.app.AlertDialog
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import android.os.Bundle
import android.util.Log
import android.webkit.JsResult
import android.webkit.WebChromeClient
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebView
import android.widget.FrameLayout
import androidx.activity.ComponentActivity
import androidx.activity.enableEdgeToEdge
import androidx.activity.result.contract.ActivityResultContracts
import androidx.core.app.NotificationManagerCompat
import androidx.core.content.ContextCompat
import androidx.core.view.ViewCompat
import androidx.core.view.WindowInsetsCompat
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.lifecycleScope
import androidx.lifecycle.repeatOnLifecycle
import androidx.webkit.WebViewAssetLoader
import androidx.webkit.WebViewClientCompat
import com.universal.obddashboard.backup.BackupArchive
import com.universal.obddashboard.backup.BackupManager
import com.universal.obddashboard.bridge.AiBridge
import com.universal.obddashboard.bridge.AppBridge
import com.universal.obddashboard.bridge.DiagnosticsBridge
import com.universal.obddashboard.bridge.FuelBridge
import com.universal.obddashboard.bridge.HistoryBridge
import com.universal.obddashboard.db.AppDatabase
import com.universal.obddashboard.fuel.FuelLog
import com.universal.obddashboard.obd.LoadedProfile
import com.universal.obddashboard.obd.ProfileParser
import com.universal.obddashboard.obd.Readiness
import com.universal.obddashboard.service.ObdForegroundService
import com.universal.obddashboard.telemetry.DashboardState
import com.universal.obddashboard.telemetry.TelemetryHub
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import org.json.JSONArray
import org.json.JSONObject

/** Hospeda o painel web local (assets/web) e faz a ponte JS ⇄ serviço de captura. */
class MainActivity : ComponentActivity() {

    internal lateinit var webView: WebView
    internal var startAfterPermissions = false

    private val permissionLauncher =
        registerForActivityResult(ActivityResultContracts.RequestMultiplePermissions()) {
            if (startAfterPermissions) {
                startAfterPermissions = false
                if (hasBluetoothPermission()) startCapture()
            }
            pushJs("window.onPermissions && window.onPermissions(${permissionsJson()})")
        }

    /** Importar abastecimentos de um arquivo: o texto vai para a caixa de importação, para conferir antes. */
    internal val fuelCsvPicker =
        registerForActivityResult(ActivityResultContracts.OpenDocument()) { uri ->
            if (uri == null) return@registerForActivityResult
            val result = try {
                val text = contentResolver.openInputStream(uri)?.use { input ->
                    val bytes = input.readNBytesCompat(MAX_CSV_BYTES + 1)
                    if (bytes.size > MAX_CSV_BYTES) throw IllegalArgumentException("Arquivo grande demais para um CSV de abastecimentos")
                    String(bytes, Charsets.UTF_8).removePrefix("\uFEFF")
                } ?: throw IllegalArgumentException("Não foi possível abrir o arquivo")
                JSONObject().put("ok", true).put("text", text)
            } catch (e: Exception) {
                JSONObject().put("ok", false).put("error", e.message ?: "erro")
            }
            pushJs("window.onFuelCsvPicked && window.onFuelCsvPicked($result)")
        }

    private fun java.io.InputStream.readNBytesCompat(max: Int): ByteArray {
        val out = java.io.ByteArrayOutputStream()
        val buf = ByteArray(8192)
        while (out.size() < max) {
            val n = read(buf, 0, minOf(buf.size, max - out.size()))
            if (n < 0) break
            out.write(buf, 0, n)
        }
        return out.toByteArray()
    }

    /** Restaurar backup: o arquivo escolhido substitui banco, ajustes e perfis importados. */
    internal val backupPicker =
        registerForActivityResult(ActivityResultContracts.OpenDocument()) { uri ->
            if (uri == null) return@registerForActivityResult
            lifecycleScope.launch(Dispatchers.IO) {
                val result = try {
                    JSONObject().put("ok", true).put("message", BackupManager.restore(this@MainActivity, uri))
                } catch (e: BackupArchive.BackupException) {
                    JSONObject().put("ok", false).put("error", e.message)
                } catch (e: Exception) {
                    JSONObject().put("ok", false).put("error", "Falha ao restaurar: ${e.message}")
                }
                refreshTotalKm()
                pushJs("window.onBackupRestored && window.onBackupRestored($result)")
            }
        }

    /** "Permitir o tempo todo": no Android 11+ o sistema abre a tela de ajustes da permissão. */
    internal val backgroundLocationLauncher =
        registerForActivityResult(ActivityResultContracts.RequestPermission()) {
            pushJs("window.onPermissions && window.onPermissions(${permissionsJson()})")
        }

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        enableEdgeToEdge()
        super.onCreate(savedInstanceState)
        ObdForegroundService.createChannels(this)

        val assetLoader = WebViewAssetLoader.Builder()
            .addPathHandler("/assets/", WebViewAssetLoader.AssetsPathHandler(this))
            .build()

        webView = WebView(this).apply {
            settings.javaScriptEnabled = true
            settings.domStorageEnabled = true
            settings.allowFileAccess = false
            settings.allowContentAccess = false
            // Só as páginas do próprio app ficam no WebView: a ponte AndroidBridge é visível para qualquer
            // página carregada nele, então links externos (ex.: mapa de uma falha) vão para outro app.
            webViewClient = object : WebViewClientCompat() {
                override fun shouldInterceptRequest(view: WebView, request: WebResourceRequest): WebResourceResponse? =
                    assetLoader.shouldInterceptRequest(request.url)

                override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
                    if (isAppPage(request.url)) return false
                    openExternally(request.url)
                    return true
                }

                override fun onPageStarted(view: WebView, url: String?, favicon: android.graphics.Bitmap?) {
                    if (url != null && !isAppPage(android.net.Uri.parse(url))) {
                        view.stopLoading()
                        view.loadUrl(APP_URL)
                    }
                }
            }
            // Sem WebChromeClient o WebView ignora alert()/confirm() (confirm devolve false na hora).
            webChromeClient = object : WebChromeClient() {
                override fun onJsAlert(view: WebView, url: String?, message: String?, result: JsResult): Boolean {
                    AlertDialog.Builder(this@MainActivity)
                        .setMessage(message)
                        .setPositiveButton("OK") { _, _ -> result.confirm() }
                        .setOnCancelListener { result.confirm() }
                        .show()
                    return true
                }

                override fun onJsConfirm(view: WebView, url: String?, message: String?, result: JsResult): Boolean {
                    AlertDialog.Builder(this@MainActivity)
                        .setMessage(message)
                        .setPositiveButton("Confirmar") { _, _ -> result.confirm() }
                        .setNegativeButton("Cancelar") { _, _ -> result.cancel() }
                        .setOnCancelListener { result.cancel() }
                        .show()
                    return true
                }
            }
            // Uma ponte por assunto (pacote bridge); a tela junta todas em `bridge` (app.js)
            addJavascriptInterface(AppBridge(this@MainActivity), "AndroidBridge")
            addJavascriptInterface(HistoryBridge(this@MainActivity), "AndroidHistory")
            addJavascriptInterface(FuelBridge(this@MainActivity), "AndroidFuel")
            addJavascriptInterface(DiagnosticsBridge(this@MainActivity), "AndroidDiag")
            addJavascriptInterface(AiBridge(this@MainActivity), "AndroidAi")
            loadUrl(APP_URL)
        }

        val root = FrameLayout(this).apply { addView(webView) }
        ViewCompat.setOnApplyWindowInsetsListener(root) { v, insets ->
            val bars = insets.getInsets(WindowInsetsCompat.Type.systemBars() or WindowInsetsCompat.Type.displayCutout())
            v.setPadding(bars.left, bars.top, bars.right, bars.bottom)
            WindowInsetsCompat.CONSUMED
        }
        setContentView(root)

        requestMissingPermissions()
        handleIntent(intent)

        lifecycleScope.launch {
            repeatOnLifecycle(Lifecycle.State.STARTED) {
                TelemetryHub.state.collect { state ->
                    pushJs("window.onTelemetry && window.onTelemetry(${stateJson(state)})")
                    delay(UI_REFRESH_MS)
                }
            }
        }
        lifecycleScope.launch {
            repeatOnLifecycle(Lifecycle.State.STARTED) {
                while (true) {
                    refreshTotalKm()
                    delay(TOTAL_KM_REFRESH_MS)
                }
            }
        }
    }

    /** "Total" do painel: hodômetro informado + viagens desde então, ou a soma das viagens. Relido a cada minuto. */
    @Volatile internal var totalKm: Double? = null

    internal suspend fun refreshTotalKm() {
        val db = AppDatabase.get(this)
        val dao = db.tripDao()
        totalKm = runCatching {
            val ref = AppSettings.odometerRef(this)
            if (ref != null) ref.km + dao.distanceSinceKm(ref.since) else dao.totalDistanceKm()
        }.getOrNull()
        realKmPerL = runCatching { FuelLog.summary(db.fuelUpDao().all()).avgKmPerL }.getOrNull()
    }

    /** Consumo real médio dos abastecimentos (para a autonomia do painel), relido a cada minuto. */
    @Volatile private var realKmPerL: Double? = null

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        handleIntent(intent)
    }

    private fun handleIntent(intent: Intent?) {
        if (intent?.action == ACTION_START_CAPTURE) startCapture()
    }

    // ---------------- Permissões e controle do serviço ----------------

    private fun requiredPermissions(): List<String> = buildList {
        add(Manifest.permission.ACCESS_FINE_LOCATION)
        add(Manifest.permission.ACCESS_COARSE_LOCATION)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) add(Manifest.permission.BLUETOOTH_CONNECT)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) add(Manifest.permission.POST_NOTIFICATIONS)
    }

    internal fun granted(p: String) = ContextCompat.checkSelfPermission(this, p) == PackageManager.PERMISSION_GRANTED

    internal fun hasBluetoothPermission() =
        Build.VERSION.SDK_INT < Build.VERSION_CODES.S || granted(Manifest.permission.BLUETOOTH_CONNECT)

    internal fun requestMissingPermissions(): Boolean {
        val missing = requiredPermissions().filterNot(::granted)
        if (missing.isNotEmpty()) permissionLauncher.launch(missing.toTypedArray())
        return missing.isEmpty()
    }

    internal fun startCapture() {
        if (!hasBluetoothPermission()) {
            startAfterPermissions = true
            requestMissingPermissions()
            return
        }
        ObdForegroundService.start(this, "user_button")
    }

    internal fun permissionsJson() = JSONObject().apply {
        requiredPermissions().forEach { put(it.substringAfterLast('.'), granted(it)) }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) put("ACCESS_BACKGROUND_LOCATION", hasBackgroundLocation())
    }

    /** Sem ela, uma captura iniciada em segundo plano perde o GPS (viagem de teste: 2,6 h sem posição). */
    internal fun hasBackgroundLocation() =
        Build.VERSION.SDK_INT < Build.VERSION_CODES.Q || granted(Manifest.permission.ACCESS_BACKGROUND_LOCATION)

    internal fun pushJs(script: String) {
        if (!::webView.isInitialized) return
        webView.post { webView.evaluateJavascript(script, null) }
    }

    // ---------------- Serialização para o painel web ----------------

    private fun stateJson(s: DashboardState): JSONObject {
        val now = System.currentTimeMillis()
        val readings = JSONObject()
        for ((id, r) in s.readings) {
            if (now - r.timestamp <= DashboardState.STALE_AFTER_MS) readings.put(id, r.value)
        }
        val d = s.derived
        return JSONObject()
            .put("running", ObdForegroundService.isRunning)
            .put("diagRecording", ObdForegroundService.activeDiagnosticFile != null)
            .put("notificationsEnabled", notificationsEnabled())
            .put("totalKm", totalKm.orNull())
            .put("backgroundLocation", !granted(Manifest.permission.ACCESS_FINE_LOCATION) || hasBackgroundLocation())
            .put("profileId", s.profileId ?: JSONObject.NULL)
            .put("vehicleName", s.vehicleName)
            .put("connection", s.connection.name)
            .put("statusMessage", s.statusMessage)
            .put("power", s.power.name)
            .put("readings", readings)
            .put("readiness", readinessJson(Readiness.fromReadings(s.readings.mapValues { it.value.value })))
            .put(
                "derived",
                JSONObject()
                    .put("fuelLph", d.fuelLph.orNull())
                    .put("instantKmPerL", d.instantKmPerL.orNull())
                    .put("tripKmPerL", d.tripKmPerL.orNull())
                    .put("tripFuelUsedL", d.tripFuelUsedL)
                    // Sem captura não há estimativa ao vivo: mostra o último nível salvo (abastecimento ou Ajustes)
                    .put("fuelRemainingL", (d.fuelRemainingL ?: AppSettings.fuelLevel(this).takeIf { !ObdForegroundService.isRunning }).orNull())
                    .put("realKmPerL", realKmPerL.orNull())
                    .put("recommendedGear", d.recommendedGear ?: JSONObject.NULL)
                    .put("estimatedGear", d.estimatedGear ?: JSONObject.NULL)
                    .put("shiftUp", d.shiftUp),
            )
            .put(
                "gps",
                s.gps?.let { g ->
                    JSONObject()
                        .put("lat", g.latitude)
                        .put("lon", g.longitude)
                        .put("speedKmh", g.speedKmh.orNull())
                        .put("accuracyM", g.accuracyM.toDouble())
                        .put("ageMs", now - g.timestamp)
                } ?: JSONObject.NULL,
            )
            .put(
                "alerts",
                JSONArray().apply {
                    s.alerts.forEach { a ->
                        put(JSONObject().put("id", a.id).put("level", a.level.name).put("message", a.message).put("since", a.since))
                    }
                },
            )
            .put("confirmedDtcs", JSONArray(s.confirmedDtcs))
            .put("pendingDtcs", JSONArray(s.pendingDtcs))
            .put("tripId", s.tripId ?: JSONObject.NULL)
            .put("tripStartedAt", s.tripStartedAt ?: JSONObject.NULL)
            .put("tripDistanceKm", s.tripDistanceKm)
            .put("adapterVersion", s.adapterVersion)
            .put("disabledPids", JSONArray(s.disabledPids))
    }

    internal var notifCheckedAt = 0L
    internal var notifEnabled = true

    /** Permissão de notificação concedida e canal de status não silenciado (consultado no máx. a cada 3 s). */
    internal fun notificationsEnabled(): Boolean {
        val now = System.currentTimeMillis()
        if (now - notifCheckedAt < 3000) return notifEnabled
        notifCheckedAt = now
        val nm = NotificationManagerCompat.from(this)
        val channel = nm.getNotificationChannelCompat(ObdForegroundService.CHANNEL_STATUS)
        notifEnabled = nm.areNotificationsEnabled() && (channel == null || channel.importance != NotificationManagerCompat.IMPORTANCE_NONE)
        return notifEnabled
    }

    /** Nível estimado agora: o da captura em andamento, senão o último salvo. */
    internal fun currentFuelLevel(): Double? =
        TelemetryHub.state.value.derived.fuelRemainingL?.takeIf { ObdForegroundService.isRunning && it.isFinite() }
            ?: AppSettings.fuelLevel(this)

    /**
     * Hodômetro do carro agora (km). Com captura em andamento, a viagem atual passa a contar a partir
     * do seu início (referência = km − distância já percorrida nela). km <= 0 remove a referência.
     */
    internal fun applyOdometer(km: Double) {
        if (km <= 0) {
            AppSettings.setOdometerRef(this, null)
        } else {
            val s = TelemetryHub.state.value
            val active = activeTripId() != null && s.tripStartedAt != null
            val ref = if (active) AppSettings.OdometerRef(km - s.tripDistanceKm, s.tripStartedAt!!)
            else AppSettings.OdometerRef(km, System.currentTimeMillis())
            AppSettings.setOdometerRef(this, ref)
        }
        lifecycleScope.launch { refreshTotalKm() }
    }

    /** Monitores de prontidão (lidos no 0101 do ciclo de diagnóstico; mudam devagar, então sem prazo de validade). */
    private fun readinessJson(r: Readiness.Status?): Any = r?.let {
        JSONObject().put("diesel", it.compressionIgnition).put("allComplete", it.allComplete).put(
            "monitors",
            JSONArray().apply { it.monitors.forEach { m -> put(JSONObject().put("id", m.id).put("name", m.name).put("complete", m.complete)) } },
        )
    } ?: JSONObject.NULL

    private fun isAppPage(url: android.net.Uri) =
        url.scheme == "https" && url.host == WebViewAssetLoader.DEFAULT_DOMAIN && url.path.orEmpty().startsWith("/assets/")

    /** Links externos abrem no app adequado (navegador, mapas); nunca dentro do WebView com a ponte. */
    private fun openExternally(url: android.net.Uri) {
        if (url.scheme !in setOf("https", "http", "geo", "mailto")) return
        try {
            startActivity(Intent(Intent.ACTION_VIEW, url).addCategory(Intent.CATEGORY_BROWSABLE).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
        } catch (e: android.content.ActivityNotFoundException) {
            Log.w(TAG, "Nenhum app para abrir $url")
        }
    }

    internal fun isOnline(): Boolean {
        val cm = getSystemService(android.net.ConnectivityManager::class.java) ?: return false
        val caps = cm.getNetworkCapabilities(cm.activeNetwork) ?: return false
        return caps.hasCapability(android.net.NetworkCapabilities.NET_CAPABILITY_INTERNET)
    }

    internal fun activeTripId(): Long? = if (ObdForegroundService.isRunning) TelemetryHub.state.value.tripId else null

    internal fun profileMetaJson(p: LoadedProfile): JSONObject {
        val v = p.profile
        val outputs = JSONArray()
        p.outputs.values.filterNot { it.hidden }.forEach { o ->
            outputs.put(
                JSONObject().put("id", o.id).put("name", o.name).put("unit", o.unit).put("decimals", o.decimals)
                    .put("min", o.min.orNull()).put("max", o.max.orNull()).put("lane", o.lane),
            )
        }
        val r = v.roles
        return JSONObject()
            .put("id", v.profileId)
            .put("vehicleName", v.vehicleName)
            .put("ecuModel", v.ecuModel)
            .put("engine", v.engine)
            .put("protocol", v.protocol)
            .put(
                "roles",
                // JSONObject.NULL mantém a chave: papel ausente no perfil (ex.: LTFT do Uno) ≠ papel padrão
                JSONObject().apply {
                    listOf(
                        "rpm" to r.rpm, "speed" to r.speed, "coolant" to r.coolantTemp, "voltage" to r.batteryVolts,
                        "throttle" to r.throttle, "map" to r.map, "intake" to r.intakeTemp, "engineLoad" to r.engineLoad,
                        "timing" to r.timingAdvance, "stft" to r.stft, "ltft" to r.ltft, "lambda" to r.lambdaVoltage,
                        "milOn" to r.milOn, "dtcCount" to r.dtcCount,
                    ).forEach { (k, v) -> put(k, v ?: JSONObject.NULL) }
                },
            )
            .put(
                "dashboard",
                JSONObject().put("rpmMax", v.dashboard.rpmMax).put("rpmRedline", v.dashboard.rpmRedline)
                    .put("speedMax", v.dashboard.speedMax).put("voltageMin", v.dashboard.voltageMin)
                    .put("voltageMax", v.dashboard.voltageMax),
            )
            .put(
                "thermal",
                v.thermal?.let {
                    JSONObject().put("thermostatOpenC", it.thermostatOpenC).put("fanStage1C", it.fanStage1C)
                        .put("fanStage2C", it.fanStage2C).put("criticalC", it.criticalC)
                } ?: JSONObject.NULL,
            )
            .put(
                "fuel",
                v.fuel?.let {
                    JSONObject().put("tankCapacityL", it.tankCapacityL).put("reserveMinL", it.reserveMinL)
                        .put("reserveMaxL", it.reserveMaxL).put("flex", it.ethanol != null)
                        .put("defaultEthanolPct", it.defaultEthanolPct)
                } ?: JSONObject.NULL,
            )
            .put("upshiftSpeedsKmh", JSONArray(v.shiftIndicator?.upshiftSpeedsKmh.orEmpty()))
            .put("dtcDescriptions", JSONObject(v.dtcDescriptions.mapKeys { it.key.uppercase() }))
            .put("outputs", outputs)
    }

    internal fun currentProfile(): LoadedProfile = TelemetryHub.profile ?: ProfileParser.loadSelected(this)

    // ---------------- Ponte JavaScript (executa em thread de binder) ----------------


    companion object {
        const val ACTION_START_CAPTURE = "com.universal.obddashboard.action.START_CAPTURE"
        private const val TAG = "MainActivity"
        private const val APP_URL = "https://appassets.androidplatform.net/assets/web/index.html"
        private const val UI_REFRESH_MS = 250L
        internal const val CONSOLE_REVIEW_LINES = 3000
        internal const val MAX_CSV_BYTES = 1_000_000
        internal const val MAX_TRIPS_FOR_TOTALS = 500
        private const val TOTAL_KM_REFRESH_MS = 60_000L
        /** Abastecimento registrado até 30 min depois de acontecer atualiza o tanque e o hodômetro do app. */
        internal const val RECENT_FUEL_UP_MS = 30 * 60_000L
    }
}

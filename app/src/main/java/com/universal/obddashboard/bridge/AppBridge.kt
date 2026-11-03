package com.universal.obddashboard.bridge

import android.Manifest
import android.content.Intent
import android.os.Build
import android.provider.Settings
import android.view.WindowManager
import android.webkit.JavascriptInterface
import androidx.lifecycle.lifecycleScope
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat
import androidx.core.view.WindowInsetsControllerCompat
import com.universal.obddashboard.AppSettings
import com.universal.obddashboard.BuildConfig
import com.universal.obddashboard.MainActivity
import com.universal.obddashboard.Vehicles
import com.universal.obddashboard.obd.BluetoothSerialManager
import com.universal.obddashboard.obd.DashboardOverride
import com.universal.obddashboard.obd.ProfileParser
import com.universal.obddashboard.obd.UserAlarm
import com.universal.obddashboard.telemetry.PerformanceTimers
import com.universal.obddashboard.orNull
import com.universal.obddashboard.service.ObdForegroundService
import kotlinx.coroutines.launch
import org.json.JSONArray
import org.json.JSONObject
import java.util.UUID

/**
 * Ponte JavaScript "AndroidBridge": captura, perfis, ajustes gerais, Bluetooth, permissões e modo do painel.
 * Registrada pela [MainActivity]; na tela, `bridge.x()` encontra o método no objeto certo.
 */
class AppBridge(private val activity: MainActivity) {

    @JavascriptInterface
    fun startCapture() = activity.runOnUiThread { activity.startCapture() }

    @JavascriptInterface
    fun stopCapture() = ObdForegroundService.stop(activity)

    @JavascriptInterface
    fun requestPermissions() = activity.runOnUiThread { activity.requestMissingPermissions() }

    @JavascriptInterface
    fun getPermissions(): String = activity.permissionsJson().toString()

    @JavascriptInterface
    fun getProfileMeta(): String = try {
        activity.profileMetaJson(activity.currentProfile()).toString()
    } catch (e: Exception) {
        JSONObject().put("error", e.message).toString()
    }

    @JavascriptInterface
    fun listProfiles(): String = JSONArray().apply {
        val selected = AppSettings.selectedProfileId(activity)
        ProfileParser.listAvailable(activity).forEach {
            put(
                JSONObject().put("id", it.id).put("vehicleName", it.vehicleName).put("ecuModel", it.ecuModel)
                    .put("source", it.source).put("selected", it.id == selected),
            )
        }
    }.toString()

    /** Ajustes → Veículo: cadastrados e o selecionado. */
    @JavascriptInterface
    fun getVehicles(): String {
        val selected = Vehicles.selectedId(activity)
        val names = ProfileParser.listAvailable(activity).associate { it.id to it.vehicleName }
        return JSONObject().put("selected", selected).put("capturing", ObdForegroundService.isRunning).put(
            "list",
            JSONArray().apply {
                Vehicles.all(activity).forEach { v ->
                    put(
                        JSONObject().put("id", v.id).put("name", v.name).put("plate", v.plate ?: "")
                            .put("profileId", v.profileId).put("profileName", names[v.profileId] ?: v.profileId),
                    )
                }
            },
        ).toString()
    }

    /** A captura grava no veículo em que começou: trocar no meio misturaria os dados. */
    @JavascriptInterface
    fun selectVehicle(id: String): String = when {
        ObdForegroundService.isRunning -> "Encerre a captura antes de trocar de veículo."
        Vehicles.get(activity, id) == null -> "Veículo não encontrado."
        else -> {
            Vehicles.select(activity, id)
            // Hodômetro e consumo real mudam com o veículo: não espera a releitura de cada minuto
            activity.lifecycleScope.launch { activity.refreshTotalKm() }
            "ok"
        }
    }

    @JavascriptInterface
    fun addVehicle(name: String, profileId: String, plate: String): String = try {
        when {
            ObdForegroundService.isRunning -> throw IllegalStateException("Encerre a captura antes de trocar de veículo.")
            name.isBlank() -> throw IllegalArgumentException("Informe o nome do veículo.")
            Vehicles.all(activity).size >= MAX_VEHICLES -> throw IllegalStateException("Limite de $MAX_VEHICLES veículos atingido.")
        }
        ProfileParser.load(activity, profileId) // valida o perfil
        val v = Vehicles.add(activity, name, profileId, plate)
        Vehicles.select(activity, v.id)
        activity.lifecycleScope.launch { activity.refreshTotalKm() }
        "ok"
    } catch (e: Exception) {
        e.message ?: "erro"
    }

    @JavascriptInterface
    fun renameVehicle(name: String, plate: String): String {
        if (name.isBlank()) return "Informe o nome do veículo."
        Vehicles.update(activity, Vehicles.selected(activity).copy(name = name, plate = plate))
        return "ok"
    }

    @JavascriptInterface
    fun selectProfile(id: String): String = try {
        ProfileParser.load(activity, id) // valida antes de selecionar
        Vehicles.update(activity, Vehicles.selected(activity).copy(profileId = id))
        "ok"
    } catch (e: Exception) {
        e.message ?: "erro"
    }

    @JavascriptInterface
    fun importProfile(json: String): String = try {
        val summary = ProfileParser.importProfile(activity, json)
        JSONObject().put("ok", true).put("id", summary.id).toString()
    } catch (e: Exception) {
        JSONObject().put("ok", false).put("error", e.message).toString()
    }

    @JavascriptInterface
    fun getSettings(): String {
        val ctx = activity
        val p = runCatching { activity.currentProfile() }.getOrNull()
        return JSONObject()
            .put("ethanolPct", AppSettings.ethanolPercent(ctx, p?.profile?.fuel?.defaultEthanolPct ?: 0.0))
            .put("fuelLevelL", AppSettings.fuelLevel(ctx).orNull())
            .put("adapterNames", AppSettings.adapterNames(ctx, p?.profile?.adapter?.deviceNames.orEmpty()).joinToString(", "))
            .put("adapterAuto", AppSettings.adapterNames(ctx, emptyList()).isEmpty())
            .put("profileAdapterNames", p?.profile?.adapter?.deviceNames.orEmpty().joinToString(", "))
            .put("extraTriggers", AppSettings.extraTriggerDevices(ctx).joinToString(", "))
            .put("idleTimeoutMin", AppSettings.idleTimeoutMin(ctx))
            .put("resumeWindowMin", AppSettings.resumeWindowMin(ctx))
            .put("odometerKm", activity.totalKm.takeIf { AppSettings.odometerRef(ctx) != null }.orNull())
            .toString()
    }

    /** Ajustes → Mostradores: valores em uso no perfil ativo. */
    @JavascriptInterface
    fun getDashboardSettings(): String {
        val p = activity.currentProfile()
        val d = AppSettings.dashboard(activity, p)
        return JSONObject()
            .put("rpmMax", d.rpmMax).put("rpmRedline", d.rpmRedline)
            .put("speedMax", d.speedMax).put("speedCorrectionPct", d.speedCorrectionPct)
            .put("customized", AppSettings.hasDashboardOverride(activity))
            .toString()
    }

    @JavascriptInterface
    fun setDashboardSettings(rpmMax: Double, rpmRedline: Double, speedMax: Double, speedCorrectionPct: Double): String {
        val override = DashboardOverride(rpmMax, rpmRedline, speedMax, speedCorrectionPct)
        override.problem()?.let { return it }
        AppSettings.setDashboardOverride(activity, override)
        return "ok"
    }

    @JavascriptInterface
    fun resetDashboardSettings(): String {
        AppSettings.clearDashboardOverride(activity)
        return "ok"
    }

    /** Ajustes → Alarmes: lista do perfil ativo, com nome e unidade do sinal. */
    @JavascriptInterface
    fun getUserAlarms(): String {
        val p = activity.currentProfile()
        return JSONArray().apply {
            AppSettings.userAlarms(activity).forEach { a ->
                val o = p.outputs[a.output]
                put(
                    JSONObject().put("id", a.id).put("name", o?.name ?: a.output).put("unit", o?.unit.orEmpty())
                        .put("above", a.above).put("value", a.value).put("critical", a.critical),
                )
            }
        }.toString()
    }

    @JavascriptInterface
    fun addUserAlarm(output: String, above: Boolean, value: Double, critical: Boolean): String {
        val p = activity.currentProfile()
        val list = AppSettings.userAlarms(activity)
        return when {
            output !in p.outputs -> "Sinal inválido."
            !value.isFinite() -> "Informe o valor do alarme."
            list.size >= UserAlarm.MAX_ALARMS -> "Limite de ${UserAlarm.MAX_ALARMS} alarmes atingido."
            else -> {
                AppSettings.setUserAlarms(activity, list + UserAlarm(UUID.randomUUID().toString().take(8), output, above, value, critical))
                "ok"
            }
        }
    }

    @JavascriptInterface
    fun deleteUserAlarm(id: String): String {
        val p = activity.currentProfile()
        AppSettings.setUserAlarms(activity, AppSettings.userAlarms(activity).filterNot { it.id == id })
        return "ok"
    }

    /** Ajustes → Desempenho: melhor e último tempo de cada faixa. */
    @JavascriptInterface
    fun getTimedRuns(): String {
        val runs = AppSettings.timedRuns(activity)
        return JSONArray().apply {
            PerformanceTimers.BANDS.forEach { (from, to) ->
                val band = "${from.toInt()}-${to.toInt()}"
                val r = runs[band]
                put(JSONObject().put("band", band).put("best", r?.best.orNull()).put("last", r?.last.orNull()))
            }
        }.toString()
    }

    @JavascriptInterface
    fun clearTimedRuns(): String {
        AppSettings.clearTimedRuns(activity)
        return "ok"
    }

    /** Ajustes → Sobre: versão instalada, para relatar problemas. */
    @JavascriptInterface
    fun getAppInfo(): String = JSONObject()
        .put("versionName", BuildConfig.VERSION_NAME).put("versionCode", BuildConfig.VERSION_CODE).put("buildType", BuildConfig.BUILD_TYPE)
        .toString()

    /** Vale a partir da próxima captura. 0 = nunca encerrar por inatividade. */
    @JavascriptInterface
    fun setIdleTimeoutMin(minutes: Int) = AppSettings.setIdleTimeoutMin(activity, minutes)

    @JavascriptInterface
    fun setResumeWindowMin(minutes: Int) = AppSettings.setResumeWindowMin(activity, minutes)

    /** Ajustes → Hodômetro do carro (ver activity.applyOdometer). */
    @JavascriptInterface
    fun setOdometerKm(km: Double): String {
        activity.applyOdometer(km)
        return "ok"
    }

    /**
     * Checklist "Pronto para viajar": cada item {id, label, ok, hint}. Cobre o que fez a captura
     * falhar ou degradar na viagem de teste (GPS em segundo plano, economia de bateria).
     */
    @JavascriptInterface
    fun getReadiness(): String {
        val ctx = activity
        val pm = activity.getSystemService(android.os.PowerManager::class.java)
        val p = runCatching { activity.currentProfile() }.getOrNull()
        val serial = BluetoothSerialManager(ctx)
        val adapterFound = serial.findBondedDevice(AppSettings.adapterNames(ctx, p?.profile?.adapter?.deviceNames.orEmpty())) != null
        fun item(id: String, label: String, ok: Boolean, hint: String) =
            JSONObject().put("id", id).put("label", label).put("ok", ok).put("hint", hint)
        return JSONArray()
            .put(item("bluetooth", "Permissão de Bluetooth", activity.hasBluetoothPermission(), "Necessária para falar com o adaptador OBD."))
            .put(item("adapter", "Adaptador OBD pareado e escolhido", adapterFound, "Pareie o adaptador no Android e escolha-o em Bluetooth, abaixo."))
            .put(item("notifications", "Notificações", activity.notificationsEnabled(), "Mostram que a captura está rodando e os alertas do motor."))
            .put(item("location", "Localização (GPS)", activity.granted(Manifest.permission.ACCESS_FINE_LOCATION), "Trajeto, distância e velocidade pelo GPS."))
            .put(item("bgLocation", "Localização \"o tempo todo\"", activity.hasBackgroundLocation(), "Mantém o GPS quando a captura começa sozinha."))
            .put(item("battery", "Sem restrição de bateria", pm.isIgnoringBatteryOptimizations(activity.packageName), "Evita que o sistema corte a captura com a tela desligada. Na Xiaomi: Economia de bateria → Sem restrições e Início automático."))
            .put(item("trigger", "Início automático pelo carro", AppSettings.extraTriggerDevices(ctx).isNotEmpty(), "Opcional: marque a multimídia do carro como gatilho em Bluetooth, abaixo."))
            .toString()
    }

    /** {"permission": bool, "devices": [{name, address}]} — dispositivos já pareados no celular. */
    @JavascriptInterface
    fun getBondedDevices(): String {
        val devices = BluetoothSerialManager(activity).bondedDevices()
        return JSONObject()
            .put("permission", devices != null)
            .put(
                "devices",
                JSONArray().apply {
                    devices.orEmpty().forEach { put(JSONObject().put("name", it.name ?: JSONObject.NULL).put("address", it.address)) }
                },
            )
            .toString()
    }

    @JavascriptInterface
    fun setAdapterNames(csv: String) = AppSettings.setAdapterNames(activity, csv)

    @JavascriptInterface
    fun setExtraTriggers(csv: String) = AppSettings.setExtraTriggerDevices(activity, csv)

    /** Pede "Permitir o tempo todo" (exige a localização comum já concedida). */
    @JavascriptInterface
    fun requestBackgroundLocation() = activity.runOnUiThread {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q || activity.hasBackgroundLocation()) return@runOnUiThread
        if (!activity.granted(Manifest.permission.ACCESS_FINE_LOCATION)) {
            activity.requestMissingPermissions()
        } else {
            activity.backgroundLocationLauncher.launch(Manifest.permission.ACCESS_BACKGROUND_LOCATION)
        }
    }

    /** Tela de informações do app (bateria/economia de energia, início automático em aparelhos Xiaomi). */
    @JavascriptInterface
    fun openAppSettings() = activity.runOnUiThread {
        activity.startActivity(
            Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, android.net.Uri.fromParts("package", activity.packageName, null))
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK),
        )
    }

    /**
     * Painel no suporte do carro: [fullscreen] esconde as barras do Android (paisagem com o Painel
     * aberto); [keepScreenOn] mantém a tela ligada (Painel aberto durante a captura).
     */
    @JavascriptInterface
    fun setDashMode(fullscreen: Boolean, keepScreenOn: Boolean) = activity.runOnUiThread {
        val controller = WindowCompat.getInsetsController(activity.window, activity.window.decorView)
        if (fullscreen) {
            controller.systemBarsBehavior = WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE
            controller.hide(WindowInsetsCompat.Type.systemBars())
        } else {
            controller.show(WindowInsetsCompat.Type.systemBars())
        }
        if (keepScreenOn) activity.window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        else activity.window.clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
    }

    /** Abre a tela do Android para liberar as notificações deste app. */
    @JavascriptInterface
    fun openNotificationSettings() = activity.runOnUiThread {
        activity.notifCheckedAt = 0
        activity.startActivity(
            Intent(Settings.ACTION_APP_NOTIFICATION_SETTINGS)
                .putExtra(Settings.EXTRA_APP_PACKAGE, activity.packageName)
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK),
        )
    }

    private companion object {
        const val MAX_VEHICLES = 10
    }
}

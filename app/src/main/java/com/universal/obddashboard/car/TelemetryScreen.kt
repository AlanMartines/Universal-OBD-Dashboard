package com.universal.obddashboard.car

import androidx.annotation.DrawableRes
import androidx.car.app.CarContext
import androidx.car.app.CarToast
import androidx.car.app.Screen
import androidx.car.app.model.Action
import androidx.car.app.model.ActionStrip
import androidx.car.app.model.CarColor
import androidx.car.app.model.CarIcon
import androidx.car.app.model.GridItem
import androidx.car.app.model.GridTemplate
import androidx.car.app.model.ItemList
import androidx.car.app.model.Template
import androidx.core.graphics.drawable.IconCompat
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.lifecycleScope
import androidx.lifecycle.repeatOnLifecycle
import com.universal.obddashboard.R
import com.universal.obddashboard.obd.AlertLevel
import com.universal.obddashboard.obd.DashboardSettings
import com.universal.obddashboard.obd.Roles
import com.universal.obddashboard.service.ObdForegroundService
import com.universal.obddashboard.telemetry.ConnectionStatus
import com.universal.obddashboard.telemetry.DashboardState
import com.universal.obddashboard.telemetry.PowerState
import com.universal.obddashboard.telemetry.TelemetryHub
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import java.util.Locale

/**
 * Painel do Android Auto: grade com RPM, velocidade, temperatura, consumo, tensão e alertas.
 *
 * Para que cada atualização conte como "refresh" (e não como novo passo da pilha de templates,
 * limitada pelo host), o título do template e os títulos dos itens são fixos; só o texto e a
 * cor dos ícones mudam. A taxa é limitada a 1 atualização por segundo.
 */
class TelemetryScreen(carContext: CarContext) : Screen(carContext) {

    private val locale = Locale.forLanguageTag("pt-BR")
    private var toastedAlertIds = emptySet<String>()

    init {
        lifecycleScope.launch {
            repeatOnLifecycle(Lifecycle.State.STARTED) {
                TelemetryHub.state.collect { state ->
                    toastNewCriticalAlerts(state)
                    invalidate()
                    delay(REFRESH_MS)
                }
            }
        }
    }

    override fun onGetTemplate(): Template {
        val s = TelemetryHub.state.value
        val profile = TelemetryHub.profile?.profile
        val roles = profile?.roles ?: Roles()
        val dash = profile?.dashboard ?: DashboardSettings()
        val thermal = profile?.thermal
        val now = System.currentTimeMillis()

        val rpm = s.value(roles.rpm, now)
        val speed = s.value(roles.speed, now)
        val gpsSpeed = s.gps?.takeIf { now - it.timestamp < 5000 }?.speedKmh
        val coolant = s.value(roles.coolantTemp, now)
        val volts = s.value(roles.batteryVolts, now)
        val d = s.derived

        // --- RPM + indicador de troca ---
        val gearHint = when {
            d.shiftUp && d.recommendedGear != null -> " • ${d.recommendedGear}ª ▲"
            d.estimatedGear != null -> " • ${d.estimatedGear}ª"
            else -> ""
        }
        val rpmItem = tile(
            "RPM",
            (rpm?.let { fmt(it, 0) } ?: "--") + gearHint,
            R.drawable.ic_rpm,
            when {
                rpm == null -> CarColor.DEFAULT
                rpm >= dash.rpmRedline -> CarColor.RED
                d.shiftUp -> CarColor.YELLOW
                else -> CarColor.GREEN
            },
        )

        // --- Velocidade (CAN + GPS) ---
        val speedText = buildString {
            append(speed?.let { "${fmt(it, 0)} km/h" } ?: "--")
            gpsSpeed?.let { append(" • GPS ${fmt(it, 0)}") }
        }
        val speedItem = tile("Velocidade", speedText, R.drawable.ic_speed, CarColor.DEFAULT)

        // --- Temperatura com faixas do Fire EVO ---
        val (tempColor, tempBand) = when {
            coolant == null -> CarColor.DEFAULT to ""
            thermal == null -> CarColor.DEFAULT to ""
            coolant > thermal.criticalC -> CarColor.RED to " • CRÍTICO"
            coolant >= thermal.fanStage2C -> CarColor.YELLOW to " • ventoinha 2ª"
            coolant >= thermal.fanStage1C -> CarColor.GREEN to " • ventoinha 1ª"
            coolant < thermal.thermostatOpenC - 15 -> CarColor.BLUE to " • frio"
            else -> CarColor.GREEN to ""
        }
        val tempItem = tile("Motor", (coolant?.let { "${fmt(it, 0)} °C" } ?: "--") + tempBand, R.drawable.ic_temp, tempColor)

        // --- Consumo ---
        val fuelText = when {
            d.instantKmPerL != null -> "${fmt(d.instantKmPerL, 1)} km/l"
            d.fuelLph != null -> "${fmt(d.fuelLph, 2)} L/h"
            else -> "--"
        } + (d.tripKmPerL?.let { " • méd ${fmt(it, 1)}" } ?: "")
        val fuelColor = d.fuelRemainingL?.let { left ->
            val reserve = profile?.fuel?.reserveMaxL ?: 0.0
            if (left <= reserve) CarColor.YELLOW else CarColor.DEFAULT
        } ?: CarColor.DEFAULT
        val fuelItem = tile("Consumo", fuelText, R.drawable.ic_fuel, fuelColor)

        // --- Tensão ---
        val voltColor = when {
            volts == null -> CarColor.DEFAULT
            volts > 15.0 || volts < 11.8 -> CarColor.RED
            volts < 12.5 && (rpm ?: 0.0) > 600 -> CarColor.YELLOW
            else -> CarColor.GREEN
        }
        val voltItem = tile("Bateria", volts?.let { "${fmt(it, 1)} V" } ?: "--", R.drawable.ic_battery, voltColor)

        // --- Alertas / DTC / status da conexão ---
        val (alertText, alertColor) = alertSummary(s)
        val alertItem = tile("Alertas", alertText, R.drawable.ic_alert, alertColor)

        val items = ItemList.Builder()
            .addItem(rpmItem)
            .addItem(speedItem)
            .addItem(tempItem)
            .addItem(fuelItem)
            .addItem(voltItem)
            .addItem(alertItem)
            .build()

        val running = ObdForegroundService.isRunning
        val toggle = Action.Builder()
            .setTitle(if (running) "Parar" else "Iniciar")
            .setOnClickListener {
                if (ObdForegroundService.isRunning) {
                    ObdForegroundService.stop(carContext)
                } else if (!ObdForegroundService.start(carContext, "android_auto_button")) {
                    CarToast.makeText(carContext, "Abra o app no celular para iniciar", CarToast.LENGTH_LONG).show()
                }
                invalidate()
            }
            .build()

        @Suppress("DEPRECATION") // setTitle/setHeaderAction mantêm compatibilidade com hosts Car API 1
        val template = GridTemplate.Builder()
            .setTitle(s.vehicleName.ifEmpty { carContext.getString(R.string.app_name) })
            .setHeaderAction(Action.APP_ICON)
            .setSingleList(items)
            .setActionStrip(ActionStrip.Builder().addAction(toggle).build())
            .build()
        return template
    }

    private fun alertSummary(s: DashboardState): Pair<String, CarColor> {
        if (s.connection != ConnectionStatus.STREAMING) {
            val text = when (s.connection) {
                ConnectionStatus.IDLE, ConnectionStatus.STOPPED -> s.statusMessage.ifEmpty { "Captura parada" }
                else -> s.statusMessage.ifEmpty { "Conectando…" }
            }
            return text to CarColor.DEFAULT
        }
        if (s.power == PowerState.IDLE_CONFIRMATION) return "Parado: encerrar captura?" to CarColor.YELLOW

        val top = s.alerts.firstOrNull { it.level != AlertLevel.INFO }
        val dtcs = s.confirmedDtcs
        return when {
            top != null -> {
                val extra = s.alerts.count { it.level != AlertLevel.INFO } - 1 + if (dtcs.isNotEmpty()) 1 else 0
                val suffix = if (extra > 0) " (+$extra)" else ""
                top.message + suffix to if (top.level == AlertLevel.CRITICAL) CarColor.RED else CarColor.YELLOW
            }
            dtcs.isNotEmpty() -> "DTC: ${dtcs.take(3).joinToString()}" to CarColor.RED
            s.pendingDtcs.isNotEmpty() -> "Pendente: ${s.pendingDtcs.take(3).joinToString()}" to CarColor.YELLOW
            else -> (s.alerts.firstOrNull()?.message ?: "Tudo OK") to CarColor.GREEN
        }
    }

    private fun toastNewCriticalAlerts(s: DashboardState) {
        val critical = s.alerts.filter { it.level == AlertLevel.CRITICAL && it.notify }
        val ids = critical.mapTo(HashSet()) { it.id }
        critical.firstOrNull { it.id !in toastedAlertIds }?.let {
            CarToast.makeText(carContext, it.message, CarToast.LENGTH_LONG).show()
        }
        toastedAlertIds = ids
    }

    private fun tile(label: String, value: String, @DrawableRes icon: Int, tint: CarColor): GridItem =
        GridItem.Builder()
            .setTitle(label)
            .setText(value)
            .setImage(
                CarIcon.Builder(IconCompat.createWithResource(carContext, icon)).setTint(tint).build(),
                GridItem.IMAGE_TYPE_ICON,
            )
            .build()

    private fun fmt(value: Double, decimals: Int) = String.format(locale, "%.${decimals}f", value)

    private companion object {
        const val REFRESH_MS = 1000L
    }
}

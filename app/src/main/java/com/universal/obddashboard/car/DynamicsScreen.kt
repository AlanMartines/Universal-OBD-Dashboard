package com.universal.obddashboard.car

import androidx.annotation.DrawableRes
import androidx.car.app.CarContext
import androidx.car.app.Screen
import androidx.car.app.model.Action
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
import com.universal.obddashboard.can.Slcan
import com.universal.obddashboard.telemetry.Compass
import com.universal.obddashboard.telemetry.TelemetryHub
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import java.util.Locale
import kotlin.math.abs

/**
 * Aba Dinâmica no Android Auto. A categoria do app (IOT) só aceita modelos prontos, sem desenho livre: o
 * horizonte e a bússola viram números. Os botões de calibrar ficam só no celular (pedem o carro parado e atenção).
 * Mesmo cuidado da [TelemetryScreen]: títulos fixos e 1 atualização por segundo, para contar como "refresh".
 */
class DynamicsScreen(carContext: CarContext) : Screen(carContext) {

    private val locale = Locale.forLanguageTag("pt-BR")

    init {
        lifecycleScope.launch {
            repeatOnLifecycle(Lifecycle.State.STARTED) {
                TelemetryHub.state.collect {
                    invalidate()
                    delay(REFRESH_MS)
                }
            }
        }
    }

    override fun onGetTemplate(): Template {
        val s = TelemetryHub.state.value
        val d = s.derived
        val roles = TelemetryHub.profile?.profile?.roles
        val now = System.currentTimeMillis()
        val speed = roles?.let { s.value(it.speed, now) }

        val drive = d.driveState?.let { listOf("P", "D", "R").getOrNull(it) }
        val gearItem = tile(
            "Câmbio",
            (drive ?: "--") + (speed?.let { " • ${fmt(it, 0)} km/h" } ?: ""),
            R.drawable.ic_gear,
            if (drive == "R") CarColor.YELLOW else CarColor.DEFAULT,
        )

        val roll = d.rollDeg
        val tiltText = buildString {
            append(d.pitchDeg?.let { (if (it >= 0.05) "+" else "") + fmt(it, 1) + "°" } ?: "--")
            roll?.let { append(" • lateral ${fmt(abs(it), 1)}°" + if (abs(it) < 0.5) "" else if (it > 0) " D" else " E") }
        }
        val tiltItem = tile("Inclinação", if (d.imuStage == null) "sem sensor" else tiltText, R.drawable.ic_tilt, CarColor.DEFAULT)

        val headingItem = tile(
            "Rumo",
            d.headingDeg?.let { "${Compass.cardinal(it)} ${fmt(it, 0)}° • " + if (d.headingSource == Compass.SOURCE_MAG) "bússola" else "GPS" } ?: "--",
            R.drawable.ic_compass,
            CarColor.DEFAULT,
        )

        val gText = if (d.lateralG == null || d.accelG == null) "--" else
            "lat ${fmt(abs(d.lateralG), 2)} • long ${(if (d.accelG >= 0.005) "+" else "") + fmt(d.accelG, 2)} g"
        val gItem = tile("Força G", gText, R.drawable.ic_gforce, if (d.accelG != null && d.accelG < -0.4) CarColor.YELLOW else CarColor.DEFAULT)

        val yaw = d.yawDps
        val turnText = when {
            yaw == null -> "--"
            abs(yaw) < 2 || (speed ?: 0.0) < 3 -> "Reta • ${fmt(abs(yaw), 1)}°/s"
            yaw > 0 -> "Esquerda • ${fmt(abs(yaw), 1)}°/s"
            else -> "Direita • ${fmt(abs(yaw), 1)}°/s"
        }
        val turnItem = tile("Curva", turnText, R.drawable.ic_turn, CarColor.DEFAULT)

        val hpa = s.value(Slcan.CABIN_PRESSURE, now)
        val altText = buildString {
            append(d.altitudeM?.let { (if (d.altitudeGps) "" else "≈ ") + fmt(it, 0) + " m" } ?: "--")
            when (d.altitudeTrend) { 1 -> append(" ↑"); -1 -> append(" ↓") }
            hpa?.let { append(" • ${fmt(it, 0)} hPa") }
        }
        val altItem = tile("Altitude", altText, R.drawable.ic_altitude, CarColor.DEFAULT)

        @Suppress("DEPRECATION") // setTitle/setHeaderAction mantêm compatibilidade com hosts Car API 1
        return GridTemplate.Builder()
            .setTitle("Dinâmica")
            .setHeaderAction(Action.BACK)
            .setSingleList(
                ItemList.Builder().addItem(gearItem).addItem(tiltItem).addItem(headingItem)
                    .addItem(gItem).addItem(turnItem).addItem(altItem).build(),
            )
            .build()
    }

    private fun tile(label: String, value: String, @DrawableRes icon: Int, tint: CarColor): GridItem =
        GridItem.Builder()
            .setTitle(label)
            .setText(value)
            .setImage(CarIcon.Builder(IconCompat.createWithResource(carContext, icon)).setTint(tint).build(), GridItem.IMAGE_TYPE_ICON)
            .build()

    private fun fmt(value: Double, decimals: Int) = String.format(locale, "%.${decimals}f", value)

    private companion object {
        const val REFRESH_MS = 1000L
    }
}

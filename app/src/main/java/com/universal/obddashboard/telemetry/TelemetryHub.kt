package com.universal.obddashboard.telemetry

import com.universal.obddashboard.obd.AlertLevel
import com.universal.obddashboard.obd.LoadedProfile
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import java.util.concurrent.atomic.AtomicReference

data class Reading(val value: Double, val timestamp: Long)

enum class ConnectionStatus { IDLE, CONNECTING, INITIALIZING, STREAMING, RECONNECTING, STOPPED, ERROR }

enum class PowerState { ACTIVE, STATIONARY, IDLE_CONFIRMATION, SHUTTING_DOWN }

data class ActiveAlert(
    val id: String,
    val level: AlertLevel,
    val message: String,
    val since: Long,
    val notify: Boolean,
)

data class GpsFix(
    val latitude: Double,
    val longitude: Double,
    val speedKmh: Double?,
    val accuracyM: Float,
    val bearing: Float?,
    val timestamp: Long,
)

data class DerivedMetrics(
    val fuelLph: Double? = null,
    val instantKmPerL: Double? = null,
    val tripKmPerL: Double? = null,
    val tripFuelUsedL: Double = 0.0,
    val fuelRemainingL: Double? = null,
    val recommendedGear: Int? = null,
    val estimatedGear: Int? = null,
    val shiftUp: Boolean = false,
    val estimatedLoadPct: Double? = null,
    val tripCost: Double? = null,
    /** Consumo instantâneo suavizado (L/h): o que interessa com o carro parado e o motor ligado. */
    val instantLph: Double? = null,
    /** Faixa do indicador de economia agora: 0 verde, 1 meio, 2 vermelho; null parado ou sem consumo. */
    val ecoBand: Int? = null,
    val movingS: Double = 0.0,
    val idleS: Double = 0.0,
    val idleFuelL: Double = 0.0,
    val fuelCutKm: Double = 0.0,
    val avgMovingKmh: Double? = null,
    /** % do tempo andando no verde, meio e vermelho. */
    val ecoPct: List<Double>? = null,
)

data class DashboardState(
    val profileId: String? = null,
    val vehicleName: String = "",
    val connection: ConnectionStatus = ConnectionStatus.IDLE,
    val statusMessage: String = "",
    val power: PowerState = PowerState.ACTIVE,
    val readings: Map<String, Reading> = emptyMap(),
    val derived: DerivedMetrics = DerivedMetrics(),
    val gps: GpsFix? = null,
    val alerts: List<ActiveAlert> = emptyList(),
    val confirmedDtcs: List<String> = emptyList(),
    val pendingDtcs: List<String> = emptyList(),
    val tripId: Long? = null,
    val tripStartedAt: Long? = null,
    val tripDistanceKm: Double = 0.0,
    val adapterVersion: String = "",
    val disabledPids: List<String> = emptyList(),
    /** Alarmes de Ajustes carregados pela captura em andamento (null = sem captura). */
    val userAlarmsLoaded: Int? = null,
    /** Estado da escuta CAN (ESP32) nesta captura; null se ela não está configurada. */
    val canStatus: String? = null,
    /** Conexão com o ESP32 nesta captura: connecting, connected ou lost; null antes de tentar ou sem escuta. */
    val canLink: String? = null,
) {
    /** Valor de uma saída, se lido há no máximo [maxAgeMs]. */
    fun value(id: String?, now: Long = System.currentTimeMillis(), maxAgeMs: Long = STALE_AFTER_MS): Double? {
        if (id == null) return null
        val r = readings[id] ?: return null
        return if (now - r.timestamp <= maxAgeMs) r.value else null
    }

    val isCapturing: Boolean
        get() = connection != ConnectionStatus.IDLE && connection != ConnectionStatus.STOPPED

    companion object {
        const val STALE_AFTER_MS = 10_000L
    }
}

/**
 * Barramento em memória entre o [com.universal.obddashboard.service.ObdForegroundService] (produtor)
 * e as telas: Android Auto, WebView e notificação. Tudo roda no mesmo processo.
 */
object TelemetryHub {

    private val _state = MutableStateFlow(DashboardState())
    val state: StateFlow<DashboardState> = _state.asStateFlow()

    @Volatile var profile: LoadedProfile? = null
        private set

    fun reset(profile: LoadedProfile) {
        this.profile = profile
        _state.value = DashboardState(
            profileId = profile.id,
            vehicleName = profile.profile.vehicleName,
            connection = ConnectionStatus.CONNECTING,
        )
    }

    fun mergeValues(values: Map<String, Double>, timestamp: Long) {
        _state.update { s ->
            val merged = HashMap(s.readings)
            for ((k, v) in values) merged[k] = Reading(v, timestamp)
            s.copy(readings = merged)
        }
    }

    fun update(transform: (DashboardState) -> DashboardState) = _state.update(transform)

    /** Ajustes de combustível feitos pelo usuário durante a captura (consumidos pelo serviço). */
    data class FuelOverride(val ethanolPercent: Double? = null, val fuelLevelL: Double? = null, val fuelCorrection: Double? = null)

    private val fuelOverride = AtomicReference<FuelOverride?>(null)

    fun requestFuelOverride(override: FuelOverride) {
        fuelOverride.getAndUpdate { prev ->
            FuelOverride(
                ethanolPercent = override.ethanolPercent ?: prev?.ethanolPercent,
                fuelLevelL = override.fuelLevelL ?: prev?.fuelLevelL,
                fuelCorrection = override.fuelCorrection ?: prev?.fuelCorrection,
            )
        }
    }

    fun takeFuelOverride(): FuelOverride? = fuelOverride.getAndSet(null)
}

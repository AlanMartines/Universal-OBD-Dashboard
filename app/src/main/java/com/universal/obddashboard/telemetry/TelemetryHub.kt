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
    /** Altitude acima do nível do mar (m) e a precisão vertical, quando o GPS informa. */
    val altitudeM: Double? = null,
    val verticalAccuracyM: Float? = null,
)

/**
 * Bússola do próprio celular (sensor de rotação do Android): rumo de um eixo do aparelho que está quase na
 * horizontal ([axis]: 0 = lado direito, 1 = topo, 2 = traseira) e se o sistema confia na leitura. O rumo do carro sai
 * disso somado à diferença aprendida com o GPS (o celular fica no suporte em qualquer ângulo).
 */
data class PhoneHeading(val azimuthDeg: Double, val axis: Int, val reliable: Boolean, val timestamp: Long)

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
    /** Vácuo do coletor (kPa): pressão atmosférica menos o MAP, com o motor ligado. */
    val vacuumKpa: Double? = null,
    /** Desvio do sensor MAP em relação ao sensor ambiente do ESP32 (kPa), medido com o motor parado. */
    val mapOffsetKpa: Double? = null,
    /** Sensor de movimento do ESP32 (LSM6DS3): null sem sensor; 0 aprendendo o "cima", 1 aprendendo a frente, 2 pronto. */
    val imuStage: Int? = null,
    /** Aceleração para a frente (g): negativa é frenagem. */
    val accelG: Double? = null,
    /** Aceleração lateral (g): positiva numa curva à esquerda. */
    val lateralG: Double? = null,
    /** Inclinação da rua (%): positiva é subida. */
    val slopePct: Double? = null,
    /** Maior desvio da gravidade na última leitura (g): buracos, lombadas e impactos. */
    val impactG: Double? = null,
    /** Impactos acima de 0,4 g na captura, andando. */
    val bumps: Int = 0,
    val maxBrakeG: Double? = null,
    val maxAccelG: Double? = null,
    val maxLateralG: Double? = null,
    /** Inclinação frontal (°, positiva subindo) e lateral (°, positiva com o lado direito mais baixo). */
    val pitchDeg: Double? = null,
    val rollDeg: Double? = null,
    /** Giro do carro (°/s): positivo virando à esquerda. */
    val yawDps: Double? = null,
    /** Maiores inclinações (em módulo) da captura, em graus. */
    val maxPitchDeg: Double? = null,
    val maxRollDeg: Double? = null,
    /** Sentido: 0 parado (P), 1 andando para a frente (D), 2 de ré (R); null sem velocidade. */
    val driveState: Int? = null,
    /** Ajuste à mão do sensor de movimento em andamento ou recém-terminado (ImuMotion.Action), ou null. */
    val imuAction: String? = null,
    /** Rumo (0° = norte) e a fonte: "gps" ou "mag" (magnetômetro do ESP32). */
    val headingDeg: Double? = null,
    val headingSource: String? = null,
    /** Quanto da volta a bússola já aprendeu (%); null sem magnetômetro. */
    val compassPct: Int? = null,
    val compassReady: Boolean = false,
    /** Desvio do giroscópio medido nesta partida (°/s, eixos do módulo); null antes de medir. */
    val gyroBiasX: Double? = null,
    val gyroBiasY: Double? = null,
    val gyroBiasZ: Double? = null,
    /** Ângulo do celular no suporte em relação à frente do carro (°), aprendido com o GPS. */
    val phoneMountDeg: Double? = null,
    /** Ajuste fino à mão em uso (°), null quando zero (Ajustes → Calibração dos sensores). */
    val trimPitchDeg: Double? = null,
    val trimRollDeg: Double? = null,
    val trimHeadingDeg: Double? = null,
    /** Altitude (m) pela pressão do ESP32, acertada pelo GPS; tendência +1 subindo, −1 descendo. */
    val altitudeM: Double? = null,
    val altitudeTrend: Int? = null,
    val altitudeGps: Boolean = false,
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
    val phoneHeading: PhoneHeading? = null,
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
    /** O que o ESP32 informou nesta captura (versão, sensores, quadros/s); null sem escuta. */
    val canInfo: com.universal.obddashboard.can.Esp32Info? = null,
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

    /**
     * Pedido da tela para os sensores do ESP32, consumido pelo serviço durante a captura:
     * - aba Dinâmica: [LEVEL] (Zerar nível), [FORWARD] (Calibrar frente);
     * - Ajustes → Calibração dos sensores: [FORGET_IMU] (esquecer nível e frente), [FORGET_COMPASS] (zerar a bússola do
     *   ESP32), [FORGET_PHONE] (reaprender o celular no suporte), [TRIMS] (ajuste fino mudou, reler).
     */
    enum class ImuRequest { LEVEL, FORWARD, FORGET_IMU, FORGET_COMPASS, FORGET_PHONE, TRIMS }

    private val imuRequests = java.util.concurrent.ConcurrentLinkedQueue<ImuRequest>()

    fun requestImu(r: ImuRequest) { imuRequests.add(r) }

    fun takeImuRequest(): ImuRequest? = imuRequests.poll()
}

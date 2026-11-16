package com.universal.obddashboard.telemetry

import kotlin.math.abs
import kotlin.math.sqrt

/**
 * Pré-diagnóstico preventivo ("vai no mecânico"), só com o que o app já lê: nada é pedido de novo ao carro.
 *
 * Durante a viagem, cada checagem junta medidas só no regime certo (motor quente, marcha lenta, rotação alta…) e, no
 * fim, vira uma [Observation] da viagem: um valor e se ficou fora do normal. O [HealthHistory] guarda as últimas
 * viagens de cada checagem e decide o estado: um sinal só vira "atenção" depois de se repetir em [REPEAT_MIN] das
 * [REPEAT_WINDOW] últimas viagens; algumas medidas (superaquecimento, queda forte na partida) valem na primeira vez.
 *
 * Checagens da primeira entrega:
 * - **Arrefecimento:** tempo de aquecimento até 80 °C depois de partida a frio; esfriar abaixo de 75 °C em estrada com o
 *   motor já quente (termostática aberta); passar da 2ª velocidade da ventoinha (superaquecimento).
 * - **Elétrica:** tensão acima de 1.500 rpm (alternador e regulador), tensão em repouso e queda na partida (divisor do ESP32).
 * - **Admissão:** MAP em marcha lenta quente sobre a pressão do ar (vácuo fraco = ar falso, mangueira) e o desvio do MAP
 *   com o motor parado.
 * - **Marcha lenta:** quanto a rotação oscila em marcha lenta quente.
 * A Central (luz de injeção, códigos, monitores) não passa por aqui: vem direto do estado (ver [HealthHistory.central]).
 */
class HealthMonitor(private val thermal: Thermal = Thermal()) {

    /** Limites térmicos do perfil (°C). */
    data class Thermal(val fan2C: Double = 103.0, val criticalC: Double = 105.0)

    /** Leituras de um passo; null quando a leitura não existe ou está velha. */
    data class Input(
        val now: Long,
        val dtS: Double,
        val rpm: Double?,
        val speedKmh: Double?,
        val coolantC: Double?,
        val mapKpa: Double?,
        val throttlePct: Double?,
        /** Pressão do ar (kPa): BMP180, barômetro do celular ou a aprendida pelo MAP com o motor parado. */
        val baroKpa: Double?,
        /** Tensão da rede do carro ou do ELM327 (V). */
        val volts: Double?,
        /** Cargas elétricas e o A/C pela rede CAN; null se o perfil não tem o sinal. */
        val acOn: Boolean?,
        val loadsOn: Boolean,
        val mapOffsetKpa: Double?,
        val battRestV: Double?,
        val battCrankV: Double?,
        /** Bateria lida agora pelo divisor do ESP32 (V), para conferir com [volts]. */
        val espBattV: Double? = null,
    )

    data class Observation(val value: Double, val flagged: Boolean, val severe: Boolean = false)

    private var tripStartAt: Long? = null
    private var engineSince: Long? = null
    // Arrefecimento
    private var coldStart: Boolean? = null
    private var warmRunS = 0.0
    private var warmupMin: Double? = null
    private var wasHot = false
    private var roadS = 0.0
    private var cooledOnRoad = false
    private var hotS = 0.0
    private var maxCoolant: Double? = null
    // Elétrica
    private val chargeVolts = ArrayList<Double>()
    private var chargeLoads = false
    // Admissão e marcha lenta
    private var idleS = 0.0
    private val idleMapRatio = ArrayList<Double>()
    private val idleRpm = ArrayList<Double>()
    private val idleWindowSd = ArrayList<Double>()
    private var lastIdleRpmAt = 0L
    private var mapOffset: Double? = null
    private var restV: Double? = null
    private var crankV: Double? = null
    // ESP32 − rede do carro, uma por segundo
    private val espDiff = mutableListOf<Double>()
    private var lastEspDiffAt = 0L

    fun update(i: Input) {
        if (tripStartAt == null) tripStartAt = i.now
        val running = (i.rpm ?: 0.0) >= RUNNING_RPM
        if (running && engineSince == null) engineSince = i.now
        if (!running && i.rpm != null) engineSince = null
        val runS = engineSince?.let { (i.now - it) / 1000.0 } ?: 0.0
        val moving = (i.speedKmh ?: 0.0) >= 3

        // ---- Arrefecimento
        val c = i.coolantC
        if (c != null) {
            maxCoolant = maxOf(maxCoolant ?: c, c)
            if (coldStart == null && running) coldStart = c <= COLD_START_C
            if (coldStart == true && warmupMin == null && running) {
                warmRunS += i.dtS
                if (c >= WARM_C) warmupMin = warmRunS / 60
            }
            if (c >= HOT_C) wasHot = true
            if (wasHot && (i.speedKmh ?: 0.0) >= ROAD_KMH) {
                roadS += i.dtS
                if (roadS >= ROAD_S && c < COOLED_C) cooledOnRoad = true
            } else {
                roadS = 0.0
            }
            if (c >= thermal.fan2C) hotS += i.dtS
        }

        // ---- Elétrica: só acima de 1.500 rpm, depois de 1 min de motor (a bateria repõe a partida)
        val v = i.volts
        if (v != null && v in 6.0..18.0 && (i.rpm ?: 0.0) >= CHARGE_RPM && runS >= 60) {
            chargeVolts += v
            if (i.loadsOn || i.acOn == true) chargeLoads = true
        }
        i.battRestV?.let { restV = it }
        i.battCrankV?.let { crankV = it }
        val esp = i.espBattV
        if (esp != null && v != null && v in ESP_CHECK_MIN_V..ESP_CHECK_MAX_V && i.now - lastEspDiffAt >= 1000) {
            espDiff += esp - v
            lastEspDiffAt = i.now
        }

        // ---- Admissão e marcha lenta: quente, parado, em marcha lenta, sem acelerar, sem A/C, 2 min depois da partida
        val idle = c != null && c >= WARM_C && !moving && i.rpm != null && i.rpm in IDLE_RPM_MIN..IDLE_RPM_MAX &&
            (i.throttlePct ?: 0.0) < IDLE_TPS_MAX && i.acOn != true && runS >= 120
        if (idle) {
            idleS += i.dtS
            val map = i.mapKpa
            val baro = i.baroKpa
            if (idleS >= IDLE_SETTLE_S && map != null && baro != null && baro in 60.0..110.0) idleMapRatio += map / baro
            if (idleS >= IDLE_SETTLE_S && i.now - lastIdleRpmAt >= 200) { idleRpm += i.rpm!!; lastIdleRpmAt = i.now }
        } else {
            closeIdleWindow()
            idleS = 0.0
        }
        i.mapOffsetKpa?.let { mapOffset = it }
    }

    /**
     * Fim de uma parada em marcha lenta: guarda quanto a rotação oscilou dentro dela. Juntar paradas diferentes inflaria o
     * número (a marcha lenta de uma parada para outra muda um pouco); nas gravações de 15 e 16/11, dentro de cada parada
     * assentada, ficou entre 2 e 10 rpm.
     */
    private fun closeIdleWindow() {
        if (idleRpm.size >= IDLE_WINDOW_MIN) idleWindowSd += stdev(idleRpm)
        idleRpm.clear()
    }

    /** Observações desta viagem até agora (só as checagens que tiveram o regime certo). */
    fun observations(): Map<String, Observation> = buildMap {
        // Aquecimento: só conta se partiu a frio e chegou a 80 °C, ou rodou bastante sem chegar
        val w = warmupMin
        if (w != null) put(WARMUP, Observation(w, w > WARMUP_MAX_MIN))
        else if (coldStart == true && warmRunS / 60 > WARMUP_MAX_MIN) put(WARMUP, Observation(warmRunS / 60, true))
        if (wasHot) put(ROAD_COOL, Observation(if (cooledOnRoad) 1.0 else 0.0, cooledOnRoad))
        maxCoolant?.let { m -> if (m >= WARM_C) put(OVERHEAT, Observation(m, hotS >= HOT_HOLD_S, severe = m > thermal.criticalC)) }
        if (chargeVolts.size >= MIN_SAMPLES) {
            val med = median(chargeVolts)
            val low = if (chargeLoads) CHARGE_LOW_LOADED_V else CHARGE_LOW_V
            put(CHARGING, Observation(med, med < low || med > CHARGE_HIGH_V, severe = med > CHARGE_SEVERE_V))
        }
        // Repouso e partida só valem com o ESP32 conferido com a rede do carro nesta viagem
        val espOk = if (espDiff.size >= MIN_SAMPLES) {
            val d = median(espDiff)
            put(ESP_BATT, Observation(d, abs(d) > ESP_BATT_DIFF_MAX_V))
            abs(d) <= ESP_BATT_DIFF_MAX_V
        } else false
        if (espOk) {
            restV?.let { put(REST_V, Observation(it, it < REST_LOW_V)) }
            crankV?.let { put(CRANK_V, Observation(it, it < CRANK_LOW_V, severe = it < CRANK_SEVERE_V)) }
        }
        if (idleMapRatio.size >= MIN_SAMPLES) {
            val r = median(idleMapRatio)
            // O limite fixo só pega o caso grosseiro; o resto é comparado com o normal do carro (HealthHistory)
            put(IDLE_VACUUM, Observation(r, r > IDLE_MAP_RATIO_MAX))
        }
        mapOffset?.let { put(MAP_OFFSET, Observation(it, abs(it) > MAP_OFFSET_MAX_KPA)) }
        val sds = idleWindowSd + if (idleRpm.size >= IDLE_WINDOW_MIN) listOf(stdev(idleRpm)) else emptyList()
        if (sds.isNotEmpty()) {
            val sd = median(sds)
            put(IDLE_RPM, Observation(sd, sd > IDLE_RPM_SD_MAX))
        }
    }

    companion object {
        // Ids das checagens (também as chaves guardadas e enviadas ao painel como health.<id>)
        const val WARMUP = "warmup"
        const val ROAD_COOL = "road_cool"
        const val OVERHEAT = "overheat"
        const val CHARGING = "charging"
        const val REST_V = "rest_v"
        const val CRANK_V = "crank_v"
        const val IDLE_VACUUM = "idle_vacuum"
        const val MAP_OFFSET = "map_offset"
        const val IDLE_RPM = "idle_rpm"
        /** Diferença da bateria ESP32 − rede do carro (V): não é do carro, é da instalação; fica fora dos subsistemas. */
        const val ESP_BATT = "esp_batt"

        const val RUNNING_RPM = 400.0
        const val COLD_START_C = 40.0
        const val WARM_C = 80.0
        const val HOT_C = 85.0
        const val COOLED_C = 75.0
        const val ROAD_KMH = 60.0
        const val ROAD_S = 180.0
        /** Até 80 °C em mais de 20 min de motor: termostática pode estar aberta (ou o dia muito frio). */
        const val WARMUP_MAX_MIN = 20.0
        const val HOT_HOLD_S = 30.0
        const val CHARGE_RPM = 1500.0
        const val CHARGE_LOW_V = 13.2
        const val CHARGE_LOW_LOADED_V = 13.0
        const val CHARGE_HIGH_V = 14.9
        const val CHARGE_SEVERE_V = 15.5
        /** O repouso é lido quando o ESP32 acorda (porta aberta, luz interna acesa): 12,08 a 12,49 V em 15 e 16/11. */
        const val REST_LOW_V = 12.0
        const val CRANK_LOW_V = 9.6
        const val CRANK_SEVERE_V = 9.0
        /**
         * Acima disso de diferença (mediana da viagem) o divisor do ESP32 não bate com a rede do carro e o repouso e a
         * partida da viagem são descartados. Em 16/11, com mau contato na alimentação da placa, ficou 1,6 a 1,9 V abaixo
         * com o motor ligado e marcou 7,57 V numa partida em que a rede mostrava 12,2 V.
         */
        const val ESP_BATT_DIFF_MAX_V = 0.5
        const val ESP_CHECK_MIN_V = 11.0
        const val ESP_CHECK_MAX_V = 15.5
        const val IDLE_RPM_MIN = 550.0
        const val IDLE_RPM_MAX = 1150.0
        /** Borboleta eletrônica: em marcha lenta o Uno fica em 4 a 5 % (gravações de 15 e 16/11). */
        const val IDLE_TPS_MAX = 8.0
        const val IDLE_SETTLE_S = 10.0
        /**
         * MAP em marcha lenta quente acima de 55% da pressão do ar: vácuo fraco em qualquer carro. O normal varia de motor
         * para motor (o Uno, sem A/C, fica em 42 a 44%), então o resto é comparado com o próprio carro: ver
         * [HealthHistory.BASELINE_RISE].
         */
        const val IDLE_MAP_RATIO_MAX = 0.55
        const val MAP_OFFSET_MAX_KPA = 3.0
        /** Rotação oscilando mais que isso (desvio-padrão dentro de cada parada, mediana entre as paradas, rpm). */
        const val IDLE_RPM_SD_MAX = 30.0
        /** Leituras (a cada 200 ms) para uma parada contar: 2 s depois de assentar. */
        const val IDLE_WINDOW_MIN = 10
        const val MIN_SAMPLES = 10

        fun median(v: List<Double>): Double { val s = v.sorted(); return if (s.size % 2 == 1) s[s.size / 2] else (s[s.size / 2 - 1] + s[s.size / 2]) / 2 }
        fun stdev(v: List<Double>): Double { val m = v.average(); return sqrt(v.sumOf { (it - m) * (it - m) } / v.size) }
    }
}

/**
 * Histórico de saúde de um veículo: as últimas viagens de cada checagem e o último estado da central. Decide o estado de
 * cada subsistema. Guardado em texto JSON nas preferências (vai no backup).
 */
class HealthHistory(
    private val trips: MutableMap<String, MutableList<Entry>> = mutableMapOf(),
    var central: Central? = null,
    /** Normal do próprio carro, aprendido nas primeiras viagens (por checagem). */
    private val baselines: MutableMap<String, Double> = mutableMapOf(),
) {
    @kotlinx.serialization.Serializable
    data class Entry(val tripId: Long, val at: Long, val value: Double, val flagged: Boolean, val severe: Boolean)

    @kotlinx.serialization.Serializable
    private data class Saved(val trips: Map<String, List<Entry>> = emptyMap(), val central: Central? = null, val baselines: Map<String, Double> = emptyMap())

    /** Luz de injeção, códigos e monitores da própria central, como estavam na última leitura. */
    @kotlinx.serialization.Serializable
    data class Central(val at: Long, val milOn: Boolean, val confirmed: List<String>, val pending: List<String>, val incomplete: List<String>?)

    enum class Level { NO_DATA, LEARNING, OK, WATCH, ALERT }

    data class CheckState(val id: String, val level: Level, val last: Entry?, val flaggedRecent: Int, val recent: Int)
    data class Subsystem(val id: String, val level: Level, val checks: List<CheckState>)

    /** Junta as observações de uma viagem (substitui as da mesma viagem, que é atualizada durante a captura). */
    fun record(tripId: Long, at: Long, obs: Map<String, HealthMonitor.Observation>) {
        for ((id, o) in obs) {
            val list = trips.getOrPut(id) { mutableListOf() }
            list.removeAll { it.tripId == tripId }
            list += Entry(tripId, at, o.value, o.flagged, o.severe)
            list.sortBy { it.at }
            while (list.size > KEEP) list.removeAt(0)
            // Normal do carro: mediana das primeiras viagens (fica guardado; "Recomeçar" apaga)
            if (id in BASELINE_CHECKS && id !in baselines && list.size >= BASELINE_TRIPS) {
                baselines[id] = HealthMonitor.median(list.take(BASELINE_TRIPS).map { it.value })
            }
        }
    }

    fun baseline(id: String): Double? = baselines[id]

    fun check(id: String): CheckState {
        val list = trips[id].orEmpty()
        if (list.isEmpty()) return CheckState(id, Level.NO_DATA, null, 0, 0)
        val base = baselines[id]
        // Com linha de base, fora do normal é o limite fixo ou subir mais que BASELINE_RISE acima do normal do carro
        val eff = if (id in BASELINE_CHECKS) list.map { e -> e.copy(flagged = e.flagged || (base != null && e.value > base + BASELINE_RISE)) } else list
        val recent = eff.takeLast(REPEAT_WINDOW)
        val flagged = recent.count { it.flagged }
        val last = eff.last()
        val level = when {
            recent.any { it.severe } -> Level.ALERT
            flagged >= REPEAT_MIN -> Level.WATCH
            id in BASELINE_CHECKS && base == null -> Level.LEARNING
            else -> Level.OK
        }
        return CheckState(id, level, last, flagged, recent.size)
    }

    fun subsystems(): List<Subsystem> {
        val c = central
        val centralLevel = when {
            c == null -> Level.NO_DATA
            c.milOn || c.confirmed.isNotEmpty() -> Level.ALERT
            c.pending.isNotEmpty() -> Level.WATCH
            else -> Level.OK
        }
        return listOf(Subsystem(CENTRAL, centralLevel, emptyList())) + GROUPS.map { (sid, ids) ->
            val checks = ids.map { check(it) }
            Subsystem(sid, checks.map { it.level }.maxByOrNull { it.ordinal } ?: Level.NO_DATA, checks)
        }
    }

    fun encode(): String = JSON.encodeToString(Saved.serializer(), Saved(trips, central, baselines))

    companion object {
        const val KEEP = 10
        const val REPEAT_WINDOW = 5
        const val REPEAT_MIN = 3
        /** Checagens comparadas com o normal do próprio carro, aprendido nas [BASELINE_TRIPS] primeiras viagens. */
        val BASELINE_CHECKS = setOf(HealthMonitor.IDLE_VACUUM)
        const val BASELINE_TRIPS = 5
        /** Subida do MAP em marcha lenta (fração da pressão do ar) acima do normal do carro: ≈ 7 kPa. */
        const val BASELINE_RISE = 0.07

        const val CENTRAL = "central"
        const val COOLING = "cooling"
        const val ELECTRIC = "electric"
        const val INTAKE = "intake"
        const val IDLE = "idle"
        val GROUPS = listOf(
            COOLING to listOf(HealthMonitor.WARMUP, HealthMonitor.ROAD_COOL, HealthMonitor.OVERHEAT),
            ELECTRIC to listOf(HealthMonitor.CHARGING, HealthMonitor.REST_V, HealthMonitor.CRANK_V),
            INTAKE to listOf(HealthMonitor.IDLE_VACUUM, HealthMonitor.MAP_OFFSET),
            IDLE to listOf(HealthMonitor.IDLE_RPM),
        )

        private val JSON = kotlinx.serialization.json.Json { ignoreUnknownKeys = true }

        fun decode(text: String?): HealthHistory = runCatching {
            val saved = JSON.decodeFromString(Saved.serializer(), text!!)
            HealthHistory(saved.trips.mapValues { it.value.toMutableList() }.toMutableMap(), saved.central, saved.baselines.toMutableMap())
        }.getOrElse { HealthHistory() }
    }
}

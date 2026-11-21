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
 *
 * Checagens da fase 2:
 * - **Mistura:** correção de curto prazo (STFT) em marcha lenta e em rodagem, com o motor quente, fora do corte de
 *   combustível e dos primeiros minutos depois de abastecer. Alta só na marcha lenta aponta ar falso; nas duas faixas,
 *   combustível ou injeção.
 * - **Escape:** sonda depois do catalisador baixa por muito tempo fora do corte de combustível (vazamento antes dela).
 * - **Sensores de temperatura:** ar admitido × água logo depois de uma partida a frio (parada longa): devem estar perto.
 * - **Embreagem:** rotação subindo sem a velocidade acompanhar, numa marcha engatada e com carga (patinando).
 * A Central (luz de injeção, códigos, monitores) não passa por aqui: vem direto do estado (ver [HealthHistory.central]).
 */
class HealthMonitor(
    private val thermal: Thermal = Thermal(),
    /** km/h a cada 1.000 rpm em cada marcha (perfil); sem elas a checagem da embreagem fica de fora. */
    private val gears: List<Double> = emptyList(),
) {

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
        /** Correção de mistura de curto prazo (%). */
        val stftPct: Double? = null,
        /** Sonda depois do catalisador (V). */
        val lambdaPostV: Double? = null,
        /** Temperatura do ar admitido (°C). */
        val intakeC: Double? = null,
        /** Último abastecimento registrado (ms), para não julgar a mistura logo depois dele. */
        val refuelAt: Long? = null,
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
    // Fase 2: mistura, escape, sensores de temperatura e embreagem
    private val stftIdle = ArrayList<Double>()
    private val stftCruise = ArrayList<Double>()
    private var lastStftAt = 0L
    private var lastFuelCutAt: Long? = null
    private val postV = ArrayList<Double>()
    private var lastPostAt = 0L
    private var tempGap: Double? = null
    private var lockedGear: Int? = null
    private var lockedAt = 0L
    private val slip = ArrayList<Double>()
    private var lastSlipAt = 0L

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

        // ---- Fase 2
        val rpmNow = i.rpm ?: 0.0
        val tps = i.throttlePct
        // Corte de combustível na desaceleração: pé fora do acelerador em rotação alta (ou vácuo muito alto)
        val fuelCut = running && rpmNow >= FUEL_CUT_RPM && ((tps != null && tps <= FUEL_CUT_TPS) || (i.mapKpa ?: 100.0) < FUEL_CUT_MAP_KPA)
        if (fuelCut) lastFuelCutAt = i.now
        val sinceCutS = lastFuelCutAt?.let { (i.now - it) / 1000.0 } ?: Double.MAX_VALUE
        val tripMin = (i.now - (tripStartAt ?: i.now)) / 60000.0
        val refuelRecent = i.refuelAt != null && (tripStartAt ?: i.now) - i.refuelAt in 0..REFUEL_RECENT_MS
        val warmLoop = c != null && c >= WARM_C && runS >= 120 && !fuelCut && sinceCutS >= AFTER_CUT_S &&
            (tps ?: 0.0) < OPEN_LOOP_TPS
        // Mistura: marcha lenta (mesmo regime da admissão) e rodagem leve, fora dos minutos depois de abastecer
        val stft = i.stftPct
        if (stft != null && warmLoop && !(refuelRecent && tripMin < REFUEL_SETTLE_MIN) && i.now - lastStftAt >= 500) {
            val cruise = (i.speedKmh ?: 0.0) >= CRUISE_KMH && rpmNow in CRUISE_RPM_MIN..CRUISE_RPM_MAX &&
                (tps ?: 0.0) in CRUISE_TPS_MIN..CRUISE_TPS_MAX
            when {
                idle && idleS >= IDLE_SETTLE_S -> { stftIdle += stft; lastStftAt = i.now }
                cruise -> { stftCruise += stft; lastStftAt = i.now }
            }
        }
        // Escape: catalisador aquecido (5 min de motor), fora do corte e dos segundos seguintes
        val post = i.lambdaPostV
        if (post != null && warmLoop && runS >= CAT_WARM_S && sinceCutS >= POST_AFTER_CUT_S && i.now - lastPostAt >= 500) {
            postV += post
            lastPostAt = i.now
        }
        // Sensores de temperatura: logo depois de uma partida a frio, ar admitido e água devem estar perto
        if (tempGap == null && running && runS <= TEMP_CHECK_S && c != null && c <= COLD_START_C && i.intakeC != null) {
            tempGap = i.intakeC - c
        }
        // Embreagem: com a marcha reconhecida em carga leve, a relação velocidade/rotação não pode cair sob carga
        val speed = i.speedKmh ?: 0.0
        if (gears.isNotEmpty() && i.rpm != null && rpmNow >= 1200 && speed >= 15) {
            val ratio = speed / (rpmNow / 1000)
            val baro = i.baroKpa
            val map = i.mapKpa
            val loaded = (tps ?: 0.0) >= SLIP_TPS && rpmNow >= SLIP_RPM && speed >= 20 &&
                map != null && (if (baro != null && baro in 60.0..110.0) map / baro >= SLIP_LOAD_RATIO else map >= SLIP_LOAD_KPA)
            val g = lockedGear
            if (!loaded && (tps ?: 0.0) < SLIP_LIGHT_TPS) {
                val best = gears.indices.minByOrNull { abs(ratio / gears[it] - 1) }!!
                if (abs(ratio / gears[best] - 1) <= GEAR_LOCK_TOL) { lockedGear = best; lockedAt = i.now }
            } else if (loaded && g != null && i.now - lockedAt <= GEAR_LOCK_MS) {
                val dev = ratio / gears[g] - 1
                if (dev in -SLIP_MAX_DEV..GEAR_LOCK_TOL) {
                    lockedAt = i.now   // segue engatada na mesma marcha
                    if (i.now - lastSlipAt >= 200) { slip += maxOf(0.0, -dev) * 100; lastSlipAt = i.now }
                } else {
                    lockedGear = null   // embreagem pisada ou troca de marcha
                }
            }
        }
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
        // Mistura: a viagem só sai marcada num desvio grosseiro; o estado vem da mediana das últimas viagens (HealthHistory)
        if (stftIdle.size >= MIN_SAMPLES) median(stftIdle).let { put(STFT_IDLE, Observation(it, abs(it) > STFT_TRIP_MAX_PCT)) }
        if (stftCruise.size >= MIN_SAMPLES) median(stftCruise).let { put(STFT_CRUISE, Observation(it, abs(it) > STFT_TRIP_MAX_PCT)) }
        if (postV.size >= POST_MIN_SAMPLES) median(postV).let { put(O2_POST, Observation(it, it < POST_LOW_V)) }
        tempGap?.let { put(TEMP_PLAUS, Observation(it, abs(it) > TEMP_GAP_MAX_C)) }
        if (slip.size >= SLIP_MIN_SAMPLES) median(slip).let { put(CLUTCH_SLIP, Observation(it, it > SLIP_MAX_PCT)) }
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
        // Fase 2
        const val STFT_IDLE = "stft_idle"
        const val STFT_CRUISE = "stft_cruise"
        const val O2_POST = "o2_post"
        const val TEMP_PLAUS = "temp_plaus"
        const val CLUTCH_SLIP = "clutch_slip"

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
         * [HealthHistory.BASELINE_RULES].
         */
        const val IDLE_MAP_RATIO_MAX = 0.55
        const val MAP_OFFSET_MAX_KPA = 3.0
        /** Rotação oscilando mais que isso (desvio-padrão dentro de cada parada, mediana entre as paradas, rpm). */
        const val IDLE_RPM_SD_MAX = 30.0
        /** Leituras (a cada 200 ms) para uma parada contar: 2 s depois de assentar. */
        const val IDLE_WINDOW_MIN = 10
        const val MIN_SAMPLES = 10

        // ---- Fase 2
        /** Corte de combustível: acima disso de rotação, com a borboleta fechada ou vácuo muito alto (perfil do Uno). */
        const val FUEL_CUT_RPM = 1500.0
        const val FUEL_CUT_TPS = 2.0
        const val FUEL_CUT_MAP_KPA = 30.0
        /** Segundos depois de um corte em que a mistura e a sonda ainda estão se acertando. */
        const val AFTER_CUT_S = 10.0
        /** Acima disso de borboleta a central sai do circuito fechado (enriquece de propósito). */
        const val OPEN_LOOP_TPS = 60.0
        /** Abastecimento até 3 h antes da viagem: os primeiros minutos não contam para a mistura. */
        const val REFUEL_RECENT_MS = 3 * 3600_000L
        const val REFUEL_SETTLE_MIN = 10.0
        const val CRUISE_KMH = 30.0
        const val CRUISE_RPM_MIN = 1500.0
        const val CRUISE_RPM_MAX = 3500.0
        const val CRUISE_TPS_MIN = 3.0
        const val CRUISE_TPS_MAX = 40.0
        /**
         * Mistura sem a correção de longo prazo legível (o Uno não tem): a de curto prazo varia muito de uma viagem para
         * outra (−15 a +22 % em marcha lenta nas viagens de 01 a 21/11). Uma viagem só sai marcada acima disso; o estado
         * vem da mediana das últimas viagens ([HealthHistory.ROLLING_RULES]).
         */
        const val STFT_TRIP_MAX_PCT = 20.0
        /** Catalisador aquecido: 5 min de motor. */
        const val CAT_WARM_S = 300.0
        /**
         * Catalisador bom deixa a sonda pós em 0,72–0,77 V no Uno; mediana abaixo disso é ar entrando antes dela. Depois de
         * um corte de combustível o catalisador fica cheio de oxigênio e a sonda pós fica baixa por dezenas de segundos:
         * nas viagens de 01 a 21/11, contar logo depois do corte marcava 9 de 70 viagens; com 60 s, nenhuma.
         */
        const val POST_LOW_V = 0.40
        const val POST_AFTER_CUT_S = 60.0
        const val POST_MIN_SAMPLES = 30
        /** Primeiro minuto depois da partida a frio: ar admitido e água ainda na temperatura do ambiente. */
        const val TEMP_CHECK_S = 60.0
        const val TEMP_GAP_MAX_C = 10.0
        /** Carga para a embreagem: borboleta, rotação e MAP perto da pressão do ar. */
        const val SLIP_TPS = 40.0
        const val SLIP_RPM = 1800.0
        const val SLIP_LOAD_RATIO = 0.75
        const val SLIP_LOAD_KPA = 72.0
        /** Carga leve, em que a marcha engatada é reconhecida pela relação velocidade/rotação. */
        const val SLIP_LIGHT_TPS = 30.0
        const val GEAR_LOCK_TOL = 0.03
        const val GEAR_LOCK_MS = 4000L
        /** Queda maior que isso na relação é embreagem pisada ou troca de marcha, não patinação. */
        const val SLIP_MAX_DEV = 0.20
        /** Patinação (mediana sob carga, %) acima disso; o resto é comparado com o normal do carro. */
        const val SLIP_MAX_PCT = 8.0
        /** 5 s de carga (a cada 200 ms) para a viagem contar. */
        const val SLIP_MIN_SAMPLES = 25

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
        // Com linha de base, fora do normal é o limite fixo ou se afastar demais do normal do próprio carro
        val rule = BASELINE_RULES[id]
        val eff = if (rule != null && base != null) list.map { e -> e.copy(flagged = e.flagged || rule.away(e.value, base)) } else list
        val recent = eff.takeLast(REPEAT_WINDOW)
        val flagged = recent.count { it.flagged }
        val last = eff.last()
        // Medidas que variam muito de viagem para viagem: vale a mediana das últimas, não cada viagem
        ROLLING_RULES[id]?.let { limit ->
            val level = if (recent.size >= REPEAT_MIN && abs(HealthMonitor.median(recent.map { it.value })) > limit) Level.WATCH else Level.OK
            return CheckState(id, level, last, recent.count { abs(it.value) > limit }, recent.size)
        }
        val level = when {
            recent.any { it.severe } -> Level.ALERT
            flagged >= REPEAT_MIN -> Level.WATCH
            rule != null && base == null -> Level.LEARNING
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
        /** Quanto uma medida pode se afastar do normal do carro; [bothWays] vale para cima e para baixo. */
        data class BaselineRule(val margin: Double, val bothWays: Boolean = false) {
            fun away(value: Double, base: Double) = if (bothWays) abs(value - base) > margin else value > base + margin
        }
        /** Checagens comparadas com o normal do próprio carro, aprendido nas [BASELINE_TRIPS] primeiras viagens. */
        val BASELINE_RULES = mapOf(
            // MAP em marcha lenta (fração da pressão do ar): subir ≈ 7 kPa acima do normal
            HealthMonitor.IDLE_VACUUM to BaselineRule(0.07),
            // Patinação (%): 4 pontos acima do normal (a leitura da velocidade atrasa um pouco na aceleração)
            HealthMonitor.CLUTCH_SLIP to BaselineRule(4.0),
        )
        /**
         * Correção de mistura (%): mediana das últimas [REPEAT_WINDOW] viagens além disso, para mais ou para menos. No Uno,
         * de 01 a 21/11, a mediana de 5 viagens rodando ficou entre −7 e +6 %; em marcha lenta chegou a +16 % em 11/11
         * (dez viagens seguidas pedindo mais combustível, voltou ao normal depois), o único trecho que daria atenção.
         */
        val ROLLING_RULES = mapOf(HealthMonitor.STFT_IDLE to 15.0, HealthMonitor.STFT_CRUISE to 15.0)
        val BASELINE_CHECKS = BASELINE_RULES.keys
        const val BASELINE_TRIPS = 5

        const val CENTRAL = "central"
        const val COOLING = "cooling"
        const val ELECTRIC = "electric"
        const val INTAKE = "intake"
        const val IDLE = "idle"
        const val MIXTURE = "mixture"
        const val EXHAUST = "exhaust"
        const val SENSORS = "sensors"
        const val CLUTCH = "clutch"
        val GROUPS = listOf(
            COOLING to listOf(HealthMonitor.WARMUP, HealthMonitor.ROAD_COOL, HealthMonitor.OVERHEAT),
            ELECTRIC to listOf(HealthMonitor.CHARGING, HealthMonitor.REST_V, HealthMonitor.CRANK_V),
            INTAKE to listOf(HealthMonitor.IDLE_VACUUM, HealthMonitor.MAP_OFFSET),
            IDLE to listOf(HealthMonitor.IDLE_RPM),
            MIXTURE to listOf(HealthMonitor.STFT_IDLE, HealthMonitor.STFT_CRUISE),
            EXHAUST to listOf(HealthMonitor.O2_POST),
            SENSORS to listOf(HealthMonitor.TEMP_PLAUS),
            CLUTCH to listOf(HealthMonitor.CLUTCH_SLIP),
        )

        private val JSON = kotlinx.serialization.json.Json { ignoreUnknownKeys = true }

        fun decode(text: String?): HealthHistory = runCatching {
            val saved = JSON.decodeFromString(Saved.serializer(), text!!)
            HealthHistory(saved.trips.mapValues { it.value.toMutableList() }.toMutableMap(), saved.central, saved.baselines.toMutableMap())
        }.getOrElse { HealthHistory() }
    }
}

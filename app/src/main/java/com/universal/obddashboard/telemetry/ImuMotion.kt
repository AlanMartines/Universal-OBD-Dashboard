package com.universal.obddashboard.telemetry

import kotlin.math.PI
import kotlin.math.abs
import kotlin.math.acos
import kotlin.math.asin
import kotlin.math.exp
import kotlin.math.sin
import kotlin.math.sqrt
import kotlin.math.tan

/**
 * Movimento do carro pelo acelerômetro e giroscópio do ESP32 (LSM6DS3, linha `# lsm6ds3 ...`).
 *
 * O módulo pode estar montado em qualquer posição: a orientação é aprendida sozinha.
 * - **Cima:** média da gravidade com o carro parado (velocidade 0, sem rotação). Ao longo de várias
 *   paradas, rampas para um lado e para o outro se compensam.
 * - **Frente:** direção em que o sensor acusa aceleração quando a velocidade do OBD sobe ou desce.
 * - **Remontagem:** parado, se a gravidade ficar longe do "cima" aprendido por [RESET_S], recomeça.
 *
 * Ajuste fino (Ajustes → Calibração dos sensores): [pitchTrimDeg] e [rollTrimDeg] somam graus à inclinação frontal e
 * lateral, por cima do que foi aprendido (a aceleração e a força lateral acompanham).
 *
 * Dois ajustes à mão (aba Dinâmica), que passam a valer no lugar do aprendizado automático:
 * - **Zerar nível** ([requestLevel]): parado num piso plano, a gravidade de agora vira o "cima". A frente fica.
 * - **Calibrar frente** ([armForward]): na próxima arrancada em linha reta (de 5 a 20 km/h), a direção da
 *   aceleração vira a frente.
 *
 * Saídas (g = gravidade): aceleração para a frente (negativa é frenagem), lateral (positiva é para a
 * esquerda, numa curva à esquerda), inclinação da rua (%, positiva é subida), inclinação frontal e lateral
 * em graus, giro (°/s, positivo à esquerda), sentido (parado, para a frente ou de ré), impactos e máximas.
 * A inclinação frontal vem do acelerômetro na direção da frente menos a aceleração medida pelo OBD; a lateral,
 * do acelerômetro de lado menos a força da curva (velocidade × giro).
 */
class ImuMotion(calibration: Calibration? = null) {

    /**
     * Orientação aprendida, nos eixos do módulo. Os pesos dizem quanto já foi visto. [upLocked] e [forwardLocked]:
     * definidos à mão (Zerar nível, Calibrar frente); o aprendizado automático não mexe mais neles.
     */
    data class Calibration(
        val up: List<Double>,
        val upWeightS: Double,
        val forward: List<Double>?,
        val forwardWeight: Double,
        val upLocked: Boolean = false,
        val forwardLocked: Boolean = false,
    ) {
        fun encode(): String = buildList {
            add(up.joinToString(",") { "%.5f".format(java.util.Locale.ROOT, it) })
            add("%.2f".format(java.util.Locale.ROOT, upWeightS))
            add(forward?.joinToString(",") { "%.5f".format(java.util.Locale.ROOT, it) } ?: "")
            add("%.4f".format(java.util.Locale.ROOT, forwardWeight))
            add((if (upLocked) "U" else "") + (if (forwardLocked) "F" else ""))
        }.joinToString(";")

        /** Como o módulo está preso, para mostrar em Ajustes. */
        fun mount(): Mount {
            val u = up.toDoubleArray()
            val (upAxis, upOff) = nearestAxis(u)
            val f = forward?.toDoubleArray()?.let { f -> unit(f.minus(unit(u).times(dot(f, unit(u))))) }?.takeIf { len(it) > 0.5 }
            val fwd = f?.let { nearestAxis(it) }
            return Mount(upAxis, upOff, upLocked, fwd?.first, fwd?.second, forwardLocked)
        }

        companion object {
            fun decode(text: String?): Calibration? = runCatching {
                val p = text!!.split(";")
                val up = p[0].split(",").map { it.toDouble() }
                val fwd = p[2].takeIf { it.isNotBlank() }?.split(",")?.map { it.toDouble() }
                require(up.size == 3 && (fwd == null || fwd.size == 3))
                val flags = p.getOrNull(4).orEmpty()
                Calibration(up, p[1].toDouble(), fwd, p[3].toDouble(), 'U' in flags, 'F' in flags)
            }.getOrNull()
        }
    }

    /**
     * Posição do módulo: o eixo dele que aponta para cima e o que aponta para a frente do carro ("+X", "−Z"...), cada um
     * com quantos graus fica fora do eixo exato. Travado: definido à mão (Zerar nível, Calibrar frente).
     */
    data class Mount(
        val upAxis: String,
        val upOffDeg: Double,
        val upLocked: Boolean,
        val forwardAxis: String?,
        val forwardOffDeg: Double?,
        val forwardLocked: Boolean,
    )

    /** Ajuste à mão em andamento ou recém-terminado (mostrado na tela). */
    enum class Action { LEVEL_PENDING, LEVEL_DONE, LEVEL_FAILED, FORWARD_ARMED, FORWARD_CAPTURING, FORWARD_DONE }

    private var upAcc = DoubleArray(3)
    private var upW = 0.0
    private var fwdAcc = DoubleArray(3)
    private var fwdW = 0.0
    private var upLocked = false
    private var fwdLocked = false

    init {
        calibration?.let {
            upW = it.upWeightS
            upAcc = it.up.toDoubleArray().times(upW)
            upLocked = it.upLocked
            if (it.forward != null) {
                fwdW = it.forwardWeight
                fwdAcc = it.forward.toDoubleArray().times(fwdW)
                fwdLocked = it.forwardLocked
            }
        }
    }

    val calibration: Calibration?
        get() = if (upW <= 0) null else Calibration(
            unit(upAcc).toList(), upW, if (fwdW > 0) unit(fwdAcc).toList() else null, fwdW, upLocked, fwdLocked && fwdW > 0,
        )

    /** 0 aprendendo o "cima" (pare o carro), 1 aprendendo a frente (ande), 2 pronto. */
    val stage: Int get() = when {
        upW < UP_READY_S -> 0
        fwdW < FWD_READY -> 1
        else -> 2
    }

    /** Muda quando a orientação é trocada à mão: hora de salvar. */
    var manualChanges = 0; private set

    /** Ajuste fino em graus, somado à inclinação frontal (positivo levanta a frente) e à lateral. */
    var pitchTrimDeg = 0.0
    var rollTrimDeg = 0.0

    var accelG: Double? = null; private set
    var lateralG: Double? = null; private set
    var slopePct: Double? = null; private set
    /** Inclinação frontal (°): positiva com a frente mais alta (subida). */
    var pitchDeg: Double? = null; private set
    /** Inclinação lateral (°): positiva com o lado direito mais baixo, negativa com o esquerdo. */
    var rollDeg: Double? = null; private set
    /** Giro em torno do eixo de cima do carro (°/s): positivo virando para a esquerda. */
    var yawDps: Double? = null; private set
    var impactG: Double? = null; private set
    var bumps = 0; private set
    var maxBrakeG = 0.0; private set
    var maxAccelG = 0.0; private set
    var maxLateralG = 0.0; private set
    /** Maiores inclinações (em módulo) vistas com a orientação pronta, em graus. */
    var maxPitchDeg = 0.0; private set
    var maxRollDeg = 0.0; private set

    /** Sentido: [DIR_STOPPED], [DIR_FORWARD] ou [DIR_REVERSE]; null sem velocidade do OBD. */
    var direction: Int? = null; private set
    /** Sentido decidido na arrancada; vale até a próxima parada. */
    private var dirLatched: Int? = null

    private var action: Action? = null
    private var actionAt = 0L
    /** Ajuste à mão para mostrar: os de resultado somem depois de [ACTION_SHOW_MS]. */
    fun action(now: Long): Action? = action?.takeIf {
        it == Action.LEVEL_PENDING || it == Action.FORWARD_ARMED || it == Action.FORWARD_CAPTURING || now - actionAt < ACTION_SHOW_MS
    }

    private var slopeSin: Double? = null
    private var rollSin: Double? = null
    private var smAccel: Double? = null
    private var smLat: Double? = null
    private var smYaw: Double? = null
    private var lastBumpAt = Long.MIN_VALUE / 2
    private var offS = 0.0
    // Amostras de "parado" esperam STILL_HOLD_MS antes de contar: o OBD demora a acusar a arrancada,
    // e o começo dela não pode entrar como gravidade.
    private val pending = ArrayDeque<Triple<Long, DoubleArray, DoubleArray>>()

    // Desvio do giroscópio: cada chip marca alguns °/s parado (a folha de dados do LSM6DS3 aceita até ±10) e o valor
    // muda com a temperatura. Medido em toda parada quieta e descontado de todas as leituras.
    private val gyroBias = DoubleArray(3)
    private var biasW = 0.0
    private var prevA: DoubleArray? = null
    /** Desvio do giroscópio medido (°/s, eixos do módulo); null antes da primeira parada. */
    val gyroBiasDps: DoubleArray? get() = gyroBias.copyOf().takeIf { biasW >= BIAS_READY_S }

    // Zerar nível: soma da gravidade parado, até LEVEL_S
    private var levelAcc = DoubleArray(3)
    private var levelS = 0.0
    private var levelSince = 0L
    // Calibrar frente: soma da arrancada em andamento
    private var capAcc = DoubleArray(3)
    private var capW = 0.0

    // Aceleração pelo OBD: inclinação da reta de velocidade nos últimos segundos (km/h inteiros são ruidosos)
    private val speeds = ArrayDeque<Pair<Long, Double>>()
    private var speedKmh: Double? = null
    private var dvdtG: Double? = null

    /** Parado num piso plano: a gravidade dos próximos [LEVEL_S] segundos vira o "cima". */
    fun requestLevel(now: Long) {
        levelAcc = DoubleArray(3)
        levelS = 0.0
        levelSince = now
        action = Action.LEVEL_PENDING
        actionAt = now
    }

    /** A próxima arrancada em linha reta define a frente. Chamar de novo com ela armada cancela. */
    fun armForward(now: Long) {
        if (action == Action.FORWARD_ARMED || action == Action.FORWARD_CAPTURING) {
            action = null
            return
        }
        capAcc = DoubleArray(3)
        capW = 0.0
        action = Action.FORWARD_ARMED
        actionAt = now
    }

    /** Nova leitura de velocidade do OBD (km/h), com a hora dela. */
    fun onSpeed(t: Long, kmh: Double) {
        speedKmh = kmh
        speeds.addLast(t to kmh)
        while (speeds.size > 2 && t - speeds.first().first > SPEED_WINDOW_MS) speeds.removeFirst()
        // Acima de 1,2 g não é carro de rua: salto de leitura (reconexão, valor perdido); ignora
        dvdtG = if (speeds.size >= 3 && t - speeds.first().first >= 800) (slope(speeds) / 3.6 / G).takeIf { abs(it) <= 1.2 } else null
        if (kmh < STOP_KMH) {
            dirLatched = null
            direction = DIR_STOPPED
        } else if (direction == null || direction == DIR_STOPPED) {
            direction = DIR_FORWARD   // até a arrancada dizer o contrário
        }
    }

    /** Uma linha do sensor: aceleração (g), rotação (°/s) e o maior desvio da gravidade no intervalo (g). */
    fun update(now: Long, dtS: Double, a: DoubleArray, gyroDps: DoubleArray, peakG: Double) {
        val dt = dtS.coerceIn(0.02, 1.0)
        val norm = len(a)
        if (norm < 0.2) return
        val v = speedKmh
        val gyro = gyroDps.minus(gyroBias)
        val rot = len(gyro)
        impactG = peakG
        // Aceleração estável entre duas leituras: ninguém mexendo no módulo
        val calm = prevA?.let { len(a.minus(it)) < CALM_G } ?: false
        prevA = a.copyOf()

        // Parado e quieto: aprende o "cima" e o desvio do giroscópio (ou percebe que o módulo mudou de posição).
        // Antes de conhecer o desvio, o giro cru pode passar de STILL_DPS mesmo parado: vale um limite maior.
        val stillDps = if (biasW >= BIAS_READY_S) STILL_DPS else BIAS_MAX_DPS
        val still = v != null && v < STOP_KMH && rot < stillDps && abs(norm - 1) < 0.06 && calm
        if (still) {
            val au = a.times(1 / norm)
            if (upW >= UP_READY_S && dot(au, unit(upAcc)) < RESET_COS && action != Action.LEVEL_PENDING) {
                offS += dt
                if (offS >= RESET_S) reset()
            } else {
                offS = 0.0
            }
            pending.addLast(Triple(now, au.times(dt), gyroDps.copyOf()))
            while (pending.isNotEmpty() && now - pending.first().first >= STILL_HOLD_MS) {
                val (_, w, gRaw) = pending.removeFirst()
                learnBias(gRaw, len(w))
                if (!upLocked) {
                    upAcc = upAcc.plus(w)
                    upW += len(w)
                }
                if (action == Action.LEVEL_PENDING) {
                    levelAcc = levelAcc.plus(w)
                    levelS += len(w)
                }
            }
            if (upW > UP_MAX_S) { upAcc = upAcc.times(UP_MAX_S / upW); upW = UP_MAX_S }
        } else {
            pending.clear()
        }
        stepLevel(now, v)
        if (upW < UP_READY_S) return clearOutputs()
        val up = unit(upAcc)
        val horiz = a.minus(up.times(dot(a, up)))
        val yaw = dot(gyro, up)
        val ky = 1 - exp(-dt / YAW_TAU_S)
        smYaw = smYaw?.let { it + (yaw - it) * ky } ?: yaw
        // Giro só depois de medir o desvio do giroscópio: antes, uma reta poderia aparecer como curva
        yawDps = smYaw.takeIf { biasW >= BIAS_READY_S }

        // Andando em linha reta com a velocidade mudando: aprende a frente (de ré não, que inverteria)
        val dv = dvdtG
        if (!fwdLocked && direction != DIR_REVERSE && v != null && v > 10 && dv != null && abs(dv) > 0.04 && abs(yaw) < 6) {
            fwdAcc = fwdAcc.plus(horiz.times(dv * dt))
            fwdW += dv * dv * dt
            if (fwdW > FWD_MAX) { fwdAcc = fwdAcc.times(FWD_MAX / fwdW); fwdW = FWD_MAX }
        }
        stepForward(now, v, dv, horiz, yaw, dt)
        if (fwdW < FWD_READY) return clearOutputs()
        val f0 = fwdAcc.minus(up.times(dot(fwdAcc, up)))
        if (len(f0) < 1e-6) return clearOutputs()
        val fwd = unit(f0)
        val left = cross(up, fwd)

        val along = dot(a, fwd)
        val lat = dot(a, left)
        decideDirection(v, dv, along)
        // A velocidade do OBD não tem sinal: de ré, a aceleração e a curva vão ao contrário.
        // Na arrancada, até saber o sentido, a rampa e a inclinação lateral ficam como estavam parado.
        val moving = v != null && v >= STOP_KMH
        val known = !moving || dirLatched != null || (v ?: 0.0) > DIR_DECIDE_MAX_KMH
        val sgn = if (direction == DIR_REVERSE) -1.0 else 1.0
        val k = 1 - exp(-dt / SLOPE_TAU_S)
        // Parado não há aceleração: o que sobra na frente é a rampa. Andando, desconta a aceleração do OBD.
        val sinNow = when {
            !moving && v != null -> along
            known && dv != null -> along - sgn * dv
            else -> null
        }
        if (sinNow != null) {
            val x = sinNow.coerceIn(-0.5, 0.5)
            slopeSin = slopeSin?.let { it + (x - it) * k } ?: x
        }
        // De lado, parado é só a inclinação; andando, desconta a força da curva (velocidade × giro)
        val rollNow = when {
            !moving && v != null -> lat
            known && v != null -> lat - sgn * (v / 3.6) * (yaw * PI / 180) / G
            else -> null
        }
        if (rollNow != null) {
            val x = rollNow.coerceIn(-0.5, 0.5)
            rollSin = rollSin?.let { it + (x - it) * k } ?: x
        }
        val s = slopeSin?.let { trimmed(it, pitchTrimDeg) }
        slopePct = s?.let { tan(asin(it)) * 100 }
        pitchDeg = s?.let { Math.toDegrees(asin(it)) }
        val r = rollSin?.let { trimmed(it, rollTrimDeg) }
        // rollSin > 0: o lado esquerdo do carro aponta para cima, ou seja, o direito está mais baixo
        rollDeg = r?.let { Math.toDegrees(asin(it)) }

        val kg = 1 - exp(-dt / G_TAU_S)
        val acc = along - (s ?: 0.0)
        smAccel = smAccel?.let { it + (acc - it) * kg } ?: acc
        val latK = lat - (r ?: 0.0)
        smLat = smLat?.let { it + (latK - it) * kg } ?: latK
        accelG = smAccel
        lateralG = smLat

        pitchDeg?.let { maxPitchDeg = maxOf(maxPitchDeg, abs(it)) }
        rollDeg?.let { maxRollDeg = maxOf(maxRollDeg, abs(it)) }
        if (v != null && v > 5) {
            maxAccelG = maxOf(maxAccelG, smAccel ?: 0.0)
            maxBrakeG = maxOf(maxBrakeG, -(smAccel ?: 0.0))
            maxLateralG = maxOf(maxLateralG, abs(smLat ?: 0.0))
            if (peakG >= BUMP_G && now - lastBumpAt >= BUMP_GAP_MS) {
                bumps++
                lastBumpAt = now
            }
        }
    }

    /**
     * Ré: na arrancada (velocidade do OBD subindo), o sensor acusa aceleração para trás. Para a frente, para a frente.
     * Decidido, vale até parar; enquanto não dá para saber, fica "para a frente" sem travar.
     */
    private fun decideDirection(v: Double?, dv: Double?, along: Double) {
        if (v == null || v < STOP_KMH) return
        dirLatched?.let { direction = it; return }
        if (v > DIR_DECIDE_MAX_KMH || dv == null || dv < DIR_MIN_G) return
        // Aceleração na direção da frente, descontada a rampa de quando estava parado
        val acc = along - (slopeSin ?: 0.0)
        when {
            acc < -DIR_MIN_G -> { dirLatched = DIR_REVERSE; direction = DIR_REVERSE }
            acc > DIR_MIN_G -> { dirLatched = DIR_FORWARD; direction = DIR_FORWARD }
        }
    }

    private fun stepLevel(now: Long, v: Double?) {
        if (action != Action.LEVEL_PENDING) return
        if ((v != null && v >= STOP_KMH) || now - levelSince > LEVEL_TIMEOUT_MS) {
            action = Action.LEVEL_FAILED
            actionAt = now
            return
        }
        if (levelS < LEVEL_S) return
        upAcc = unit(levelAcc).times(UP_MAX_S)
        upW = UP_MAX_S
        upLocked = true
        slopeSin = null
        rollSin = null
        offS = 0.0
        action = Action.LEVEL_DONE
        actionAt = now
        manualChanges++
    }

    private fun stepForward(now: Long, v: Double?, dv: Double?, horiz: DoubleArray, yaw: Double, dt: Double) {
        if (action != Action.FORWARD_ARMED && action != Action.FORWARD_CAPTURING) return
        if (v == null) return
        if (v < FWD_CAL_FROM_KMH) {
            // Parado ou quase: espera a arrancada (uma tentativa que não chegou a 20 km/h recomeça)
            if (action == Action.FORWARD_CAPTURING) action = Action.FORWARD_ARMED
            capAcc = DoubleArray(3)
            capW = 0.0
            return
        }
        if (v <= FWD_CAL_TO_KMH) {
            if (abs(yaw) >= 6 || (dv != null && dv < 0)) {
                // Curva ou freada no meio: não serve; tenta na próxima arrancada
                capAcc = DoubleArray(3)
                capW = -1.0
                action = Action.FORWARD_ARMED
                return
            }
            if (capW < 0) return
            action = Action.FORWARD_CAPTURING
            if (dv != null && dv > 0.02) {
                capAcc = capAcc.plus(horiz.times(dv * dt))
                capW += dv * dv * dt
            }
            return
        }
        // Passou de 20 km/h: fecha a tentativa
        if (action == Action.FORWARD_CAPTURING && capW >= FWD_CAL_MIN && len(capAcc) > 1e-9) {
            fwdAcc = unit(capAcc).times(FWD_MAX)
            fwdW = FWD_MAX
            fwdLocked = true
            dirLatched = DIR_FORWARD
            direction = DIR_FORWARD
            action = Action.FORWARD_DONE
            actionAt = now
            manualChanges++
        } else if (action == Action.FORWARD_CAPTURING) {
            action = Action.FORWARD_ARMED
        }
        capAcc = DoubleArray(3)
        capW = 0.0
    }

    private fun clearOutputs() {
        accelG = null
        lateralG = null
        slopePct = null
        pitchDeg = null
        rollDeg = null
    }

    /** Seno da inclinação com o ajuste fino somado ao ângulo. */
    private fun trimmed(sinA: Double, trimDeg: Double): Double {
        val x = sinA.coerceIn(-0.45, 0.45)
        if (trimDeg == 0.0) return x
        return sin(asin(x) + Math.toRadians(trimDeg)).coerceIn(-0.45, 0.45)
    }

    /**
     * Esquece o nível e a frente (Ajustes → Calibração dos sensores, ao trocar o módulo de lugar): volta a aprender do
     * zero. O desvio do giroscópio fica, porque é do chip e não da posição.
     */
    fun forget() {
        reset()
        maxPitchDeg = 0.0
        maxRollDeg = 0.0
    }

    /** Média do giro cru parado: as primeiras paradas acertam rápido; depois, acompanha devagar a temperatura. */
    private fun learnBias(raw: DoubleArray, dt: Double) {
        biasW += dt
        val k = dt / minOf(biasW, BIAS_TAU_S)
        for (i in 0..2) gyroBias[i] += (raw[i] - gyroBias[i]) * k
    }

    private fun reset() {
        upAcc = DoubleArray(3); upW = 0.0
        fwdAcc = DoubleArray(3); fwdW = 0.0
        upLocked = false; fwdLocked = false
        slopeSin = null; rollSin = null; smAccel = null; smLat = null; smYaw = null; offS = 0.0
        yawDps = null
        dirLatched = null
        pending.clear()
        clearOutputs()
    }

    companion object {
        const val G = 9.80665
        const val UP_READY_S = 3.0
        const val UP_MAX_S = 600.0
        const val FWD_READY = 0.15      // soma de (dv/dt em g)² × s: umas duas arrancadas e uma frenagem
        const val FWD_MAX = 30.0
        const val STILL_DPS = 3.0
        /** Desvio do giroscópio: limite antes de medir, tempo parado até valer e quão devagar acompanha. */
        const val BIAS_MAX_DPS = 12.0
        const val BIAS_READY_S = 2.0
        const val BIAS_TAU_S = 30.0
        /** Diferença máxima da aceleração entre duas leituras (g) para contar como parado e quieto. */
        const val CALM_G = 0.05
        const val STILL_HOLD_MS = 1000L
        const val RESET_COS = 0.94      // cerca de 20° fora do "cima" aprendido
        const val RESET_S = 10.0
        const val SLOPE_TAU_S = 2.5
        const val G_TAU_S = 0.4
        const val YAW_TAU_S = 0.4
        const val BUMP_G = 0.4          // desvio da gravidade que conta como buraco ou impacto
        const val BUMP_GAP_MS = 1000L
        const val SPEED_WINDOW_MS = 1500L
        const val STOP_KMH = 0.5

        const val DIR_STOPPED = 0
        const val DIR_FORWARD = 1
        const val DIR_REVERSE = 2
        /** Aceleração mínima (g) para decidir o sentido na arrancada, e até que velocidade ainda decide. */
        const val DIR_MIN_G = 0.03
        const val DIR_DECIDE_MAX_KMH = 25.0

        const val LEVEL_S = 3.0
        const val LEVEL_TIMEOUT_MS = 20_000L
        const val FWD_CAL_FROM_KMH = 5.0
        const val FWD_CAL_TO_KMH = 20.0
        /** Peso mínimo da arrancada: cerca de 0,05 g por 2 s. */
        const val FWD_CAL_MIN = 0.004
        const val ACTION_SHOW_MS = 6000L

        /** Eixo do módulo mais perto do vetor ("+X", "−Y"...) e quantos graus o vetor fica fora dele. */
        fun nearestAxis(v: DoubleArray): Pair<String, Double> {
            val l = len(v)
            val i = (0..2).maxBy { abs(v[it]) }
            val name = (if (v[i] >= 0) "+" else "−") + "XYZ"[i]
            val off = if (l < 1e-12) 0.0 else Math.toDegrees(acos((abs(v[i]) / l).coerceAtMost(1.0)))
            return name to off
        }

        private fun dot(a: DoubleArray, b: DoubleArray) = a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
        private fun len(a: DoubleArray) = sqrt(dot(a, a))
        private fun unit(a: DoubleArray): DoubleArray { val l = len(a); return if (l < 1e-12) a.copyOf() else a.times(1 / l) }
        private fun cross(a: DoubleArray, b: DoubleArray) =
            doubleArrayOf(a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0])
        private fun DoubleArray.times(k: Double) = DoubleArray(3) { this[it] * k }
        private fun DoubleArray.plus(b: DoubleArray) = DoubleArray(3) { this[it] + b[it] }
        private fun DoubleArray.minus(b: DoubleArray) = DoubleArray(3) { this[it] - b[it] }

        /** Inclinação da reta (mínimos quadrados) de velocidade por tempo, em km/h por segundo. */
        private fun slope(pts: Collection<Pair<Long, Double>>): Double {
            val t0 = pts.first().first
            val n = pts.size
            val mx = pts.sumOf { (it.first - t0) / 1000.0 } / n
            val my = pts.sumOf { it.second } / n
            var sxy = 0.0
            var sxx = 0.0
            for ((t, y) in pts) {
                val x = (t - t0) / 1000.0 - mx
                sxy += x * (y - my)
                sxx += x * x
            }
            return if (sxx < 1e-9) 0.0 else sxy / sxx
        }
    }
}

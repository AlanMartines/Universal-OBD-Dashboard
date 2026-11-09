package com.universal.obddashboard.telemetry

import kotlin.math.abs
import kotlin.math.asin
import kotlin.math.exp
import kotlin.math.sqrt
import kotlin.math.tan

/**
 * Movimento do carro pelo acelerômetro e giroscópio do ESP32 (LSM6DS3, linha `# lsm6ds3 ...`).
 *
 * O módulo pode estar montado em qualquer posição: a orientação é aprendida sozinha, sem botão.
 * - **Cima:** média da gravidade com o carro parado (velocidade 0, sem rotação). Ao longo de várias
 *   paradas, rampas para um lado e para o outro se compensam.
 * - **Frente:** direção em que o sensor acusa aceleração quando a velocidade do OBD sobe ou desce.
 * - **Remontagem:** parado, se a gravidade ficar longe do "cima" aprendido por [RESET_S], recomeça.
 *
 * Saídas (g = gravidade): aceleração para a frente (negativa é frenagem), lateral (positiva é para a
 * esquerda, numa curva à esquerda), inclinação da rua (%, positiva é subida), impactos e máximas da viagem.
 * A inclinação vem do acelerômetro na direção da frente menos a aceleração medida pelo OBD.
 */
class ImuMotion(calibration: Calibration? = null) {

    /** Orientação aprendida, nos eixos do módulo. Os pesos dizem quanto já foi visto. */
    data class Calibration(val up: List<Double>, val upWeightS: Double, val forward: List<Double>?, val forwardWeight: Double) {
        fun encode(): String = buildList {
            add(up.joinToString(",") { "%.5f".format(java.util.Locale.ROOT, it) })
            add("%.2f".format(java.util.Locale.ROOT, upWeightS))
            add(forward?.joinToString(",") { "%.5f".format(java.util.Locale.ROOT, it) } ?: "")
            add("%.4f".format(java.util.Locale.ROOT, forwardWeight))
        }.joinToString(";")

        companion object {
            fun decode(text: String?): Calibration? = runCatching {
                val p = text!!.split(";")
                val up = p[0].split(",").map { it.toDouble() }
                val fwd = p[2].takeIf { it.isNotBlank() }?.split(",")?.map { it.toDouble() }
                require(up.size == 3 && (fwd == null || fwd.size == 3))
                Calibration(up, p[1].toDouble(), fwd, p[3].toDouble())
            }.getOrNull()
        }
    }

    private var upAcc = DoubleArray(3)
    private var upW = 0.0
    private var fwdAcc = DoubleArray(3)
    private var fwdW = 0.0

    init {
        calibration?.let {
            upW = it.upWeightS
            upAcc = it.up.toDoubleArray().times(upW)
            if (it.forward != null) {
                fwdW = it.forwardWeight
                fwdAcc = it.forward.toDoubleArray().times(fwdW)
            }
        }
    }

    val calibration: Calibration?
        get() = if (upW <= 0) null else Calibration(unit(upAcc).toList(), upW, if (fwdW > 0) unit(fwdAcc).toList() else null, fwdW)

    /** 0 aprendendo o "cima" (pare o carro), 1 aprendendo a frente (ande), 2 pronto. */
    val stage: Int get() = when {
        upW < UP_READY_S -> 0
        fwdW < FWD_READY -> 1
        else -> 2
    }

    var accelG: Double? = null; private set
    var lateralG: Double? = null; private set
    var slopePct: Double? = null; private set
    var impactG: Double? = null; private set
    var bumps = 0; private set
    var maxBrakeG = 0.0; private set
    var maxAccelG = 0.0; private set
    var maxLateralG = 0.0; private set

    private var slopeSin: Double? = null
    private var smAccel: Double? = null
    private var smLat: Double? = null
    private var lastBumpAt = Long.MIN_VALUE / 2
    private var offS = 0.0
    // Amostras de "parado" esperam STILL_HOLD_MS antes de contar: o OBD demora a acusar a arrancada,
    // e o começo dela não pode entrar como gravidade.
    private val pending = ArrayDeque<Pair<Long, DoubleArray>>()

    // Aceleração pelo OBD: inclinação da reta de velocidade nos últimos segundos (km/h inteiros são ruidosos)
    private val speeds = ArrayDeque<Pair<Long, Double>>()
    private var speedKmh: Double? = null
    private var dvdtG: Double? = null

    /** Nova leitura de velocidade do OBD (km/h), com a hora dela. */
    fun onSpeed(t: Long, kmh: Double) {
        speedKmh = kmh
        speeds.addLast(t to kmh)
        while (speeds.size > 2 && t - speeds.first().first > SPEED_WINDOW_MS) speeds.removeFirst()
        // Acima de 1,2 g não é carro de rua: salto de leitura (reconexão, valor perdido); ignora
        dvdtG = if (speeds.size >= 3 && t - speeds.first().first >= 800) (slope(speeds) / 3.6 / G).takeIf { abs(it) <= 1.2 } else null
    }

    /** Uma linha do sensor: aceleração (g), rotação (°/s) e o maior desvio da gravidade no intervalo (g). */
    fun update(now: Long, dtS: Double, a: DoubleArray, gyroDps: DoubleArray, peakG: Double) {
        val dt = dtS.coerceIn(0.02, 1.0)
        val norm = len(a)
        if (norm < 0.2) return
        val v = speedKmh
        val rot = len(gyroDps)
        impactG = peakG

        // Parado e quieto: aprende o "cima" (ou percebe que o módulo mudou de posição)
        val still = v != null && v < 0.5 && rot < STILL_DPS && abs(norm - 1) < 0.06
        if (still) {
            val au = a.times(1 / norm)
            if (upW >= UP_READY_S && dot(au, unit(upAcc)) < RESET_COS) {
                offS += dt
                if (offS >= RESET_S) reset()
            } else {
                offS = 0.0
            }
            pending.addLast(now to au.times(dt))
            while (pending.isNotEmpty() && now - pending.first().first >= STILL_HOLD_MS) {
                val w = pending.removeFirst().second
                upAcc = upAcc.plus(w)
                upW += len(w)
            }
            if (upW > UP_MAX_S) { upAcc = upAcc.times(UP_MAX_S / upW); upW = UP_MAX_S }
        } else {
            pending.clear()
        }
        if (upW < UP_READY_S) return clearOutputs()
        val up = unit(upAcc)
        val horiz = a.minus(up.times(dot(a, up)))

        // Andando em linha reta com a velocidade mudando: aprende a frente
        val dv = dvdtG
        val yaw = abs(dot(gyroDps, up))
        if (v != null && v > 10 && dv != null && abs(dv) > 0.04 && yaw < 6) {
            fwdAcc = fwdAcc.plus(horiz.times(dv * dt))
            fwdW += dv * dv * dt
            if (fwdW > FWD_MAX) { fwdAcc = fwdAcc.times(FWD_MAX / fwdW); fwdW = FWD_MAX }
        }
        if (fwdW < FWD_READY) return clearOutputs()
        val f0 = fwdAcc.minus(up.times(dot(fwdAcc, up)))
        if (len(f0) < 1e-6) return clearOutputs()
        val fwd = unit(f0)
        val left = cross(up, fwd)

        val along = dot(a, fwd)
        val k = 1 - exp(-dt / SLOPE_TAU_S)
        // Parado não há aceleração: o que sobra na frente é a rampa. Andando, desconta a aceleração do OBD.
        val sinNow = when {
            v != null && v < 0.5 -> along
            dv != null -> along - dv
            else -> null
        }
        if (sinNow != null) {
            val x = sinNow.coerceIn(-0.5, 0.5)
            slopeSin = slopeSin?.let { it + (x - it) * k } ?: x
        }
        val s = slopeSin?.coerceIn(-0.45, 0.45)
        slopePct = s?.let { tan(asin(it)) * 100 }

        val kg = 1 - exp(-dt / G_TAU_S)
        val acc = along - (s ?: 0.0)
        smAccel = smAccel?.let { it + (acc - it) * kg } ?: acc
        val lat = dot(a, left)
        smLat = smLat?.let { it + (lat - it) * kg } ?: lat
        accelG = smAccel
        lateralG = smLat

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

    private fun clearOutputs() {
        accelG = null
        lateralG = null
        slopePct = null
    }

    private fun reset() {
        upAcc = DoubleArray(3); upW = 0.0
        fwdAcc = DoubleArray(3); fwdW = 0.0
        slopeSin = null; smAccel = null; smLat = null; offS = 0.0
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
        const val STILL_HOLD_MS = 1000L
        const val RESET_COS = 0.94      // cerca de 20° fora do "cima" aprendido
        const val RESET_S = 10.0
        const val SLOPE_TAU_S = 2.5
        const val G_TAU_S = 0.4
        const val BUMP_G = 0.4          // desvio da gravidade que conta como buraco ou impacto
        const val BUMP_GAP_MS = 1000L
        const val SPEED_WINDOW_MS = 1500L

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

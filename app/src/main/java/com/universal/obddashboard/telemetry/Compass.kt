package com.universal.obddashboard.telemetry

import kotlin.math.abs
import kotlin.math.atan2
import kotlin.math.cos
import kotlin.math.exp
import kotlin.math.floor
import kotlin.math.sin
import kotlin.math.sqrt

/**
 * Rumo do carro (0° = norte, 90° = leste), de duas fontes:
 * - **GPS:** andando acima de [GPS_MIN_KMH] com boa precisão, o rumo do GPS é o melhor que há.
 * - **Magnetômetro do ESP32** (QMC5883L/QMC5883P/HMC5883L, linha `# mag ...`): parado, devagar ou sem sinal.
 *
 * Dentro do carro o campo magnético é torto (lata, motor, fiação), e o norte magnético não é o geográfico.
 * Por isso a bússola se calibra sozinha pelo GPS, sem pedir nada e sem depender de como o módulo foi preso:
 * 1. andando em linha reta, guarda a leitura do magnetômetro em cada faixa de 10° do rumo do GPS;
 * 2. conforme o carro vira, o campo da Terra gira num plano dentro do módulo: esse plano sai das próprias leituras
 *    (componentes principais), e nele o centro do círculo é o "ferro" do carro;
 * 3. uma tabela de desvio por faixa (rumo do GPS menos o da bússola) junta a declinação magnética, a posição
 *    do módulo e o resto da distorção.
 * Precisa de faixas nas quatro direções. Se o módulo for mexido, a bússola passa a discordar do GPS e recomeça.
 */
class Compass(calibration: Calibration? = null) {

    /** Leitura média do magnetômetro (eixos do módulo) e rumo médio do GPS, por faixa de [BIN_DEG]. */
    class Bin(val mag: DoubleArray, val sin: Double, val cos: Double, val n: Int)

    data class Calibration(val bins: List<Bin?>) {
        fun encode(): String = bins.joinToString("|") { b ->
            if (b == null) "" else (b.mag.toList() + listOf(b.sin, b.cos, b.n.toDouble()))
                .joinToString(",") { "%.4f".format(java.util.Locale.ROOT, it) }
        }

        companion object {
            fun decode(text: String?): Calibration? = runCatching {
                val parts = text!!.split("|")
                require(parts.size == BINS)
                Calibration(parts.map { p ->
                    if (p.isBlank()) null else p.split(",").map { it.toDouble() }.let { v ->
                        require(v.size == 6)
                        Bin(doubleArrayOf(v[0], v[1], v[2]), v[3], v[4], v[5].toInt())
                    }
                })
            }.getOrNull()
        }
    }

    private val bins = arrayOfNulls<Bin>(BINS)
    /** Muda quando a tabela muda: hora de salvar. */
    var changes = 0; private set

    init {
        calibration?.bins?.forEachIndexed { i, b -> if (i < BINS) bins[i] = b }
    }

    val calibration: Calibration get() = Calibration(bins.toList())

    /** Rumo (°) e de onde veio: [SOURCE_GPS] ou [SOURCE_MAG]; null sem nenhum dos dois. */
    var headingDeg: Double? = null; private set
    var source: String? = null; private set
    /** Quanto da volta a bússola já viu (0 a 100%); não precisa chegar a 100, basta [ready]. */
    val progressPct: Int get() = bins.count { it != null && it.n >= BIN_MIN_N } * 100 / BINS
    val ready: Boolean get() = fit() != null

    private var gpsBearing: Double? = null
    private var gpsAt = 0L
    private var gpsGood = false
    private var gpsTurnDps: Double? = null
    private var magHeading: Double? = null
    private var magAt = 0L
    private var cachedFit: Fit? = null
    private var fitDirty = true
    private var disagreeS = 0.0

    /** Plano do campo no módulo (base u1, u2), centro do círculo nele e desvio por faixa. */
    private class Fit(val u1: DoubleArray, val u2: DoubleArray, val cx: Double, val cy: Double, val radius: Double, val dev: DoubleArray, val ok: BooleanArray)

    fun reset() {
        bins.fill(null)
        cachedFit = null
        fitDirty = true
        magHeading = null
        disagreeS = 0.0
        changes++
    }

    /** Nova posição do GPS. */
    fun onGps(t: Long, bearing: Float?, speedKmh: Double?, accuracyM: Float) {
        val good = bearing != null && speedKmh != null && speedKmh >= GPS_MIN_KMH && accuracyM <= GPS_MAX_ACCURACY_M
        if (good) {
            val b = norm(bearing!!.toDouble())
            val prev = gpsBearing
            // Curva pelo próprio GPS, para quem não tem giroscópio
            gpsTurnDps = if (prev != null && gpsGood && t > gpsAt && t - gpsAt <= GPS_FRESH_MS) abs(wrap(b - prev)) * 1000.0 / (t - gpsAt) else null
            gpsBearing = b
            gpsAt = t
        } else if (speedKmh != null && speedKmh >= GPS_MIN_KMH) {
            // Andando sem rumo bom: o último deixa de valer
            gpsBearing = null
            gpsTurnDps = null
        }
        gpsGood = good
    }

    /** Uma leitura do magnetômetro (µT, eixos do módulo) e o giro do carro (°/s, do giroscópio), se houver. */
    fun onMag(t: Long, mag: DoubleArray, yawDps: Double?) {
        val gpsFresh = gpsGood && t - gpsAt <= GPS_FRESH_MS
        val turn = yawDps?.let { abs(it) } ?: gpsTurnDps
        // Aprende: rumo bom do GPS e andando reto (o rumo do GPS atrasa nas curvas)
        val straight = gpsFresh && turn != null && turn < LEARN_MAX_DPS
        val dt = if (magAt == 0L) 1.0 else ((t - magAt) / 1000.0).coerceIn(0.0, 2.0)
        magAt = t
        if (straight) {
            // Leitura longe da média guardada no mesmo rumo: interferência passageira (caminhão, ponte) não entra na
            // tabela; se continuar por DISAGREE_S, o módulo foi mexido e a bússola recomeça
            val fit0 = fit()
            val bin = bins[binOf(gpsBearing!!)]?.takeIf { it.n >= BIN_MIN_N }
            val off = fit0 != null && bin != null &&
                sqrt((0..2).sumOf { (mag[it] - bin.mag[it]).let { x -> x * x } }) > fit0.radius * DISAGREE_FRAC
            if (off) {
                disagreeS += dt
                if (disagreeS > DISAGREE_S) reset()
            } else {
                disagreeS = maxOf(0.0, disagreeS - dt)
                learn(gpsBearing!!, mag)
            }
        }
        val f = fit() ?: run { magHeading = null; return }
        val hx = dot(mag, f.u1) - f.cx
        val hy = dot(mag, f.u2) - f.cy
        if (hx * hx + hy * hy < 1e-6) return
        val raw = norm(Math.toDegrees(atan2(hy, hx)))
        val now = norm(raw + deviation(f, raw))
        val k = 1 - exp(-dt / MAG_TAU_S)
        magHeading = magHeading?.let { norm(it + wrap(now - it) * k) } ?: now
    }

    private fun binOf(bearing: Double) = (bearing / BIN_DEG).toInt().coerceIn(0, BINS - 1)

    /** Escolhe o rumo de agora: GPS bom; senão a bússola; parado, o último do GPS por até [GPS_HOLD_MS]. */
    fun update(now: Long, speedKmh: Double?) {
        val gpsFresh = gpsGood && now - gpsAt <= GPS_FRESH_MS
        val mag = magHeading?.takeIf { now - magAt <= MAG_FRESH_MS }
        val stoppedHold = gpsBearing != null && now - gpsAt <= GPS_HOLD_MS && (speedKmh ?: 0.0) < 1
        when {
            gpsFresh -> { headingDeg = gpsBearing; source = SOURCE_GPS }
            mag != null -> { headingDeg = mag; source = SOURCE_MAG }
            stoppedHold -> { headingDeg = gpsBearing; source = SOURCE_GPS }
            else -> { headingDeg = null; source = null }
        }
    }

    private fun learn(bearing: Double, mag: DoubleArray) {
        val i = binOf(bearing)
        val r = Math.toRadians(bearing)
        val old = bins[i]
        bins[i] = if (old == null) {
            Bin(mag.copyOf(), sin(r), cos(r), 1)
        } else {
            // Média que esquece devagar: o carro muda (som ligado, ventoinha), a tabela acompanha
            val k = 1.0 / minOf(old.n + 1, BIN_MAX_N)
            Bin(DoubleArray(3) { old.mag[it] + (mag[it] - old.mag[it]) * k }, old.sin + (sin(r) - old.sin) * k, old.cos + (cos(r) - old.cos) * k, old.n + 1)
        }
        if (old == null || (old.n + 1) % 10 == 0) { fitDirty = true; changes++ }
    }

    private fun fit(): Fit? {
        if (fitDirty) { cachedFit = computeFit(); fitDirty = false }
        return cachedFit
    }

    /**
     * Plano e círculo pelas faixas. Precisa das quatro direções: com só metade da volta, o centro sai errado.
     * O plano é o dos dois maiores eixos de espalhamento das leituras (o campo da Terra girando com o carro).
     */
    private fun computeFit(): Fit? {
        val pts = bins.mapIndexedNotNull { i, b -> b?.takeIf { it.n >= BIN_MIN_N }?.let { i to it } }
        if (pts.size < MIN_BINS) return null
        val quads = IntArray(4)
        pts.forEach { (i, _) -> quads[(i * BIN_DEG / 90).toInt().coerceIn(0, 3)]++ }
        if (quads.any { it < MIN_PER_QUADRANT }) return null

        val mean = DoubleArray(3) { k -> pts.sumOf { it.second.mag[k] } / pts.size }
        val cov = Array(3) { DoubleArray(3) }
        for ((_, b) in pts) {
            val d = DoubleArray(3) { b.mag[it] - mean[it] }
            for (r in 0..2) for (c in 0..2) cov[r][c] += d[r] * d[c] / pts.size
        }
        val u1 = principal(cov) ?: return null
        // Segundo eixo: o maior espalhamento que sobra, perpendicular ao primeiro
        val l1 = quad(cov, u1)
        val defl = Array(3) { r -> DoubleArray(3) { c -> cov[r][c] - l1 * u1[r] * u1[c] } }
        var u2 = principal(defl)?.let { v -> unit(minus(v, times(u1, dot(v, u1)))) } ?: return null
        if (quad(cov, u2) < 1.0) return null   // quase sem giro: não é um círculo

        fun solve(u2: DoubleArray): Pair<DoubleArray, Double>? {
            // Círculo x² + y² + D·x + E·y + F = 0 (mínimos quadrados, Kåsa)
            val m = Array(3) { DoubleArray(3) }
            val v = DoubleArray(3)
            for ((_, b) in pts) {
                val x = dot(b.mag, u1)
                val y = dot(b.mag, u2)
                val row = doubleArrayOf(x, y, 1.0)
                val rhs = -(x * x + y * y)
                for (r in 0..2) { for (c in 0..2) m[r][c] += row[r] * row[c]; v[r] += row[r] * rhs }
            }
            val sol = solve3(m, v) ?: return null
            return doubleArrayOf(-sol[0] / 2, -sol[1] / 2) to sol[2]
        }
        var (c, f) = solve(u2) ?: return null
        val r2 = c[0] * c[0] + c[1] * c[1] - f
        if (r2 <= 1.0) return null
        fun raw(b: Bin, u2: DoubleArray, c: DoubleArray) = norm(Math.toDegrees(atan2(dot(b.mag, u2) - c[1], dot(b.mag, u1) - c[0])))
        // Sentido: o ângulo da bússola tem que crescer junto com o rumo do GPS; se diminui, inverte o segundo eixo
        var turn = 0.0
        for (j in pts.indices) {
            val a = pts[j].second
            val b = pts[(j + 1) % pts.size].second
            turn += wrap(raw(b, u2, c) - raw(a, u2, c))
        }
        if (turn < 0) {
            u2 = times(u2, -1.0)
            c = doubleArrayOf(c[0], -c[1])
        }
        val dev = DoubleArray(BINS)
        val ok = BooleanArray(BINS)
        for ((i, b) in pts) {
            dev[i] = wrap(norm(Math.toDegrees(atan2(b.sin, b.cos))) - raw(b, u2, c))
            ok[i] = true
        }
        return Fit(u1, u2, c[0], c[1], sqrt(r2), dev, ok)
    }

    /** Desvio para um rumo cru da bússola. A tabela é por rumo verdadeiro: uma segunda passada acerta a faixa. */
    private fun deviation(f: Fit, raw: Double): Double {
        val d = devAt(f, raw)
        return devAt(f, raw + d)
    }

    /** Desvio num rumo, interpolado entre os centros das faixas vizinhas que têm leitura. */
    private fun devAt(f: Fit, bearing: Double): Double {
        val pos = norm(bearing) / BIN_DEG - 0.5
        var lo = floor(pos).toInt()
        var steps = 0
        while (!f.ok[Math.floorMod(lo, BINS)] && steps++ < BINS) lo--
        var hi = floor(pos).toInt() + 1
        steps = 0
        while (!f.ok[Math.floorMod(hi, BINS)] && steps++ < BINS) hi++
        val a = f.dev[Math.floorMod(lo, BINS)]
        val b = f.dev[Math.floorMod(hi, BINS)]
        val w = if (hi == lo) 0.0 else ((pos - lo) / (hi - lo)).coerceIn(0.0, 1.0)
        return a + wrap(b - a) * w
    }

    companion object {
        const val SOURCE_GPS = "gps"
        const val SOURCE_MAG = "mag"
        const val BIN_DEG = 10.0
        const val BINS = 36
        const val BIN_MIN_N = 5
        const val BIN_MAX_N = 200
        const val MIN_BINS = 12
        const val MIN_PER_QUADRANT = 2
        const val GPS_MIN_KMH = 12.0
        const val GPS_MAX_ACCURACY_M = 25f
        const val GPS_FRESH_MS = 3000L
        const val GPS_HOLD_MS = 120_000L
        const val MAG_FRESH_MS = 3000L
        const val MAG_TAU_S = 0.6
        const val LEARN_MAX_DPS = 3.0
        /** Leitura a mais de metade do raio da média da faixa, por [DISAGREE_S] andando reto: o módulo mudou. */
        const val DISAGREE_FRAC = 0.5
        const val DISAGREE_S = 30.0

        /** Pontos cardeais e colaterais em português (N, NE, L, SE, S, SO, O, NO). */
        fun cardinal(deg: Double): String = listOf("N", "NE", "L", "SE", "S", "SO", "O", "NO")[Math.floorMod(Math.round(norm(deg) / 45.0).toInt(), 8)]

        fun norm(d: Double): Double { val r = d % 360.0; return if (r < 0) r + 360.0 else r }
        /** Diferença de ângulos entre −180 e 180. */
        fun wrap(d: Double): Double { val r = norm(d); return if (r > 180) r - 360 else r }

        private fun dot(a: DoubleArray, b: DoubleArray) = a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
        private fun times(a: DoubleArray, k: Double) = DoubleArray(3) { a[it] * k }
        private fun minus(a: DoubleArray, b: DoubleArray) = DoubleArray(3) { a[it] - b[it] }
        private fun unit(a: DoubleArray): DoubleArray { val l = sqrt(dot(a, a)); return if (l < 1e-12) a else times(a, 1 / l) }
        private fun quad(m: Array<DoubleArray>, v: DoubleArray) = (0..2).sumOf { r -> v[r] * (0..2).sumOf { c -> m[r][c] * v[c] } }

        /** Maior eixo de uma matriz simétrica (iteração de potência). */
        private fun principal(m: Array<DoubleArray>): DoubleArray? {
            var v = doubleArrayOf(0.577, 0.577, 0.577)
            // Começa pela coluna mais forte: evita partir justo perpendicular ao eixo procurado
            val col = (0..2).maxBy { c -> (0..2).sumOf { r -> m[r][c] * m[r][c] } }
            if ((0..2).sumOf { r -> m[r][col] * m[r][col] } > 1e-12) v = unit(DoubleArray(3) { m[it][col] })
            repeat(60) {
                val w = DoubleArray(3) { r -> (0..2).sumOf { c -> m[r][c] * v[c] } }
                val l = sqrt(dot(w, w))
                if (l < 1e-12) return null
                v = times(w, 1 / l)
            }
            return v
        }

        private fun solve3(a: Array<DoubleArray>, b: DoubleArray): DoubleArray? {
            val m = Array(3) { r -> DoubleArray(4) { c -> if (c < 3) a[r][c] else b[r] } }
            for (c in 0..2) {
                val p = (c..2).maxBy { abs(m[it][c]) }
                if (abs(m[p][c]) < 1e-12) return null
                val tmp = m[c]; m[c] = m[p]; m[p] = tmp
                for (r in 0..2) if (r != c) {
                    val f = m[r][c] / m[c][c]
                    for (k in c..3) m[r][k] -= f * m[c][k]
                }
            }
            return DoubleArray(3) { m[it][3] / m[it][it] }
        }
    }
}

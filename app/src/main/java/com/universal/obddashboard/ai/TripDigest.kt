package com.universal.obddashboard.ai

import com.universal.obddashboard.db.TelemetryLogEntity
import com.universal.obddashboard.db.TripEntity
import com.universal.obddashboard.obd.VehicleProfile
import java.util.Locale
import kotlin.math.abs
import kotlin.math.max
import kotlin.math.min

/**
 * "Analisar viagem com IA": resume a viagem no celular e só o resumo sai. As amostras têm GPS,
 * mas daqui só sai velocidade, rotação, temperaturas, consumo e tempos (nunca coordenadas,
 * horário ou VIN). Velocidade da ECU × obd_speed_factor (calibrada no hodômetro), GPS na falta dela.
 */
object TripDigest {

    data class Segment(val fromKm: Double, val toKm: Double, val kmPerL: Double?, val avgSpeedKmh: Double, val avgRpm: Double?)

    data class Digest(
        val distanceKm: Double,
        val durationMin: Double,
        val movingMin: Double,
        val idleMin: Double,
        val avgMovingSpeedKmh: Double?,
        val maxSpeedKmh: Double,
        /** % do tempo em movimento por faixa de velocidade (chave: rótulo). */
        val speedBands: Map<String, Double>,
        val avgRpm: Double?,
        val maxRpm: Double,
        val rpmBands: Map<String, Double>,
        /** % do tempo em movimento em cada marcha estimada (1..n). */
        val gearPct: Map<Int, Double>,
        val avgThrottlePct: Double?,
        val coolantMinC: Double?,
        val coolantMaxC: Double?,
        val coolantAvgC: Double?,
        val intakeAvgC: Double?,
        val voltageMin: Double?,
        val voltageMax: Double?,
        val fuelUsedL: Double,
        val idleFuelL: Double,
        val kmPerL: Double?,
        val segments: List<Segment>,
        val dtcCodes: List<String>,
    )

    private const val MAX_GAP_S = 10.0
    private const val MOVING_KMH = 2.0
    private val SPEED_BANDS = listOf(0.0 to 40.0, 40.0 to 80.0, 80.0 to 100.0, 100.0 to 120.0, 120.0 to Double.MAX_VALUE)
    private val RPM_BANDS = listOf(0.0 to 1500.0, 1500.0 to 2500.0, 2500.0 to 3500.0, 3500.0 to 4500.0, 4500.0 to Double.MAX_VALUE)

    private fun bandLabel(b: Pair<Double, Double>, unit: String) =
        if (b.second == Double.MAX_VALUE) "acima de ${b.first.toInt()} $unit" else "${b.first.toInt()}–${b.second.toInt()} $unit"

    fun compute(trip: TripEntity, samples: List<TelemetryLogEntity>, profile: VehicleProfile, dtcCodes: List<String> = emptyList()): Digest {
        val factor = profile.obdSpeedFactor
        val ratios = profile.shiftIndicator?.gearKmhPer1000Rpm.orEmpty()
        val tolerance = profile.shiftIndicator?.gearMatchTolerance ?: 0.12
        fun speedOf(s: TelemetryLogEntity) = s.speedObdKmh?.times(factor) ?: s.speedGpsKmh

        var total = 0.0; var moving = 0.0; var idle = 0.0
        var distance = 0.0; var fuel = 0.0; var idleFuel = 0.0
        var rpmSum = 0.0; var rpmT = 0.0; var thrSum = 0.0; var thrT = 0.0
        var coolSum = 0.0; var coolT = 0.0; var iatSum = 0.0; var iatT = 0.0
        val speedBand = DoubleArray(SPEED_BANDS.size)
        val rpmBand = DoubleArray(RPM_BANDS.size)
        val gearT = DoubleArray(ratios.size)
        // marcos de distância/combustível para os trechos
        val marks = ArrayList<DoubleArray>() // [dist, fuel, time, rpmSum, rpmT]

        for (i in 1 until samples.size) {
            val a = samples[i - 1]
            val b = samples[i]
            val dt = (b.timestamp - a.timestamp) / 1000.0
            if (dt <= 0 || dt > MAX_GAP_S) continue
            total += dt
            val v = speedOf(b) ?: speedOf(a) ?: 0.0
            val rpm = b.rpm
            distance += v * dt / 3600.0
            val lph = b.fuelLph
            if (lph != null && lph.isFinite()) fuel += lph * dt / 3600.0
            if (v >= MOVING_KMH) {
                moving += dt
                speedBand[SPEED_BANDS.indexOfFirst { v >= it.first && v < it.second }] += dt
                if (rpm != null && rpm >= 900 && ratios.isNotEmpty()) {
                    val r = v / (rpm / 1000.0)
                    val best = ratios.indices.minBy { abs(r - ratios[it]) / ratios[it] }
                    if (abs(r - ratios[best]) / ratios[best] <= tolerance) gearT[best] += dt
                }
            } else if (rpm != null && rpm > 300) {
                idle += dt
                if (lph != null && lph.isFinite()) idleFuel += lph * dt / 3600.0
            }
            if (rpm != null && rpm > 300) {
                rpmSum += rpm * dt; rpmT += dt
                rpmBand[RPM_BANDS.indexOfFirst { rpm >= it.first && rpm < it.second }] += dt
            }
            b.throttlePct?.let { thrSum += it * dt; thrT += dt }
            b.coolantC?.let { coolSum += it * dt; coolT += dt }
            b.intakeC?.let { iatSum += it * dt; iatT += dt }
            marks += doubleArrayOf(distance, fuel, total, rpmSum, rpmT)
        }

        val coolants = samples.mapNotNull { it.coolantC }
        val volts = samples.mapNotNull { it.voltage }.filter { it > 5 }
        val dist = if (trip.distanceKm > 0) trip.distanceKm else distance
        val scale = if (distance > 0) dist / distance else 1.0

        fun pct(arr: DoubleArray, base: Double) = if (base <= 0) emptyMap() else arr.withIndex().associate { it.index to it.value * 100 / base }

        return Digest(
            distanceKm = dist,
            durationMin = ((trip.endTime ?: samples.lastOrNull()?.timestamp ?: trip.startTime) - trip.startTime) / 60000.0,
            movingMin = moving / 60, idleMin = idle / 60,
            avgMovingSpeedKmh = if (moving > 0) distance / (moving / 3600.0) else null,
            maxSpeedKmh = max(trip.maxSpeedKmh, samples.maxOfOrNull { speedOf(it) ?: 0.0 } ?: 0.0),
            speedBands = pct(speedBand, moving).mapKeys { bandLabel(SPEED_BANDS[it.key], "km/h") },
            avgRpm = if (rpmT > 0) rpmSum / rpmT else null,
            maxRpm = max(trip.maxRpm, samples.maxOfOrNull { it.rpm ?: 0.0 } ?: 0.0),
            rpmBands = pct(rpmBand, rpmT).mapKeys { bandLabel(RPM_BANDS[it.key], "rpm") },
            gearPct = pct(gearT, moving).mapKeys { it.key + 1 },
            avgThrottlePct = if (thrT > 0) thrSum / thrT else null,
            coolantMinC = coolants.minOrNull(), coolantMaxC = coolants.maxOrNull(),
            coolantAvgC = if (coolT > 0) coolSum / coolT else null,
            intakeAvgC = if (iatT > 0) iatSum / iatT else null,
            voltageMin = volts.minOrNull(), voltageMax = volts.maxOrNull(),
            fuelUsedL = if (fuel > 0) fuel else trip.fuelUsedL,
            idleFuelL = idleFuel,
            kmPerL = (if (fuel > 0) fuel else trip.fuelUsedL).takeIf { it > 0.05 }?.let { dist / it },
            segments = segments(marks, scale, dist),
            dtcCodes = dtcCodes.distinct(),
        )
    }

    /** Até 8 trechos de mesma distância (mínimo 5 km cada): consumo, velocidade e giro médios. */
    private fun segments(marks: List<DoubleArray>, scale: Double, dist: Double): List<Segment> {
        if (marks.isEmpty() || dist < 10) return emptyList()
        val n = min(8, max(2, (dist / 5).toInt()))
        val raw = marks.last()[0]
        val out = ArrayList<Segment>()
        var prev = doubleArrayOf(0.0, 0.0, 0.0, 0.0, 0.0)
        for (k in 1..n) {
            val target = raw * k / n
            val m = marks.firstOrNull { it[0] >= target } ?: marks.last()
            val dKm = (m[0] - prev[0]) * scale
            val dL = m[1] - prev[1]
            val dT = m[2] - prev[2]
            val dRpmT = m[4] - prev[4]
            out += Segment(
                fromKm = prev[0] * scale, toKm = m[0] * scale,
                kmPerL = if (dL > 0.05) dKm / dL else null,
                avgSpeedKmh = if (dT > 0) (m[0] - prev[0]) / (dT / 3600.0) else 0.0,
                avgRpm = if (dRpmT > 0) (m[3] - prev[3]) / dRpmT else null,
            )
            prev = m
        }
        return out
    }

    const val SYSTEM = "Você é um especialista em mecânica e condução econômica que analisa viagens para o dono do carro, " +
        "em português do Brasil. Use só os números fornecidos (não invente dados). Responda em no máximo 300 palavras, " +
        "em texto simples (sem tabelas), com estas partes: 1) Resumo da viagem; 2) Consumo: o que mais influenciou, citando " +
        "os números; 3) Condução e uso das marchas; 4) Saúde do motor (temperatura, bateria, falhas), dizendo se algo merece " +
        "atenção; 5) Duas ou três dicas práticas para a próxima viagem. O consumo e a marcha são estimados pelo app."

    private fun f(v: Double?, d: Int = 0) = v?.let { String.format(Locale("pt", "BR"), "%.${d}f", it) } ?: "--"

    fun text(d: Digest, profile: VehicleProfile, ethanolPct: Double): String = buildString {
        appendLine("Veículo: ${profile.vehicleName}${profile.modelYear?.let { " ($it)" } ?: ""}")
        if (profile.engine.isNotBlank()) appendLine("Motor: ${profile.engine}")
        profile.fuel?.let { appendLine("Tanque: ${f(it.tankCapacityL)} L; combustível configurado no app hoje: ${f(ethanolPct)}% etanol (0% = gasolina C)") }
        if (profile.shiftIndicator?.gearKmhPer1000Rpm?.isNotEmpty() == true) {
            appendLine("Relações (km/h a cada 1000 rpm): ${profile.shiftIndicator.gearKmhPer1000Rpm.joinToString(" / ") { f(it, 1) }}")
        }
        appendLine()
        appendLine("Distância: ${f(d.distanceKm, 1)} km em ${f(d.durationMin)} min (em movimento ${f(d.movingMin)} min, parado com motor ligado ${f(d.idleMin)} min)")
        appendLine("Velocidade média em movimento: ${f(d.avgMovingSpeedKmh)} km/h; máxima ${f(d.maxSpeedKmh)} km/h")
        if (d.speedBands.isNotEmpty()) appendLine("Tempo em movimento por velocidade: " + d.speedBands.entries.joinToString("; ") { "${it.key} ${f(it.value)}%" })
        appendLine("Rotação média ${f(d.avgRpm)} rpm, máxima ${f(d.maxRpm)} rpm")
        if (d.rpmBands.isNotEmpty()) appendLine("Tempo por rotação: " + d.rpmBands.entries.joinToString("; ") { "${it.key} ${f(it.value)}%" })
        if (d.gearPct.isNotEmpty()) appendLine("Tempo em movimento por marcha estimada: " + d.gearPct.entries.joinToString("; ") { "${it.key}ª ${f(it.value)}%" } + " (o restante: embreagem/ponto morto)")
        d.avgThrottlePct?.let { appendLine("Acelerador médio: ${f(it)}%") }
        appendLine("Combustível estimado: ${f(d.fuelUsedL, 1)} L (${f(d.kmPerL, 1)} km/l); parado com motor ligado: ${f(d.idleFuelL, 2)} L")
        if (d.segments.isNotEmpty()) {
            appendLine("Trechos:")
            d.segments.forEach { s ->
                appendLine("- km ${f(s.fromKm)}–${f(s.toKm)}: ${f(s.kmPerL, 1)} km/l, ${f(s.avgSpeedKmh)} km/h de média, ${f(s.avgRpm)} rpm")
            }
        }
        appendLine("Temperatura do motor: mínima ${f(d.coolantMinC)} °C, média ${f(d.coolantAvgC)} °C, máxima ${f(d.coolantMaxC)} °C")
        profile.thermal?.let { appendLine("Referências do motor: termostato abre ~${f(it.thermostatOpenC)} °C; ventoinha ${f(it.fanStage1C)} °C; crítico ${f(it.criticalC)} °C") }
        d.intakeAvgC?.let { appendLine("Ar admitido médio: ${f(it)} °C") }
        if (d.voltageMin != null) appendLine("Tensão elétrica: mínima ${f(d.voltageMin, 1)} V, máxima ${f(d.voltageMax, 1)} V")
        appendLine(if (d.dtcCodes.isEmpty()) "Códigos de falha na viagem: nenhum" else "Códigos de falha na viagem: ${d.dtcCodes.joinToString(", ")}")
        append("Analise esta viagem.")
    }

    fun messages(d: Digest, profile: VehicleProfile, ethanolPct: Double) = listOf(
        AiClient.Message("system", SYSTEM),
        AiClient.Message("user", text(d, profile, ethanolPct)),
    )
}

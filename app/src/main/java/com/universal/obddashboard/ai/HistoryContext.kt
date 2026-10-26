package com.universal.obddashboard.ai

import com.universal.obddashboard.db.DiagnosticTroubleCodeEntity
import com.universal.obddashboard.db.FuelUpEntity
import com.universal.obddashboard.db.TripEntity
import com.universal.obddashboard.fuel.FuelLog
import com.universal.obddashboard.obd.VehicleProfile
import java.time.Instant
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.util.Locale

/**
 * "Perguntar à IA": o histórico do carro em texto, montado no celular. Sai só o agregado por viagem
 * e por abastecimento, com a data (sem horário). Nunca saem GPS, VIN, nome do posto nem
 * observações (podem conter lugares).
 */
object HistoryContext {

    data class Turn(val role: String, val content: String)

    const val MAX_TRIPS = 40
    const val MAX_TURNS = 6
    const val MAX_TURN_CHARS = 2000
    const val MAX_QUESTION_CHARS = 1000

    const val SYSTEM = "Você é um assistente que responde perguntas do dono sobre o próprio carro, em português do Brasil, " +
        "usando só os dados do histórico abaixo (viagens e consumo estimados pelo app; abastecimentos reais informados pelo dono). " +
        "Seja direto e mostre as contas quando calcular algo. Se os dados não bastarem para responder, diga o que falta. " +
        "Para dúvidas mecânicas, lembre que o diagnóstico deve ser confirmado por um mecânico. Responda em no máximo 300 palavras."

    private val pt = Locale("pt", "BR")
    private fun f(v: Double?, d: Int = 0) = v?.takeIf { it.isFinite() }?.let { String.format(pt, "%.${d}f", it) } ?: "--"

    fun text(
        profile: VehicleProfile,
        trips: List<TripEntity>,
        fuelUps: List<FuelUpEntity>,
        dtcs: List<DiagnosticTroubleCodeEntity>,
        ethanolPct: Double,
        fuelLevelL: Double?,
        odometerKm: Double?,
        zone: ZoneId = ZoneId.systemDefault(),
    ): String = buildString {
        val day = DateTimeFormatter.ofPattern("dd/MM/yyyy").withZone(zone)
        fun date(ms: Long) = day.format(Instant.ofEpochMilli(ms))

        appendLine("## Veículo")
        appendLine("${profile.vehicleName}${profile.modelYear?.let { " ($it)" } ?: ""}${if (profile.engine.isNotBlank()) " · ${profile.engine}" else ""}")
        profile.fuel?.let { appendLine("Tanque de ${f(it.tankCapacityL)} L; nível estimado agora ${f(fuelLevelL, 1)} L; combustível no tanque ${f(ethanolPct)}% etanol (0% = gasolina C)") }
        odometerKm?.let { appendLine("Hodômetro estimado: ${f(it)} km") }

        appendLine()
        val recent = trips.sortedByDescending { it.startTime }.take(MAX_TRIPS)
        appendLine("## Viagens gravadas (${recent.size} mais recentes de ${trips.size}; consumo estimado pelo app)")
        recent.forEach { t ->
            val min = t.endTime?.let { (it - t.startTime) / 60000.0 }
            val kml = if (t.fuelUsedL > 0.05) t.distanceKm / t.fuelUsedL else null
            appendLine(
                "- ${date(t.startTime)}: ${f(t.distanceKm, 1)} km, ${f(min)} min, ${f(t.fuelUsedL, 1)} L (${f(kml, 1)} km/l), " +
                    "vel. máx ${f(t.maxSpeedKmh)} km/h, rpm máx ${f(t.maxRpm)}, temp. máx ${f(t.maxCoolantC)} °C, tensão mín ${f(t.minVoltage, 1)} V",
            )
        }
        if (trips.isNotEmpty()) appendLine("Total gravado: ${f(trips.sumOf { it.distanceKm })} km, ${f(trips.sumOf { it.fuelUsedL }, 1)} L estimados")

        appendLine()
        appendLine("## Abastecimentos (informados pelo dono)")
        if (fuelUps.isEmpty()) appendLine("Nenhum registrado.")
        fuelUps.sortedBy { it.timestamp }.forEach { u ->
            appendLine(
                "- ${date(u.timestamp)}: ${f(u.liters, 2)} L de ${FUEL_NAMES[u.fuelType] ?: u.fuelType}${u.ethanolPct?.let { " (${f(it)}% etanol)" } ?: ""}, " +
                    "R$ ${f(u.totalPrice, 2)} (R$ ${f(u.pricePerLiter, 3)}/L), hodômetro ${f(u.odometerKm, 1)} km, ${if (u.fullTank) "tanque cheio" else "parcial"}",
            )
        }
        if (fuelUps.isNotEmpty()) {
            val s = FuelLog.summary(fuelUps, zone)
            appendLine("Consumo real entre tanques cheios:")
            s.intervals.forEach { iv ->
                appendLine("- ${date(iv.from.timestamp)} a ${date(iv.to.timestamp)}: ${f(iv.distanceKm, 1)} km, ${f(iv.liters, 2)} L, ${f(iv.kmPerL, 2)} km/l, R$ ${f(iv.costPerKm, 2)}/km, ${FUEL_NAMES[iv.fuelType] ?: iv.fuelType}")
            }
            appendLine("Média real: ${f(s.avgKmPerL, 2)} km/l; custo R$ ${f(s.costPerKm, 2)}/km; gasto total R$ ${f(s.totalCost, 2)}")
            appendLine("Gasto por mês: " + s.costByMonth.entries.joinToString("; ") { "${it.key}: R$ ${f(it.value, 2)}" })
            s.ethanolBreakEven?.let { appendLine("Etanol compensa abaixo de ${f(it * 100)}% do preço da gasolina (medido neste carro)") }
        }

        appendLine()
        appendLine("## Códigos de falha registrados")
        if (dtcs.isEmpty()) appendLine("Nenhum.")
        dtcs.groupBy { it.code to it.kind }.forEach { (key, list) ->
            val desc = profile.describeDtc(key.first)?.let { " ($it)" } ?: ""
            appendLine("- ${key.first}$desc, ${if (key.second == "PENDING") "pendente" else "confirmado"}: ${list.size}× (última em ${date(list.maxOf { it.detectedAt })})")
        }
    }

    private val FUEL_NAMES = mapOf(
        FuelLog.GASOLINE to "gasolina", FuelLog.GASOLINE_PREMIUM to "gasolina aditivada",
        FuelLog.ETHANOL to "etanol", FuelLog.MIX to "mistura",
    )

    /** Histórico da conversa vindo da tela: só papéis user/assistant, limitado em quantidade e tamanho. */
    fun sanitize(turns: List<Turn>): List<Turn> = turns
        .filter { it.role == "user" || it.role == "assistant" }
        .takeLast(MAX_TURNS)
        .map { it.copy(content = it.content.take(MAX_TURN_CHARS)) }

    fun messages(context: String, history: List<Turn>, question: String): List<AiClient.Message> {
        val q = question.trim().take(MAX_QUESTION_CHARS)
        require(q.isNotEmpty()) { "Escreva uma pergunta" }
        return listOf(AiClient.Message("system", SYSTEM + "\n\n# Histórico do carro\n" + context)) +
            sanitize(history).map { AiClient.Message(it.role, it.content) } +
            AiClient.Message("user", q)
    }
}

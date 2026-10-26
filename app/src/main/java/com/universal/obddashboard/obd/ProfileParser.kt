package com.universal.obddashboard.obd

import android.content.Context
import com.universal.obddashboard.AppSettings
import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json
import java.io.File
import kotlin.math.abs
import kotlin.math.ceil
import kotlin.math.floor
import kotlin.math.pow
import kotlin.math.round
import kotlin.math.sqrt

// =====================================================================================
//  Modelo do perfil JSON (assets/profiles/*.json ou <filesDir>/profiles/*.json)
// =====================================================================================

@Serializable
data class VehicleProfile(
    @SerialName("schema_version") val schemaVersion: Int = 1,
    @SerialName("profile_id") val profileId: String,
    @SerialName("vehicle_name") val vehicleName: String,
    @SerialName("model_year") val modelYear: Int? = null,
    @SerialName("ecu_model") val ecuModel: String = "",
    val engine: String = "",
    val protocol: String = "AUTO",
    @SerialName("init_commands") val initCommands: List<String>,
    val adapter: AdapterSettings = AdapterSettings(),
    val lanes: Map<String, LaneSettings> = DEFAULT_LANES,
    val roles: Roles = Roles(),
    val pids: Map<String, List<PidDefinition>>,
    val alerts: List<AlertRule> = emptyList(),
    val dashboard: DashboardSettings = DashboardSettings(),
    val thermal: ThermalSettings? = null,
    val fuel: FuelSettings? = null,
    @SerialName("shift_indicator") val shiftIndicator: ShiftIndicatorSettings? = null,
    @SerialName("power_management") val powerManagement: PowerSettings = PowerSettings(),
    @SerialName("telemetry_log_interval_ms") val telemetryLogIntervalMs: Long = 2000,
    /**
     * Fator sobre a velocidade da ECU para a distância sem GPS, para bater com o hodômetro do carro
     * (pneus fora da medida original ou calibração do sensor de velocidade). Não muda a velocidade exibida.
     */
    @SerialName("obd_speed_factor") val obdSpeedFactor: Double = 1.0,
    /** Descrição de códigos de falha específicos do veículo/ECU, ex.: {"P0130": "Sonda lambda pré-catalisador"}. */
    @SerialName("dtc_descriptions") val dtcDescriptions: Map<String, String> = emptyMap(),
) {
    /** Descrição do código (sem diferenciar maiúsculas), ou null se o perfil não a define. */
    fun describeDtc(code: String): String? = dtcDescriptions[code.uppercase()] ?: dtcDescriptions[code]

    companion object {
        val DEFAULT_LANES = mapOf(
            "high_frequency" to LaneSettings(intervalMs = 100, priority = 0),
            "medium_frequency" to LaneSettings(intervalMs = 1500, priority = 1),
            "diagnostics" to LaneSettings(intervalMs = 10_000, priority = 2, throttleWhenIdle = false),
        )
    }
}

@Serializable
data class AdapterSettings(
    @SerialName("device_names") val deviceNames: List<String> = listOf("OBDII", "OBD2", "OBD-II", "V-LINK"),
    @SerialName("response_timeout_ms") val responseTimeoutMs: Long = 1000,
    @SerialName("dtc_timeout_ms") val dtcTimeoutMs: Long = 2500,
    @SerialName("at_timeout_ms") val atTimeoutMs: Long = 1500,
    @SerialName("reset_timeout_ms") val resetTimeoutMs: Long = 4000,
    @SerialName("search_timeout_ms") val searchTimeoutMs: Long = 8000,
    /** Acrescenta o nº de respostas esperadas ("010C1"): o ELM327 devolve sem esperar o timeout. */
    @SerialName("append_response_count") val appendResponseCount: Boolean = false,
    @SerialName("query_supported_pids") val querySupportedPids: Boolean = true,
    @SerialName("min_command_gap_ms") val minCommandGapMs: Long = 0,
    @SerialName("max_consecutive_no_data") val maxConsecutiveNoData: Int = 5,
    @SerialName("max_consecutive_timeouts") val maxConsecutiveTimeouts: Int = 4,
)

@Serializable
data class LaneSettings(
    @SerialName("interval_ms") val intervalMs: Long,
    /** Desempate do escalonador: menor = mais prioritário. */
    val priority: Int = 1,
    /** Se true, o intervalo é multiplicado por power_management.idle_poll_multiplier em modo ocioso. */
    @SerialName("throttle_when_idle") val throttleWhenIdle: Boolean = true,
)

/** Mapeia papéis semânticos (usados por consumo, viagem, freeze frame) para os ids das saídas do perfil. */
@Serializable
data class Roles(
    val rpm: String? = "rpm",
    val speed: String? = "speed",
    val throttle: String? = "throttle",
    val map: String? = "map",
    val maf: String? = null,
    @SerialName("coolant_temp") val coolantTemp: String? = "coolant_temp",
    @SerialName("intake_temp") val intakeTemp: String? = "intake_temp",
    @SerialName("battery_volts") val batteryVolts: String? = "battery_volts",
    @SerialName("timing_advance") val timingAdvance: String? = "timing_advance",
    @SerialName("engine_load") val engineLoad: String? = "engine_load",
    val stft: String? = "stft_b1",
    val ltft: String? = "ltft_b1",
    @SerialName("lambda_voltage") val lambdaVoltage: String? = "lambda_b1s1_v",
    @SerialName("mil_on") val milOn: String? = "mil_on",
    @SerialName("dtc_count") val dtcCount: String? = "dtc_count",
)

@Serializable
data class PidDefinition(
    val id: String,
    val name: String = id,
    val command: String,
    /** Fórmula de saída única (id = [id]). Variáveis A..Z = bytes de dados da resposta. */
    val formula: String? = null,
    val unit: String = "",
    val decimals: Int = 0,
    val min: Double? = null,
    val max: Double? = null,
    /** Nº mínimo de bytes de dados esperados (validação de resposta truncada). */
    val bytes: Int? = null,
    /** "formula" | "dtc" | "elm_voltage" */
    val decoder: String = "formula",
    /** Saídas múltiplas a partir de uma mesma resposta (ex.: 0101 → mil_on + dtc_count). */
    val outputs: List<OutputDefinition> = emptyList(),
    @SerialName("dtc_kind") val dtcKind: String? = null,
    @SerialName("fallback_command") val fallbackCommand: String? = null,
    @SerialName("fallback_decoder") val fallbackDecoder: String? = null,
    @SerialName("fallback_formula") val fallbackFormula: String? = null,
)

@Serializable
data class OutputDefinition(
    val id: String,
    val name: String = id,
    val formula: String,
    val unit: String = "",
    val decimals: Int = 0,
    val min: Double? = null,
    val max: Double? = null,
    /** Valor interno (ex.: bytes dos monitores de prontidão): não aparece na lista de sensores. */
    val hidden: Boolean = false,
)

@Serializable
data class AlertRule(
    val id: String,
    /** "info" | "warning" | "critical" */
    val level: String = "warning",
    /** Expressão booleana sobre os ids das saídas, ex.: "coolant_temp > 105 && rpm > 0". */
    val condition: String,
    /** Texto com placeholders {id}, ex.: "Motor a {coolant_temp} °C". */
    val message: String,
    /** Tempo que a condição deve permanecer verdadeira antes de disparar (debounce). */
    @SerialName("sustain_ms") val sustainMs: Long = 0,
    /** Emite notificação/aviso no carro quando disparar. */
    val notify: Boolean = true,
)

@Serializable
data class DashboardSettings(
    @SerialName("rpm_max") val rpmMax: Double = 7000.0,
    @SerialName("rpm_redline") val rpmRedline: Double = 6000.0,
    @SerialName("speed_max") val speedMax: Double = 200.0,
    @SerialName("voltage_min") val voltageMin: Double = 11.0,
    @SerialName("voltage_max") val voltageMax: Double = 15.5,
)

@Serializable
data class ThermalSettings(
    @SerialName("thermostat_open_c") val thermostatOpenC: Double,
    @SerialName("fan_stage1_c") val fanStage1C: Double,
    @SerialName("fan_stage2_c") val fanStage2C: Double,
    @SerialName("critical_c") val criticalC: Double,
)

@Serializable
data class FuelSettings(
    @SerialName("tank_capacity_l") val tankCapacityL: Double,
    @SerialName("reserve_min_l") val reserveMinL: Double = 0.0,
    @SerialName("reserve_max_l") val reserveMaxL: Double = 0.0,
    /** "speed_density" (MAP + RPM + IAT) ou "maf" (sensor de massa de ar). */
    val method: String = "speed_density",
    @SerialName("displacement_l") val displacementL: Double = 1.0,
    @SerialName("volumetric_efficiency") val volumetricEfficiency: Double = 0.80,
    /** Expressão que identifica o corte de injeção em desaceleração (consumo = 0), ex.: "rpm > 1500 && map < 28". */
    @SerialName("decel_fuel_cut_condition") val decelFuelCutCondition: String? = null,
    val gasoline: FuelType = FuelType("Gasolina", 14.7, 745.0),
    val ethanol: FuelType? = null,
    @SerialName("default_ethanol_pct") val defaultEthanolPct: Double = 0.0,
)

@Serializable
data class FuelType(
    val name: String,
    val afr: Double,
    @SerialName("density_g_per_l") val densityGPerL: Double,
)

@Serializable
data class ShiftIndicatorSettings(
    @SerialName("upshift_speeds_kmh") val upshiftSpeedsKmh: List<Double>,
    /** Opcional: km/h a cada 1000 RPM em cada marcha, para inferir a marcha engatada. */
    @SerialName("gear_kmh_per_1000rpm") val gearKmhPer1000Rpm: List<Double> = emptyList(),
    @SerialName("gear_match_tolerance") val gearMatchTolerance: Double = 0.12,
    @SerialName("upshift_rpm_hint") val upshiftRpmHint: Double = 2500.0,
    @SerialName("max_tps_for_hint_pct") val maxTpsForHintPct: Double = 60.0,
)

@Serializable
data class PowerSettings(
    @SerialName("idle_timeout_s") val idleTimeoutS: Long = 300,
    @SerialName("idle_confirm_timeout_s") val idleConfirmTimeoutS: Long = 60,
    @SerialName("obd_idle_speed_kmh") val obdIdleSpeedKmh: Double = 1.0,
    @SerialName("gps_idle_speed_kmh") val gpsIdleSpeedKmh: Double = 4.0,
    @SerialName("idle_poll_multiplier") val idlePollMultiplier: Double = 5.0,
    @SerialName("ecu_silence_timeout_s") val ecuSilenceTimeoutS: Long = 60,
    @SerialName("initial_connect_attempts") val initialConnectAttempts: Int = 6,
    @SerialName("reconnect_attempts") val reconnectAttempts: Int = 6,
    /** Com o adaptador respondendo mas a ECU muda (ignição desligada), espera até tanto antes de encerrar. */
    @SerialName("ignition_wait_s") val ignitionWaitS: Long = 300,
    @SerialName("reconnect_delay_ms") val reconnectDelayMs: Long = 5000,
)

// =====================================================================================
//  Perfil compilado (fórmulas já analisadas, prontas para avaliação em tempo real)
// =====================================================================================

enum class DecoderType { FORMULA, DTC, ELM_VOLTAGE }

enum class AlertLevel { INFO, WARNING, CRITICAL }

class CompiledOutput(val id: String, val expr: Expr, val source: String)

class CommandVariant(
    val command: String,
    val decoder: DecoderType,
    val outputs: List<CompiledOutput>,
    val dtcKind: DtcKind?,
    val expectedBytes: Int?,
) {
    val isAtCommand: Boolean = command.startsWith("AT")

    /** Cabeçalho esperado na resposta positiva: (modo + 0x40) seguido dos bytes do PID. */
    val responseHeader: IntArray? =
        if (isAtCommand) null
        else ElmResponseParser.hexToBytes(command).also { it[0] = it[0] + 0x40 }

    /** PID do modo 01 (para checagem no bitmap de PIDs suportados), ou null. */
    val mode01Pid: Int? =
        if (command.length == 4 && command.startsWith("01")) command.substring(2).toInt(16) else null
}

class CompiledCommand(
    val pidId: String,
    val laneName: String,
    val lane: LaneSettings,
    val primary: CommandVariant,
    val fallback: CommandVariant?,
)

class CompiledAlert(val rule: AlertRule, val level: AlertLevel, val condition: Expr)

data class OutputMeta(
    val id: String,
    val name: String,
    val unit: String,
    val decimals: Int,
    val min: Double?,
    val max: Double?,
    val lane: String,
    val hidden: Boolean = false,
)

class LoadedProfile(
    val profile: VehicleProfile,
    val commands: List<CompiledCommand>,
    val alerts: List<CompiledAlert>,
    val outputs: Map<String, OutputMeta>,
) {
    val id: String get() = profile.profileId

    /** Em CAN (ISO 15765-4) a resposta do modo 03/07 traz um byte de contagem após o SID. */
    val isCan: Boolean = profile.protocol.contains("15765") ||
        profile.initCommands.any { it.uppercase().matches(Regex("ATSP[6-9AB]")) }
}

data class ProfileSummary(val id: String, val vehicleName: String, val ecuModel: String, val source: String)

class ProfileException(message: String, cause: Throwable? = null) : IllegalArgumentException(message, cause)

// =====================================================================================
//  ProfileParser: leitura, validação e compilação dos perfis
// =====================================================================================

object ProfileParser {

    const val ASSET_DIR = "profiles"
    const val DEFAULT_PROFILE_ID = "fiat_uno_vivace_7gf"

    private val json = Json {
        ignoreUnknownKeys = true   // permite chaves "_comment" e extensões futuras
        isLenient = true
    }

    /** Converte o texto JSON em um perfil compilado, validando comandos, fórmulas e alertas. */
    fun parse(text: String): LoadedProfile {
        val profile = try {
            json.decodeFromString(VehicleProfile.serializer(), text)
        } catch (e: Exception) {
            throw ProfileException("JSON de perfil inválido: ${e.message}", e)
        }
        return compile(profile)
    }

    fun compile(profile: VehicleProfile): LoadedProfile {
        val commands = mutableListOf<CompiledCommand>()
        val outputs = LinkedHashMap<String, OutputMeta>()

        for ((laneName, pidList) in profile.pids) {
            val lane = profile.lanes[laneName]
                ?: throw ProfileException("Esteira '$laneName' usada em 'pids' mas não declarada em 'lanes'")
            for (pid in pidList) {
                val ctx = "PID '${pid.id}'"
                val command = normalizeCommand(pid.command, ctx)
                val decoder = parseDecoder(pid.decoder, ctx)

                val outputDefs = buildList {
                    if (pid.formula != null) add(
                        OutputDefinition(pid.id, pid.name, pid.formula, pid.unit, pid.decimals, pid.min, pid.max)
                    )
                    addAll(pid.outputs)
                }
                if (decoder != DecoderType.DTC && outputDefs.isEmpty()) {
                    throw ProfileException("$ctx não define 'formula' nem 'outputs'")
                }
                for (o in outputDefs) {
                    if (outputs.containsKey(o.id)) throw ProfileException("Saída '${o.id}' duplicada ($ctx)")
                    outputs[o.id] = OutputMeta(o.id, o.name, o.unit, o.decimals, o.min, o.max, laneName, o.hidden)
                }

                val dtcKind = if (decoder == DecoderType.DTC) {
                    pid.dtcKind?.let { parseDtcKind(it, ctx) } ?: DtcKind.fromMode(command)
                    ?: throw ProfileException("$ctx: informe 'dtc_kind' (confirmed/pending/permanent)")
                } else null

                val primary = CommandVariant(
                    command = command,
                    decoder = decoder,
                    outputs = outputDefs.map { CompiledOutput(it.id, compileFormula(it.formula, "$ctx/${it.id}"), it.formula) },
                    dtcKind = dtcKind,
                    expectedBytes = pid.bytes,
                )

                val fallback = pid.fallbackCommand?.let { fbCmd ->
                    val fbDecoder = parseDecoder(pid.fallbackDecoder ?: pid.decoder, "$ctx (fallback)")
                    val fbFormula = pid.fallbackFormula
                        ?: if (fbDecoder == DecoderType.ELM_VOLTAGE) "V" else pid.formula
                        ?: throw ProfileException("$ctx: 'fallback_formula' obrigatório")
                    CommandVariant(
                        command = normalizeCommand(fbCmd, "$ctx (fallback)"),
                        decoder = fbDecoder,
                        outputs = listOf(CompiledOutput(pid.id, compileFormula(fbFormula, "$ctx/fallback"), fbFormula)),
                        dtcKind = null,
                        expectedBytes = null,
                    )
                }

                commands += CompiledCommand(pid.id, laneName, lane, primary, fallback)
            }
        }

        val alerts = profile.alerts.map { rule ->
            CompiledAlert(
                rule = rule,
                level = when (rule.level.lowercase()) {
                    "info" -> AlertLevel.INFO
                    "warning", "warn" -> AlertLevel.WARNING
                    "critical", "danger" -> AlertLevel.CRITICAL
                    else -> throw ProfileException("Alerta '${rule.id}': nível '${rule.level}' inválido")
                },
                condition = compileFormula(rule.condition, "alerta '${rule.id}'"),
            )
        }

        profile.fuel?.decelFuelCutCondition?.let { compileFormula(it, "fuel.decel_fuel_cut_condition") }

        return LoadedProfile(profile, commands, alerts, outputs)
    }

    /** Lista os perfis disponíveis: embarcados (assets) + importados pelo usuário (filesDir, com precedência). */
    fun listAvailable(context: Context): List<ProfileSummary> {
        val result = LinkedHashMap<String, ProfileSummary>()
        context.assets.list(ASSET_DIR).orEmpty().filter { it.endsWith(".json") }.forEach { name ->
            runCatching { readHeader(context.assets.open("$ASSET_DIR/$name").bufferedReader().use { it.readText() }) }
                .getOrNull()?.let { result[it.profileId] = ProfileSummary(it.profileId, it.vehicleName, it.ecuModel, "asset") }
        }
        userDir(context).listFiles { f -> f.extension == "json" }.orEmpty().forEach { file ->
            runCatching { readHeader(file.readText()) }
                .getOrNull()?.let { result[it.profileId] = ProfileSummary(it.profileId, it.vehicleName, it.ecuModel, "user") }
        }
        return result.values.toList()
    }

    fun load(context: Context, profileId: String): LoadedProfile {
        userDir(context).listFiles { f -> f.extension == "json" }.orEmpty().forEach { file ->
            val text = file.readText()
            if (runCatching { readHeader(text).profileId }.getOrNull() == profileId) return parse(text)
        }
        context.assets.list(ASSET_DIR).orEmpty().filter { it.endsWith(".json") }.forEach { name ->
            val text = context.assets.open("$ASSET_DIR/$name").bufferedReader().use { it.readText() }
            if (runCatching { readHeader(text).profileId }.getOrNull() == profileId) return parse(text)
        }
        throw ProfileException("Perfil '$profileId' não encontrado")
    }

    fun loadSelected(context: Context): LoadedProfile {
        val id = AppSettings.selectedProfileId(context)
        return try {
            load(context, id)
        } catch (e: ProfileException) {
            if (id == DEFAULT_PROFILE_ID) throw e else load(context, DEFAULT_PROFILE_ID)
        }
    }

    /** Valida e grava um perfil enviado pelo usuário em <filesDir>/profiles. */
    fun importProfile(context: Context, text: String): ProfileSummary {
        val loaded = parse(text)
        val file = File(userDir(context), "${loaded.id}.json")
        file.writeText(text)
        return ProfileSummary(loaded.id, loaded.profile.vehicleName, loaded.profile.ecuModel, "user")
    }

    private fun userDir(context: Context) = File(context.filesDir, ASSET_DIR).apply { mkdirs() }

    @Serializable
    private data class Header(
        @SerialName("profile_id") val profileId: String,
        @SerialName("vehicle_name") val vehicleName: String = "",
        @SerialName("ecu_model") val ecuModel: String = "",
    )

    private fun readHeader(text: String) = json.decodeFromString(Header.serializer(), text)

    private fun normalizeCommand(raw: String, ctx: String): String {
        val cmd = raw.replace(" ", "").uppercase()
        val valid = cmd.startsWith("AT") || (cmd.length % 2 == 0 && cmd.isNotEmpty() && cmd.all { it in HEX })
        if (!valid) throw ProfileException("$ctx: comando '$raw' inválido (esperado AT... ou hexadecimal)")
        return cmd
    }

    private fun parseDecoder(name: String, ctx: String) = when (name.lowercase()) {
        "formula" -> DecoderType.FORMULA
        "dtc" -> DecoderType.DTC
        "elm_voltage", "atrv" -> DecoderType.ELM_VOLTAGE
        else -> throw ProfileException("$ctx: decoder '$name' desconhecido")
    }

    private fun parseDtcKind(name: String, ctx: String) = when (name.lowercase()) {
        "confirmed", "active" -> DtcKind.CONFIRMED
        "pending" -> DtcKind.PENDING
        "permanent" -> DtcKind.PERMANENT
        else -> throw ProfileException("$ctx: dtc_kind '$name' inválido")
    }

    private fun compileFormula(source: String, ctx: String): Expr = try {
        FormulaEvaluator.compile(source)
    } catch (e: FormulaException) {
        throw ProfileException("Fórmula inválida em $ctx: ${e.message}", e)
    }

    private const val HEX = "0123456789ABCDEF"
}

// =====================================================================================
//  Avaliador de fórmulas: compila uma vez em AST e avalia a cada resposta
//
//  Suporta: + - * / %  ( )  & | ^ << >>  == != < <= > >=  && || !  cond ? a : b
//  Funções: min, max, abs, round(x[,casas]), floor, ceil, sqrt, clamp(x,lo,hi),
//           signed8(x), signed16(x)
//  Literais: 123, 1.5, 0x7F.  Precedência igual à da linguagem C.
// =====================================================================================

class FormulaException(message: String) : IllegalArgumentException(message)

fun interface VariableResolver {
    /** Retorna o valor da variável, ou NaN se desconhecida/indisponível. */
    fun resolve(name: String): Double
}

sealed class Expr {
    abstract fun eval(vars: VariableResolver): Double

    class Const(private val value: Double) : Expr() {
        override fun eval(vars: VariableResolver) = value
    }

    class Var(val name: String) : Expr() {
        override fun eval(vars: VariableResolver) = vars.resolve(name)
    }

    class Unary(private val op: String, private val operand: Expr) : Expr() {
        override fun eval(vars: VariableResolver): Double {
            val x = operand.eval(vars)
            return when (op) {
                "-" -> -x
                "!" -> if (x.isNaN()) Double.NaN else bool(!FormulaEvaluator.truthy(x))
                else -> x
            }
        }
    }

    class Binary(private val op: String, private val left: Expr, private val right: Expr) : Expr() {
        override fun eval(vars: VariableResolver): Double {
            when (op) {
                "&&" -> return bool(FormulaEvaluator.truthy(left.eval(vars)) && FormulaEvaluator.truthy(right.eval(vars)))
                "||" -> return bool(FormulaEvaluator.truthy(left.eval(vars)) || FormulaEvaluator.truthy(right.eval(vars)))
            }
            val a = left.eval(vars)
            val b = right.eval(vars)
            return when (op) {
                "+" -> a + b
                "-" -> a - b
                "*" -> a * b
                "/" -> a / b
                "%" -> a % b
                "==" -> bool(a == b)
                "!=" -> bool(a != b)
                "<" -> bool(a < b)
                "<=" -> bool(a <= b)
                ">" -> bool(a > b)
                ">=" -> bool(a >= b)
                else -> bitwise(a, b)
            }
        }

        private fun bitwise(a: Double, b: Double): Double {
            if (a.isNaN() || b.isNaN()) return Double.NaN
            val x = a.toLong()
            val y = b.toLong()
            return when (op) {
                "&" -> x and y
                "|" -> x or y
                "^" -> x xor y
                "<<" -> x shl y.toInt()
                ">>" -> x shr y.toInt()
                else -> throw IllegalStateException("Operador $op")
            }.toDouble()
        }
    }

    class Ternary(private val cond: Expr, private val whenTrue: Expr, private val whenFalse: Expr) : Expr() {
        override fun eval(vars: VariableResolver): Double {
            val c = cond.eval(vars)
            if (c.isNaN()) return Double.NaN
            return if (FormulaEvaluator.truthy(c)) whenTrue.eval(vars) else whenFalse.eval(vars)
        }
    }

    class Call(private val impl: (DoubleArray) -> Double, private val args: List<Expr>) : Expr() {
        override fun eval(vars: VariableResolver): Double =
            impl(DoubleArray(args.size) { args[it].eval(vars) })
    }
}

private fun bool(b: Boolean) = if (b) 1.0 else 0.0

object FormulaEvaluator {

    private class Function(val arity: IntRange, val impl: (DoubleArray) -> Double)

    private val functions: Map<String, Function> = mapOf(
        "min" to Function(2..16) { a -> a.minOrNull() ?: Double.NaN },
        "max" to Function(2..16) { a -> a.maxOrNull() ?: Double.NaN },
        "abs" to Function(1..1) { a -> abs(a[0]) },
        "round" to Function(1..2) { a ->
            val factor = if (a.size > 1) 10.0.pow(a[1]) else 1.0
            round(a[0] * factor) / factor
        },
        "floor" to Function(1..1) { a -> floor(a[0]) },
        "ceil" to Function(1..1) { a -> ceil(a[0]) },
        "sqrt" to Function(1..1) { a -> sqrt(a[0]) },
        "clamp" to Function(3..3) { a -> a[0].coerceIn(a[1], a[2]) },
        "signed8" to Function(1..1) { a -> if (a[0].isNaN()) Double.NaN else a[0].toLong().toByte().toDouble() },
        "signed16" to Function(1..1) { a -> if (a[0].isNaN()) Double.NaN else a[0].toLong().toShort().toDouble() },
    )

    fun truthy(v: Double) = !v.isNaN() && v != 0.0

    fun compile(source: String): Expr = Parser(source, tokenize(source)).parseAll()

    /** Conveniência para testes e uso pontual (compila a cada chamada). */
    fun evaluate(source: String, vars: Map<String, Double>): Double =
        compile(source).eval { vars[it] ?: Double.NaN }

    /** Avalia uma fórmula de resposta OBD com os bytes de dados mapeados para A, B, C, ... */
    fun evaluateBytes(expr: Expr, data: IntArray): Double = expr.eval { name ->
        if (name.length == 1 && name[0] in 'A'..'Z') {
            val i = name[0] - 'A'
            if (i < data.size) data[i].toDouble() else Double.NaN
        } else Double.NaN
    }

    // ---------------- Tokenizador ----------------

    private sealed class Tok {
        data class Num(val value: Double) : Tok()
        data class Id(val name: String) : Tok()
        data class Op(val symbol: String) : Tok()
        data object End : Tok()
    }

    private val twoCharOps = setOf("<<", ">>", "<=", ">=", "==", "!=", "&&", "||")
    private const val ONE_CHAR_OPS = "+-*/%&|^<>!()?:,"

    private fun tokenize(src: String): List<Tok> {
        val out = mutableListOf<Tok>()
        var i = 0
        while (i < src.length) {
            val c = src[i]
            when {
                c.isWhitespace() -> i++
                c == '0' && i + 1 < src.length && (src[i + 1] == 'x' || src[i + 1] == 'X') -> {
                    var j = i + 2
                    while (j < src.length && src[j].isLetterOrDigit()) j++
                    val hex = src.substring(i + 2, j)
                    out += Tok.Num(hex.toLongOrNull(16)?.toDouble() ?: throw FormulaException("Hex inválido '0x$hex' em \"$src\""))
                    i = j
                }
                c.isDigit() || (c == '.' && i + 1 < src.length && src[i + 1].isDigit()) -> {
                    var j = i
                    while (j < src.length && (src[j].isDigit() || src[j] == '.')) j++
                    val text = src.substring(i, j)
                    out += Tok.Num(text.toDoubleOrNull() ?: throw FormulaException("Número inválido '$text' em \"$src\""))
                    i = j
                }
                c.isLetter() || c == '_' -> {
                    var j = i
                    while (j < src.length && (src[j].isLetterOrDigit() || src[j] == '_')) j++
                    out += Tok.Id(src.substring(i, j))
                    i = j
                }
                i + 1 < src.length && src.substring(i, i + 2) in twoCharOps -> {
                    out += Tok.Op(src.substring(i, i + 2)); i += 2
                }
                c in ONE_CHAR_OPS -> {
                    out += Tok.Op(c.toString()); i++
                }
                else -> throw FormulaException("Caractere inesperado '$c' na posição $i em \"$src\"")
            }
        }
        out += Tok.End
        return out
    }

    // ---------------- Parser descendente recursivo ----------------

    private class Parser(private val src: String, private val tokens: List<Tok>) {
        private var pos = 0
        private fun peek() = tokens[pos]
        private fun isOp(vararg symbols: String) = (peek() as? Tok.Op)?.symbol in symbols
        private fun nextOp(): String = (tokens[pos++] as Tok.Op).symbol

        private fun expect(symbol: String) {
            if (!isOp(symbol)) throw FormulaException("Esperado '$symbol' em \"$src\"")
            pos++
        }

        fun parseAll(): Expr {
            if (peek() == Tok.End) throw FormulaException("Fórmula vazia")
            val e = ternary()
            if (peek() != Tok.End) throw FormulaException("Símbolo inesperado ${peek()} em \"$src\"")
            return e
        }

        private fun ternary(): Expr {
            val cond = logicalOr()
            if (!isOp("?")) return cond
            pos++
            val a = ternary()
            expect(":")
            val b = ternary()
            return Expr.Ternary(cond, a, b)
        }

        private fun binaryLevel(next: () -> Expr, vararg ops: String): Expr {
            var left = next()
            while (isOp(*ops)) {
                val op = nextOp()
                left = Expr.Binary(op, left, next())
            }
            return left
        }

        private fun logicalOr(): Expr = binaryLevel(::logicalAnd, "||")
        private fun logicalAnd(): Expr = binaryLevel(::bitOr, "&&")
        private fun bitOr(): Expr = binaryLevel(::bitXor, "|")
        private fun bitXor(): Expr = binaryLevel(::bitAnd, "^")
        private fun bitAnd(): Expr = binaryLevel(::equality, "&")
        private fun equality(): Expr = binaryLevel(::relational, "==", "!=")
        private fun relational(): Expr = binaryLevel(::shift, "<", "<=", ">", ">=")
        private fun shift(): Expr = binaryLevel(::additive, "<<", ">>")
        private fun additive(): Expr = binaryLevel(::multiplicative, "+", "-")
        private fun multiplicative(): Expr = binaryLevel(::unary, "*", "/", "%")

        private fun unary(): Expr {
            if (isOp("-", "+", "!")) {
                val op = nextOp()
                return Expr.Unary(op, unary())
            }
            return primary()
        }

        private fun primary(): Expr {
            return when (val t = tokens[pos++]) {
                is Tok.Num -> Expr.Const(t.value)
                is Tok.Id -> {
                    if (!isOp("(")) return Expr.Var(t.name)
                    val fn = functions[t.name.lowercase()]
                        ?: throw FormulaException("Função desconhecida '${t.name}' em \"$src\"")
                    pos++
                    val args = mutableListOf<Expr>()
                    if (!isOp(")")) {
                        do {
                            args += ternary()
                        } while (isOp(",").also { if (it) pos++ })
                    }
                    expect(")")
                    if (args.size !in fn.arity) {
                        throw FormulaException("Função '${t.name}' espera ${fn.arity} argumento(s), recebeu ${args.size}")
                    }
                    Expr.Call(fn.impl, args)
                }
                is Tok.Op -> {
                    if (t.symbol != "(") throw FormulaException("Símbolo inesperado '${t.symbol}' em \"$src\"")
                    val e = ternary()
                    expect(")")
                    e
                }
                Tok.End -> throw FormulaException("Fim inesperado da fórmula \"$src\"")
            }
        }
    }
}

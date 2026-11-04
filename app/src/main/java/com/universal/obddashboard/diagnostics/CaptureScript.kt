package com.universal.obddashboard.diagnostics

import android.content.Context
import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.jsonObject

/**
 * Roteiro de captura: passos guiados para mapear a rede do carro (portas, luzes, pedais…). A tela
 * conduz cada passo e grava uma marca por mudança ("liga", "desliga") no arquivo de diagnóstico,
 * no mesmo relógio dos quadros do ESP32 e do ELM327. O app só marca o tempo e lê: nada é enviado ao carro.
 *
 * O roteiro genérico (assets/capture-scripts/generic.json) serve a qualquer veículo: itens que quase todo
 * carro tem, marcados "se tiver" quando não. Um perfil pode trazer o próprio roteiro em
 * assets/capture-scripts/<profile_id>.json, que substitui o genérico.
 */
@Serializable
data class CaptureScript(
    @SerialName("schema_version") val schemaVersion: Int = 1,
    @SerialName("profile_id") val profileId: String = GENERIC,
    val title: String,
    val groups: List<Group>,
) {
    /** Onde o grupo acontece: "stopped" (parado) ou "moving" (só dirigir, sem passos guiados). */
    @Serializable
    data class Group(val id: String, val title: String, val place: String = "stopped", val note: String? = null, val steps: List<Step> = emptyList())

    /**
     * Um passo tem exatamente um formato:
     * - [pattern]: alterna "liga" e "desliga" [Pattern.repeat] vezes;
     * - [phases]: sequência de instruções com duração;
     * - [events]: botões que a pessoa toca quando algo acontece (ex.: ventilador ligou), até [maxS].
     * [choices] são botões opcionais durante o passo (ex.: posição do econômetro).
     * [engine]: "on", "off" ou "any", só para avisar; o bloqueio é sempre com o carro andando.
     */
    @Serializable
    data class Step(
        val id: String,
        val title: String,
        val priority: Boolean = false,
        val engine: String = "any",
        val before: String? = null,
        val after: String? = null,
        val pattern: Pattern? = null,
        val phases: List<Phase>? = null,
        val events: List<String>? = null,
        @SerialName("max_s") val maxS: Int? = null,
        val choices: Choices? = null,
    )

    @Serializable
    data class Pattern(val on: String, val off: String, @SerialName("on_s") val onS: Int = 10, @SerialName("off_s") val offS: Int = 10, val repeat: Int = 3)

    @Serializable
    data class Phase(val say: String, val s: Int)

    @Serializable
    data class Choices(val label: String, val options: List<String>)

    class ScriptException(message: String) : Exception(message)

    companion object {
        // encodeDefaults: a tela precisa de todos os campos (on_s, off_s, repeat…), mesmo os iguais ao padrão
        private val json = Json { ignoreUnknownKeys = true; encodeDefaults = true }
        private val ID = Regex("^[a-z0-9_]{1,32}$")
        private const val MAX_TEXT = 240
        const val GENERIC = "generic"

        /** Roteiro próprio do perfil, se houver; senão o genérico. Um roteiro inválido vira exceção. */
        fun load(context: Context, profileId: String): CaptureScript {
            fun read(name: String) = runCatching { context.assets.open("capture-scripts/$name.json").bufferedReader().use { it.readText() } }.getOrNull()
            val own = profileId.takeIf { ID.matches(it) && it != GENERIC }?.let(::read)
            return parse(own ?: read(GENERIC) ?: throw ScriptException("Roteiro genérico ausente"))
        }

        fun parse(text: String): CaptureScript {
            val s = runCatching { json.decodeFromString(serializer(), text) }.getOrElse { throw ScriptException("Roteiro ilegível: ${it.message}") }
            validate(s)
            return s
        }

        fun encode(s: CaptureScript): String = json.encodeToString(serializer(), s)

        private fun validate(s: CaptureScript) {
            fun text(v: String?, what: String) {
                if (v != null && (v.isBlank() || v.length > MAX_TEXT)) throw ScriptException("$what: texto vazio ou longo demais")
            }
            if (s.schemaVersion != 1) throw ScriptException("schema_version ${s.schemaVersion} não suportado")
            text(s.title, "título")
            if (s.groups.isEmpty()) throw ScriptException("roteiro sem grupos")
            val ids = HashSet<String>()
            s.groups.forEach { g ->
                if (!ID.matches(g.id) || !ids.add("g:" + g.id)) throw ScriptException("grupo '${g.id}': id inválido ou repetido")
                if (g.place !in setOf("stopped", "moving")) throw ScriptException("grupo '${g.id}': place deve ser stopped ou moving")
                text(g.title, "grupo '${g.id}'"); text(g.note, "grupo '${g.id}'")
                if (g.place == "moving" && g.steps.isNotEmpty()) throw ScriptException("grupo '${g.id}': em movimento não há passos guiados")
                g.steps.forEach { st ->
                    val ctx = "passo '${st.id}'"
                    if (!ID.matches(st.id) || !ids.add(st.id)) throw ScriptException("$ctx: id inválido ou repetido")
                    listOf(st.title, st.before, st.after).forEach { text(it, ctx) }
                    if (st.engine !in setOf("on", "off", "any")) throw ScriptException("$ctx: engine deve ser on, off ou any")
                    val kinds = listOfNotNull(st.pattern, st.phases, st.events)
                    if (kinds.size != 1) throw ScriptException("$ctx: use exatamente um de pattern, phases ou events")
                    st.pattern?.let { p ->
                        text(p.on, ctx); text(p.off, ctx)
                        if (p.onS !in 1..600 || p.offS !in 1..600 || p.repeat !in 1..10) throw ScriptException("$ctx: tempos ou repetições fora da faixa")
                    }
                    st.phases?.let { ph ->
                        if (ph.isEmpty() || ph.size > 30) throw ScriptException("$ctx: de 1 a 30 fases")
                        ph.forEach { text(it.say, ctx); if (it.s !in 1..600) throw ScriptException("$ctx: fase com duração fora da faixa") }
                    }
                    st.events?.let { ev ->
                        if (ev.isEmpty() || ev.size > 6) throw ScriptException("$ctx: de 1 a 6 eventos")
                        ev.forEach { text(it, ctx) }
                        if (st.maxS == null || st.maxS !in 10..3600) throw ScriptException("$ctx: eventos precisam de max_s entre 10 e 3600")
                    }
                    st.choices?.let { c ->
                        text(c.label, ctx)
                        if (c.options.isEmpty() || c.options.size > 8) throw ScriptException("$ctx: de 1 a 8 opções")
                        c.options.forEach { text(it, ctx) }
                    }
                }
            }
        }
    }
}

/** Marca que a tela pede para gravar. Só campos conhecidos, com tamanho limitado: o texto vem da WebView. */
object CaptureMarks {
    private val PHASES = setOf("step_start", "on", "off", "phase", "choice", "event", "note", "step_end", "skip")
    private val ID = Regex("^[a-z0-9_]{1,32}$")
    private val LIMITS = mapOf("label" to 120, "value" to 60, "note" to 300, "result" to 20)

    /** Campos prontos para o gravador, ou null se a marca não é válida. */
    fun sanitize(text: String): Map<String, Any>? {
        val o: JsonObject = runCatching { Json.parseToJsonElement(text).jsonObject }.getOrNull() ?: return null
        fun str(k: String) = (o[k] as? JsonPrimitive)?.takeIf { it.isString }?.contentOrNull
        val script = str("script")?.takeIf { ID.matches(it) } ?: return null
        val step = str("step")?.takeIf { ID.matches(it) } ?: return null
        val phase = str("phase")?.takeIf { it in PHASES } ?: return null
        val out = linkedMapOf<String, Any>("script" to script, "step" to step, "phase" to phase)
        (o["n"] as? JsonPrimitive)?.contentOrNull?.toIntOrNull()?.takeIf { it in 0..99 }?.let { out["n"] = it }
        LIMITS.forEach { (k, max) ->
            str(k)?.let { v -> v.filterNot { it.isISOControl() }.trim().take(max).takeIf { it.isNotEmpty() }?.let { out[k] = it } }
        }
        return out
    }
}

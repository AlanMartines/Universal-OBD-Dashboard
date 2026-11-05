package com.universal.obddashboard.diagnostics

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import java.io.File

class CaptureScriptTest {

    private val dir = File("src/main/assets/capture-scripts")
    private val generic = File(dir, "generic.json").readText()

    @Test fun everyShippedScriptIsValid() {
        val files = dir.listFiles { f -> f.extension == "json" }!!
        assertTrue("falta o roteiro genérico", files.any { it.name == "generic.json" })
        files.forEach { f ->
            val s = CaptureScript.parse(f.readText())
            assertEquals("${f.name}: profile_id deve ser o nome do arquivo", f.nameWithoutExtension, s.profileId)
        }
    }

    @Test fun genericScriptCoversTheCommonItems() {
        val s = CaptureScript.parse(generic)
        val steps = s.groups.flatMap { it.steps }.map { it.id }.toSet()
        listOf("ign_quiet", "door_driver", "seatbelt_driver", "brake_pedal", "handbrake", "reverse", "high_beam", "idle_quiet", "ac", "rpm_fixed", "radiator_fan", "engine_off", "fuel_before", "fuel_after")
            .forEach { assertTrue("roteiro genérico sem $it", it in steps) }
        assertTrue("em movimento, só passos do passageiro", s.groups.filter { it.place == "moving" }.all { g -> g.steps.all { it.passenger } })
        val gauge = s.groups.flatMap { it.steps }.first { it.id == "economy_gauge" }
        assertTrue("indicador de economia com o passageiro", gauge.passenger)
        assertEquals(listOf("red", "neutral", "green"), gauge.zones!!.map { it.color })
        assertEquals(listOf("Alto", "Médio", "Baixo"), gauge.zones!!.first().options)
        // O roteiro volta à tela pelo encode; precisa sair igual
        assertEquals(s, CaptureScript.parse(CaptureScript.encode(s)))
    }

    @Test fun encodedScriptKeepsEveryFieldTheScreenReads() {
        // Sem os valores padrão no texto, a tela recebia "undefined" e o passo nunca terminava
        val o = Json.parseToJsonElement(CaptureScript.encode(CaptureScript.parse(generic))).jsonObject
        val steps = o["groups"]!!.jsonArray.flatMap { (it.jsonObject["steps"] as? JsonArray).orEmpty() }.map { it.jsonObject }
        assertTrue(steps.isNotEmpty())
        steps.forEach { st ->
            val id = st["id"].toString()
            listOf("priority", "engine").forEach { assertTrue("$id sem $it", st.containsKey(it)) }
            (st["pattern"] as? JsonObject)?.let { p -> listOf("on_s", "off_s", "repeat").forEach { assertTrue("$id sem $it", p.containsKey(it)) } }
        }
    }

    @Test fun invalidScriptsAreRefused() {
        fun refused(json: String) = runCatching { CaptureScript.parse(json) }.exceptionOrNull() is CaptureScript.ScriptException
        assertTrue("dois formatos no mesmo passo", refused(generic.replaceFirst("\"phases\": [{ \"say\": \"Ignição ligada. Não toque em nada.\", \"s\": 60 }]", "\"phases\": [{ \"say\": \"x\", \"s\": 60 }], \"events\": [\"a\"], \"max_s\": 60")))
        assertTrue("id repetido", refused(generic.replaceFirst("\"id\": \"door_passenger\"", "\"id\": \"door_driver\"")))
        assertTrue("duração fora da faixa", refused(generic.replaceFirst("\"on_s\": 10", "\"on_s\": 0")))
        assertTrue("passo comum em movimento", refused(generic.replace("{ \"id\": \"economy_gauge\"", "{ \"id\": \"x\", \"title\": \"x\", \"phases\": [{ \"say\": \"x\", \"s\": 1 }] }, { \"id\": \"economy_gauge\"")))
        assertTrue("passo do passageiro em grupo parado", refused(generic.replaceFirst("\"id\": \"door_driver\", \"title\": \"Porta do motorista\",", "\"id\": \"door_driver\", \"title\": \"Porta do motorista\", \"passenger\": true,")))
        assertTrue("cor desconhecida", refused(generic.replace("\"color\": \"red\"", "\"color\": \"azul\"")))
        assertTrue("texto ilegível", refused("{"))
    }

    @Test fun marksKeepOnlyKnownFieldsWithLimits() {
        val m = CaptureMarks.sanitize("""{"script":"generic","step":"door_driver","phase":"on","n":2,"label":"Abra a porta","extra":"x"}""")!!
        assertEquals(mapOf("script" to "generic", "step" to "door_driver", "phase" to "on", "n" to 2, "label" to "Abra a porta"), m)
        assertNull("fase desconhecida", CaptureMarks.sanitize("""{"script":"generic","step":"a","phase":"write"}"""))
        assertNull("id com caracteres estranhos", CaptureMarks.sanitize("""{"script":"generic","step":"a b","phase":"on"}"""))
        assertNull("JSON inválido", CaptureMarks.sanitize("nada"))
        val long = CaptureMarks.sanitize("""{"script":"generic","step":"a","phase":"note","note":"${"x".repeat(500)}\u0007"}""")!!
        assertEquals(300, (long["note"] as String).length)
        assertNull("número fora da faixa é ignorado", CaptureMarks.sanitize("""{"script":"generic","step":"a","phase":"on","n":500}""")!!["n"])
    }
}

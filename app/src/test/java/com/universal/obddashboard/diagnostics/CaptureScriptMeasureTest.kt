package com.universal.obddashboard.diagnostics

import org.junit.Assert.assertEquals
import org.junit.Assert.assertThrows
import org.junit.Test
import java.io.File

class CaptureScriptMeasureTest {
    private val generic = File("src/main/assets/capture-scripts/generic.json").readText()

    @Test fun roteiroGenericoTemOsCincoPontosDaBateria() {
        val s = CaptureScript.parse(generic)
        val bateria = s.groups.first { it.id == "bateria" }
        assertEquals(listOf("bat_off", "bat_ign", "bat_crank", "bat_idle", "bat_load"), bateria.steps.map { it.id })
        assert(bateria.steps.all { it.measure == "battery" })
    }

    @Test fun medidaSoAceitaBateriaESozinha() {
        val base = """{"schema_version":1,"title":"t","groups":[{"id":"g","title":"g","steps":[STEP]}]}"""
        assertThrows(CaptureScript.ScriptException::class.java) {
            CaptureScript.parse(base.replace("STEP", """{"id":"a","title":"a","measure":"oleo"}"""))
        }
        assertThrows(CaptureScript.ScriptException::class.java) {
            CaptureScript.parse(base.replace("STEP", """{"id":"a","title":"a","measure":"battery","phases":[{"say":"x","s":5}]}"""))
        }
        CaptureScript.parse(base.replace("STEP", """{"id":"a","title":"a","measure":"battery"}"""))
    }

    @Test fun marcaDeMedidaPassaNoFiltro() {
        val m = CaptureMarks.sanitize("""{"script":"generic","step":"bat_off","phase":"measure","value":"12.60","note":"multimetro=12.60 esp_cru=10.460"}""")!!
        assertEquals("measure", m["phase"])
        assertEquals("12.60", m["value"])
    }
}

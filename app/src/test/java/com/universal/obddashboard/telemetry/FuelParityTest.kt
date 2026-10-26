package com.universal.obddashboard.telemetry

import com.universal.obddashboard.obd.ProfileParser
import com.universal.obddashboard.obd.VariableResolver
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonArray
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.double
import kotlinx.serialization.json.doubleOrNull
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.put
import org.junit.Assert.assertEquals
import org.junit.Test
import java.io.File

/**
 * O consumo é calculado em dois lugares: no app (FuelCalculator) e na ferramenta de recálculo
 * (tools/trip-report, Python). Os dois conferem a mesma tabela (fixtures/fuel_parity.json), então
 * uma mudança em um só deles quebra um dos testes. Para regenerar a tabela depois de mudar o modelo
 * de propósito: REGEN_FUEL_PARITY=1 ./gradlew :app:testDebugUnitTest --tests '*FuelParityTest*'.
 */
class FuelParityTest {

    private val fixture = File("../tools/trip-report/fixtures/fuel_parity.json")
    private val profileFile = "src/main/assets/profiles/fiat_uno_vivace_7gf.json"
    private val fuel = ProfileParser.parse(File(profileFile).readText()).profile.fuel!!

    /** rpm, map (kPa), intake_temp (°C), stft_b1 (%), throttle (%), speed, etanol (%). */
    private val cases = listOf(
        listOf(850.0, 35.0, 30.0, 0.0, 0.0, 0.0, 0.0),        // marcha lenta
        listOf(3000.0, 60.0, 35.0, 2.3, 22.0, 100.0, 0.0),     // cruzeiro
        listOf(5500.0, 95.0, 40.0, -5.5, 85.0, 140.0, 0.0),    // carga alta
        listOf(3000.0, 60.0, 35.0, 0.0, 22.0, 100.0, 100.0),   // etanol
        listOf(3000.0, 60.0, 35.0, 0.0, 22.0, 100.0, 27.0),    // mistura
        listOf(2500.0, 25.0, 30.0, 0.0, 0.0, 80.0, 0.0),       // corte em desaceleração (rpm > 1500 && map < 30)
        listOf(2000.0, 50.0, 30.0, 45.0, 10.0, 50.0, 0.0),     // trim limitado a +30%
        listOf(200.0, 90.0, 30.0, 0.0, 0.0, 0.0, 0.0),         // motor parando
    )

    private fun lph(c: List<Double>): Double? {
        val vals = mapOf("rpm" to c[0], "map" to c[1], "intake_temp" to c[2], "stft_b1" to c[3], "throttle" to c[4], "speed" to c[5])
        return FuelCalculator(fuel).litersPerHour(c[0], c[1], c[2], null, c[3], null, c[6], VariableResolver { vals[it] ?: Double.NaN })
    }

    @Test fun kotlinMatchesTheSharedTable() {
        if (System.getenv("REGEN_FUEL_PARITY") == "1") {
            fixture.parentFile.mkdirs()
            fixture.writeText(
                buildJsonObject {
                    put("profile", "app/$profileFile")
                    put("cases", buildJsonArray {
                        cases.forEach { c ->
                            add(buildJsonObject {
                                put("rpm", c[0]); put("map", c[1]); put("intake_temp", c[2]); put("stft_b1", c[3])
                                put("throttle", c[4]); put("speed", c[5]); put("ethanol_pct", c[6])
                                put("lph", lph(c)?.let { JsonPrimitive(it) } ?: JsonNull)
                            })
                        }
                    })
                }.toString(),
            )
        }
        val table = Json.parseToJsonElement(fixture.readText()).jsonObject["cases"]!!.jsonArray.map { it.jsonObject }
        assertEquals(cases.size, table.size)
        table.forEachIndexed { i, row: JsonObject ->
            val c = listOf("rpm", "map", "intake_temp", "stft_b1", "throttle", "speed", "ethanol_pct").map { row[it]!!.jsonPrimitive.double }
            assertEquals("caso $i", cases[i], c)
            val expected = row["lph"]!!.jsonPrimitive.doubleOrNull
            val actual = lph(c)
            if (expected == null) assertEquals("caso $i", null, actual) else assertEquals("caso $i", expected, actual!!, 1e-9)
        }
    }
}

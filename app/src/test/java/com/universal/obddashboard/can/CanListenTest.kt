package com.universal.obddashboard.can

import com.universal.obddashboard.obd.ProfileException
import com.universal.obddashboard.obd.ProfileParser
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File

/** Valores dos exemplos são fictícios. */
class CanListenTest {
    private val uno = ProfileParser.parse(File("src/main/assets/profiles/fiat_uno_vivace_7gf.json").readText())
    private val decoder = CanDecoder(uno.canSignals)
    private fun decode(line: String) = Slcan.parse(line)?.let { decoder.decode(it) }.orEmpty()

    @Test fun parsesFirmwareLinesAndIgnoresStatus() {
        val f = Slcan.parse("t2A04038000DE")!!
        assertEquals(0x2A0, f.id)
        assertEquals(listOf(0x03, 0x80, 0x00, 0xDE), f.data.toList())
        assertEquals(0x18DAF110, Slcan.parse("T18DAF1102AABB")!!.id)
        assertNull(Slcan.parse("# stats quadros=10 perdidos=0 erros=0"))
        assertNull("tamanho não bate com os dados", Slcan.parse("t2A04038"))
        assertNull("RTR não traz dados", Slcan.parse("r2A00"))
    }

    @Test fun parsesBmp180Line() {
        val v = Slcan.parseAmbient("# bmp180 temp=24.3C pressao=1013.2hPa")!!
        assertEquals(24.3, v[Slcan.CABIN_TEMP]!!, 1e-9)
        assertEquals(1013.2, v[Slcan.CABIN_PRESSURE]!!, 1e-9)
        assertEquals(-0.5, Slcan.parseAmbient("# bmp180 temp=-0.5C pressao=921.0hPa")!![Slcan.CABIN_TEMP]!!, 1e-9)
        assertNull("fora da faixa do sensor", Slcan.parseAmbient("# bmp180 temp=24.3C pressao=0.0hPa"))
        assertNull(Slcan.parseAmbient("# bmp180 ausente"))
        assertNull("não é quadro", Slcan.parse("# bmp180 temp=24.3C pressao=1013.2hPa"))
    }

    @Test fun unoProfileDecodesConfirmedSignals() {
        assertEquals(56.0, decode("t2A04038000DE")["can_speed"]!!, 1e-9)
        assertEquals(39.0, decode("t3808000000000027FF00")["fuel_level_pct"]!!, 1e-9)
        assertEquals(123456.0, decode("t60380001E24000000000")["odometer_km"]!!, 1e-9)
        assertEquals(625.0, decode("t643800000000000186A0")["trip_km"]!!, 1e-9)
        // Rotação, temperatura e tensão: confirmados com o ELM327 em 04/11/2026
        val engine = decode("t2818030180750A082504")
        assertEquals(1185.0, engine["can_rpm"]!!, 1e-9)
        assertEquals(77.0, engine["can_coolant_temp"]!!, 1e-9)
        assertEquals(14.08, decode("t3E080058000000000000")["can_voltage"]!!, 1e-9)
        // Consumo da injeção (provável): b4 × 0,66 L/h
        assertEquals(6.6, engine["can_fuel_lph"]!!, 1e-9)
        assertTrue("quadro sem sinal mapeado", decode("t2C1800C83C0000000000").isEmpty())
        assertTrue("acima de 100% é descartado", decode("t38080000000000C8FF00").isEmpty())
        // O painel manda o nível zerado nos últimos segundos antes de a ignição desligar
        assertTrue("0% é descartado", decode("t38080000100000000B00").isEmpty())
        // Sinais da escuta viram saídas do perfil: aparecem em Sensores e servem para alarmes
        assertEquals("can", uno.outputs.getValue("fuel_level_pct").lane)
        assertEquals("odometer_km", uno.profile.roles.odometer)
    }

    @Test fun tankAnchorsOnlyWhenStoppedAndChangedEnough() {
        val tank = TankAnchor(48.0)
        var t = 0L
        fun feed(pct: Double, speed: Double?, est: Double?): Double? { t += 1000; return tank.onReading(pct, speed, t, est) }
        assertNull("andando não ancora", (1..20).map { feed(39.0, 30.0, 10.0) }.last())
        val results = (1..12).map { feed(39.0, 0.0, 10.0) }
        assertEquals(18.72, results.filterNotNull().first(), 1e-9)
        val tank2 = TankAnchor(48.0)
        t = 0L
        assertTrue("diferença menor que 1 L mantém a estimativa", (1..12).map { t += 1000; tank2.onReading(39.0, 0.0, t, 18.5) }.all { it == null })
    }

    @Test fun lateGaugeAfterFuelUpDoesNotUndoTheFullTank() {
        // Como em 05/11: tanque cheio registrado (48 L) com o ponteiro ainda em 17%, subindo devagar.
        val tank = TankAnchor(48.0)
        var t = 1_000_000L
        val fuelUpAt = t
        // Cada etapa começa andando (zera a janela de leituras paradas), como no uso real.
        fun still(pct: Double, n: Int, est: Double): List<Double?> {
            t += 1000
            tank.onReading(pct, 30.0, t, est, fuelUpAt)
            return (1..n).map { t += 1000; tank.onReading(pct, 0.0, t, est, fuelUpAt) }
        }
        assertTrue("ponteiro atrasado não baixa o nível informado", still(17.0, 20, 48.0).all { it == null })
        assertTrue("subindo, ainda atrás: mantém", still(60.0, 20, 47.5).all { it == null })
        assertTrue("alcançou (dentro de 1 L): nada muda", still(98.0, 20, 47.2).all { it == null })
        // Depois de alcançar, volta a valer o painel, inclusive para baixo.
        // Dias depois, com o tanque gasto.
        t += 11 * 60_000L
        assertEquals(30.0 / 100 * 48, still(30.0, 20, 47.0).filterNotNull().first(), 1e-9)
    }

    @Test fun risingGaugeOnlyPullsTheEstimateUp() {
        // Sem abastecimento registrado: enquanto o ponteiro sobe, só serve para aumentar a estimativa.
        val tank = TankAnchor(48.0)
        var t = 0L
        fun still(pct: Double, n: Int, est: Double) = (1..n).map { t += 1000; tank.onReading(pct, 0.0, t, est) }
        still(17.0, 5, 8.0)
        assertEquals(40.0 / 100 * 48, still(40.0, 15, 8.0).filterNotNull().first(), 1e-9)
        assertTrue("subindo e abaixo da estimativa: ignora", still(41.0, 15, 30.0).all { it == null })
    }

    @Test fun badSignalDefinitionIsRefused() {
        val json = File("src/main/assets/profiles/fiat_uno_vivace_7gf.json").readText()
            .replace("\"frame\": \"2A0\", \"start\": 0,", "\"frame\": \"2A0\", \"start\": 7,")
        val error = runCatching { ProfileParser.parse(json) }.exceptionOrNull()
        assertTrue(error.toString(), error is ProfileException)
    }
}

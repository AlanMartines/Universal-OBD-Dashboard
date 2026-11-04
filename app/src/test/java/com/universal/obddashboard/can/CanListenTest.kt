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

    @Test fun unoProfileDecodesConfirmedSignals() {
        assertEquals(56.0, decode("t2A04038000DE")["can_speed"]!!, 1e-9)
        assertEquals(39.0, decode("t3808000000000027FF00")["fuel_level_pct"]!!, 1e-9)
        assertEquals(123456.0, decode("t60380001E24000000000")["odometer_km"]!!, 1e-9)
        assertEquals(625.0, decode("t643800000000000186A0")["trip_km"]!!, 1e-9)
        assertTrue("quadro sem sinal mapeado", decode("t2818030180820190290").isEmpty())
        assertTrue("acima de 100% é descartado", decode("t38080000000000C8FF00").isEmpty())
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

    @Test fun badSignalDefinitionIsRefused() {
        val json = File("src/main/assets/profiles/fiat_uno_vivace_7gf.json").readText()
            .replace("\"frame\": \"2A0\", \"start\": 0,", "\"frame\": \"2A0\", \"start\": 7,")
        val error = runCatching { ProfileParser.parse(json) }.exceptionOrNull()
        assertTrue(error.toString(), error is ProfileException)
    }
}

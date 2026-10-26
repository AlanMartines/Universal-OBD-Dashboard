package com.universal.obddashboard.car

import androidx.car.app.model.CarColor
import androidx.car.app.model.GridItem
import androidx.car.app.model.GridTemplate
import androidx.car.app.testing.TestCarContext
import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import com.universal.obddashboard.obd.ProfileParser
import com.universal.obddashboard.telemetry.ConnectionStatus
import com.universal.obddashboard.telemetry.TelemetryHub
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.annotation.Config
import java.io.File

/**
 * Tela do Android Auto com a biblioteca de testes oficial: o GridTemplate é montado (os builders
 * validam as regras do host) e os títulos ficam fixos entre atualizações, para que cada refresh
 * não conte como um novo passo na pilha de templates.
 */
@RunWith(AndroidJUnit4::class)
@Config(sdk = [34])
class TelemetryScreenTest {

    private val carContext = TestCarContext.createCarContext(ApplicationProvider.getApplicationContext())

    @Before fun profile() {
        TelemetryHub.reset(ProfileParser.parse(File("src/main/assets/profiles/fiat_uno_vivace_7gf.json").readText()))
    }

    private fun grid(): GridTemplate = TelemetryScreen(carContext).onGetTemplate() as GridTemplate
    private fun items(t: GridTemplate) = t.singleList!!.items.map { it as GridItem }

    @Test fun idleScreenHasSixFixedTiles() {
        TelemetryHub.update { it.copy(connection = ConnectionStatus.IDLE, statusMessage = "") }
        val t = grid()
        assertEquals(listOf("RPM", "Velocidade", "Motor", "Consumo", "Bateria", "Alertas"), items(t).map { it.title.toString() })
        assertEquals("--", items(t)[0].text.toString())
        assertEquals("Iniciar", t.actionStrip!!.actions.single().title.toString())
    }

    @Test fun streamingValuesAndColors() {
        val now = System.currentTimeMillis()
        TelemetryHub.update { it.copy(connection = ConnectionStatus.STREAMING) }
        TelemetryHub.mergeValues(mapOf("rpm" to 6400.0, "speed" to 100.0, "coolant_temp" to 106.0, "battery_volts" to 14.1), now)
        val t = grid()
        val byTitle = items(t).associateBy { it.title.toString() }
        assertTrue(byTitle["RPM"]!!.text.toString().startsWith("6.400") || byTitle["RPM"]!!.text.toString().startsWith("6400"))
        assertTrue(byTitle["Velocidade"]!!.text.toString().startsWith("100 km/h"))
        assertTrue(byTitle["Motor"]!!.text.toString().contains("CRÍTICO"))
        assertEquals(CarColor.RED, byTitle["Motor"]!!.image!!.tint)
        assertEquals(CarColor.RED, byTitle["RPM"]!!.image!!.tint)          // acima da faixa vermelha (6250)
        assertEquals(CarColor.GREEN, byTitle["Bateria"]!!.image!!.tint)
        // Títulos iguais aos da tela parada: o host trata como atualização, não como nova tela
        assertEquals(listOf("RPM", "Velocidade", "Motor", "Consumo", "Bateria", "Alertas"), byTitle.keys.toList())
    }
}

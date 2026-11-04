package com.universal.obddashboard.remote

import com.universal.obddashboard.db.TelemetryLogEntity
import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.Json
import org.junit.Test
import java.io.File
import java.io.IOException

class RemoteTest {
    private fun entity(id: Long, extra: String? = null) = TelemetryLogEntity(
        id = id, tripId = 7, timestamp = 1_790_000_000_000 + id, rpm = 900.0, speedObdKmh = 40.0, coolantC = 88.0,
        voltage = 13.8, fuelLph = 1.2, latitude = -10.5, longitude = -20.5, speedGpsKmh = 41.0, gpsAccuracyM = 5f, extraJson = extra,
    )

    @Test fun gpsSoSaiComAOpcaoLigada() {
        assertFalse(RemotePayload.sample(entity(1), sendGps = false).toString().contains("-10.5"))
        val on = RemotePayload.sample(entity(1), sendGps = true).toString()
        assertTrue(on.contains("\"lat\":-10.5"))
    }

    @Test fun listaFechadaDeCampos() {
        val s = RemotePayload.sample(entity(1), sendGps = true)
        assertEquals(setOf("seq", "ts", "tripId", "metrics", "gps"), s.keys)
        assertTrue(s["metrics"].toString().contains("\"rpm\":900.0"))
        assertTrue(s["metrics"].toString().contains("\"derived.fuelLph\":1.2"))
    }

    @Test fun extrasInvalidosFicamDeFora() {
        val extra = """{"fuel_rate":2.5,"vin":"9BD00000000000000","x y;DROP":1,"nan":"NaN","obj":{"a":1}}"""
        val text = RemotePayload.sample(entity(1, extra), sendGps = false)["metrics"].toString()
        assertTrue(text.contains("fuel_rate"))
        assertFalse(text.contains("vin"))
        assertFalse(text.contains("DROP"))
        assertFalse(text.contains("obj"))
    }

    @Test fun extraCorrompidoNaoDerrubaOEnvio() {
        assertTrue(RemotePayload.sample(entity(1, "{quebrado"), false)["metrics"].toString().contains("rpm"))
    }

    @Test fun numeroInfinitoNaoSai() {
        val s = RemotePayload.sample(entity(1).copy(rpm = Double.NaN, coolantC = Double.POSITIVE_INFINITY), false)
        assertFalse(s["metrics"].toString().contains("rpm"))
        assertFalse(s["metrics"].toString().contains("coolant"))
    }

    @Test fun dtcsInvalidosFicamDeFora() {
        val s = RemotePayload.sample(entity(1), false, listOf("P0301", "<img>", "P0301")).toString()
        assertTrue(s.contains("\"dtcs\":[\"P0301\"]"))
    }

    @Test fun enderecoSoHttps() {
        assertEquals("https://a.exemplo.test", RemoteClient.normalizeUrl(" https://a.exemplo.test/ "))
        for (bad in listOf("http://a.test", "ftp://a.test", "a.test", "", "https://user:senha@a.test", "https://a.test?x=1", "javascript:alert(1)")) {
            assertThrows(bad, IllegalArgumentException::class.java) { RemoteClient.normalizeUrl(bad) }
        }
    }

    @Test fun pareamentoEMensagens() {
        var body = ""
        val ok = RemoteClient("https://a.test", { _, _, b, _ ->
            body = b
            RemoteClient.Response(200, """{"deviceId":"d1","deviceName":"Celular","deviceToken":"obd_dev_abc"}""")
        }).pair(" ABCD-EFGH-JKLM ", "uuid", "1.0.0")
        assertEquals("obd_dev_abc", ok.token)
        assertTrue(body.contains("\"code\":\"ABCD-EFGH-JKLM\""))
        for (code in listOf(401, 400, 429, 500)) {
            assertThrows(RemoteClient.PairingException::class.java) {
                RemoteClient("https://a.test", { _, _, _, _ -> RemoteClient.Response(code, "{}") }).pair("x", "u", "1")
            }
        }
        assertThrows(RemoteClient.PairingException::class.java) {
            RemoteClient("https://a.test", { _, _, _, _ -> RemoteClient.Response(200, "<html>") }).pair("x", "u", "1")
        }
    }

    @Test fun tokenVaiNoCabecalho() {
        var headers = emptyMap<String, String>()
        var url = ""
        RemoteClient("https://a.test/", { u, h, _, _ -> url = u; headers = h; RemoteClient.Response(200, "{}") }).upload("obd_dev_x", "{}")
        assertEquals("https://a.test/api/v1/telemetry", url)
        assertEquals("Bearer obd_dev_x", headers["Authorization"])
    }

    private class FakeSource(var rows: List<TelemetryLogEntity>, override var cursor: Long = 0) : RemoteUploader.Source {
        override suspend fun samplesAfter(id: Long, limit: Int) = rows.filter { it.id > id }.take(limit)
        override suspend fun maxId() = rows.maxOfOrNull { it.id } ?: 0L
        override val sendGps = false
        override fun currentDtcs() = listOf("P0420")
    }

    @Test fun enviaEmPacotesEAvancaOCursor() = runBlocking {
        val source = FakeSource((1L..450L).map { entity(it) })
        val sizes = mutableListOf<Int>()
        val r = RemoteUploader(source) { b -> sizes += Regex("\"seq\"").findAll(b).count(); 200 }.drain()
        assertEquals(RemoteUploader.Outcome.SENT, r.outcome)
        assertEquals(listOf(200, 200, 50), sizes)
        assertEquals(450L, source.cursor)
        assertEquals(RemoteUploader.Outcome.IDLE, RemoteUploader(source) { 200 }.drain().outcome)
    }

    @Test fun semRedeNaoPerdeNada() = runBlocking {
        val source = FakeSource((1L..5L).map { entity(it) })
        val r = RemoteUploader(source) { throw IOException("sem rede") }.drain()
        assertEquals(RemoteUploader.Outcome.RETRY, r.outcome)
        assertEquals(0L, source.cursor)
    }

    @Test fun erroDoServidorRepeteEDepoisEnvia() = runBlocking {
        val source = FakeSource((1L..5L).map { entity(it) })
        assertEquals(RemoteUploader.Outcome.RETRY, RemoteUploader(source) { 503 }.drain().outcome)
        assertEquals(0L, source.cursor)
        assertEquals(RemoteUploader.Outcome.RETRY, RemoteUploader(source) { 429 }.drain().outcome)
        assertEquals(5, RemoteUploader(source) { 200 }.drain().sent)
    }

    @Test fun pacoteRecusadoNaoTravaAFila() = runBlocking {
        val source = FakeSource((1L..5L).map { entity(it) })
        val r = RemoteUploader(source) { 400 }.drain()
        assertEquals(5, r.dropped)
        assertEquals(5L, source.cursor)
    }

    @Test fun revogadoParaDeEnviar() = runBlocking {
        val source = FakeSource((1L..5L).map { entity(it) })
        var calls = 0
        val r = RemoteUploader(source) { calls++; 401 }.drain()
        assertEquals(RemoteUploader.Outcome.REVOKED, r.outcome)
        assertEquals(1, calls)
        assertEquals(0L, source.cursor)
    }

    @Test fun cursorAFrenteVoltaDepoisDeRestaurarBackup() = runBlocking {
        val source = FakeSource((1L..3L).map { entity(it) }, cursor = 900)
        RemoteUploader(source) { 200 }.drain()
        assertEquals(3L, source.cursor)
    }

    @Test fun esperaCrescenteComLimite() {
        assertEquals(5_000L, RemoteUploader.backoffMs(0))
        assertEquals(10_000L, RemoteUploader.backoffMs(1))
        assertEquals(300_000L, RemoteUploader.backoffMs(20))
    }

    @Test fun leituraAoVivoSemSequenciaEComExtras() {
        val text = RemotePayload.live(entity(5), false, listOf("P0301"), mapOf("dash.rpmMax" to 7000.0, "derived.x" to null, "ruim y" to 1.0, "nan" to Double.NaN))
        assertFalse(text.contains("\"seq\""))
        assertFalse(text.contains("tripId"))
        assertFalse(text.contains("-10.5"))
        assertTrue(text.contains("\"dash.rpmMax\":7000.0"))
        assertFalse(text.contains("ruim"))
        assertFalse(text.contains("nan"))
        assertTrue(text.contains("P0301"))
        val withAlerts = Json.parseToJsonElement(
            RemotePayload.live(entity(5), false, emptyList(), emptyMap(), listOf(
                RemotePayload.LiveAlert("CRITICAL", "Rotação: 6500 RPM <script>"),
                RemotePayload.LiveAlert("INFO", "não vai"),
            )),
        ).jsonObject
        val alerts = withAlerts["alerts"]!!.jsonArray
        assertEquals(1, alerts.size)
        assertEquals("Rotação: 6500 RPM script", alerts[0].jsonObject["message"]!!.jsonPrimitive.content)
        assertEquals(0, Json.parseToJsonElement(RemotePayload.live(entity(5), false, emptyList(), emptyMap())).jsonObject["alerts"]!!.jsonArray.size)
    }

    @Test fun ritmoAoVivoSegueQuemEstaOlhando() {
        assertEquals(1_000L, RemoteUploader.liveDelayMs(2))
        assertEquals(10_000L, RemoteUploader.liveDelayMs(0))
        assertEquals(30_000L, RemoteUploader.liveDelayMs(null))
    }

    @Test fun recusaDoServidorNaoViraErro() {
        assertEquals(null, RemoteClient("https://a.test", { _, _, _, _ -> RemoteClient.Response(401, "{}") }).live("t", "{}"))
        assertEquals(3, RemoteClient("https://a.test", { _, _, _, _ -> RemoteClient.Response(200, "{\"viewers\":3}") }).live("t", "{}"))
    }

    /** Gera um pacote real para conferir contra a API do servidor. */
    @Test fun gravaAmostraParaConferirComOServidor() {
        val dir = File("build/remote-contract").apply { mkdirs() }
        val now = System.currentTimeMillis()
        val body = RemotePayload.batch(
            listOf(
                RemotePayload.sample(entity(1, """{"fuel_rate":2.5}""").copy(timestamp = now - 1000), sendGps = true),
                RemotePayload.sample(entity(2).copy(timestamp = now), sendGps = false, dtcs = listOf("P0301")),
            ),
        )
        File(dir, "batch.json").writeText(body)
    }

    @Test fun fuelUpsLeaveStationAndNotesOnThePhone() {
        val f = com.universal.obddashboard.db.FuelUpEntity(
            id = 3, timestamp = 1_000, profileId = "p", odometerKm = 1234.0, liters = 7.473, totalPrice = 50.0, pricePerLiter = 6.691,
            fuelType = "gasoline_premium", fullTank = false, station = "Posto da esquina", notes = "perto de casa",
        )
        val text = RemotePayload.fuelUps(listOf(f, f.copy(id = 0)))
        val items = Json.parseToJsonElement(text).jsonObject["items"]!!.jsonArray
        assertEquals("sem id local não vai", 1, items.size)
        val o = items[0].jsonObject
        assertEquals("gasoline_premium", o["fuelType"]!!.jsonPrimitive.content)
        assertEquals("false", o["fullTank"]!!.jsonPrimitive.content)
        assertTrue(!text.contains("Posto") && !text.contains("casa") && !text.contains("station"))
    }
}

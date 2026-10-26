package com.universal.obddashboard.export

import com.universal.obddashboard.db.DiagnosticTroubleCodeEntity
import com.universal.obddashboard.db.TelemetryLogEntity
import com.universal.obddashboard.db.TripEntity
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import java.time.ZoneId
import javax.xml.parsers.DocumentBuilderFactory

class TripExporterTest {

    private val t0 = 1_761_220_800_000L // 2025-10-23T12:00:00Z
    private val trip = TripEntity(id = 7, profileId = "fiat_uno_vivace_7gf", startTime = t0, endTime = t0 + 60_000)

    private fun sample(dtS: Int, lat: Double? = -23.55, extra: String? = null) = TelemetryLogEntity(
        tripId = 7,
        timestamp = t0 + dtS * 1000L,
        rpm = 2100.0,
        speedObdKmh = 42.0,
        coolantC = 91.0,
        voltage = 14.1,
        latitude = lat,
        longitude = lat?.let { -46.63 },
        gpsAccuracyM = 3.9f,
        extraJson = extra,
    )

    // ---------------- CSV ----------------

    @Test fun csvHasFixedColumnsAndUnionOfExtras() {
        val csv = TripExporter.csv(
            listOf(
                sample(0, extra = """{"lambda_b1s2_v":0.62}"""),
                sample(2, extra = """{"lambda_b1s1_trim":-1.5,"lambda_b1s2_v":0.6}"""),
            ),
        ).lines()

        val header = csv[0].split(',')
        assertEquals(listOf("timestamp_ms", "time_utc", "rpm"), header.take(3))
        assertEquals(listOf("lambda_b1s1_trim", "lambda_b1s2_v"), header.takeLast(2)) // ordenados
        val first = csv[1].split(',')
        assertEquals("1761220800000", first[0])
        assertEquals("2025-10-23T12:00:00Z", first[1])
        assertEquals("2100", first[header.indexOf("rpm")])          // sem ".0"
        assertEquals("3.9", first[header.indexOf("gps_accuracy_m")]) // Float sem ruído binário
        assertEquals("", first[header.indexOf("map_kpa")])           // ausente = vazio
        assertEquals("", first[header.indexOf("lambda_b1s1_trim")])
        assertEquals("-1.5", csv[2].split(',')[header.indexOf("lambda_b1s1_trim")])
        assertEquals(3, csv.count { it.isNotEmpty() })
    }

    @Test fun csvToleratesBrokenExtraJson() {
        val csv = TripExporter.csv(listOf(sample(0, extra = "{quebrado"))).lines()
        assertEquals(TripExporter.csv(listOf(sample(0))).lines()[0], csv[0])
    }

    // ---------------- GPX ----------------

    private fun parse(xml: String) = DocumentBuilderFactory.newInstance().apply { isNamespaceAware = true }
        .newDocumentBuilder().parse(xml.byteInputStream())

    @Test fun gpxIsWellFormedWithTrackPointsAndDtcWaypoints() {
        val dtc = DiagnosticTroubleCodeEntity(
            tripId = 7, code = "P0133", kind = "CONFIRMED", detectedAt = t0 + 2000,
            rpm = 2100.0, speedKmh = 42.0, latitude = -23.551, longitude = -46.631,
        )
        val xml = TripExporter.gpx(trip, listOf(sample(0), sample(2), sample(4, lat = null)), listOf(dtc), ZoneId.of("America/Sao_Paulo"))
        val doc = parse(xml)

        val pts = doc.getElementsByTagNameNS(TripExporter.GPX_NS, "trkpt")
        assertEquals(2, pts.length) // amostra sem GPS fica de fora
        assertEquals("-23.55", pts.item(0).attributes.getNamedItem("lat").nodeValue)
        assertEquals("2025-10-23T12:00:02Z", (pts.item(1) as org.w3c.dom.Element).getElementsByTagNameNS(TripExporter.GPX_NS, "time").item(0).textContent)
        assertEquals("2100", doc.getElementsByTagNameNS(TripExporter.OBD_NS, "rpm").item(0).textContent)

        val wpt = doc.getElementsByTagNameNS(TripExporter.GPX_NS, "wpt")
        assertEquals(1, wpt.length)
        assertTrue(wpt.item(0).textContent.contains("P0133"))
        assertTrue("nome com horário local", xml.contains("<name>Viagem 23/10/2025 09:00</name>"))
    }

    @Test fun gpxSplitsSegmentsOnGpsGaps() {
        val xml = TripExporter.gpx(trip, listOf(sample(0), sample(2), sample(120), sample(122)), emptyList())
        assertEquals(2, parse(xml).getElementsByTagNameNS(TripExporter.GPX_NS, "trkseg").length)
    }

    @Test fun hasGpsDetectsTripsWithoutFixes() {
        assertFalse(TripExporter.hasGps(listOf(sample(0, lat = null))))
        assertTrue(TripExporter.hasGps(listOf(sample(0, lat = null), sample(2))))
    }

    @Test fun xmlTextIsEscaped() {
        val dtc = DiagnosticTroubleCodeEntity(
            tripId = 7, code = "P<0&1>", kind = "PENDING", detectedAt = t0, latitude = 1.0, longitude = 2.0,
        )
        parse(TripExporter.gpx(trip, listOf(sample(0)), listOf(dtc))) // não lança SAXParseException
    }

    @Test fun fileNameUsesTripIdAndLocalStart() {
        assertEquals("viagem_7_20251023-0900.gpx", TripExporter.fileName(trip, "gpx", ZoneId.of("America/Sao_Paulo")))
    }
}

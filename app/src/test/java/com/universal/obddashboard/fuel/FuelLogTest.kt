package com.universal.obddashboard.fuel

import com.universal.obddashboard.db.FuelUpEntity
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.time.ZoneId

class FuelLogTest {

    private val ms = ZoneId.of("America/Campo_Grande")

    /** Três tanques cheios de uma viagem de teste (litros e km reais; datas, postos e hodômetro genéricos). */
    private val trip = """
        data_hora,hodometro_km,litros,valor_total,preco_litro,combustivel,etanol_pct,tanque_cheio,posto,observacao
        2026-01-10T08:15:30-04:00,10000,32.094,214.70,6.69,gasoline_premium,,sim,"Posto A, Cidade 1",
        2026-01-10T14:40:10-03:00,10418,32.203,209.00,6.49,gasoline_premium,,sim,Posto B,
        2026-01-11T07:05:45-03:00,10885.6,37.368,231.31,6.19,gasoline_premium,,sim,Posto C,TRIP 467.6
    """.trimIndent()

    private val list = FuelLog.fromCsv(trip, "fiat_uno_vivace_7gf", ms)

    @Test fun parsesReceiptsWithTimezones() {
        assertEquals(3, list.size)
        assertEquals("Posto A, Cidade 1", list[0].station)
        // 14:40 em -03 = 13:40 em -04
        assertEquals(1_768_066_810_000L, list[1].timestamp)
        assertEquals(32.203, list[1].liters, 0.0)
        assertTrue(list.all { it.fullTank })
    }

    @Test fun realConsumptionBetweenFullTanks() {
        val iv = FuelLog.intervals(list)
        assertEquals(2, iv.size)
        assertEquals(418.0, iv[0].distanceKm, 1e-9)
        assertEquals(12.98, iv[0].kmPerL, 0.01)           // 418 km / 32,203 L
        assertEquals(12.51, iv[1].kmPerL, 0.01)           // 467,6 km / 37,368 L
        assertEquals(0.5, iv[0].costPerKm!!, 0.001)        // R$ 209,00 / 418 km
        val s = FuelLog.summary(list, ms)
        assertEquals(12.73, s.avgKmPerL!!, 0.01)           // 885,6 km / 69,571 L
        assertEquals(655.01, s.totalCost, 1e-9)
        assertEquals(mapOf("2026-01" to 655.01), s.costByMonth.mapValues { Math.round(it.value * 100) / 100.0 })
        assertNull(s.ethanolBreakEven)                     // ainda sem etanol
    }

    @Test fun partialFillUpsAddToTheInterval() {
        val partial = list[0].copy(id = 9, timestamp = list[0].timestamp + 3_600_000, odometerKm = 10094.0, liters = 10.0,
            totalPrice = 66.9, fullTank = false)
        val iv = FuelLog.intervals(list + partial)
        assertEquals(42.203, iv[0].liters, 1e-9)            // 10 parcial + 32,203 no tanque cheio seguinte
        assertEquals(275.9, iv[0].cost!!, 1e-9)
    }

    @Test fun ethanolBreakEvenFromMeasuredConsumption() {
        val base = list[0]
        fun f(h: Long, odo: Double, l: Double, type: String) = base.copy(timestamp = base.timestamp + h * 3_600_000, odometerKm = odo, liters = l, fuelType = type)
        val log = listOf(f(0, 1000.0, 40.0, FuelLog.GASOLINE), f(10, 1500.0, 40.0, FuelLog.ETHANOL), f(20, 1850.0, 40.0, FuelLog.GASOLINE))
        // gasolina: 500 km / 40 L = 12,5; etanol: 350 km / 40 L = 8,75 → etanol compensa abaixo de 70% do preço
        assertEquals(0.70, FuelLog.summary(log, ms).ethanolBreakEven!!, 1e-9)
    }

    @Test fun tankAfterFullAndPartialFillUps() {
        val gas = list[1]                                                   // 32,203 L de gasolina, tanque cheio
        assertEquals(FuelLog.TankAfter(48.0, 0.0), FuelLog.tankAfter(gas, 48.0, 10.0, 0.0))
        // Tanque com etanol enchido com gasolina: sobram 15,8 L a 100% → 33% de etanol
        assertEquals(32.9, FuelLog.tankAfter(gas, 48.0, null, 100.0).ethanolPct, 0.1)
        val partialEthanol = gas.copy(liters = 20.0, fuelType = FuelLog.ETHANOL, fullTank = false)
        val t = FuelLog.tankAfter(partialEthanol, 48.0, 20.0, 0.0)
        assertEquals(40.0, t.levelL, 1e-9)
        assertEquals(50.0, t.ethanolPct, 1e-9)
        assertEquals(48.0, FuelLog.tankAfter(partialEthanol, 48.0, 40.0, 0.0).levelL, 1e-9)  // não passa da capacidade
        // Mistura sem % informado não mexe no % do tanque
        assertEquals(30.0, FuelLog.tankAfter(gas.copy(fuelType = FuelLog.MIX, ethanolPct = null), 48.0, null, 30.0).ethanolPct, 1e-9)
    }

    @Test fun csvRoundTrip() {
        val again = FuelLog.fromCsv(FuelLog.toCsv(list, ms), "fiat_uno_vivace_7gf", ms)
        assertEquals(list.map { it.copy(id = 0) }, again.map { it.copy(id = 0) })
    }

    @Test fun derivesMissingPriceAndRejectsBadRows() {
        val one = FuelLog.fromCsv("data_hora,litros,valor_total\n2026-10-25T10:00,40,260\n", "p", ms).single()
        assertEquals(6.5, one.pricePerLiter!!, 1e-9)
        assertEquals(FuelLog.GASOLINE, one.fuelType)
        assertTrue(runCatching { FuelLog.fromCsv("data_hora,litros\nontem,40\n", "p", ms) }.exceptionOrNull() is FuelLog.CsvException)
    }
}

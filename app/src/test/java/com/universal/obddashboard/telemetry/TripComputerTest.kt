package com.universal.obddashboard.telemetry

import com.universal.obddashboard.db.TelemetryLogEntity
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class TripComputerTest {

    @Test fun statsSplitMovingIdleFuelCutAndEcoBands() {
        val s = TripStats(ecoMidLPer100km = 10.0)
        repeat(60) { s.add(1.0, 0.0, 850.0, 1.2) }          // 1 min parado, motor ligado, 1,2 L/h
        repeat(120) { s.add(1.0, 60.0, 2500.0, 3.0) }       // 2 min a 60 km/h, 5 L/100 km: verde
        repeat(60) { s.add(1.0, 60.0, 2500.0, 6.6) }        // 1 min a 11 L/100 km: meio
        repeat(30) { s.add(1.0, 40.0, 2200.0, 0.0) }        // 30 s com a injeção cortada
        s.add(30.0, 50.0, 2000.0, 3.0)                       // buraco nos dados: ignorado
        assertEquals(60.0, s.idleS, 1e-9)
        assertEquals(1.2 / 60, s.idleFuelL, 1e-9)
        assertEquals(210.0, s.movingS, 1e-9)
        assertEquals(40.0 * 30 / 3600, s.fuelCutKm, 1e-9)
        val eco = s.ecoPct()!!
        assertEquals(100.0 * 120 / 180, eco[0], 1e-9)
        assertEquals(100.0 * 60 / 180, eco[1], 1e-9)
        assertEquals(0.0, eco[2], 1e-9)
        assertEquals((60.0 * 180 + 40.0 * 30) / 3600 / (210.0 / 3600), s.avgMovingKmh!!, 1e-9)
    }

    @Test fun bandsFollowTheMiddleOfTheGauge() {
        assertEquals(0, TripStats.band(5.0))
        assertEquals(1, TripStats.band(10.4))
        assertEquals(2, TripStats.band(12.6))
        assertEquals(0, TripStats.band(7.0, mid = 8.0))
    }

    @Test fun statsFromRecordedSamples() {
        val logs = (0 until 31).map { i -> TelemetryLogEntity(tripId = 1, timestamp = i * 2000L, rpm = 850.0, speedObdKmh = 0.0, fuelLph = 1.0) }
        val s = TripStats.fromLogs(logs)
        assertEquals(60.0, s.idleS, 1e-9)
        assertNull("sem tempo andando, sem média", s.avgMovingKmh)
    }

    @Test fun smoothingFollowsWithoutJumping() {
        val m = Smoothed(tauS = 3.0)
        assertEquals(10.0, m.update(10.0, 1.0)!!, 1e-9)
        val next = m.update(20.0, 1.0)!!
        assert(next > 10.0 && next < 20.0)
        assertEquals(next, m.update(null, 1.0)!!, 1e-9)
    }

    @Test fun legsNeedEnoughDataForKmPerL() {
        assertNull(Leg(0.5, 0.05).kmPerL)
        assertEquals(12.0, Leg(12.0, 1.0).kmPerL!!, 1e-9)
        assertEquals(Leg(0.0, 0.0), Leg(1.0, 0.1) - Leg(2.0, 0.3))
    }

    @Test fun periodSinceMarkCountsOnlyWhatCameAfter() {
        val mark = TripMark(since = 1000, tripId = 7, km = 3.0, liters = 0.3)
        // Viagem da marca ainda em andamento: só o resto dela
        assertEquals(Leg(10.0, 1.0), TripComputer.sinceMark(mark, Leg(5.0, 0.5), null, Leg(8.0, 0.8), 7, 500))
        // Viagem da marca terminada, outra em andamento que começou depois: as duas
        assertEquals(Leg(15.0, 1.5), TripComputer.sinceMark(mark, Leg(5.0, 0.5), Leg(8.0, 0.8), Leg(5.0, 0.5), 9, 2000))
        // Viagem em andamento que começou antes da marca e não é a dela: fica de fora
        assertEquals(Leg(5.0, 0.5), TripComputer.sinceMark(mark, Leg(5.0, 0.5), null, Leg(50.0, 5.0), 3, 100))
        assertEquals(mark, TripMark.decode(mark.encode()))
        assertNull(TripMark.decode("lixo"))
    }

    @Test fun recentStopsAfterFiftyKm() {
        val prev = listOf(Leg(30.0, 3.0), Leg(20.0, 2.0), Leg(100.0, 10.0))
        assertEquals(Leg(60.0, 6.0), TripComputer.recent(Leg(10.0, 1.0), prev))
    }

    @Test fun rangeToReserveAndEmpty() {
        val (reserve, empty) = TripComputer.range(fuelL = 16.0, kmPerL = 12.0, reserveL = 6.5)
        assertEquals(114.0, reserve!!, 1e-9)
        assertEquals(192.0, empty!!, 1e-9)
        assertEquals(0.0, TripComputer.range(5.0, 12.0, 6.5).first!!, 1e-9)
        assertNull(TripComputer.range(null, 12.0, 6.5).second)
        // Média desde o abastecimento só com km suficientes; senão a real
        assertEquals(11.0, TripComputer.rangeKmPerL(Leg(10.0, 0.5), 11.0, null)!!, 1e-9)
        assertEquals(12.5, TripComputer.rangeKmPerL(Leg(50.0, 4.0), 11.0, null)!!, 1e-9)
        assertEquals(0.5, TripComputer.costPerKm(6.0, 12.0)!!, 1e-9)
    }
}

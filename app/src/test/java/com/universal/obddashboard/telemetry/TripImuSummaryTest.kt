package com.universal.obddashboard.telemetry

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test
import org.junit.runner.RunWith
import androidx.test.ext.junit.runners.AndroidJUnit4
import org.robolectric.annotation.Config

@RunWith(AndroidJUnit4::class)
@Config(sdk = [34])
class TripImuSummaryTest {

    @Test fun takesTheLargestOfEachMaximum() {
        val s = TripImuSummary.fromExtras(listOf(
            """{"derived.maxBrakeG":0.21,"derived.maxAccelG":0.18,"derived.maxLateralG":0.12,"derived.bumps":1}""",
            null,
            """{"rpm_x":1}""",
            """{"derived.maxBrakeG":0.43,"derived.maxAccelG":0.18,"derived.maxLateralG":0.31,"derived.bumps":4}""",
        ))!!
        assertEquals(0.43, s.maxBrakeG, 1e-9)
        assertEquals(0.18, s.maxAccelG, 1e-9)
        assertEquals(0.31, s.maxLateralG, 1e-9)
        assertEquals(4, s.bumps)
    }

    @Test fun noSensorNoSummary() {
        assertNull(TripImuSummary.fromExtras(listOf(null, """{"cabin_temp":24}""", "lixo")))
    }
}

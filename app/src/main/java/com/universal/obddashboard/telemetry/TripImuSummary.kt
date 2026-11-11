package com.universal.obddashboard.telemetry

import org.json.JSONObject

/**
 * O que o sensor de movimento (LSM6DS3 no ESP32) registrou numa viagem, pelas leituras gravadas: os máximos
 * já vêm acumulados pelo [ImuMotion] em cada amostra (derived.maxBrakeG, maxAccelG, maxLateralG, bumps), então
 * vale o maior de cada um. null quando a viagem não teve o sensor.
 */
data class TripImuSummary(val maxBrakeG: Double, val maxAccelG: Double, val maxLateralG: Double, val bumps: Int) {
    companion object {
        fun fromExtras(extras: List<String?>): TripImuSummary? {
            var brake = 0.0; var accel = 0.0; var lateral = 0.0; var bumps = 0
            var seen = false
            for (raw in extras) {
                if (raw.isNullOrEmpty() || !raw.contains("derived.max")) continue
                val o = runCatching { JSONObject(raw) }.getOrNull() ?: continue
                fun v(k: String) = o.optDouble(k, Double.NaN).takeIf { it.isFinite() }
                v("derived.maxBrakeG")?.let { seen = true; brake = maxOf(brake, it) }
                v("derived.maxAccelG")?.let { seen = true; accel = maxOf(accel, it) }
                v("derived.maxLateralG")?.let { seen = true; lateral = maxOf(lateral, it) }
                v("derived.bumps")?.let { bumps = maxOf(bumps, it.toInt()) }
            }
            return if (seen) TripImuSummary(brake, accel, lateral, bumps) else null
        }
    }
}

package com.universal.obddashboard.telemetry

/** Leituras do acelerômetro, giroscópio e barômetro do celular (reserva dos sensores do ESP32). */
object PhoneSensors {
    const val AX = "phone_ax"
    const val AY = "phone_ay"
    const val AZ = "phone_az"
    const val GX = "phone_gx"
    const val GY = "phone_gy"
    const val GZ = "phone_gz"
    const val PEAK = "phone_peak"
    const val PRESSURE = "phone_pressure"

    /** Sinais da rede do carro que servem de segunda fonte, pelos nomes usados nos perfis com escuta CAN. */
    const val CAN_RPM = "can_rpm"
    const val CAN_VOLTAGE = "can_voltage"
    const val CAN_COOLANT = "can_coolant_temp"
}

package com.universal.obddashboard.telemetry

/**
 * Motor ligado ou desligado por votação de fontes independentes. Se uma cair (o ELM327 parou de responder, a rede CAN
 * dormiu, o ESP32 desconectou), as outras decidem:
 * - **RPM** (OBD ou rede CAN): acima de [RPM_ON] é ligado; zero é desligado. Quando existe, decide sozinho.
 * - **Tensão** (rede do carro, ELM327 ou o divisor do ESP32): acima de [ALTERNATOR_V] o alternador está carregando, então
 *   o motor gira; abaixo de [BATTERY_ONLY_V], só a bateria.
 * - **Vibração** do sensor de movimento parado (mediana do pico dos últimos segundos): nas gravações de 14/11/2026, motor
 *   desligado deu 0,02 a 0,03 g; em marcha lenta, 0,04 a 0,09 g.
 *
 * O resultado é [on] (null sem nenhuma fonte) e [source], a fonte que decidiu.
 */
object EngineVote {

    data class Result(val on: Boolean?, val source: String?, val votes: Int)

    /**
     * @param rpm RPM recente (OBD ou CAN), ou null
     * @param volts tensões recentes de todas as fontes que houver
     * @param vibrationG mediana do pico do sensor de movimento com o carro parado (g), ou null andando ou sem sensor
     */
    fun decide(rpm: Double?, volts: List<Double>, vibrationG: Double?): Result {
        if (rpm != null) return Result(rpm >= RPM_ON, SOURCE_RPM, 1)
        val byVolts = volts.filter { it in 6.0..17.5 }.maxOrNull()?.let { v ->
            when {
                v >= ALTERNATOR_V -> true
                v <= BATTERY_ONLY_V -> false
                else -> null
            }
        }
        val byVibration = vibrationG?.let { it >= VIBRATION_ON_G }
        val votes = listOfNotNull(byVolts, byVibration)
        return when {
            byVolts != null -> Result(byVolts, SOURCE_VOLTS, votes.size)
            byVibration != null -> Result(byVibration, SOURCE_VIBRATION, votes.size)
            else -> Result(null, null, 0)
        }
    }

    const val RPM_ON = 300.0
    /** Alternador carregando: acima disto o motor gira. */
    const val ALTERNATOR_V = 13.3
    /** Só bateria (motor parado): abaixo disto. Entre os dois, a tensão não decide. */
    const val BATTERY_ONLY_V = 12.9
    /** Vibração do motor em marcha lenta, com o carro parado (mediana do pico, g). */
    const val VIBRATION_ON_G = 0.035

    const val SOURCE_RPM = "rpm"
    const val SOURCE_VOLTS = "tensao"
    const val SOURCE_VIBRATION = "vibracao"
}

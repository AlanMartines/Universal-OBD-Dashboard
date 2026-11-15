package com.universal.obddashboard.telemetry

/**
 * Bateria pelo divisor do ESP32 (firmware 1.6), conferida com a tensão que a rede do carro (ou o ELM327) informa:
 * - [restV]: tensão em repouso, lida pelo ESP32 assim que ligou, antes da partida;
 * - [crankV]: a menor tensão desde que ele ligou, depois de o motor pegar (a queda da partida);
 * - [diffV]: média que esquece devagar de ESP32 − carro, com as duas leituras frescas.
 *
 * A queda da partida diz muito da bateria: acima de uns 10 V é saudável; perto de 9,6 V ou menos, ela está fraca.
 */
class BatteryWatch {

    var restV: Double? = null; private set
    var crankV: Double? = null; private set
    var diffV: Double? = null; private set
    private var engineSeen = false

    /** [espRest] e [espLowest] vêm da linha do ESP32; [engineOn] da votação do motor. */
    fun update(espV: Double?, espRest: Double?, espLowest: Double?, carV: Double?, engineOn: Boolean?) {
        if (espRest != null) restV = espRest
        if (engineOn == true) engineSeen = true
        // A menor tensão só é a da partida depois que o motor pegou
        if (engineSeen && espLowest != null) crankV = espLowest
        if (espV != null && carV != null && carV in 6.0..17.5) {
            val d = espV - carV
            diffV = diffV?.let { it + (d - it) * GAIN } ?: d
        }
    }

    companion object {
        const val GAIN = 0.02
        const val CRANK_WEAK_V = 9.6
    }
}

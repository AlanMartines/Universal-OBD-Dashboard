package com.universal.obddashboard.telemetry

/**
 * Temperatura de fora estimada pela do ar da admissão (IAT). Com o motor frio (a água perto da temperatura do ar e abaixo
 * de [COLD_COOLANT_C]), o carro ficou parado tempo bastante para tudo igualar com o ambiente: a primeira leitura da
 * admissão nessas condições é a temperatura de fora. Andando rápido, o ar que entra também fica perto da de fora (mas o
 * cofre aquece um pouco), então a estimativa só desce com o carro a [MOVING_KMH] por [MOVING_S] seguidos.
 *
 * É uma estimativa (marcada como tal na tela): o sensor BMP180 do ESP32 fica dentro da caixa e mede a temperatura de lá.
 */
class AmbientEstimate {

    var ambientC: Double? = null; private set
    /** "partida" (motor frio) ou "andando". */
    var source: String? = null; private set
    private var movingS = 0.0

    fun update(dtS: Double, intakeC: Double?, coolantC: Double?, speedKmh: Double?) {
        if (intakeC == null) return
        if (ambientC == null && coolantC != null && coolantC <= COLD_COOLANT_C && coolantC - intakeC <= COLD_DIFF_C) {
            ambientC = intakeC
            source = SOURCE_COLD
            return
        }
        if (speedKmh != null && speedKmh >= MOVING_KMH) movingS += dtS else movingS = 0.0
        if (movingS >= MOVING_S) {
            val a = ambientC
            // A admissão andando só fica mais quente que o ar de fora: desce a estimativa, não sobe (exceto sem nenhuma)
            if (a == null || intakeC < a) {
                ambientC = intakeC
                source = SOURCE_MOVING
            }
        }
    }

    companion object {
        const val COLD_COOLANT_C = 45.0
        const val COLD_DIFF_C = 6.0
        const val MOVING_KMH = 60.0
        const val MOVING_S = 180.0
        const val SOURCE_COLD = "partida"
        const val SOURCE_MOVING = "andando"
    }
}

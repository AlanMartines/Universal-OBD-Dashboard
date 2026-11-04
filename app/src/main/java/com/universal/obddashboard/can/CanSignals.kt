package com.universal.obddashboard.can

import com.universal.obddashboard.obd.Expr
import com.universal.obddashboard.obd.FormulaEvaluator
import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable

/**
 * Sinais lidos da rede CAN do carro por um adaptador de escuta (ESP32 em listen-only), definidos no
 * perfil de cada veículo. A rede, os IDs e as fórmulas mudam de um carro para outro.
 */
@Serializable
data class CanListenSettings(
    /** Só informativo: a velocidade da rede fica no firmware do adaptador. */
    @SerialName("bitrate_kbps") val bitrateKbps: Int? = null,
    val signals: List<CanSignalDefinition> = emptyList(),
)

@Serializable
data class CanSignalDefinition(
    val id: String,
    val name: String = id,
    /** ID do quadro em hexadecimal, ex.: "2A0" (11 bits) ou "18DAF110" (29 bits). */
    val frame: String,
    /** Primeiro byte usado (0 a 7) e quantos bytes: viram A, B, C… na fórmula. */
    val start: Int,
    val length: Int = 1,
    val formula: String,
    val unit: String = "",
    val decimals: Int = 0,
    val min: Double? = null,
    val max: Double? = null,
)

class CompiledCanSignal(val def: CanSignalDefinition, val frameId: Int, val expr: Expr)

/** Linha slcan do firmware: "t2A04016200DE" ou "T18DAF11080102…". Estado ("#…") e RTR viram null. */
object Slcan {
    data class Frame(val id: Int, val data: IntArray)

    private val STD = Regex("^t([0-9A-Fa-f]{3})([0-8])([0-9A-Fa-f]*)$")
    private val EXT = Regex("^T([0-9A-Fa-f]{8})([0-8])([0-9A-Fa-f]*)$")

    fun parse(line: String): Frame? {
        val m = STD.matchEntire(line.trim()) ?: EXT.matchEntire(line.trim()) ?: return null
        val len = m.groupValues[2].toInt()
        val hex = m.groupValues[3]
        if (hex.length != len * 2) return null
        return Frame(m.groupValues[1].toInt(16), IntArray(len) { hex.substring(it * 2, it * 2 + 2).toInt(16) })
    }
}

/** Converte quadros em leituras com os sinais do perfil. Valor fora de min/max é descartado. */
class CanDecoder(signals: List<CompiledCanSignal>) {
    private val byFrame = signals.groupBy { it.frameId }

    fun decode(frame: Slcan.Frame): Map<String, Double> {
        val list = byFrame[frame.id] ?: return emptyMap()
        val out = HashMap<String, Double>()
        for (s in list) {
            if (s.def.start < 0 || s.def.start + s.def.length > frame.data.size) continue
            val v = FormulaEvaluator.evaluateBytes(s.expr, frame.data.copyOfRange(s.def.start, s.def.start + s.def.length))
            if (!v.isFinite()) continue
            if ((s.def.min != null && v < s.def.min) || (s.def.max != null && v > s.def.max)) continue
            out[s.def.id] = v
        }
        return out
    }
}

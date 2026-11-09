package com.universal.obddashboard.can

import com.universal.obddashboard.obd.Expr
import com.universal.obddashboard.obd.FormulaEvaluator
import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import kotlin.math.abs

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

    /** Leitura do sensor BMP180 do ESP32 (no módulo, não na rede do carro). */
    const val CABIN_TEMP = "cabin_temp"
    const val CABIN_PRESSURE = "cabin_pressure"
    private val BMP = Regex("^# bmp180 temp=(-?\\d+(?:\\.\\d+)?)C pressao=(\\d+(?:\\.\\d+)?)hPa$")

    /** `# bmp180 temp=24.3C pressao=1013.2hPa` → temperatura (°C) e pressão (hPa); fora da faixa do sensor, null. */
    fun parseAmbient(line: String): Map<String, Double>? {
        val m = BMP.matchEntire(line.trim()) ?: return null
        val t = m.groupValues[1].toDouble()
        val p = m.groupValues[2].toDouble()
        if (t !in -40.0..85.0 || p !in 300.0..1100.0) return null
        return mapOf(CABIN_TEMP to t, CABIN_PRESSURE to p)
    }

    /** Acelerômetro e giroscópio LSM6DS3 do ESP32: aceleração (g), rotação (°/s) e pico do intervalo (g). */
    const val IMU_AX = "imu_ax"
    const val IMU_AY = "imu_ay"
    const val IMU_AZ = "imu_az"
    const val IMU_GX = "imu_gx"
    const val IMU_GY = "imu_gy"
    const val IMU_GZ = "imu_gz"
    const val IMU_PEAK = "imu_peak"
    private const val NUM = "(-?\\d+(?:\\.\\d+)?)"
    private val IMU = Regex("^# lsm6ds3 ax=$NUM ay=$NUM az=$NUM gx=$NUM gy=$NUM gz=$NUM pico=$NUM$")

    /** `# lsm6ds3 ax=0.012 ay=-0.034 az=0.998 gx=0.1 gy=-0.2 gz=0.0 pico=0.15`; fora da faixa do sensor, null. */
    fun parseImu(line: String): Map<String, Double>? {
        val m = IMU.matchEntire(line.trim()) ?: return null
        val v = m.groupValues.drop(1).map { it.toDouble() }
        if (v.take(3).any { abs(it) > 4.5 } || v.subList(3, 6).any { abs(it) > 300 } || v[6] !in 0.0..8.0) return null
        return listOf(IMU_AX, IMU_AY, IMU_AZ, IMU_GX, IMU_GY, IMU_GZ, IMU_PEAK).zip(v).toMap()
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

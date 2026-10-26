package com.universal.obddashboard.obd

/**
 * Monitores de prontidão (SAE J1979, PID 0101 bytes B, C e D): quais autodiagnósticos a ECU
 * suporta e se já completaram desde a última vez que os códigos foram apagados. Só leitura.
 *
 * O perfil expõe os bytes como saídas ocultas [OUT_B], [OUT_C] e [OUT_D] do comando 0101.
 */
object Readiness {

    const val OUT_B = "readiness_b"
    const val OUT_C = "readiness_c"
    const val OUT_D = "readiness_d"

    data class Monitor(val id: String, val name: String, val complete: Boolean)

    data class Status(val compressionIgnition: Boolean, val monitors: List<Monitor>) {
        val incomplete: List<Monitor> get() = monitors.filterNot { it.complete }
        val allComplete: Boolean get() = monitors.isNotEmpty() && incomplete.isEmpty()
    }

    /** Byte B: bits 0–2 = suportado, bits 4–6 = incompleto (1) para os monitores contínuos. */
    private val CONTINUOUS = listOf("misfire" to "Falha de ignição", "fuel_system" to "Sistema de combustível", "components" to "Componentes")

    /** Bytes C (suportado) e D (incompleto), motor a gasolina/etanol. */
    private val SPARK = listOf(
        "catalyst" to "Catalisador", "heated_catalyst" to "Catalisador aquecido", "evap" to "Sistema evaporativo (cânister)",
        "secondary_air" to "Ar secundário", "ac_refrigerant" to "Gás do ar-condicionado", "o2_sensor" to "Sonda lambda",
        "o2_heater" to "Aquecimento da sonda", "egr" to "Recirculação de gases (EGR)",
    )

    /** Bytes C e D, motor diesel. */
    private val COMPRESSION = listOf(
        "nmhc_catalyst" to "Catalisador NMHC", "nox_scr" to "NOx/SCR", "reserved2" to "Reservado",
        "boost" to "Pressão do turbo", "reserved4" to "Reservado", "exhaust_sensor" to "Sensor de gases de escape",
        "pm_filter" to "Filtro de partículas", "egr_vvt" to "EGR/VVT",
    )

    /** null se algum byte faltar (ECU sem 0101 ou perfil sem as saídas). */
    fun decode(b: Int?, c: Int?, d: Int?): Status? {
        if (b == null || c == null || d == null) return null
        val compression = b and 0x08 != 0
        val monitors = buildList {
            CONTINUOUS.forEachIndexed { i, (id, name) ->
                if (b shr i and 1 == 1) add(Monitor(id, name, complete = b shr (i + 4) and 1 == 0))
            }
            (if (compression) COMPRESSION else SPARK).forEachIndexed { i, (id, name) ->
                if (c shr i and 1 == 1 && !id.startsWith("reserved")) add(Monitor(id, name, complete = d shr i and 1 == 0))
            }
        }
        return Status(compression, monitors)
    }

    fun fromReadings(readings: Map<String, Double>): Status? =
        decode(readings[OUT_B]?.toInt(), readings[OUT_C]?.toInt(), readings[OUT_D]?.toInt())
}

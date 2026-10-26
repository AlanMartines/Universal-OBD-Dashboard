package com.universal.obddashboard.diagnostics

import com.universal.obddashboard.obd.AdapterSettings
import com.universal.obddashboard.obd.ElmTimeoutException
import com.universal.obddashboard.obd.ElmTransport
import kotlinx.serialization.json.put

/**
 * Varredura única no início da sessão (só com a gravação de diagnóstico ligada): identifica o
 * adaptador e lê uma vez cada PID que a ECU anuncia, inclusive os que o perfil não usa, além de
 * VIN/calibração (modo 09) e DTCs. As respostas brutas ficam no log via [LoggingTransport];
 * nada aqui é interpretado, para que a análise posterior veja exatamente o que a ECU devolveu.
 */
object DiagnosticScan {

    private val AT_COMMANDS = listOf("ATI", "AT@1", "ATDP", "ATDPN", "ATRV")
    private val MODE09 = listOf("0900", "0902", "0904", "0906", "090A")
    private val DTC_MODES = listOf("03", "07", "0A")

    /** PIDs SAE J1979 consultados quando a ECU não informou o bitmap de suportados. */
    private val FALLBACK_PIDS = (0x01..0x4F).filter { it % 0x20 != 0 }

    /** @throws java.io.IOException se o link cair (timeouts isolados são tolerados). */
    suspend fun run(transport: ElmTransport, supportedPids: Set<Int>?, adapter: AdapterSettings, recorder: DiagnosticRecorder) {
        val pids = (supportedPids?.filter { it % 0x20 != 0 } ?: FALLBACK_PIDS).sorted()
        recorder.event("scan") {
            put("phase", "start")
            put("pid_count", pids.size)
            put("supported_known", supportedPids != null)
        }
        var timeouts = 0
        suspend fun send(cmd: String, timeoutMs: Long) {
            try {
                transport.sendRaw(cmd, timeoutMs)
            } catch (e: ElmTimeoutException) {
                timeouts++
            }
        }
        AT_COMMANDS.forEach { send(it, adapter.atTimeoutMs) }
        pids.forEach { send("01%02X".format(it), adapter.responseTimeoutMs) }
        MODE09.forEach { send(it, adapter.dtcTimeoutMs) }
        DTC_MODES.forEach { send(it, adapter.dtcTimeoutMs) }
        recorder.event("scan") {
            put("phase", "end")
            put("timeouts", timeouts)
        }
    }
}

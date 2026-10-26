package com.universal.obddashboard.obd

import android.os.SystemClock
import android.util.Log
import kotlinx.coroutines.currentCoroutineContext
import kotlinx.coroutines.delay
import kotlinx.coroutines.ensureActive
import java.io.IOException
import java.util.concurrent.ConcurrentLinkedQueue

/** A ECU não respondeu ao handshake inicial (ignição provavelmente desligada). Pode tentar de novo. */
class EcuNotRespondingException(message: String) : Exception(message)

/** A ECU parou de responder durante a captura por mais que ecu_silence_timeout_s: motor/ignição desligados. */
class EcuSilentException(message: String) : Exception(message)

data class AdapterInfo(
    val version: String,
    val supportedPids: Set<Int>?,
    val disabledPids: List<String>,
)

sealed interface CommandResult {
    class Values(val values: Map<String, Double>) : CommandResult
    /** [fromEcu] = false quando veio de um NO DATA: sem prova de que a ECU está viva. */
    class Dtcs(val kind: DtcKind, val codes: List<String>, val fromEcu: Boolean = true) : CommandResult
    data object NoData : CommandResult
    class Failure(val kind: ElmErrorKind) : CommandResult
}

/**
 * Escalonador serial das três esteiras de telemetria (alta, média frequência e sentinela).
 *
 * Política: Earliest-Deadline-First com um único comando em voo.
 *  - Cada comando tem `nextDueAt = horário do último envio + intervalo da esteira`.
 *  - A cada iteração é enviado o comando vencido com o prazo mais antigo; empates vão para a
 *    esteira de maior prioridade (menor `priority`).
 *  - Quando o adaptador não consegue cumprir 100 ms para todos os PIDs de alta (um ELM327 via
 *    SPP faz tipicamente 10–25 req/s), a alta esteira roda "o mais rápido possível" sem
 *    estrangular as demais: um PID de média frequência vencido fica com o prazo mais antigo e
 *    entra na próxima janela, então nenhuma esteira sofre inanição.
 *  - O próximo comando só é escrito depois do prompt '>' do anterior (ver [ElmTransport]),
 *    o que elimina o "BUFFER FULL". Se mesmo assim ocorrer, um intervalo mínimo extra é aplicado.
 */
class CommandQueue(
    private val serial: ElmTransport,
    private val profile: LoadedProfile,
    private val listener: Listener,
    private val clock: () -> Long = { SystemClock.elapsedRealtime() },
) {

    interface Listener {
        fun onValues(values: Map<String, Double>, timestamp: Long)
        fun onDtcs(kind: DtcKind, codes: List<String>, timestamp: Long)
        /** [disabled] = false quando o PID apenas trocou para o comando de fallback. */
        fun onCommandStatus(pidId: String, message: String, disabled: Boolean) {}
    }

    private class Slot(val def: CompiledCommand) {
        var variant: CommandVariant = def.primary
        var enabled = true
        var nextDueAt = 0L
        var noDataStreak = 0
        var noDataSince = 0L
    }

    private val adapter = profile.profile.adapter
    private val power = profile.profile.powerManagement
    private val slots = profile.commands.map { Slot(it) }

    /** Congelamento de quadro gravado pela ECU (modo 02, quadro 0): código que o gerou e leituras. */
    data class EcuFreezeFrame(val code: String, val values: Map<String, Double>)

    /** Leituras avulsas pedidas de fora (ex.: congelamento de quadro), feitas entre os ciclos normais. */
    private val oneShots = ConcurrentLinkedQueue<suspend () -> Unit>()

    /**
     * Lê uma vez o congelamento de quadro da própria ECU (modo 02): só consulta. [onResult] recebe
     * null se a ECU não guarda quadro ou não suporta o modo 02.
     */
    fun requestEcuFreezeFrame(onResult: (EcuFreezeFrame?) -> Unit) {
        oneShots += { onResult(readEcuFreezeFrame()) }
    }

    /** Em modo ocioso (veículo parado) as esteiras com throttle_when_idle são desaceleradas. */
    @Volatile var idleMode: Boolean = false

    private var gapMs = adapter.minCommandGapMs
    private var consecutiveTimeouts = 0
    private var lastEcuResponseAt = 0L
    private var appendResponseCount = adapter.appendResponseCount

    /** Formato do modo 03/07 depende do barramento; com ATSP0 só se sabe após o 0100 (ATDPN). */
    private var isCan = profile.isCan

    /** Executa a sequência de inicialização do perfil e descobre os PIDs suportados pela ECU. */
    suspend fun initialize(): AdapterInfo {
        var version = ""
        for (raw in profile.profile.initCommands) {
            val cmd = raw.replace(" ", "").uppercase()
            val isReset = cmd == "ATZ" || cmd == "ATWS" || cmd == "ATD"
            val response = try {
                serial.sendRaw(cmd, if (isReset) adapter.resetTimeoutMs else adapter.atTimeoutMs)
            } catch (e: ElmTimeoutException) {
                if (isReset) "" else throw IOException("Adaptador não respondeu a $cmd", e)
            }
            if (cmd == "ATZ" || cmd == "ATI") {
                response.lines().map { it.trim() }.lastOrNull { it.contains("ELM", ignoreCase = true) }
                    ?.let { version = it }
            }
            if (response.trim() == "?") Log.w(TAG, "Adaptador não reconhece $cmd (ignorado)")
            if (isReset) delay(300)
        }

        val supported = probeEcu()
        detectProtocol()
        val disabled = applySupport(supported)
        val now = clock()
        lastEcuResponseAt = now
        slots.forEach { it.nextDueAt = now }
        return AdapterInfo(version, supported, disabled)
    }

    /** Laço principal. Só retorna por exceção (cancelamento, perda de link ou ECU em silêncio). */
    suspend fun run() {
        while (true) {
            currentCoroutineContext().ensureActive()
            val now = clock()
            if (now - lastEcuResponseAt > power.ecuSilenceTimeoutS * 1000) {
                throw EcuSilentException("ECU sem resposta há ${power.ecuSilenceTimeoutS}s")
            }

            val oneShot = oneShots.poll()
            if (oneShot != null) {
                oneShot()
                continue
            }

            var best: Slot? = null
            var nextWake = Long.MAX_VALUE
            for (s in slots) {
                if (!s.enabled) continue
                if (s.nextDueAt <= now) {
                    val b = best
                    if (b == null || s.nextDueAt < b.nextDueAt ||
                        (s.nextDueAt == b.nextDueAt && s.def.lane.priority < b.def.lane.priority)
                    ) best = s
                } else if (s.nextDueAt < nextWake) {
                    nextWake = s.nextDueAt
                }
            }

            if (best == null) {
                delay(if (nextWake == Long.MAX_VALUE) 1000 else (nextWake - now).coerceIn(1, 50))
                continue
            }

            execute(best)
            best.nextDueAt = clock() + intervalOf(best)
            if (gapMs > 0) delay(gapMs)
        }
    }

    private suspend fun query(command: String): IntArray? = try {
        (ElmResponseParser.parse(serial.sendRaw(command, adapter.responseTimeoutMs)) as? ElmResult.Messages)?.messages?.firstOrNull()
    } catch (e: ElmTimeoutException) {
        null
    }

    private suspend fun readEcuFreezeFrame(): EcuFreezeFrame? {
        // 02 02 00: código que gerou o quadro 0 (00 00 = nenhum quadro guardado)
        val head = query("020200") ?: return null
        if (head.size < 5 || head[0] != 0x42 || head[1] != 0x02) return null
        val code = dtcFromBytes(head[3], head[4]) ?: return null
        val values = HashMap<String, Double>()
        for (slot in slots) {
            val v = slot.variant
            val pid = v.mode01Pid ?: continue
            if (!slot.enabled || v.decoder != DecoderType.FORMULA || pid == 0x01 || slot.def.laneName == DIAGNOSTICS_LANE) continue
            val m = query("02%02X00".format(pid)) ?: continue
            if (m.size < 4 || m[0] != 0x42 || m[1] != pid) continue
            val data = m.copyOfRange(3, m.size) // depois do número do quadro
            for (o in v.outputs) {
                FormulaEvaluator.evaluateBytes(o.expr, data).takeIf { it.isFinite() }?.let { values[o.id] = it }
            }
        }
        return EcuFreezeFrame(code, values)
    }

    private fun intervalOf(slot: Slot): Long {
        val base = slot.def.lane.intervalMs
        return if (idleMode && slot.def.lane.throttleWhenIdle) (base * power.idlePollMultiplier).toLong() else base
    }

    private suspend fun execute(slot: Slot) {
        val v = slot.variant
        val wire = if (appendResponseCount && v.mode01Pid != null) v.command + "1" else v.command
        val timeout = if (v.decoder == DecoderType.DTC) adapter.dtcTimeoutMs else adapter.responseTimeoutMs

        val raw = try {
            serial.sendRaw(wire, timeout)
        } catch (e: ElmTimeoutException) {
            if (++consecutiveTimeouts >= adapter.maxConsecutiveTimeouts) {
                throw IOException("Adaptador ELM327 parou de responder ($consecutiveTimeouts timeouts seguidos)")
            }
            return
        }
        consecutiveTimeouts = 0
        val timestamp = System.currentTimeMillis()

        when (val result = v.interpret(raw, isCan)) {
            is CommandResult.Values -> {
                slot.noDataStreak = 0
                if (!v.isAtCommand) lastEcuResponseAt = clock()
                if (result.values.isNotEmpty()) listener.onValues(result.values, timestamp)
            }
            is CommandResult.Dtcs -> {
                if (result.fromEcu) lastEcuResponseAt = clock()
                // Em CAN uma ECU viva responde "43 00"; NO DATA ali é silêncio, não "sem falhas".
                if (result.fromEcu || !isCan) listener.onDtcs(result.kind, result.codes, timestamp)
            }
            CommandResult.NoData -> onNoData(slot)
            is CommandResult.Failure -> when (result.kind) {
                ElmErrorKind.UNKNOWN_COMMAND ->
                    if (wire != v.command) {
                        Log.w(TAG, "Adaptador não aceita sufixo de contagem de respostas; desativando")
                        appendResponseCount = false
                    } else {
                        switchToFallbackOrDisable(slot, "comando ${v.command} rejeitado pelo adaptador")
                    }
                ElmErrorKind.BUFFER_FULL -> {
                    gapMs = (gapMs + 10).coerceAtMost(100)
                    delay(100)
                }
                else -> Unit // STOPPED, BUS_ERROR, UNABLE_TO_CONNECT: o detector de silêncio da ECU decide
            }
        }
    }

    private fun onNoData(slot: Slot) {
        // Só conta NO DATA seguidos enquanto a ECU responde a outros comandos. Com a ECU muda
        // (ignição desligada, motor apagou) a contagem recomeça e quem decide é o detector de silêncio.
        if (slot.noDataStreak == 0 || lastEcuResponseAt <= slot.noDataSince) {
            slot.noDataStreak = 1
            slot.noDataSince = clock()
        } else {
            slot.noDataStreak++
        }
        if (slot.noDataStreak >= adapter.maxConsecutiveNoData) {
            switchToFallbackOrDisable(slot, "${slot.noDataStreak} respostas NO DATA seguidas")
        }
    }

    private fun switchToFallbackOrDisable(slot: Slot, reason: String) {
        val fb = slot.def.fallback
        slot.noDataStreak = 0
        if (fb != null && slot.variant !== fb) {
            slot.variant = fb
            listener.onCommandStatus(slot.def.pidId, "$reason; usando ${fb.command}", disabled = false)
        } else {
            slot.enabled = false
            listener.onCommandStatus(slot.def.pidId, reason, disabled = true)
        }
    }

    private suspend fun detectProtocol() {
        val raw = try {
            serial.sendRaw("ATDPN", adapter.atTimeoutMs)
        } catch (e: ElmTimeoutException) {
            return
        }
        ElmResponseParser.isCanProtocol(raw)?.let { isCan = it }
        Log.i(TAG, "Protocolo ATDPN=${raw.trim()} (CAN=$isCan)")
    }

    /** Envia 0100 (estabelece o protocolo) e percorre os bitmaps 0120, 0140... */
    private suspend fun probeEcu(): Set<Int>? {
        val first = try {
            ElmResponseParser.parse(serial.sendRaw("0100", adapter.searchTimeoutMs))
        } catch (e: ElmTimeoutException) {
            throw EcuNotRespondingException("ECU não respondeu a 0100 (ignição desligada?)")
        }
        if (first !is ElmResult.Messages) {
            val detail = (first as? ElmResult.Error)?.raw?.trim() ?: "NO DATA"
            throw EcuNotRespondingException("ECU não respondeu a 0100: $detail")
        }
        if (!adapter.querySupportedPids) return null

        val supported = mutableSetOf<Int>()
        var result: ElmResult = first
        var base = 0x00
        while (true) {
            (result as? ElmResult.Messages)?.messages?.forEach { m ->
                if (m.size >= 6 && m[0] == 0x41 && m[1] == base) {
                    supported += ElmResponseParser.decodeSupportedBitmap(base, m.copyOfRange(2, 6))
                }
            }
            val next = base + 0x20
            if (next > 0xC0 || next !in supported) break
            base = next
            result = try {
                ElmResponseParser.parse(serial.sendRaw("01%02X".format(base), adapter.responseTimeoutMs))
            } catch (e: ElmTimeoutException) {
                break
            }
        }
        return supported.ifEmpty { null }
    }

    private fun applySupport(supported: Set<Int>?): List<String> {
        if (supported == null) return emptyList()
        val disabled = mutableListOf<String>()
        for (slot in slots) {
            val pid = slot.def.primary.mode01Pid ?: continue
            if (pid in supported) continue
            val reason = "PID 01%02X não suportado pela ECU".format(pid)
            switchToFallbackOrDisable(slot, reason)
            if (!slot.enabled) disabled += slot.def.pidId
        }
        return disabled
    }

    private companion object {
        const val TAG = "CommandQueue"
        /** Esteira de diagnóstico (0101, DTCs): fora do congelamento de quadro. */
        const val DIAGNOSTICS_LANE = "diagnostics"
    }
}

/** Converte a resposta bruta do ELM327 em valores de engenharia segundo o decodificador do perfil. */
internal fun CommandVariant.interpret(raw: String, isCan: Boolean): CommandResult {
    if (decoder == DecoderType.ELM_VOLTAGE) {
        val volts = ElmResponseParser.parseVoltage(raw) ?: return CommandResult.Failure(ElmErrorKind.GARBAGE)
        val values = HashMap<String, Double>(outputs.size)
        for (o in outputs) {
            val v = o.expr.eval { name -> if (name == "V") volts else Double.NaN }
            if (v.isFinite()) values[o.id] = v
        }
        return CommandResult.Values(values)
    }

    return when (val parsed = ElmResponseParser.parse(raw)) {
        ElmResult.NoData ->
            if (decoder == DecoderType.DTC) CommandResult.Dtcs(dtcKind!!, emptyList(), fromEcu = false) else CommandResult.NoData
        is ElmResult.Error -> CommandResult.Failure(parsed.kind)
        is ElmResult.Messages -> when (decoder) {
            DecoderType.DTC -> CommandResult.Dtcs(dtcKind!!, DtcDecoder.decode(parsed.messages, dtcKind, isCan))
            else -> {
                val header = responseHeader!!
                val msg = parsed.messages.firstOrNull { m ->
                    m.size >= header.size && header.indices.all { m[it] == header[it] }
                } ?: return CommandResult.Failure(ElmErrorKind.GARBAGE) // resposta de outro comando (atrasada)
                val data = msg.copyOfRange(header.size, msg.size)
                if (expectedBytes != null && data.size < expectedBytes) {
                    return CommandResult.Failure(ElmErrorKind.GARBAGE)
                }
                val values = HashMap<String, Double>(outputs.size)
                for (o in outputs) {
                    val v = FormulaEvaluator.evaluateBytes(o.expr, data)
                    if (v.isFinite()) values[o.id] = v
                }
                CommandResult.Values(values)
            }
        }
    }
}

/** Dois bytes de DTC (SAE J2012) → "P0420"; null para 00 00. */
internal fun dtcFromBytes(b1: Int, b2: Int): String? {
    if (b1 == 0 && b2 == 0) return null
    return "%c%d%X%X%X".format("PCBU"[b1 shr 6], (b1 shr 4) and 3, b1 and 0xF, b2 shr 4, b2 and 0xF)
}

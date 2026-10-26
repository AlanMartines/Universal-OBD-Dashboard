package com.universal.obddashboard.diagnostics

import kotlinx.serialization.json.JsonObjectBuilder
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import java.io.BufferedWriter
import java.io.Closeable
import java.io.File
import java.io.FileOutputStream
import java.io.OutputStreamWriter
import java.io.PrintWriter
import java.io.StringWriter
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

/**
 * Gravação de diagnóstico: um arquivo JSON Lines por sessão de captura (uma linha por evento,
 * `{"t": epoch_ms, "type": "...", ...}`), para análise posterior fora do app.
 *
 * Nunca derruba a captura: qualquer falha de E/S (disco cheio...) desativa o gravador em silêncio
 * e fica registrada em [failure]. Thread-safe.
 */
class DiagnosticRecorder(
    val file: File,
    private val maxBytes: Long = DEFAULT_MAX_BYTES,
    private val clock: () -> Long = System::currentTimeMillis,
) : Closeable {

    private val lock = Any()
    @Volatile private var writer: BufferedWriter? =
        BufferedWriter(OutputStreamWriter(FileOutputStream(file, true), Charsets.UTF_8), 64 * 1024)
    private var bytes = file.length()

    @Volatile var failure: Throwable? = null
        private set

    val isActive: Boolean get() = synchronized(lock) { writer != null }

    fun event(type: String, fields: JsonObjectBuilder.() -> Unit = {}) {
        if (writer == null) return
        val line = try {
            buildJsonObject {
                put("t", clock())
                put("type", type)
                fields()
            }.toString()
        } catch (e: Exception) {
            buildJsonObject { put("t", clock()); put("type", "recorder_error"); put("error", e.toString()) }.toString()
        }
        synchronized(lock) {
            val w = writer ?: return
            try {
                if (bytes + line.length > maxBytes) {
                    w.write("""{"t":${clock()},"type":"truncated","max_bytes":$maxBytes}""")
                    w.newLine()
                    closeLocked()
                    return
                }
                w.write(line)
                w.newLine()
                bytes += line.length + 1
            } catch (e: Exception) {
                fail(e)
            }
        }
    }

    fun error(where: String, e: Throwable) = event("error") {
        put("where", where)
        put("error", e.toString())
        put("stack", stackOf(e))
    }

    fun flush() = synchronized(lock) {
        try {
            writer?.flush()
        } catch (e: Exception) {
            fail(e)
        }
    }

    override fun close() = synchronized(lock) { closeLocked() }

    private fun closeLocked() {
        try {
            writer?.close()
        } catch (_: Exception) {
        }
        writer = null
    }

    private fun fail(e: Exception) {
        failure = e
        closeLocked()
    }

    companion object {
        const val DEFAULT_MAX_BYTES = 1L shl 30 // 1 GiB por sessão
        const val EXTENSION = "jsonl"
        val NAME_REGEX = Regex("^(diag|crash)_[A-Za-z0-9_.-]+\\.(jsonl|txt)$")

        fun newFile(dir: File, profileId: String, now: Long = System.currentTimeMillis()): File {
            dir.mkdirs()
            val stamp = SimpleDateFormat("yyyyMMdd-HHmmss", Locale.US).format(Date(now))
            val safeProfile = profileId.replace(Regex("[^A-Za-z0-9_.-]"), "_")
            return File(dir, "diag_${stamp}_$safeProfile.$EXTENSION")
        }

        /** Apaga arquivos mais antigos que [maxAgeMs], exceto [keep]. */
        fun cleanup(dir: File, maxAgeMs: Long, now: Long = System.currentTimeMillis(), keep: File? = null) {
            dir.listFiles()?.forEach { f ->
                if (f != keep && f.name.matches(NAME_REGEX) && now - f.lastModified() > maxAgeMs) f.delete()
            }
        }

        /** Grava uma falha fatal do app em crash_<data>.txt (chamado pelo handler de exceções não tratadas). */
        fun writeCrash(dir: File, thread: Thread, e: Throwable, now: Long = System.currentTimeMillis()) {
            try {
                dir.mkdirs()
                val stamp = SimpleDateFormat("yyyyMMdd-HHmmss", Locale.US).format(Date(now))
                File(dir, "crash_$stamp.txt").writeText("Thread: ${thread.name}\nHorário: ${Date(now)}\n\n${stackOf(e)}")
            } catch (_: Exception) {
            }
        }

        fun stackOf(e: Throwable): String = StringWriter().also { e.printStackTrace(PrintWriter(it)) }.toString()
    }
}

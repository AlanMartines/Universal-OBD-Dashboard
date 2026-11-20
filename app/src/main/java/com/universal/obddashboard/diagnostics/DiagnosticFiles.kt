package com.universal.obddashboard.diagnostics

import android.content.Context
import com.universal.obddashboard.export.TripExportFiles
import com.universal.obddashboard.export.ZipExport
import com.universal.obddashboard.service.ObdForegroundService
import java.io.File
import java.util.zip.GZIPOutputStream

/** Listagem, exportação (.gz) e remoção dos arquivos de diagnóstico, para a tela de Ajustes. */
object DiagnosticFiles {

    class DiagnosticFileException(message: String) : Exception(message)

    data class Entry(val name: String, val sizeBytes: Long, val modifiedAt: Long, val active: Boolean)

    private const val EXPORT_DIR = "exports" // mesmo diretório servido pelo FileProvider (file_paths.xml)

    fun list(context: Context): List<Entry> {
        val active = setOfNotNull(ObdForegroundService.activeDiagnosticFile, ConsoleSession.activeFile)
        return ObdForegroundService.diagnosticsDir(context).listFiles().orEmpty()
            .filter { it.name.matches(DiagnosticRecorder.NAME_REGEX) }
            .sortedByDescending { it.lastModified() }
            .map { Entry(it.name, it.length(), it.lastModified(), it.name in active) }
    }

    /** Compacta em cache/exports/<nome>.gz (o arquivo em gravação também pode ser exportado). */
    fun exportGzip(context: Context, name: String): File {
        val src = resolve(context, name)
        val dir = File(context.cacheDir, EXPORT_DIR).apply { mkdirs() }
        val out = File(dir, "$name.gz")
        src.inputStream().use { input -> GZIPOutputStream(out.outputStream()).use { input.copyTo(it) } }
        return out
    }

    /**
     * Ajustes → Gravação de diagnóstico → Exportar tudo: todas as gravações num .zip (a que está gravando entra com
     * o que já foi escrito). Os .jsonl compactam bem, como no .gz de cada arquivo.
     */
    fun exportAllZip(context: Context): File {
        val files = list(context)
        if (files.isEmpty()) throw DiagnosticFileException("Nenhuma gravação de diagnóstico")
        val out = File(TripExportFiles.exportDir(context), "diagnostico_${TripExportFiles.stamp()}.zip")
        ZipExport.write(out) { zip -> files.forEach { zip.add(it.name, resolve(context, it.name)) } }
        return out
    }

    fun delete(context: Context, name: String) {
        if (name == ObdForegroundService.activeDiagnosticFile || name == ConsoleSession.activeFile) {
            throw DiagnosticFileException("Arquivo em gravação: encerre a captura ou a escuta antes de apagar")
        }
        if (!resolve(context, name).delete()) throw DiagnosticFileException("Não foi possível apagar $name")
    }

    /**
     * Apaga todas as gravações, menos a que estiver gravando (captura ou escuta do console). Devolve quantos arquivos
     * e quantos bytes saíram, e quantos ficaram por estarem em uso ou não poderem ser apagados.
     */
    fun deleteAll(context: Context): DeleteAllResult {
        var count = 0
        var bytes = 0L
        var kept = 0
        list(context).forEach { e ->
            if (e.active) { kept++; return@forEach }
            val f = resolve(context, e.name)
            val size = f.length()
            if (f.delete()) { count++; bytes += size } else kept++
        }
        return DeleteAllResult(count, bytes, kept)
    }

    data class DeleteAllResult(val deleted: Int, val bytes: Long, val kept: Int)

    /** Últimas [maxLines] linhas do arquivo, para rever uma gravação do console na própria tela. */
    fun tail(context: Context, name: String, maxLines: Int): List<String> {
        val buf = ArrayDeque<String>()
        resolve(context, name).bufferedReader().useLines { seq ->
            seq.forEach {
                buf.addLast(it)
                if (buf.size > maxLines) buf.removeFirst()
            }
        }
        return buf.toList()
    }

    private fun resolve(context: Context, name: String): File {
        if (!name.matches(DiagnosticRecorder.NAME_REGEX)) throw DiagnosticFileException("Nome inválido: $name")
        val f = File(ObdForegroundService.diagnosticsDir(context), name)
        if (!f.isFile) throw DiagnosticFileException("Arquivo não encontrado: $name")
        return f
    }
}

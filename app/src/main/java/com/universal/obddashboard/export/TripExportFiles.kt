package com.universal.obddashboard.export

import android.content.Context
import android.content.Intent
import androidx.core.content.FileProvider
import com.universal.obddashboard.db.AppDatabase
import java.io.File

/** Grava a exportação de uma viagem em cache/exports e monta o Intent de compartilhamento. */
object TripExportFiles {

    enum class Format(val extension: String, val mimeType: String) {
        CSV("csv", "text/csv"),
        GPX("gpx", "application/gpx+xml"),
    }

    class ExportException(message: String) : Exception(message)

    private const val DIR = "exports"
    private const val MAX_AGE_MS = 24 * 60 * 60 * 1000L

    fun authority(context: Context) = "${context.packageName}.files"

    /** @throws ExportException se a viagem não existir ou não tiver dados para o formato pedido. */
    suspend fun write(context: Context, tripId: Long, format: Format): File {
        val dao = AppDatabase.get(context).tripDao()
        val trip = dao.getTrip(tripId) ?: throw ExportException("Viagem $tripId não encontrada")
        val samples = dao.telemetryForTrip(tripId)
        if (samples.isEmpty()) throw ExportException("Viagem sem amostras gravadas")

        val content = when (format) {
            Format.CSV -> TripExporter.csv(samples)
            Format.GPX -> {
                if (!TripExporter.hasGps(samples)) throw ExportException("Viagem sem pontos de GPS")
                TripExporter.gpx(trip, samples, dao.dtcsForTrip(tripId))
            }
        }

        val dir = File(context.cacheDir, DIR).apply { mkdirs() }
        val now = System.currentTimeMillis()
        dir.listFiles()?.filter { now - it.lastModified() > MAX_AGE_MS }?.forEach { it.delete() }
        return File(dir, TripExporter.fileName(trip, format.extension)).apply { writeText(content) }
    }

    fun shareIntent(context: Context, file: File, format: Format): Intent = shareIntent(context, file, format.mimeType)

    /** Qualquer arquivo em cache/exports (ver res/xml/file_paths.xml). */
    fun shareIntent(context: Context, file: File, mimeType: String): Intent {
        val uri = FileProvider.getUriForFile(context, authority(context), file)
        val send = Intent(Intent.ACTION_SEND)
            .setType(mimeType)
            .putExtra(Intent.EXTRA_STREAM, uri)
            .putExtra(Intent.EXTRA_SUBJECT, file.name)
            .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
        return Intent.createChooser(send, "Exportar ${file.name}")
    }
}

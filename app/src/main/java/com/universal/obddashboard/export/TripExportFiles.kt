package com.universal.obddashboard.export

import android.content.Context
import android.content.Intent
import androidx.core.content.FileProvider
import com.universal.obddashboard.db.AppDatabase
import java.io.File
import java.time.Instant
import java.time.ZoneId
import java.time.format.DateTimeFormatter

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

        return File(exportDir(context), TripExporter.fileName(trip, format.extension)).apply { writeText(content) }
    }

    /**
     * Histórico → Exportar todos: um .zip com o CSV de cada viagem do veículo e o GPX das que têm GPS (os mesmos
     * arquivos dos botões de cada viagem). Uma viagem por vez na memória.
     * @throws ExportException se não houver nenhuma viagem com amostras.
     */
    suspend fun writeAll(context: Context, vehicleId: String, zone: ZoneId = ZoneId.systemDefault()): File {
        val dao = AppDatabase.get(context).tripDao()
        val trips = dao.recentTrips(Int.MAX_VALUE, vehicleId)
        if (trips.isEmpty()) throw ExportException("Nenhuma viagem gravada neste veículo")
        val out = File(exportDir(context), "historico_${stamp(zone)}.zip")
        val written = ZipExport.write(out) { zip ->
            for (trip in trips.asReversed()) {   // da mais antiga para a mais nova
                val samples = dao.telemetryForTrip(trip.id)
                if (samples.isEmpty()) continue
                zip.add(TripExporter.fileName(trip, Format.CSV.extension, zone), TripExporter.csv(samples).toByteArray())
                if (TripExporter.hasGps(samples)) {
                    zip.add(TripExporter.fileName(trip, Format.GPX.extension, zone), TripExporter.gpx(trip, samples, dao.dtcsForTrip(trip.id)).toByteArray())
                }
            }
            zip.count
        }
        if (written == 0) {
            out.delete()
            throw ExportException("Nenhuma viagem com amostras gravadas")
        }
        return out
    }

    /** cache/exports, servido pelo FileProvider; o que passou de um dia é apagado aqui. */
    fun exportDir(context: Context): File {
        val dir = File(context.cacheDir, DIR).apply { mkdirs() }
        val now = System.currentTimeMillis()
        dir.listFiles()?.filter { now - it.lastModified() > MAX_AGE_MS }?.forEach { it.delete() }
        return dir
    }

    fun stamp(zone: ZoneId = ZoneId.systemDefault()): String =
        DateTimeFormatter.ofPattern("yyyyMMdd-HHmm").format(Instant.now().atZone(zone))

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

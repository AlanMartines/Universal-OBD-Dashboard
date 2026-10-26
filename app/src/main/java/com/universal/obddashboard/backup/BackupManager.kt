package com.universal.obddashboard.backup

import android.content.Context
import android.net.Uri
import com.universal.obddashboard.BuildConfig
import com.universal.obddashboard.db.AppDatabase
import com.universal.obddashboard.diagnostics.ConsoleSession
import com.universal.obddashboard.obd.ProfileParser
import com.universal.obddashboard.service.ObdForegroundService
import java.io.File
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

/** Gera e restaura o backup completo ([BackupArchive]) no aparelho. */
object BackupManager {

    private const val EXPORT_DIR = "exports" // servido pelo FileProvider (file_paths.xml)
    private const val SETTINGS_PREFS = "obd_dashboard_settings"

    /** Cria cache/exports/backup_<data>.zip. */
    fun export(context: Context): File {
        val db = AppDatabase.get(context)
        // Leva o que está no WAL para o arquivo principal antes de copiá-lo
        db.openHelper.writableDatabase.query("PRAGMA wal_checkpoint(FULL)").use { it.moveToFirst() }
        val dbFile = context.getDatabasePath(AppDatabase.NAME)
        val dir = File(context.cacheDir, EXPORT_DIR).apply { mkdirs() }
        val stamp = SimpleDateFormat("yyyyMMdd-HHmm", Locale.US).format(Date())
        val out = File(dir, "backup_obd_$stamp.zip")
        val prefs = context.getSharedPreferences(SETTINGS_PREFS, Context.MODE_PRIVATE).all
        BackupArchive.write(
            out,
            BackupArchive.Manifest(BackupArchive.FORMAT, BuildConfig.VERSION_NAME, AppDatabase.VERSION, System.currentTimeMillis()),
            dbFile,
            BackupArchive.encodePrefs(prefs),
            File(context.filesDir, ProfileParser.ASSET_DIR).listFiles { f -> f.extension == "json" }.orEmpty().toList(),
        )
        return out
    }

    /**
     * Substitui banco, ajustes e perfis importados pelos do backup. O app precisa estar sem captura e
     * sem console em uso. A chave de IA atual é mantida.
     * @return resumo para a tela
     * @throws BackupArchive.BackupException
     */
    fun restore(context: Context, uri: Uri): String {
        if (ObdForegroundService.isRunning) throw BackupArchive.BackupException("Encerre a captura antes de restaurar um backup")
        if (ConsoleSession.isActive) throw BackupArchive.BackupException("Feche o console antes de restaurar um backup")
        val work = File(context.cacheDir, "restore").apply { deleteRecursively(); mkdirs() }
        try {
            val zip = File(work, "backup.zip")
            context.contentResolver.openInputStream(uri)?.use { input -> zip.outputStream().use { input.copyTo(it) } }
                ?: throw BackupArchive.BackupException("Não foi possível abrir o arquivo")
            val contents = BackupArchive.read(zip, File(work, "x"), AppDatabase.VERSION)

            AppDatabase.closeForRestore()
            val dbFile = context.getDatabasePath(AppDatabase.NAME)
            listOf("", "-wal", "-shm", "-journal").forEach { File(dbFile.path + it).delete() }
            contents.database.copyTo(dbFile, overwrite = true)

            contents.settingsJson?.let { json ->
                val edit = context.getSharedPreferences(SETTINGS_PREFS, Context.MODE_PRIVATE).edit().clear()
                BackupArchive.decodePrefs(json).forEach { (k, v) ->
                    when (v) {
                        is BackupArchive.PrefValue.B -> edit.putBoolean(k, v.v)
                        is BackupArchive.PrefValue.I -> edit.putInt(k, v.v)
                        is BackupArchive.PrefValue.L -> edit.putLong(k, v.v)
                        is BackupArchive.PrefValue.F -> edit.putFloat(k, v.v)
                        is BackupArchive.PrefValue.S -> edit.putString(k, v.v)
                        is BackupArchive.PrefValue.SS -> edit.putStringSet(k, v.v)
                    }
                }
                edit.commit()
            }
            val profileDir = File(context.filesDir, ProfileParser.ASSET_DIR).apply { mkdirs() }
            contents.profiles.forEach { it.copyTo(File(profileDir, it.name), overwrite = true) }

            // Reabre já migrando, se o backup for de uma versão anterior do banco
            val db = AppDatabase.get(context)
            val trips = kotlinx.coroutines.runBlocking { db.tripDao().recentTrips(100_000).size }
            val fuelUps = kotlinx.coroutines.runBlocking { db.fuelUpDao().all().size }
            val date = SimpleDateFormat("dd/MM/yyyy HH:mm", Locale("pt", "BR")).format(Date(contents.manifest.createdAt))
            return "Backup de $date (app ${contents.manifest.appVersion}) restaurado: $trips viagens, $fuelUps abastecimentos."
        } finally {
            work.deleteRecursively()
        }
    }
}

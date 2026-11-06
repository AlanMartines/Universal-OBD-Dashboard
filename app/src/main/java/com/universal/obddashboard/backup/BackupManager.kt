package com.universal.obddashboard.backup

import android.content.Context
import android.net.Uri
import androidx.core.content.edit
import com.universal.obddashboard.BuildConfig
import com.universal.obddashboard.Vehicles
import com.universal.obddashboard.ai.AiSettings
import com.universal.obddashboard.remote.RemoteSettings
import com.universal.obddashboard.db.AppDatabase
import com.universal.obddashboard.diagnostics.ConsoleSession
import com.universal.obddashboard.obd.ProfileParser
import com.universal.obddashboard.service.ObdForegroundService
import java.io.File
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

private fun android.content.SharedPreferences.Editor.putPref(k: String, v: BackupArchive.PrefValue) {
    when (v) {
        is BackupArchive.PrefValue.B -> putBoolean(k, v.v)
        is BackupArchive.PrefValue.I -> putInt(k, v.v)
        is BackupArchive.PrefValue.L -> putLong(k, v.v)
        is BackupArchive.PrefValue.F -> putFloat(k, v.v)
        is BackupArchive.PrefValue.S -> putString(k, v.v)
        is BackupArchive.PrefValue.SS -> putStringSet(k, v.v)
    }
}

/** Gera e restaura o backup completo ([BackupArchive]) no aparelho. */
object BackupManager {

    private const val EXPORT_DIR = "exports" // servido pelo FileProvider (file_paths.xml)
    private const val SETTINGS_PREFS = "obd_dashboard_settings"
    private const val AI_PREFS = "ai_settings"
    private const val REMOTE_PREFS = "remote_telemetry"

    /** Resultado da restauração: texto para a tela e as preferências da tela, para o JavaScript regravar. */
    class Restored(val message: String, val webSettings: String?)

    /** Cria cache/exports/backup_<data>.zip. [webSettings]: localStorage da tela, em JSON. */
    fun export(context: Context, webSettings: String? = null): File {
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
            mapOf(
                BackupArchive.AI_SETTINGS to BackupArchive.encodePrefs(BackupArchive.aiPrefsForBackup(context.getSharedPreferences(AI_PREFS, Context.MODE_PRIVATE).all)),
                BackupArchive.REMOTE_SETTINGS to BackupArchive.encodePrefs(BackupArchive.remotePrefsForBackup(context.getSharedPreferences(REMOTE_PREFS, Context.MODE_PRIVATE).all)),
                BackupArchive.WEB_SETTINGS to BackupArchive.sanitizeWebSettings(webSettings),
            ),
        )
        return out
    }

    /**
     * Substitui banco, ajustes e perfis importados pelos do backup. O app precisa estar sem captura e
     * sem console em uso. A chave de IA atual é mantida.
     * @return resumo para a tela
     * @throws BackupArchive.BackupException
     */
    suspend fun restore(context: Context, uri: Uri): Restored {
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
                // Gravação síncrona: os ajustes precisam estar no disco antes de o app reabrir o banco
                context.getSharedPreferences(SETTINGS_PREFS, Context.MODE_PRIVATE).edit(commit = true) {
                    clear()
                    BackupArchive.decodePrefs(json).forEach { (k, v) -> putPref(k, v) }
                }
            }
            // IA e servidor: só mistura o que veio (a chave da IA e o pareamento deste aparelho ficam como estão)
            val ai = contents.extras[BackupArchive.AI_SETTINGS]?.let { BackupArchive.aiPrefsForBackup(BackupArchive.decodePrefs(it)) }.orEmpty()
            context.getSharedPreferences(AI_PREFS, Context.MODE_PRIVATE).edit(commit = true) { ai.forEach { (k, v) -> putPref(k, v as BackupArchive.PrefValue) } }
            val remote = contents.extras[BackupArchive.REMOTE_SETTINGS]?.let { BackupArchive.remotePrefsForBackup(BackupArchive.decodePrefs(it)) }.orEmpty()
            context.getSharedPreferences(REMOTE_PREFS, Context.MODE_PRIVATE).edit(commit = true) { remote.forEach { (k, v) -> putPref(k, v as BackupArchive.PrefValue) } }
            val profileDir = File(context.filesDir, ProfileParser.ASSET_DIR).apply { mkdirs() }
            contents.profiles.forEach { it.copyTo(File(profileDir, it.name), overwrite = true) }

            // Reabre já migrando, se o backup for de uma versão anterior do banco
            val db = AppDatabase.get(context)
            // Backup de antes dos veículos: os ajustes gerais vão para o veículo selecionado
            Vehicles.ensure(context, force = true)
            val trips = db.tripDao().tripCount()
            val fuelUps = db.fuelUpDao().count()
            val date = SimpleDateFormat("dd/MM/yyyy HH:mm", Locale("pt", "BR")).format(Date(contents.manifest.createdAt))
            val todo = buildList {
                if ((ai["enabled"] as? BackupArchive.PrefValue.B)?.v == true && !AiSettings.hasKey(context)) add("cole a chave da IA em Ajustes → Assistente IA")
                if (remote.keys.any { it.startsWith("base_url@") } && RemoteSettings.token(context) == null) add("pareie com o painel (no painel: Dispositivos → novo código)")
            }
            val pending = if (todo.isEmpty()) "" else " Falta: " + todo.joinToString("; ") + "."
            return Restored(
                "Backup de $date (app ${contents.manifest.appVersion}) restaurado: $trips viagens, $fuelUps abastecimentos.$pending",
                contents.extras[BackupArchive.WEB_SETTINGS]?.let { BackupArchive.sanitizeWebSettings(it) },
            )
        } finally {
            work.deleteRecursively()
        }
    }
}

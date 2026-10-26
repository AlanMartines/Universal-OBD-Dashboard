package com.universal.obddashboard.backup

import android.content.Context
import android.net.Uri
import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import com.universal.obddashboard.db.AppDatabase
import com.universal.obddashboard.db.FuelUpEntity
import com.universal.obddashboard.db.TripEntity
import kotlinx.coroutines.runBlocking
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.annotation.Config
import java.io.File
import java.util.zip.ZipEntry
import java.util.zip.ZipOutputStream

@RunWith(AndroidJUnit4::class)
@Config(sdk = [34])
class BackupTest {

    private val context: Context = ApplicationProvider.getApplicationContext()
    private val prefs get() = context.getSharedPreferences("obd_dashboard_settings", Context.MODE_PRIVATE)

    @After fun close() = AppDatabase.closeForRestore()

    @Test fun exportWipeRestoreRoundTrip() {
        val db = AppDatabase.get(context)
        runBlocking {
            db.tripDao().insertTrip(TripEntity(profileId = "p", startTime = 1000, distanceKm = 418.0))
            db.fuelUpDao().insert(FuelUpEntity(timestamp = 2000, profileId = "p", liters = 32.2, fuelType = "gasoline"))
        }
        prefs.edit().putFloat("fuel_level_l", 24f).putString("selected_profile", "fiat_uno_vivace_7gf")
            .putStringSet("x_set", setOf("a", "b")).putLong("odometer_ref_since", 5L).commit()
        File(context.filesDir, "profiles").apply { mkdirs() }.resolve("meu_carro.json").writeText("{}")

        val zip = BackupManager.export(context)
        assertTrue(zip.length() > 0)

        // Apaga tudo, como num celular novo
        AppDatabase.closeForRestore()
        context.getDatabasePath(AppDatabase.NAME).delete()
        prefs.edit().clear().commit()
        File(context.filesDir, "profiles").deleteRecursively()

        val msg = BackupManager.restore(context, Uri.fromFile(zip))
        assertTrue(msg, msg.contains("1 viagens") && msg.contains("1 abastecimentos"))
        val restored = AppDatabase.get(context)
        runBlocking { assertEquals(418.0, restored.tripDao().recentTrips(10).single().distanceKm, 0.0) }
        assertEquals(24f, prefs.getFloat("fuel_level_l", 0f))
        assertEquals("fiat_uno_vivace_7gf", prefs.getString("selected_profile", null))
        assertEquals(setOf("a", "b"), prefs.getStringSet("x_set", null))
        assertEquals(5L, prefs.getLong("odometer_ref_since", 0))
        assertTrue(File(context.filesDir, "profiles/meu_carro.json").isFile)
    }

    private fun zipOf(vararg entries: Pair<String, ByteArray>): File {
        val f = File.createTempFile("bkp", ".zip")
        ZipOutputStream(f.outputStream()).use { z -> entries.forEach { (n, b) -> z.putNextEntry(ZipEntry(n)); z.write(b); z.closeEntry() } }
        return f
    }

    private val sqliteHeader = "SQLite format 3\u0000".toByteArray() + ByteArray(100)

    @Test fun rejectsBadArchives() {
        val dir = File.createTempFile("work", "").apply { delete(); mkdirs() }
        fun err(f: File) = runCatching { BackupArchive.read(f, dir, 3) }.exceptionOrNull()?.message.orEmpty()
        assertTrue(err(File.createTempFile("nozip", ".zip").apply { writeText("não é zip") }).contains("válido"))
        val newer = """{"format":1,"app_version":"9.9","db_version":99,"created_at":1}""".toByteArray()
        assertTrue(err(zipOf("manifest.json" to newer, "database.db" to sqliteHeader)).contains("mais nova"))
        val ok = """{"format":1,"app_version":"0.7","db_version":3,"created_at":1}""".toByteArray()
        assertTrue(err(zipOf("manifest.json" to ok, "database.db" to "lixo".toByteArray())).contains("corrompido"))
        // Nomes perigosos no zip são ignorados (nada é escrito fora da pasta de trabalho)
        val c = BackupArchive.read(zipOf("manifest.json" to ok, "database.db" to sqliteHeader,
            "profiles/../../evil.json" to "{}".toByteArray(), "/etc/x" to "x".toByteArray(), "profiles/bom.json" to "{}".toByteArray()), dir, 3)
        assertEquals(listOf("bom.json"), c.profiles.map { it.name })
        assertFalse(File(dir.parentFile, "evil.json").exists())
    }

    @Test fun prefsCodecKeepsTypes() {
        val all = mapOf("b" to true, "i" to 3, "l" to 4L, "f" to 1.5f, "s" to "x", "ss" to setOf("a"))
        val back = BackupArchive.decodePrefs(BackupArchive.encodePrefs(all))
        assertEquals(BackupArchive.PrefValue.I(3), back["i"])
        assertEquals(BackupArchive.PrefValue.L(4L), back["l"])
        assertEquals(BackupArchive.PrefValue.F(1.5f), back["f"])
        assertEquals(BackupArchive.PrefValue.SS(setOf("a")), back["ss"])
        assertEquals(6, back.size)
    }
}

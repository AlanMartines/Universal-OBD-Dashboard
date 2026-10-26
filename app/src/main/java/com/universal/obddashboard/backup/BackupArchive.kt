package com.universal.obddashboard.backup

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.boolean
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.float
import kotlinx.serialization.json.int
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.long
import kotlinx.serialization.json.longOrNull
import kotlinx.serialization.json.put
import kotlinx.serialization.json.putJsonArray
import kotlinx.serialization.json.putJsonObject
import kotlinx.serialization.json.add
import java.io.File
import java.util.zip.ZipEntry
import java.util.zip.ZipFile
import java.util.zip.ZipOutputStream

/**
 * Backup completo (Ajustes → Backup): um .zip com manifesto, banco (viagens, telemetria, falhas,
 * abastecimentos, respostas da IA), ajustes do app e perfis importados. A chave de API da IA não
 * entra: fica só no Keystore do aparelho.
 */
object BackupArchive {

    const val FORMAT = 1
    const val MANIFEST = "manifest.json"
    const val DATABASE = "database.db"
    const val SETTINGS = "settings.json"
    const val PROFILES_DIR = "profiles/"
    private val PROFILE_NAME = Regex("^[A-Za-z0-9_.-]{1,80}\\.json$")
    private const val MAX_DB_BYTES = 2L * 1024 * 1024 * 1024
    private const val MAX_SMALL_BYTES = 5L * 1024 * 1024

    class BackupException(message: String) : Exception(message)

    data class Manifest(val format: Int, val appVersion: String, val dbVersion: Int, val createdAt: Long) {
        fun toJson(): String = buildJsonObject {
            put("format", format)
            put("app_version", appVersion)
            put("db_version", dbVersion)
            put("created_at", createdAt)
        }.toString()
    }

    data class Contents(val manifest: Manifest, val database: File, val settingsJson: String?, val profiles: List<File>)

    fun write(out: File, manifest: Manifest, database: File, settingsJson: String, profiles: List<File>) {
        ZipOutputStream(out.outputStream().buffered()).use { zip ->
            fun put(name: String, write: (java.io.OutputStream) -> Unit) {
                zip.putNextEntry(ZipEntry(name))
                write(zip)
                zip.closeEntry()
            }
            put(MANIFEST) { it.write(manifest.toJson().toByteArray()) }
            put(DATABASE) { o -> database.inputStream().use { it.copyTo(o) } }
            put(SETTINGS) { it.write(settingsJson.toByteArray()) }
            profiles.filter { PROFILE_NAME.matches(it.name) }.forEach { f -> put(PROFILES_DIR + f.name) { o -> f.inputStream().use { it.copyTo(o) } } }
        }
    }

    /**
     * Extrai em [dir] só os nomes conhecidos (nada de "../" ou caminhos absolutos) e valida o manifesto.
     * @throws BackupException arquivo inválido ou de uma versão mais nova do app
     */
    fun read(zipFile: File, dir: File, currentDbVersion: Int): Contents {
        dir.mkdirs()
        val zip = try { ZipFile(zipFile) } catch (e: Exception) { throw BackupException("Não é um arquivo de backup (.zip) válido") }
        zip.use { z ->
            val manifestEntry = z.getEntry(MANIFEST) ?: throw BackupException("Backup sem manifesto")
            val m = runCatching {
                val o = Json.parseToJsonElement(z.getInputStream(manifestEntry).use { it.readBytes().toString(Charsets.UTF_8) }).jsonObject
                Manifest(
                    o["format"]!!.jsonPrimitive.int,
                    o["app_version"]?.jsonPrimitive?.contentOrNull.orEmpty(),
                    o["db_version"]!!.jsonPrimitive.int,
                    o["created_at"]?.jsonPrimitive?.longOrNull ?: 0L,
                )
            }.getOrElse { throw BackupException("Manifesto ilegível") }
            if (m.format != FORMAT) throw BackupException("Formato de backup desconhecido (${m.format})")
            if (m.dbVersion > currentDbVersion) throw BackupException("Backup feito por uma versão mais nova do app (banco v${m.dbVersion}); atualize o app antes")

            fun extract(entry: ZipEntry, target: File, max: Long) {
                if (entry.size > max) throw BackupException("Arquivo grande demais no backup: ${entry.name}")
                z.getInputStream(entry).use { input ->
                    target.outputStream().use { out ->
                        val copied = input.copyTo(out)
                        if (copied > max) throw BackupException("Arquivo grande demais no backup: ${entry.name}")
                    }
                }
            }
            val dbEntry = z.getEntry(DATABASE) ?: throw BackupException("Backup sem banco de dados")
            val db = File(dir, DATABASE).also { extract(dbEntry, it, MAX_DB_BYTES) }
            val settings = z.getEntry(SETTINGS)?.let { e -> File(dir, SETTINGS).also { extract(e, it, MAX_SMALL_BYTES) }.readText() }
            val profileDir = File(dir, "profiles").apply { mkdirs() }
            val profiles = z.entries().toList()
                .filter { it.name.startsWith(PROFILES_DIR) && PROFILE_NAME.matches(it.name.removePrefix(PROFILES_DIR)) }
                .map { e -> File(profileDir, e.name.removePrefix(PROFILES_DIR)).also { extract(e, it, MAX_SMALL_BYTES) } }
            if (!db.readHeader().startsWith("SQLite format 3")) throw BackupException("Banco de dados do backup corrompido")
            return Contents(m, db, settings, profiles)
        }
    }

    private fun File.readHeader(): String = inputStream().use { input ->
        val buf = ByteArray(16)
        val n = input.read(buf)
        if (n <= 0) "" else String(buf, 0, n, Charsets.US_ASCII)
    }

    /** Preferências → JSON com tipo, para restaurar exatamente (Boolean, Int, Long, Float, String, Set). */
    fun encodePrefs(all: Map<String, *>): String = buildJsonObject {
        all.forEach { (k, v) ->
            when (v) {
                is Boolean -> putJsonObject(k) { put("t", "b"); put("v", v) }
                is Int -> putJsonObject(k) { put("t", "i"); put("v", v) }
                is Long -> putJsonObject(k) { put("t", "l"); put("v", v) }
                is Float -> putJsonObject(k) { put("t", "f"); put("v", v) }
                is String -> putJsonObject(k) { put("t", "s"); put("v", v) }
                is Set<*> -> putJsonObject(k) { put("t", "ss"); putJsonArray("v") { v.forEach { add(it.toString()) } } }
                else -> Unit
            }
        }
    }.toString()

    sealed interface PrefValue {
        data class B(val v: Boolean) : PrefValue
        data class I(val v: Int) : PrefValue
        data class L(val v: Long) : PrefValue
        data class F(val v: Float) : PrefValue
        data class S(val v: String) : PrefValue
        data class SS(val v: Set<String>) : PrefValue
    }

    fun decodePrefs(json: String): Map<String, PrefValue> =
        Json.parseToJsonElement(json).jsonObject.mapNotNull { (k, e) ->
            val o = e as? JsonObject ?: return@mapNotNull null
            val v = o["v"] ?: return@mapNotNull null
            val value: PrefValue? = runCatching {
                when ((o["t"] as? JsonPrimitive)?.contentOrNull) {
                    "b" -> PrefValue.B(v.jsonPrimitive.boolean)
                    "i" -> PrefValue.I(v.jsonPrimitive.int)
                    "l" -> PrefValue.L(v.jsonPrimitive.long)
                    "f" -> PrefValue.F(v.jsonPrimitive.float)
                    "s" -> PrefValue.S(v.jsonPrimitive.content)
                    "ss" -> PrefValue.SS((v as JsonArray).map { it.jsonPrimitive.content }.toSet())
                    else -> null
                }
            }.getOrNull()
            value?.let { k to it }
        }.toMap()
}

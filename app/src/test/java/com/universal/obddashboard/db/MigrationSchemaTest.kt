package com.universal.obddashboard.db

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import org.junit.Assert.assertEquals
import org.junit.Test
import java.io.File

/**
 * Confere a migração contra os esquemas exportados pelo Room (app/schemas): se o SQL da migração não
 * bater com o que o Room espera, o app quebra ao abrir o banco de quem já tem viagens gravadas.
 */
class MigrationSchemaTest {

    private fun entities(version: Int): Map<String, JsonObject> {
        val root = Json.parseToJsonElement(File("schemas/com.universal.obddashboard.db.AppDatabase/$version.json").readText())
        return root.jsonObject["database"]!!.jsonObject["entities"]!!.jsonArray
            .map { it.jsonObject }.associateBy { it["tableName"]!!.jsonPrimitive.content }
    }

    private fun sqlOf(e: JsonObject, table: String): List<String> =
        listOf(e["createSql"]!!.jsonPrimitive.content.replace("\${TABLE_NAME}", table)) +
            (e["indices"]?.jsonArray.orEmpty()).map { it.jsonObject["createSql"]!!.jsonPrimitive.content.replace("\${TABLE_NAME}", table) }

    @Test fun migration1to2CreatesExactlyTheExpectedTable() {
        val v2 = entities(2)
        assertEquals(sqlOf(v2["fuel_ups"]!!, "fuel_ups"), AppDatabase.MIGRATION_1_2_SQL)
    }

    @Test fun migration2to3AddsColumnAndAnswersTable() {
        val v2 = entities(2)
        val v3 = entities(3)
        assertEquals(sqlOf(v3["ai_answers"]!!, "ai_answers"), AppDatabase.MIGRATION_2_3_CREATE)
        assertEquals(v2.keys + "ai_answers", v3.keys)
        for (t in v2.keys - "diagnostic_trouble_codes") assertEquals(t, v2[t], v3[t])
        // A coluna nova é a única diferença na tabela de falhas (ALTER TABLE acrescenta no fim)
        val before = v2["diagnostic_trouble_codes"]!!["createSql"]!!.jsonPrimitive.content
        val after = v3["diagnostic_trouble_codes"]!!["createSql"]!!.jsonPrimitive.content
        assertEquals(before.replace("`gps_accuracy_m` REAL,", "`gps_accuracy_m` REAL, `ecu_freeze_json` TEXT,"), after)
        assertEquals("ALTER TABLE `diagnostic_trouble_codes` ADD COLUMN `ecu_freeze_json` TEXT", AppDatabase.MIGRATION_2_3_ALTER)
    }

    @Test fun existingTablesAreUnchanged() {
        val v1 = entities(1)
        val v2 = entities(2)
        assertEquals(v1.keys + "fuel_ups", v2.keys)
        for (t in v1.keys) assertEquals(t, v1[t], v2[t])
    }
}

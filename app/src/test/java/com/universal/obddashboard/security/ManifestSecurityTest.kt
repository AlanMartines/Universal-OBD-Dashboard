package com.universal.obddashboard.security

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File

/**
 * O backup do Android levaria para a nuvem, ou para o celular novo, o banco com o percurso pelo GPS e as
 * preferências com o token do painel e a chave da IA. O app tem o próprio backup, que deixa as chaves de fora.
 */
class ManifestSecurityTest {

    private val manifest = File("src/main/AndroidManifest.xml").readText()
    private val rules = File("src/main/res/xml/data_extraction_rules.xml").readText()
    private val domains = listOf(
        "root", "file", "database", "sharedpref", "external",
        "device_root", "device_file", "device_database", "device_sharedpref",
    )

    @Test fun androidBackupIsOff() {
        assertTrue("allowBackup precisa ser false", """android:allowBackup="false"""" in manifest)
        assertTrue("fullBackupContent precisa ser false", """android:fullBackupContent="false"""" in manifest)
        assertTrue("faltam as regras de extração", """android:dataExtractionRules="@xml/data_extraction_rules"""" in manifest)
    }

    @Test fun cloudBackupAndDeviceTransferExcludeEverything() {
        for (section in listOf("cloud-backup", "device-transfer")) {
            val body = rules.substringAfter("<$section>").substringBefore("</$section>")
            assertTrue("$section não pode incluir nada", "<include" !in body)
            val excluded = Regex("""<exclude domain="(\w+)" path="\." />""").findAll(body).map { it.groupValues[1] }.toSet()
            assertEquals(section, domains.toSet(), excluded)
        }
    }
}

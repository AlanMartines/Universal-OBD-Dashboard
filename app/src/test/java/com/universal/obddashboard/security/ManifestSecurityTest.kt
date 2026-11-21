package com.universal.obddashboard.security

import com.universal.obddashboard.IntentGuard
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
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

    /** Componente exportado novo é porta de entrada para outros apps: o teste obriga a revisar e validar. */
    @Test fun onlyReviewedComponentsAreExported() {
        val exported = Regex("""<(activity|service|receiver|provider)\b[^>]*?android:name="([^"]+)"[^>]*?android:exported="true"""", RegexOption.DOT_MATCHES_ALL)
            .findAll(manifest).map { it.groupValues[2] }.toSet()
        assertEquals(setOf(".MainActivity", ".service.AutoDisconnectReceiver", ".car.DashboardCarAppService"), exported)
    }

    @Test fun exportedComponentsValidateWhatArrives() {
        val src = File("src/main/java/com/universal/obddashboard")
        val receiver = File(src, "service/AutoDisconnectReceiver.kt").readText()
        val onReceive = receiver.substringAfter("override fun onReceive").substringBefore("getParcelableExtra")
        assertTrue("o receptor precisa filtrar a ação antes de ler o Intent", "ACTION_ACL_CONNECTED" in onReceive && "return" in onReceive)
        val main = File(src, "MainActivity.kt").readText()
        assertTrue("iniciar captura precisa do código do app", "IntentGuard.isTrusted(this, intent)" in main.substringAfter("private fun handleIntent"))
        val car = File(src, "car/DashboardCarAppService.kt").readText()
        assertTrue("Android Auto: release só com a lista de hosts", "addAllowedHosts(R.array.car_hosts_allowlist)" in car)
    }

    @Test fun intentTokenComparison() {
        assertTrue(IntentGuard.matches("abc123", "abc123"))
        assertFalse(IntentGuard.matches("abc123", "abc124"))
        assertFalse(IntentGuard.matches("abc123", null))
        assertFalse(IntentGuard.matches("abc123", ""))
        assertFalse(IntentGuard.matches(null, null))
        assertFalse(IntentGuard.matches("", ""))
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

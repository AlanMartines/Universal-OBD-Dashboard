package com.universal.obddashboard.bridge

import android.webkit.JavascriptInterface
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File

/**
 * Contrato entre a tela (assets/web) e o app: toda chamada `bridge.x(...)` do JavaScript existe em
 * exatamente um objeto nativo com @JavascriptInterface, e todo objeto está registrado com o nome
 * que a tela procura. Pega na hora um método renomeado, movido ou esquecido.
 */
class BridgeContractTest {

    private val bridges = mapOf(
        "AndroidBridge" to AppBridge::class.java,
        "AndroidHistory" to HistoryBridge::class.java,
        "AndroidFuel" to FuelBridge::class.java,
        "AndroidDiag" to DiagnosticsBridge::class.java,
        "AndroidAi" to AiBridge::class.java,
    )

    private val web = File("src/main/assets/web")
    private val appJs = web.listFiles { f -> f.extension == "js" }!!.joinToString("\n") { it.readText() }

    private fun exposed(c: Class<*>) = c.declaredMethods.filter { it.isAnnotationPresent(JavascriptInterface::class.java) }.map { it.name }

    @Test fun everyJsCallHasExactlyOneNativeMethod() {
        val calls = Regex("""\bbridge\.(\w+)\(""").findAll(appJs).map { it.groupValues[1] }.toSortedSet()
        assertTrue("nenhuma chamada encontrada", calls.size > 40)
        val owners = bridges.flatMap { (name, c) -> exposed(c).map { it to name } }.groupBy({ it.first }, { it.second })
        val missing = calls.filter { it !in owners }
        val duplicated = owners.filterValues { it.size > 1 }
        assertEquals("chamadas sem método nativo", emptyList<String>(), missing)
        assertEquals("métodos em mais de um objeto", emptyMap<String, List<String>>(), duplicated)
    }

    @Test fun everyNativeMethodIsUsedAndRegistered() {
        val unused = bridges.values.flatMap(::exposed).filter { !Regex("""\bbridge\.$it\(""").containsMatchIn(appJs) }
        assertEquals("métodos nativos que a tela não chama", emptyList<String>(), unused)
        val activity = File("src/main/java/com/universal/obddashboard/MainActivity.kt").readText()
        bridges.forEach { (name, c) -> assertTrue("$name não registrado", activity.contains("""${c.simpleName}(this@MainActivity), "$name")""")) }
        bridges.keys.forEach { assertTrue("$it fora da lista da tela", appJs.contains("'$it'")) }
    }

    @Test fun asyncMethodsAreCalledThroughNativeAsync() {
        // Métodos que respondem em onBridgeResult: chamados direto, devolveriam undefined à tela
        val sources = File("src/main/java/com/universal/obddashboard/bridge").listFiles()!!.joinToString("\n") { it.readText() }
        val async = Regex("""fun (\w+)\(requestId: String[^)]*\) = (?:activity\.answerAsync|previewJson)""")
            .findAll(sources).map { it.groupValues[1] }.toSortedSet()
        assertTrue("nenhum método assíncrono encontrado", async.size >= 10)
        val wrong = async.filter { m ->
            Regex("""\bbridge\.$m\((?!id\b)""").containsMatchIn(appJs) ||
                Regex("""\(id\) => bridge\.$m\(id\b""").findAll(appJs).count() != Regex("""\bbridge\.$m\(""").findAll(appJs).count()
        }
        assertEquals("chamadas fora do nativeAsync", emptyList<String>(), wrong)
    }

    @Test fun everyPushedScriptCallsAHandlerTheScreenDefines() {
        // pushJs roda JavaScript na tela: um nome errado falha em silêncio e a resposta nunca chega
        val kotlin = File("src/main/java").walkTopDown().filter { it.extension == "kt" }.joinToString("\n") { it.readText() }
        val scripts = Regex("""pushJs\("([^"$]*)""").findAll(kotlin).map { it.groupValues[1] }.toList()
        assertTrue("nenhum pushJs encontrado", scripts.size >= 6)
        scripts.forEach { s ->
            val m = Regex("""^window\.(on\w+) && window\.(on\w+)\($""").find(s)
            assertTrue("script fora do formato window.onX && window.onX(...): $s", m != null && m.groupValues[1] == m.groupValues[2])
            val handler = m!!.groupValues[1]
            assertTrue("$handler não é definido pela tela", Regex("""window\.$handler\s*=""").containsMatchIn(appJs))
        }
    }

    @Test fun browserStubCoversEveryCall() {
        // A pré-visualização fora do app (navegador, harness do painel) usa o simulador do app-core.js
        val stub = appJs.substringAfter("}) : {").substringBefore("\n};")
        val names = Regex("""(\w+)(?:\(\)|:)""").findAll(stub).map { it.groupValues[1] }.toSet()
        val calls = Regex("""\bbridge\.(\w+)\(""").findAll(appJs).map { it.groupValues[1] }.toSortedSet()
        assertEquals("faltam no simulador do navegador", emptyList<String>(), calls.filter { it !in names })
    }
}

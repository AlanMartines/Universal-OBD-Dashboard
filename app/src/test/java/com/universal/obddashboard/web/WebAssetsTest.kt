package com.universal.obddashboard.web

import org.junit.Assert.assertEquals
import org.junit.Test
import java.io.File

/**
 * Checagens estáticas da tela (assets/web): os arquivos app-*.js dividem o escopo global, então um
 * nome de função repetido faz a última declaração substituir a primeira em silêncio, e um id
 * repetido faz o código escrever no elemento errado.
 */
class WebAssetsTest {

    private val web = File("src/main/assets/web")
    private val html = File(web, "index.html").readText()
    private val scripts = web.listFiles { f -> f.name.startsWith("app-") && f.extension == "js" }!!.sortedBy { it.name }

    @Test fun noDuplicateTopLevelNames() {
        val decl = Regex("""^(?:function\s+(\w+)|(?:const|let|var)\s+(\w+)\s*=)""", RegexOption.MULTILINE)
        val names = scripts.flatMap { f -> decl.findAll(f.readText()).map { (it.groupValues[1].ifEmpty { it.groupValues[2] }) to f.name } }
        val dup = names.groupBy({ it.first }, { it.second }).filterValues { it.size > 1 }
        assertEquals("nomes declarados em mais de um lugar", emptyMap<String, List<String>>(), dup)
    }

    @Test fun noDuplicateIds() {
        val ids = Regex("""\bid="([^"]+)"""").findAll(html).map { it.groupValues[1] }.toList()
        assertEquals("ids repetidos no index.html", emptyList<String>(), ids.groupBy { it }.filterValues { it.size > 1 }.keys.toList())
    }

    @Test fun everyElementUsedByScriptsExists() {
        val ids = Regex("""\bid="([^"]+)"""").findAll(html).map { it.groupValues[1] }.toSet()
        val used = scripts.flatMap { f -> Regex("""\$\('([\w-]+)'\)""").findAll(f.readText()).map { it.groupValues[1] } }.toSortedSet()
        assertEquals("elementos usados no JavaScript que não existem no HTML", emptyList<String>(), used.filter { it !in ids })
    }

    @Test fun indexLoadsEveryScriptCoreFirstMainLast() {
        val order = Regex("""<script src="(app-[\w-]+\.js)"""").findAll(html).map { it.groupValues[1] }.toList()
        assertEquals(scripts.map { it.name }.toSet(), order.toSet())
        assertEquals("app-core.js", order.first())
        assertEquals("app-main.js", order.last())
    }
}

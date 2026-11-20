package com.universal.obddashboard.web

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
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

    /**
     * HTML só com dado escapado: toda atribuição a innerHTML (ou insertAdjacentHTML) começa por html`...`,
     * que escapa cada ${...}, ou é texto fixo (no máximo escolhido por uma condição). Concatenação e
     * template literal cru deixariam um nome de dispositivo, um perfil importado ou um backup virar código.
     */
    @Test fun htmlOnlyThroughEscapingTag() {
        val literal = Regex("""'(?:[^'\\]|\\.)*'""")
        val onlyLiterals = Regex("""^[\w.\s|&!()]*\?\s*:\s*;?$|^\s*;?$""")
        val problems = scripts.flatMap { f ->
            f.readLines().withIndex().mapNotNull { (i, line) ->
                val where = "${f.name}:${i + 1}"
                val rhs = when {
                    ".innerHTML =" in line -> line.substringAfter(".innerHTML =").trim()
                    "insertAdjacentHTML(" in line -> line.substringAfter("insertAdjacentHTML(").substringAfter(",").trim()
                    "outerHTML" in line || "document.write" in line -> return@mapNotNull "$where usa outerHTML/document.write"
                    else -> return@mapNotNull null
                }
                if (rhs.startsWith("html`")) return@mapNotNull null
                val rest = literal.replace(rhs, "")
                if ("`" in rest || "+" in rest || "\${" in rhs || !onlyLiterals.matches(rest)) "$where: $rhs" else null
            }
        }
        assertEquals("innerHTML com dado fora do html`...`", emptyList<String>(), problems)
    }

    @Test fun contentSecurityPolicyBlocksInlineCode() {
        val csp = Regex("""http-equiv="Content-Security-Policy" content="([^"]+)"""").find(html)?.groupValues?.get(1)
        assertTrue("index.html sem CSP", csp != null)
        assertTrue(csp!!, "script-src 'self'" in csp && "default-src 'none'" in csp && "object-src 'none'" in csp)
        assertTrue(csp, "unsafe-inline" !in csp && "unsafe-eval" !in csp)
        assertTrue("script embutido no index.html", !Regex("""<script(?![^>]*\bsrc=)""").containsMatchIn(html))
        assertTrue("atributo on...= no index.html", !Regex("""\son[a-z]+=""").containsMatchIn(html))
    }

    @Test fun indexLoadsEveryScriptCoreFirstMainLast() {
        val order = Regex("""<script src="(app-[\w-]+\.js)"""").findAll(html).map { it.groupValues[1] }.toList()
        assertEquals(scripts.map { it.name }.toSet(), order.toSet())
        assertEquals("app-core.js", order.first())
        assertEquals("app-main.js", order.last())
    }
}

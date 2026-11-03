package com.universal.obddashboard.web

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File

/** Tabela de códigos genéricos da tela: formato dos códigos e ausência de duplicatas. */
class DtcTableTest {
    private val text = File("src/main/assets/web/dtc-sae.js").readText()
    private val codes = Regex(""""([PCBU][0-9A-F]{4})":""").findAll(text).map { it.groupValues[1] }.toList()

    @Test fun codesAreValidAndUnique() {
        assertTrue("tabela vazia", codes.size > 150)
        assertEquals(codes.size, codes.toSet().size)
        // Sondas lambda usam numeração decimal: P0136 existe, P013A não
        assertTrue("P0136" in codes && "P0161" in codes)
        assertTrue(codes.none { Regex("P01[3-6][A-F]").matches(it) })
    }
}

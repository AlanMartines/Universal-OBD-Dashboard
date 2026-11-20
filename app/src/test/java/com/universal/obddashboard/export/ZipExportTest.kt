package com.universal.obddashboard.export

import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder
import java.util.zip.ZipFile

class ZipExportTest {

    @get:Rule val tmp = TemporaryFolder()

    @Test fun writesBytesAndFilesAndRenamesDuplicates() {
        val src = tmp.newFile("diag.jsonl").apply { writeText("{\"a\":1}\n".repeat(1000)) }
        val out = tmp.root.resolve("tudo.zip")
        val count = ZipExport.write(out) { zip ->
            zip.add("viagem_1.csv", "a,b\n1,2\n".toByteArray())
            zip.add("viagem_1.csv", "outra".toByteArray())
            zip.add("sem-extensao", "x".toByteArray())
            zip.add("sem-extensao", "y".toByteArray())
            zip.add("diag.jsonl", src)
            zip.count
        }
        assertEquals(5, count)
        ZipFile(out).use { z ->
            assertEquals(listOf("viagem_1.csv", "viagem_1-2.csv", "sem-extensao", "sem-extensao-2", "diag.jsonl"), z.entries().toList().map { it.name })
            assertEquals("a,b\n1,2\n", z.getInputStream(z.getEntry("viagem_1.csv")).readBytes().decodeToString())
            assertEquals("outra", z.getInputStream(z.getEntry("viagem_1-2.csv")).readBytes().decodeToString())
            assertArrayEquals(src.readBytes(), z.getInputStream(z.getEntry("diag.jsonl")).readBytes())
        }
        // o .jsonl repetitivo compacta: o .zip fica bem menor que o original
        assert(out.length() < src.length() / 5) { "zip ${out.length()} vs ${src.length()}" }
    }
}

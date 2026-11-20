package com.universal.obddashboard.export

import java.io.BufferedOutputStream
import java.io.File
import java.util.zip.ZipEntry
import java.util.zip.ZipOutputStream

/**
 * Um .zip escrito entrada por entrada: o conteúdo de cada arquivo vai direto para o disco, sem juntar tudo na
 * memória (o histórico de um ano ou as gravações de diagnóstico passam de dezenas de MB).
 */
object ZipExport {

    class Writer internal constructor(private val zip: ZipOutputStream) {
        private val used = HashSet<String>()

        /** Quantas entradas foram gravadas. */
        var count = 0
            private set

        fun add(name: String, bytes: ByteArray) = entry(name) { zip.write(bytes) }

        /** Copia o arquivo em blocos; serve também para o que ainda está sendo gravado (lê o tamanho de agora). */
        fun add(name: String, file: File) = entry(name) { file.inputStream().use { it.copyTo(zip) } }

        private inline fun entry(name: String, body: () -> Unit) {
            zip.putNextEntry(ZipEntry(unique(name)))
            body()
            zip.closeEntry()
            count++
        }

        /** Nome repetido ganha sufixo (viagem_1.csv, viagem_1-2.csv), senão o .zip ficaria inválido. */
        private fun unique(name: String): String {
            if (used.add(name)) return name
            val dot = name.lastIndexOf('.').takeIf { it > 0 } ?: name.length
            var n = 2
            while (true) {
                val candidate = name.substring(0, dot) + "-" + n + name.substring(dot)
                if (used.add(candidate)) return candidate
                n++
            }
        }
    }

    /** Grava [out] com o que [block] adicionar; inline para o bloco poder consultar o banco (suspend). */
    inline fun <T> write(out: File, block: (Writer) -> T): T =
        ZipOutputStream(BufferedOutputStream(out.outputStream())).use { block(newWriter(it)) }

    @PublishedApi
    internal fun newWriter(zip: ZipOutputStream) = Writer(zip)
}

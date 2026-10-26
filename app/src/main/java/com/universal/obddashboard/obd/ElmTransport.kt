package com.universal.obddashboard.obd

/** O adaptador não devolveu o prompt '>' dentro do prazo. O link continua válido. */
class ElmTimeoutException(command: String) : Exception("Timeout aguardando resposta de '$command'")

/**
 * Canal serial com um ELM327: um comando em voo por vez, resposta lida até o prompt '>'.
 * Implementado por [BluetoothSerialManager] (SPP) e, nos testes, pelo simulador em JVM.
 */
fun interface ElmTransport {
    /**
     * Envia "<cmd>\r" e retorna o texto bruto da resposta, sem o prompt.
     * @throws ElmTimeoutException se o prompt não chegar a tempo (link segue aberto)
     * @throws java.io.IOException se o link caiu
     */
    suspend fun sendRaw(command: String, timeoutMs: Long): String
}

/**
 * Transporte que também sabe escutar: comandos como ATMA não terminam sozinhos; o ELM327 fica
 * imprimindo uma linha por quadro até receber qualquer caractere.
 */
interface ElmMonitorTransport : ElmTransport {
    /**
     * Envia "<cmd>\r", entrega cada linha recebida a [onLine] e, passado [durationMs], interrompe o
     * monitoramento e aguarda o prompt. Retorna antes se o próprio ELM327 parar (BUFFER FULL, erro).
     * [onLine] roda na thread de leitura: deve ser rápido.
     * @throws java.io.IOException se o link caiu
     */
    suspend fun monitor(command: String, durationMs: Long, onLine: (String) -> Unit)
}

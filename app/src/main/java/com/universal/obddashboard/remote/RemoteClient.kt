package com.universal.obddashboard.remote

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.put
import java.io.IOException
import java.net.HttpURLConnection
import java.net.URI
import java.net.URL

/** Conversa com o servidor. Só envia: nenhuma resposta vira comando para o adaptador ou o carro. */
class RemoteClient(baseUrl: String, private val transport: Transport = UrlTransport) {

    class Response(val code: Int, val body: String)

    fun interface Transport {
        /** @throws IOException sem rede ou timeout */
        fun post(url: String, headers: Map<String, String>, body: String, timeoutMs: Int): Response
    }

    data class Pairing(val deviceId: String, val deviceName: String, val token: String)
    class PairingException(message: String) : Exception(message)

    private val base = normalizeUrl(baseUrl)

    /** @throws PairingException com texto para a tela; @throws IOException sem rede */
    fun pair(code: String, installationId: String, appVersion: String): Pairing {
        val body = buildJsonObject {
            put("code", code.trim())
            put("installationId", installationId)
            put("appVersion", appVersion.filter { it.isLetterOrDigit() || it in "._+-" }.take(32))
        }.toString()
        val res = transport.post("$base/api/v1/devices/register", JSON_HEADERS, body, TIMEOUT_MS)
        when (res.code) {
            200 -> Unit
            401 -> throw PairingException("Código inválido ou vencido. Gere outro no painel.")
            400 -> throw PairingException("Confira o código: ele tem 12 letras e números.")
            429 -> throw PairingException("Muitas tentativas. Aguarde alguns minutos.")
            else -> throw PairingException("O servidor não respondeu como esperado (${res.code}).")
        }
        val o = runCatching { Json.parseToJsonElement(res.body).jsonObject }.getOrNull()
        val token = o?.get("deviceToken")?.jsonPrimitive?.content
        val id = o?.get("deviceId")?.jsonPrimitive?.content
        if (token == null || id == null || !token.startsWith("obd_dev_")) {
            throw PairingException("Resposta inesperada: confira o endereço do servidor.")
        }
        return Pairing(id, o["deviceName"]?.jsonPrimitive?.content.orEmpty(), token)
    }

    /** @return código HTTP. @throws IOException sem rede */
    fun upload(token: String, batchJson: String): Int =
        transport.post("$base/api/v1/telemetry", JSON_HEADERS + ("Authorization" to "Bearer $token"), batchJson, TIMEOUT_MS).code

    companion object {
        private const val TIMEOUT_MS = 20_000
        private val JSON_HEADERS = mapOf("Content-Type" to "application/json")

        /** Só https, sem usuário e senha no endereço. @throws IllegalArgumentException com texto para a tela */
        fun normalizeUrl(raw: String): String {
            val text = raw.trim().trimEnd('/')
            val uri = runCatching { URI(text) }.getOrNull()
            require(uri != null && uri.scheme.equals("https", ignoreCase = true) && !uri.host.isNullOrEmpty()) {
                "O endereço precisa começar com https://"
            }
            require(uri.userInfo == null && uri.query == null && uri.fragment == null) { "Use só o endereço do servidor." }
            return text
        }
    }
}

object UrlTransport : RemoteClient.Transport {
    override fun post(url: String, headers: Map<String, String>, body: String, timeoutMs: Int): RemoteClient.Response {
        val conn = URL(url).openConnection() as HttpURLConnection
        try {
            conn.requestMethod = "POST"
            conn.connectTimeout = timeoutMs
            conn.readTimeout = timeoutMs
            // Um redirecionamento poderia levar o token para outro endereço.
            conn.instanceFollowRedirects = false
            headers.forEach { (k, v) -> conn.setRequestProperty(k, v) }
            conn.doOutput = true
            conn.outputStream.use { it.write(body.toByteArray(Charsets.UTF_8)) }
            val code = conn.responseCode
            val stream = if (code in 200..299) conn.inputStream else conn.errorStream
            return RemoteClient.Response(code, stream?.use { it.readBytes().toString(Charsets.UTF_8) }.orEmpty())
        } finally {
            conn.disconnect()
        }
    }
}

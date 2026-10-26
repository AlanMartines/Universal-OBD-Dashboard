package com.universal.obddashboard.ai

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.addJsonObject
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.put
import kotlinx.serialization.json.putJsonArray
import java.io.IOException
import java.net.HttpURLConnection
import java.net.SocketTimeoutException
import java.net.URL

/** Provedores com API no formato do OpenAI (`POST <base>/chat/completions`, chave em `Authorization: Bearer`). */
enum class AiProvider(val label: String, val baseUrl: String, val modelHint: String) {
    OPENAI("OpenAI", "https://api.openai.com/v1/", "gpt-4o-mini"),
    CLAUDE("Claude (Anthropic)", "https://api.anthropic.com/v1/", "claude-haiku-5-5"),
    GEMINI("Gemini (Google)", "https://generativelanguage.googleapis.com/v1beta/openai/", "gemini-2.5-flash"),
    CUSTOM("Personalizado (compatível com OpenAI)", "", ""),
}

/**
 * Cliente mínimo de chat completions, sem dependências: um pedido, uma resposta de texto.
 * Funciona com qualquer serviço compatível com OpenAI (OpenAI, Claude, Gemini, OpenRouter, Ollama...).
 */
class AiClient(
    baseUrl: String,
    private val apiKey: String,
    private val model: String,
    private val transport: HttpTransport = UrlConnectionTransport,
) {
    data class Message(val role: String, val content: String)
    class HttpResponse(val code: Int, val body: String)

    fun interface HttpTransport {
        /** @throws IOException sem rede / timeout */
        fun post(url: String, headers: Map<String, String>, body: String, timeoutMs: Int): HttpResponse
    }

    enum class ErrorKind { INVALID_KEY, NOT_FOUND, RATE_LIMIT, SERVER, BAD_REQUEST, NETWORK, TIMEOUT, EMPTY }

    class AiException(val kind: ErrorKind, message: String) : Exception(message)

    private val url = baseUrl.trim().trimEnd('/') + "/chat/completions"

    /** @throws AiException */
    fun chat(messages: List<Message>, maxTokens: Int = DEFAULT_MAX_TOKENS): String {
        var res = send(requestBody(model, messages, maxTokens, TokenParam.MAX_TOKENS))
        // Modelos de raciocínio do OpenAI recusam max_tokens e pedem max_completion_tokens.
        if (res.code == 400 && res.body.contains("max_completion_tokens")) {
            res = send(requestBody(model, messages, maxTokens, TokenParam.MAX_COMPLETION_TOKENS))
        }
        if (res.code !in 200..299) throw errorFor(res)
        return parseContent(res.body) ?: throw AiException(ErrorKind.EMPTY, "O provedor respondeu sem texto")
    }

    private fun send(body: String): HttpResponse = try {
        transport.post(
            url,
            mapOf("Authorization" to "Bearer $apiKey", "Content-Type" to "application/json", "Accept" to "application/json"),
            body,
            TIMEOUT_MS,
        )
    } catch (e: SocketTimeoutException) {
        throw AiException(ErrorKind.TIMEOUT, "O provedor demorou demais para responder")
    } catch (e: IOException) {
        throw AiException(ErrorKind.NETWORK, "Sem conexão com o provedor (${e.message ?: "erro de rede"})")
    }

    enum class TokenParam(val key: String) { MAX_TOKENS("max_tokens"), MAX_COMPLETION_TOKENS("max_completion_tokens") }

    companion object {
        const val DEFAULT_MAX_TOKENS = 900
        private const val TIMEOUT_MS = 45_000
        private const val MAX_ERROR_CHARS = 200
        private val json = Json { ignoreUnknownKeys = true }

        fun requestBody(model: String, messages: List<Message>, maxTokens: Int, tokenParam: TokenParam): String = buildJsonObject {
            put("model", model)
            putJsonArray("messages") {
                messages.forEach { m -> addJsonObject { put("role", m.role); put("content", m.content) } }
            }
            put(tokenParam.key, maxTokens)
        }.toString()

        /** choices[0].message.content: texto, ou lista de partes {type: text, text} (alguns provedores). */
        fun parseContent(body: String): String? = runCatching {
            val content = json.parseToJsonElement(body).jsonObject["choices"]!!.jsonArray[0].jsonObject["message"]!!.jsonObject["content"]
            when (content) {
                is JsonPrimitive -> content.contentOrNull
                is JsonArray -> content.mapNotNull { it.jsonObject["text"]?.jsonPrimitive?.contentOrNull }.joinToString("")
                else -> null
            }
        }.getOrNull()?.trim()?.takeIf { it.isNotEmpty() }

        fun errorFor(res: HttpResponse): AiException {
            val detail = runCatching {
                val root = json.parseToJsonElement(res.body)
                val err = (if (root is JsonArray) root[0] else root).jsonObject["error"]
                when (err) {
                    is JsonObject -> err["message"]?.jsonPrimitive?.contentOrNull
                    is JsonPrimitive -> err.contentOrNull
                    else -> null
                }
            }.getOrNull()?.take(MAX_ERROR_CHARS)
            val suffix = detail?.let { ": $it" } ?: " (HTTP ${res.code})"
            return when (res.code) {
                401, 403 -> AiException(ErrorKind.INVALID_KEY, "Chave recusada pelo provedor$suffix")
                404 -> AiException(ErrorKind.NOT_FOUND, "Modelo ou endereço não encontrado$suffix")
                429 -> AiException(ErrorKind.RATE_LIMIT, "Limite de uso ou créditos esgotados$suffix")
                in 500..599 -> AiException(ErrorKind.SERVER, "O provedor está com problemas$suffix")
                else -> AiException(ErrorKind.BAD_REQUEST, "Pedido recusado$suffix")
            }
        }
    }
}

/** Transporte real (HttpURLConnection). Chamar fora da thread principal. */
object UrlConnectionTransport : AiClient.HttpTransport {
    override fun post(url: String, headers: Map<String, String>, body: String, timeoutMs: Int): AiClient.HttpResponse {
        val conn = URL(url).openConnection() as HttpURLConnection
        try {
            conn.requestMethod = "POST"
            conn.connectTimeout = timeoutMs
            conn.readTimeout = timeoutMs
            conn.doOutput = true
            headers.forEach { (k, v) -> conn.setRequestProperty(k, v) }
            conn.outputStream.use { it.write(body.toByteArray(Charsets.UTF_8)) }
            val code = conn.responseCode
            val stream = if (code in 200..299) conn.inputStream else conn.errorStream
            val text = stream?.use { it.readBytes().toString(Charsets.UTF_8) }.orEmpty()
            return AiClient.HttpResponse(code, text)
        } finally {
            conn.disconnect()
        }
    }
}

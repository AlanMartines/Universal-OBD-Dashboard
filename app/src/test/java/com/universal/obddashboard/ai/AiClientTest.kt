package com.universal.obddashboard.ai

import com.universal.obddashboard.obd.ProfileParser
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File
import java.io.IOException
import java.net.SocketTimeoutException

class AiClientTest {

    private class Fake(vararg val replies: AiClient.HttpResponse) : AiClient.HttpTransport {
        val calls = mutableListOf<Triple<String, Map<String, String>, String>>()
        override fun post(url: String, headers: Map<String, String>, body: String, timeoutMs: Int): AiClient.HttpResponse {
            calls += Triple(url, headers, body)
            return replies[minOf(calls.size - 1, replies.size - 1)]
        }

        override fun get(url: String, headers: Map<String, String>, timeoutMs: Int) = post(url, headers, "", timeoutMs)
    }

    private fun ok(content: String) = AiClient.HttpResponse(200, """{"choices":[{"message":{"role":"assistant","content":$content}}]}""")
    private val msgs = listOf(AiClient.Message("user", "oi"))

    @Test fun sendsOpenAiFormatToEveryProviderBaseUrl() {
        for (p in AiProvider.entries.filter { it != AiProvider.CUSTOM }) {
            val t = Fake(ok("\"Olá\""))
            assertEquals("Olá", AiClient(p.baseUrl, "sk-test", "m1", t).chat(msgs))
            val (url, headers, body) = t.calls.single()
            assertTrue(url, url.endsWith("/chat/completions") && !url.contains("//chat"))
            assertEquals("Bearer sk-test", headers["Authorization"])
            val o = Json.parseToJsonElement(body).jsonObject
            assertEquals("m1", o["model"]!!.jsonPrimitive.content)
            assertEquals("oi", o["messages"]!!.jsonArray[0].jsonObject["content"]!!.jsonPrimitive.content)
            assertTrue(o.containsKey("max_tokens"))
        }
    }

    @Test fun readsContentAsListOfParts() {
        assertEquals("ab", AiClient("https://x/v1", "k", "m", Fake(ok("""[{"type":"text","text":"a"},{"type":"text","text":"b"}]"""))).chat(msgs))
    }

    @Test fun retriesWithMaxCompletionTokensWhenAsked() {
        val t = Fake(AiClient.HttpResponse(400, """{"error":{"message":"Unsupported parameter: 'max_tokens'. Use 'max_completion_tokens' instead."}}"""), ok("\"ok\""))
        assertEquals("ok", AiClient("https://x/v1/", "k", "m", t).chat(msgs))
        assertTrue(Json.parseToJsonElement(t.calls[1].third).jsonObject.containsKey("max_completion_tokens"))
    }

    @Test fun mapsErrorsToFriendlyMessages() {
        fun kind(code: Int, body: String = "{}") =
            runCatching { AiClient("https://x", "k", "m", Fake(AiClient.HttpResponse(code, body))).chat(msgs) }
                .exceptionOrNull() as AiClient.AiException
        assertEquals(AiClient.ErrorKind.INVALID_KEY, kind(401).kind)
        assertEquals(AiClient.ErrorKind.NOT_FOUND, kind(404).kind)
        assertEquals(AiClient.ErrorKind.RATE_LIMIT, kind(429).kind)
        assertEquals(AiClient.ErrorKind.SERVER, kind(503).kind)
        // Gemini devolve o erro dentro de uma lista
        assertTrue(kind(400, """[{"error":{"code":400,"message":"API key not valid"}}]""").message!!.contains("API key not valid"))
        assertEquals(AiClient.ErrorKind.EMPTY, kind(200, """{"choices":[{"message":{"content":""}}]}""").kind)
        val net = runCatching { AiClient("https://x", "k", "m", { _, _, _, _ -> throw IOException("no route") }).chat(msgs) }.exceptionOrNull()
        assertEquals(AiClient.ErrorKind.NETWORK, (net as AiClient.AiException).kind)
        val slow = runCatching { AiClient("https://x", "k", "m", { _, _, _, _ -> throw SocketTimeoutException() }).chat(msgs) }.exceptionOrNull()
        assertEquals(AiClient.ErrorKind.TIMEOUT, (slow as AiClient.AiException).kind)
    }

    @Test fun dtcPromptCarriesOnlyWhitelistedFields() {
        val profile = ProfileParser.parse(File("src/main/assets/profiles/fiat_uno_vivace_7gf.json").readText()).profile
        // A tela manda o item do histórico inteiro: GPS, horário e VIN não podem sair.
        val fromScreen = """{"code":"p0420","kind":"CONFIRMED","rpm":2510,"speedKmh":96.4,"engineLoadPct":41,"coolantC":88,
            "lat":-12.3456789,"lon":-45.6789123,"detectedAt":1792978490366,"vin":"9BD19713MD3112345","tripId":17,
            "ecuFrame":{"rpm":853,"coolant_temp":86,"latitude":-12.3456789,"Lon":-45.67,"x":"y"}}"""
        val req = DtcPrompt.Request.fromJson(Json.parseToJsonElement(fromScreen).jsonObject)
        val all = DtcPrompt.messages(req, profile).joinToString("\n") { it.content }
        assertTrue(all.contains("P0420 (confirmado)"))
        assertTrue(all.contains("Fiat Uno"))
        assertTrue(all.contains("rotação 2510 rpm") && all.contains("velocidade 96 km/h") && all.contains("88 °C"))
        assertTrue(all, all.contains("Congelamento de quadro gravado pela ECU:") && all.contains("853"))
        for (secret in listOf("12.34", "45.67", "1792978490366", "9BD19713", "3112345", "tripId", "17\n")) {
            assertFalse("vazou: $secret", all.contains(secret))
        }
        assertTrue(runCatching { DtcPrompt.Request.fromJson(Json.parseToJsonElement("""{"code":"rm -rf"}""").jsonObject) }.isFailure)
    }

    @Test fun listsTextModelsInOpenAiFormat() {
        val t = Fake(AiClient.HttpResponse(200, """{"object":"list","data":[{"id":"gpt-4o-mini"},{"id":"text-embedding-3-small"},
            {"id":"whisper-1"},{"id":"gpt-image-1"},{"id":"gpt-4o-realtime-preview"},{"id":"gpt-4.1"},{"id":"omni-moderation-latest"}]}"""))
        assertEquals(listOf("gpt-4.1", "gpt-4o-mini"), AiClient(AiProvider.OPENAI.baseUrl, "sk-test", "", t).listModels())
        val (url, headers) = t.calls.single()
        assertEquals("https://api.openai.com/v1/models", url)
        assertEquals("Bearer sk-test", headers["Authorization"])
    }

    @Test fun geminiModelNamesLoseThePrefix() {
        val t = Fake(AiClient.HttpResponse(200, """{"object":"list","data":[{"id":"models/gemini-2.5-flash","object":"model"},
            {"id":"models/gemini-embedding-001"},{"id":"models/imagen-4.0-generate-001"},{"id":"models/gemini-2.5-pro"}]}"""))
        assertEquals(listOf("gemini-2.5-flash", "gemini-2.5-pro"), AiClient(AiProvider.GEMINI.baseUrl, "k", "", t).listModels())
        assertEquals("https://generativelanguage.googleapis.com/v1beta/openai/models", t.calls.single().first)
    }

    @Test fun anthropicListsWithItsOwnHeaders() {
        val t = Fake(AiClient.HttpResponse(200, """{"data":[{"type":"model","id":"claude-haiku-5-5","display_name":"Claude Haiku 5.5"},
            {"type":"model","id":"claude-opus-5-5"}],"has_more":false}"""))
        assertEquals(listOf("claude-haiku-5-5", "claude-opus-5-5"), AiClient(AiProvider.CLAUDE.baseUrl, "sk-ant", "", t).listModels())
        val (url, headers) = t.calls.single()
        assertEquals("https://api.anthropic.com/v1/models?limit=1000", url)
        assertEquals("sk-ant", headers["x-api-key"])
        assertTrue(headers.containsKey("anthropic-version"))
        assertFalse(headers.containsKey("Authorization"))
    }

    @Test fun listModelsReportsKeyAndFormatErrors() {
        val bad = Fake(AiClient.HttpResponse(401, """{"error":{"message":"invalid api key"}}"""))
        val e = runCatching { AiClient(AiProvider.OPENAI.baseUrl, "x", "", bad).listModels() }.exceptionOrNull() as AiClient.AiException
        assertEquals(AiClient.ErrorKind.INVALID_KEY, e.kind)
        val odd = Fake(AiClient.HttpResponse(200, "<html>"))
        val e2 = runCatching { AiClient(AiProvider.OPENAI.baseUrl, "x", "", odd).listModels() }.exceptionOrNull() as AiClient.AiException
        assertEquals(AiClient.ErrorKind.EMPTY, e2.kind)
    }
}

package com.universal.obddashboard.ai

import android.content.Context
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import android.util.Log
import java.security.KeyStore
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

/**
 * Configuração do assistente IA. A chave de API é guardada cifrada (AES-GCM) com uma chave que
 * vive só no Android Keystore deste aparelho: um backup copiado para outro celular não a revela
 * (lá a decifragem falha e o app pede a chave de novo).
 */
object AiSettings {

    /** [consents]: tipos de envio já aceitos depois de ver o texto ("dtc", "trip", "ask"). */
    data class Config(val enabled: Boolean, val provider: AiProvider, val baseUrl: String, val model: String, val consents: Set<String>) {
        val ready: Boolean get() = enabled && baseUrl.isNotBlank() && model.isNotBlank()
    }

    private const val PREFS = "ai_settings"
    private const val KEY_ENABLED = "enabled"
    private const val KEY_PROVIDER = "provider"
    private const val KEY_BASE_URL = "base_url"
    private const val KEY_MODEL = "model"
    private const val KEY_CONSENT = "consent" // v0.6.0: só "Explicar falha"
    private const val KEY_CONSENTS = "consents"
    val CONSENT_KINDS = setOf("dtc", "trip", "ask")
    private const val KEY_SECRET = "api_key_enc"
    private const val KEYSTORE = "AndroidKeyStore"
    private const val KEY_ALIAS = "obd_ai_api_key"
    private const val TAG = "AiSettings"

    private fun prefs(c: Context) = c.getSharedPreferences(PREFS, Context.MODE_PRIVATE)

    fun config(c: Context): Config {
        val p = prefs(c)
        val provider = runCatching { AiProvider.valueOf(p.getString(KEY_PROVIDER, null)!!) }.getOrDefault(AiProvider.OPENAI)
        return Config(
            enabled = p.getBoolean(KEY_ENABLED, false),
            provider = provider,
            baseUrl = p.getString(KEY_BASE_URL, null) ?: provider.baseUrl,
            model = p.getString(KEY_MODEL, null).orEmpty(),
            consents = p.getStringSet(KEY_CONSENTS, null)?.toSet()
                ?: if (p.getBoolean(KEY_CONSENT, false)) setOf("dtc") else emptySet(),
        )
    }

    fun save(c: Context, enabled: Boolean, provider: AiProvider, baseUrl: String, model: String) {
        val url = baseUrl.trim().ifEmpty { provider.baseUrl }
        require(url.startsWith("https://")) { "O endereço precisa começar com https://" }
        prefs(c).edit()
            .putBoolean(KEY_ENABLED, enabled)
            .putString(KEY_PROVIDER, provider.name)
            .putString(KEY_BASE_URL, url)
            .putString(KEY_MODEL, model.trim())
            .apply()
    }

    fun addConsent(c: Context, kind: String) {
        require(kind in CONSENT_KINDS) { "Tipo inválido: $kind" }
        prefs(c).edit().putStringSet(KEY_CONSENTS, config(c).consents + kind).apply()
    }

    fun hasKey(c: Context) = apiKey(c) != null

    /** "sk-…a1b2" para mostrar na tela; null sem chave. */
    fun maskedKey(c: Context): String? = apiKey(c)?.let { k ->
        if (k.length <= 8) "••••" else k.take(3) + "…" + k.takeLast(4)
    }

    fun setApiKey(c: Context, key: String?) {
        val k = key?.trim().orEmpty()
        if (k.isEmpty()) {
            prefs(c).edit().remove(KEY_SECRET).apply()
            return
        }
        val cipher = Cipher.getInstance("AES/GCM/NoPadding").apply { init(Cipher.ENCRYPT_MODE, secretKey()) }
        val enc = cipher.iv + cipher.doFinal(k.toByteArray(Charsets.UTF_8))
        prefs(c).edit().putString(KEY_SECRET, Base64.encodeToString(enc, Base64.NO_WRAP)).apply()
    }

    fun apiKey(c: Context): String? {
        val stored = prefs(c).getString(KEY_SECRET, null) ?: return null
        return try {
            val raw = Base64.decode(stored, Base64.NO_WRAP)
            val cipher = Cipher.getInstance("AES/GCM/NoPadding")
            cipher.init(Cipher.DECRYPT_MODE, secretKey(), GCMParameterSpec(128, raw, 0, GCM_IV_BYTES))
            String(cipher.doFinal(raw, GCM_IV_BYTES, raw.size - GCM_IV_BYTES), Charsets.UTF_8)
        } catch (e: Exception) {
            Log.w(TAG, "Chave de API ilegível neste aparelho; será pedida de novo")
            prefs(c).edit().remove(KEY_SECRET).apply()
            null
        }
    }

    private const val GCM_IV_BYTES = 12

    private fun secretKey(): SecretKey {
        val ks = KeyStore.getInstance(KEYSTORE).apply { load(null) }
        (ks.getEntry(KEY_ALIAS, null) as? KeyStore.SecretKeyEntry)?.let { return it.secretKey }
        return KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, KEYSTORE).apply {
            init(
                KeyGenParameterSpec.Builder(KEY_ALIAS, KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT)
                    .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                    .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                    .setKeySize(256)
                    .build(),
            )
        }.generateKey()
    }
}

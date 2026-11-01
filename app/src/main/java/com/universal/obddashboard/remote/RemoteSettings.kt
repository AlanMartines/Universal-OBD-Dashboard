package com.universal.obddashboard.remote

import android.content.Context
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import android.util.Log
import androidx.core.content.edit
import java.security.KeyStore
import java.util.UUID
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

/**
 * Configuração do envio ao servidor. Desligado até a pessoa parear. O token fica cifrado com uma
 * chave do Android Keystore: um backup copiado para outro celular não o revela.
 */
object RemoteSettings {
    private const val PREFS = "remote_telemetry"
    private const val KEY_URL = "base_url"
    private const val KEY_ENABLED = "enabled"
    private const val KEY_GPS = "send_gps"
    private const val KEY_INSTALLATION = "installation_id"
    private const val KEY_DEVICE_NAME = "device_name"
    private const val KEY_CURSOR = "cursor"
    private const val KEY_TOKEN = "token_enc"
    private const val KEY_LAST_SENT = "last_sent_at"
    private const val KEY_LAST_ERROR = "last_error"
    private const val KEYSTORE = "AndroidKeyStore"
    private const val KEY_ALIAS = "obd_remote_token"
    private const val GCM_IV_BYTES = 12
    private const val TAG = "RemoteSettings"

    private fun prefs(c: Context) = c.getSharedPreferences(PREFS, Context.MODE_PRIVATE)

    fun baseUrl(c: Context): String = prefs(c).getString(KEY_URL, null).orEmpty()
    fun enabled(c: Context): Boolean = prefs(c).getBoolean(KEY_ENABLED, false)
    fun setEnabled(c: Context, on: Boolean) = prefs(c).edit { putBoolean(KEY_ENABLED, on) }
    fun sendGps(c: Context): Boolean = prefs(c).getBoolean(KEY_GPS, false)
    fun setSendGps(c: Context, on: Boolean) = prefs(c).edit { putBoolean(KEY_GPS, on) }
    fun deviceName(c: Context): String = prefs(c).getString(KEY_DEVICE_NAME, null).orEmpty()
    fun cursor(c: Context): Long = prefs(c).getLong(KEY_CURSOR, 0L)
    fun setCursor(c: Context, id: Long) = prefs(c).edit { putLong(KEY_CURSOR, id) }
    fun lastSentAt(c: Context): Long = prefs(c).getLong(KEY_LAST_SENT, 0L)
    fun lastError(c: Context): String = prefs(c).getString(KEY_LAST_ERROR, null).orEmpty()

    fun recordResult(c: Context, sentNow: Boolean, error: String?) = prefs(c).edit {
        if (sentNow) putLong(KEY_LAST_SENT, System.currentTimeMillis())
        if (error == null) remove(KEY_LAST_ERROR) else putString(KEY_LAST_ERROR, error)
    }

    /** Identificador aleatório desta instalação. Não usa IMEI, MAC nem ID do aparelho. */
    fun installationId(c: Context): String = prefs(c).getString(KEY_INSTALLATION, null) ?: UUID.randomUUID().toString().also {
        prefs(c).edit { putString(KEY_INSTALLATION, it) }
    }

    /** Liga o envio a partir de agora: o histórico anterior ao pareamento não sobe. */
    fun savePairing(c: Context, url: String, deviceName: String, token: String, cursor: Long) {
        val cipher = Cipher.getInstance("AES/GCM/NoPadding").apply { init(Cipher.ENCRYPT_MODE, secretKey()) }
        val enc = cipher.iv + cipher.doFinal(token.toByteArray(Charsets.UTF_8))
        prefs(c).edit {
            putString(KEY_URL, url)
            putString(KEY_DEVICE_NAME, deviceName)
            putString(KEY_TOKEN, Base64.encodeToString(enc, Base64.NO_WRAP))
            putLong(KEY_CURSOR, cursor)
            putBoolean(KEY_ENABLED, true)
            remove(KEY_LAST_ERROR)
            remove(KEY_LAST_SENT)
        }
    }

    fun clearPairing(c: Context, error: String? = null) = prefs(c).edit {
        remove(KEY_TOKEN)
        remove(KEY_DEVICE_NAME)
        putBoolean(KEY_ENABLED, false)
        if (error == null) remove(KEY_LAST_ERROR) else putString(KEY_LAST_ERROR, error)
    }

    fun token(c: Context): String? {
        val stored = prefs(c).getString(KEY_TOKEN, null) ?: return null
        return try {
            val raw = Base64.decode(stored, Base64.NO_WRAP)
            val cipher = Cipher.getInstance("AES/GCM/NoPadding")
            cipher.init(Cipher.DECRYPT_MODE, secretKey(), GCMParameterSpec(128, raw, 0, GCM_IV_BYTES))
            String(cipher.doFinal(raw, GCM_IV_BYTES, raw.size - GCM_IV_BYTES), Charsets.UTF_8)
        } catch (_: Exception) {
            Log.w(TAG, "Token ilegível neste aparelho; será preciso parear de novo")
            clearPairing(c)
            null
        }
    }

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

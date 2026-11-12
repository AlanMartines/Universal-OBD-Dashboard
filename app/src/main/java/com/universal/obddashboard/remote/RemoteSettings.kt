package com.universal.obddashboard.remote

import android.content.Context
import com.universal.obddashboard.Vehicles
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
    private const val KEY_FUEL_HASH = "fuel_sent_hash"
    private const val KEY_FUEL_SENT_AT = "fuel_sent_at"
    private const val KEY_MAINT_HASH = "maint_sent_hash"
    private const val KEYSTORE = "AndroidKeyStore"
    private const val KEY_ALIAS = "obd_remote_token"
    private const val GCM_IV_BYTES = 12
    private const val TAG = "RemoteSettings"

    private fun prefs(c: Context) = c.getSharedPreferences(PREFS, Context.MODE_PRIVATE)

    /** Cada veículo tem o próprio pareamento: o servidor vê um dispositivo por carro. */
    private fun k(key: String, v: String) = Vehicles.scopedKey(key, v)

    fun baseUrl(c: Context, v: String = Vehicles.selectedId(c)): String = prefs(c).getString(k(KEY_URL, v), null).orEmpty()
    fun enabled(c: Context, v: String = Vehicles.selectedId(c)): Boolean = prefs(c).getBoolean(k(KEY_ENABLED, v), false)
    fun setEnabled(c: Context, on: Boolean, v: String = Vehicles.selectedId(c)) = prefs(c).edit { putBoolean(k(KEY_ENABLED, v), on) }
    fun sendGps(c: Context, v: String = Vehicles.selectedId(c)): Boolean = prefs(c).getBoolean(k(KEY_GPS, v), false)
    fun setSendGps(c: Context, on: Boolean, v: String = Vehicles.selectedId(c)) = prefs(c).edit { putBoolean(k(KEY_GPS, v), on) }
    fun deviceName(c: Context, v: String = Vehicles.selectedId(c)): String = prefs(c).getString(k(KEY_DEVICE_NAME, v), null).orEmpty()
    fun cursor(c: Context, v: String = Vehicles.selectedId(c)): Long = prefs(c).getLong(k(KEY_CURSOR, v), 0L)
    fun setCursor(c: Context, id: Long, v: String = Vehicles.selectedId(c)) = prefs(c).edit { putLong(k(KEY_CURSOR, v), id) }
    fun lastSentAt(c: Context, v: String = Vehicles.selectedId(c)): Long = prefs(c).getLong(k(KEY_LAST_SENT, v), 0L)
    fun lastError(c: Context, v: String = Vehicles.selectedId(c)): String = prefs(c).getString(k(KEY_LAST_ERROR, v), null).orEmpty()

    /** Resumo do último envio de abastecimentos: só reenvia quando a lista mudar. */
    fun fuelSentHash(c: Context, v: String = Vehicles.selectedId(c)): String = prefs(c).getString(k(KEY_FUEL_HASH, v), null).orEmpty()
    fun setFuelSentHash(c: Context, hash: String, v: String = Vehicles.selectedId(c)) = prefs(c).edit {
        putString(k(KEY_FUEL_HASH, v), hash)
        putLong(k(KEY_FUEL_SENT_AT, v), System.currentTimeMillis())
    }
    /** Hash da última lista de manutenção aceita pelo painel (só reenvia quando muda). */
    fun maintSentHash(c: Context, v: String = Vehicles.selectedId(c)): String = prefs(c).getString(k(KEY_MAINT_HASH, v), null).orEmpty()
    fun setMaintSentHash(c: Context, hash: String, v: String = Vehicles.selectedId(c)) = prefs(c).edit { putString(k(KEY_MAINT_HASH, v), hash) }

    fun fuelSentAt(c: Context, v: String = Vehicles.selectedId(c)): Long = prefs(c).getLong(k(KEY_FUEL_SENT_AT, v), 0L)

    fun recordResult(c: Context, sentNow: Boolean, error: String?, v: String = Vehicles.selectedId(c)) = prefs(c).edit {
        if (sentNow) putLong(k(KEY_LAST_SENT, v), System.currentTimeMillis())
        if (error == null) remove(k(KEY_LAST_ERROR, v)) else putString(k(KEY_LAST_ERROR, v), error)
    }

    /** Identificador aleatório desta instalação. Não usa IMEI, MAC nem ID do aparelho. */
    fun installationId(c: Context): String = prefs(c).getString(KEY_INSTALLATION, null) ?: UUID.randomUUID().toString().also {
        prefs(c).edit { putString(KEY_INSTALLATION, it) }
    }

    /** Liga o envio a partir de agora: o histórico anterior ao pareamento não sobe. */
    fun savePairing(c: Context, url: String, deviceName: String, token: String, cursor: Long, v: String = Vehicles.selectedId(c)) {
        val cipher = Cipher.getInstance("AES/GCM/NoPadding").apply { init(Cipher.ENCRYPT_MODE, secretKey()) }
        val enc = cipher.iv + cipher.doFinal(token.toByteArray(Charsets.UTF_8))
        prefs(c).edit {
            putString(k(KEY_URL, v), url)
            putString(k(KEY_DEVICE_NAME, v), deviceName)
            putString(k(KEY_TOKEN, v), Base64.encodeToString(enc, Base64.NO_WRAP))
            putLong(k(KEY_CURSOR, v), cursor)
            putBoolean(k(KEY_ENABLED, v), true)
            remove(k(KEY_LAST_ERROR, v))
            remove(k(KEY_LAST_SENT, v))
            remove(k(KEY_FUEL_HASH, v))
            remove(k(KEY_MAINT_HASH, v))
        }
    }

    fun clearPairing(c: Context, error: String? = null, v: String = Vehicles.selectedId(c)) = prefs(c).edit {
        remove(k(KEY_TOKEN, v))
        remove(k(KEY_DEVICE_NAME, v))
        putBoolean(k(KEY_ENABLED, v), false)
        if (error == null) remove(k(KEY_LAST_ERROR, v)) else putString(k(KEY_LAST_ERROR, v), error)
    }

    fun token(c: Context, v: String = Vehicles.selectedId(c)): String? {
        val stored = prefs(c).getString(k(KEY_TOKEN, v), null) ?: return null
        return try {
            val raw = Base64.decode(stored, Base64.NO_WRAP)
            val cipher = Cipher.getInstance("AES/GCM/NoPadding")
            cipher.init(Cipher.DECRYPT_MODE, secretKey(), GCMParameterSpec(128, raw, 0, GCM_IV_BYTES))
            String(cipher.doFinal(raw, GCM_IV_BYTES, raw.size - GCM_IV_BYTES), Charsets.UTF_8)
        } catch (_: Exception) {
            Log.w(TAG, "Token ilegível neste aparelho; será preciso parear de novo")
            clearPairing(c, v = v)
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

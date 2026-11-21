package com.universal.obddashboard

import android.content.Context
import android.content.Intent
import androidx.core.content.edit
import java.security.MessageDigest
import java.security.SecureRandom
import java.util.Base64

/**
 * Pedidos internos que chegam por componentes exportados (a tela principal precisa ser exportada para abrir
 * pelo ícone): só valem com o código aleatório desta instalação, que só o próprio app conhece e põe nas suas
 * notificações. Outro app instalado não consegue mandar "iniciar captura" sozinho.
 *
 * O código fica num arquivo de preferências próprio, fora do backup do app (é segredo, como as chaves).
 */
object IntentGuard {

    const val EXTRA_TOKEN = "com.universal.obddashboard.extra.INTENT_TOKEN"
    private const val FILE = "intent_guard"
    private const val KEY = "token"

    @Synchronized
    fun token(context: Context): String {
        val prefs = context.applicationContext.getSharedPreferences(FILE, Context.MODE_PRIVATE)
        prefs.getString(KEY, null)?.let { return it }
        val bytes = ByteArray(32).also { SecureRandom().nextBytes(it) }
        val novo = Base64.getUrlEncoder().withoutPadding().encodeToString(bytes)
        prefs.edit { putString(KEY, novo) }
        return novo
    }

    /** Põe o código desta instalação no Intent (para PendingIntents do próprio app). */
    fun attach(context: Context, intent: Intent): Intent = intent.putExtra(EXTRA_TOKEN, token(context))

    fun isTrusted(context: Context, intent: Intent?): Boolean =
        matches(token(context), intent?.getStringExtra(EXTRA_TOKEN))

    /** Comparação em tempo constante; ausente ou vazio nunca vale. */
    fun matches(expected: String?, given: String?): Boolean =
        !expected.isNullOrEmpty() && !given.isNullOrEmpty() &&
            MessageDigest.isEqual(expected.toByteArray(), given.toByteArray())
}

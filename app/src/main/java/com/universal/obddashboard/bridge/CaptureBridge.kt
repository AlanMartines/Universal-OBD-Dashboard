package com.universal.obddashboard.bridge

import android.content.Context
import android.content.Intent
import android.os.Build
import android.os.VibrationEffect
import android.os.Vibrator
import android.os.VibratorManager
import android.speech.tts.TextToSpeech
import android.webkit.JavascriptInterface
import androidx.lifecycle.DefaultLifecycleObserver
import androidx.lifecycle.LifecycleOwner
import com.universal.obddashboard.AppSettings
import com.universal.obddashboard.MainActivity
import com.universal.obddashboard.diagnostics.CaptureMarks
import com.universal.obddashboard.diagnostics.CaptureScript
import com.universal.obddashboard.service.ObdForegroundService
import org.json.JSONObject
import java.util.Locale

/**
 * Ponte JavaScript "AndroidCapture": roteiro de captura (Ajustes → Escuta CAN). A tela conduz os passos;
 * aqui ficam o roteiro do perfil, as marcas no arquivo de diagnóstico, a voz e a vibração. Nada vai ao carro.
 */
class CaptureBridge(private val activity: MainActivity) {

    @Volatile private var tts: TextToSpeech? = null
    @Volatile private var ttsReady = false

    init {
        activity.lifecycle.addObserver(object : DefaultLifecycleObserver {
            override fun onDestroy(owner: LifecycleOwner) {
                tts?.shutdown()
                tts = null
            }
        })
    }

    /** {ok, script, diagEnabled, recording} ou {ok: false, error}. */
    @JavascriptInterface
    fun getCaptureScript(): String = try {
        val script = CaptureScript.load(activity, activity.currentProfile().profile.profileId)
        JSONObject().put("ok", true).put("script", JSONObject(CaptureScript.encode(script)))
            .put("diagEnabled", AppSettings.diagnosticRecording(activity))
            .put("recording", ObdForegroundService.isRecording)
            .toString()
    } catch (e: Exception) {
        JSONObject().put("ok", false).put("error", e.message ?: "erro").toString()
    }

    /**
     * Grava a marca {script, step, phase, n?, label?, value?, note?, result?} e mantém a captura viva
     * (o aviso de parada longa não interrompe o passo). "ok" ou o motivo.
     */
    @JavascriptInterface
    fun captureMark(json: String): String {
        val fields = CaptureMarks.sanitize(json) ?: return "Marca inválida."
        if (!ObdForegroundService.mark(fields)) return "Sem captura gravando: ligue a Gravação de diagnóstico e toque em Iniciar."
        captureKeepAlive()
        return "ok"
    }

    /** Com o roteiro aberto, a parada longa não encerra a captura: a tela chama isto a cada minuto. */
    @JavascriptInterface
    fun captureKeepAlive() {
        if (!ObdForegroundService.isRunning || ObdForegroundService.isStopping) return
        activity.startService(Intent(activity, ObdForegroundService::class.java).setAction(ObdForegroundService.ACTION_KEEP_ALIVE))
    }

    /** Fala o texto em português, interrompendo a fala anterior. */
    @JavascriptInterface
    fun captureSpeak(text: String) {
        val clean = text.filterNot { it.isISOControl() }.take(200)
        if (clean.isBlank()) return
        val engine = tts
        if (engine != null && ttsReady) {
            engine.speak(clean, TextToSpeech.QUEUE_FLUSH, null, "roteiro")
            return
        }
        if (engine == null) {
            tts = TextToSpeech(activity.applicationContext) { status ->
                ttsReady = status == TextToSpeech.SUCCESS
                if (ttsReady) {
                    tts?.language = Locale.forLanguageTag("pt-BR")
                    tts?.speak(clean, TextToSpeech.QUEUE_FLUSH, null, "roteiro")
                }
            }
        }
    }

    @JavascriptInterface
    fun captureVibrate(ms: Int) {
        val duration = ms.coerceIn(20, 1500).toLong()
        val vibrator = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            (activity.getSystemService(Context.VIBRATOR_MANAGER_SERVICE) as? VibratorManager)?.defaultVibrator
        } else {
            @Suppress("DEPRECATION")
            activity.getSystemService(Context.VIBRATOR_SERVICE) as? Vibrator
        } ?: return
        if (!vibrator.hasVibrator()) return
        vibrator.vibrate(VibrationEffect.createOneShot(duration, VibrationEffect.DEFAULT_AMPLITUDE))
    }
}

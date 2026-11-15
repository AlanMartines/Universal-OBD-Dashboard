package com.universal.obddashboard.service

import android.annotation.SuppressLint
import android.content.Context
import android.location.Location
import android.location.LocationListener
import android.location.LocationManager
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import android.util.Log
import com.google.android.gms.common.ConnectionResult
import com.google.android.gms.common.GoogleApiAvailability
import com.google.android.gms.location.FusedLocationProviderClient
import com.google.android.gms.location.LocationCallback
import com.google.android.gms.location.LocationRequest
import com.google.android.gms.location.LocationResult
import com.google.android.gms.location.LocationServices
import com.google.android.gms.location.Priority
import java.util.concurrent.Executors

/** Regras da escolha da fonte do GPS, separadas do Android para teste. */
object GpsSourcePolicy {
    /** Google ligado, em alta precisão, sem posição por este tempo: o nativo entra junto até o Google voltar. */
    const val GOOGLE_SILENT_MS = 30_000L

    enum class Source(val label: String) { GOOGLE("google"), NATIVE("nativo") }

    fun initial(googleAvailable: Boolean) = if (googleAvailable) Source.GOOGLE else Source.NATIVE

    /** O nativo deve rodar junto do Google? Só em alta precisão e com o Google mudo há [GOOGLE_SILENT_MS]. */
    fun needsNativeBackup(source: Source, highAccuracy: Boolean, googleSilentMs: Long) =
        source == Source.GOOGLE && highAccuracy && googleSilentMs >= GOOGLE_SILENT_MS
}

/**
 * Posição do celular: usa o serviço do Google quando ele existe e responde; senão, o GPS do próprio Android.
 *
 * - Sem o Google Play Services (ex.: LineageOS sem GApps), ou se o pedido ao Google falhar: só o nativo.
 * - Com o Google mudo por [GpsSourcePolicy.GOOGLE_SILENT_MS] em alta precisão, o nativo liga junto e desliga
 *   na primeira posição que o Google mandar de novo.
 * - No Android 14+, a altitude acima do nível do mar é calculada pelo próprio Android quando a posição não a traz.
 *
 * Tudo roda na thread principal; [onLocation] também é chamado nela.
 */
class LocationSource(
    private val context: Context,
    private val onLocation: (Location) -> Unit,
    private val onSourceChange: (source: String, reason: String) -> Unit,
) {
    private val main = Handler(Looper.getMainLooper())
    private val altitudeWorker by lazy { Executors.newSingleThreadExecutor() }
    private val lm: LocationManager? = context.getSystemService(LocationManager::class.java)

    private var source: GpsSourcePolicy.Source? = null
    private var highAccuracy = false
    private var running = false
    private var googleFailed = false

    private var fused: FusedLocationProviderClient? = null
    private var fusedCallback: LocationCallback? = null
    private var lastGoogleMono = 0L
    private var nativeListener: LocationListener? = null

    private val watchdog = object : Runnable {
        override fun run() {
            if (!running) return
            val src = source ?: return
            val silent = SystemClock.elapsedRealtime() - lastGoogleMono
            if (GpsSourcePolicy.needsNativeBackup(src, highAccuracy, silent) && nativeListener == null) {
                onSourceChange(GpsSourcePolicy.Source.NATIVE.label, "google sem posição há ${silent / 1000} s")
                startNative()
            }
            main.postDelayed(this, WATCHDOG_MS)
        }
    }

    /** Liga ou troca o ritmo (alta precisão andando; baixa potência parado). Chamar de novo só ajusta o pedido. */
    fun start(highAccuracy: Boolean) {
        this.highAccuracy = highAccuracy
        val first = !running
        running = true
        if (source == null) {
            val chosen = GpsSourcePolicy.initial(!googleFailed && googleAvailable())
            source = chosen
            onSourceChange(chosen.label, if (chosen == GpsSourcePolicy.Source.GOOGLE) "google disponível" else "google ausente")
        }
        if (source == GpsSourcePolicy.Source.GOOGLE) {
            if (first) lastGoogleMono = SystemClock.elapsedRealtime()
            startGoogle()
            // Reserva ligada: ajusta o ritmo dela também
            if (nativeListener != null) startNative()
        } else {
            startNative()
        }
        main.removeCallbacks(watchdog)
        main.postDelayed(watchdog, WATCHDOG_MS)
    }

    fun stop() {
        running = false
        main.removeCallbacks(watchdog)
        fusedCallback?.let { cb -> fused?.removeLocationUpdates(cb) }
        fusedCallback = null
        stopNative()
        source = null
        googleFailed = false
    }

    private fun googleAvailable(): Boolean = try {
        GoogleApiAvailability.getInstance().isGooglePlayServicesAvailable(context) == ConnectionResult.SUCCESS
    } catch (e: Exception) {
        false
    }

    @SuppressLint("MissingPermission")   // o serviço só liga a localização com a permissão dada
    private fun startGoogle() {
        val client = fused ?: LocationServices.getFusedLocationProviderClient(context).also { fused = it }
        val callback = fusedCallback ?: object : LocationCallback() {
            override fun onLocationResult(result: LocationResult) {
                val loc = result.lastLocation ?: return
                lastGoogleMono = SystemClock.elapsedRealtime()
                if (nativeListener != null) {
                    stopNative()
                    onSourceChange(GpsSourcePolicy.Source.GOOGLE.label, "google voltou")
                }
                deliver(loc)
            }
        }.also { fusedCallback = it }
        val request = if (highAccuracy) {
            // 2 s basta para o trajeto (a velocidade instantânea vem da ECU) e poupa bateria.
            LocationRequest.Builder(Priority.PRIORITY_HIGH_ACCURACY, 2000L).setMinUpdateIntervalMillis(1000L).build()
        } else {
            LocationRequest.Builder(Priority.PRIORITY_BALANCED_POWER_ACCURACY, 10_000L).build()
        }
        // Reutilizar o mesmo callback substitui a requisição anterior.
        try {
            client.requestLocationUpdates(request, callback, Looper.getMainLooper())
                .addOnFailureListener { e -> main.post { googleFailedNow(e.message ?: e.javaClass.simpleName) } }
        } catch (e: Exception) {
            googleFailedNow(e.message ?: e.javaClass.simpleName)
        }
    }

    private fun googleFailedNow(why: String) {
        if (!running || source != GpsSourcePolicy.Source.GOOGLE) return
        Log.i(TAG, "Google sem localização: $why; usando o GPS do Android")
        googleFailed = true   // não tenta o Google de novo nesta viagem
        fusedCallback?.let { cb -> fused?.removeLocationUpdates(cb) }
        fusedCallback = null
        source = GpsSourcePolicy.Source.NATIVE
        onSourceChange(GpsSourcePolicy.Source.NATIVE.label, "google falhou: $why")
        startNative()
    }

    @SuppressLint("MissingPermission")
    private fun startNative() {
        val manager = lm ?: return
        if (!manager.allProviders.contains(LocationManager.GPS_PROVIDER)) return
        val listener = nativeListener ?: LocationListener { loc -> deliver(loc) }.also { nativeListener = it }
        // Mesmo listener: o pedido novo substitui o anterior
        val intervalMs = if (highAccuracy) 1000L else 10_000L
        try {
            manager.requestLocationUpdates(LocationManager.GPS_PROVIDER, intervalMs, 0f, listener, Looper.getMainLooper())
        } catch (e: Exception) {
            Log.w(TAG, "GPS do Android indisponível: ${e.message}")
        }
    }

    private fun stopNative() {
        nativeListener?.let { l -> lm?.removeUpdates(l) }
        nativeListener = null
    }

    /** Sem altitude do nível do mar na posição, o Android 14+ calcula (lê um arquivo: fora da thread principal). */
    private fun deliver(loc: Location) {
        // Nada do Android 14 pode aparecer fora deste teste: em versões antigas, a classe não existe e o app fecha
        // (v0.9.49 a 0.9.52: um campo do tipo AltitudeConverter derrubava o app na primeira posição).
        if (Build.VERSION.SDK_INT < 34 || !loc.hasAltitude() || loc.hasMslAltitude()) {
            onLocation(loc)
            return
        }
        altitudeWorker.execute {
            try {
                MslAltitude.add(context, loc)
            } catch (e: Throwable) {
                Log.d(TAG, "Altitude do nível do mar indisponível: ${e.message}")
            }
            main.post { if (running) onLocation(loc) }
        }
    }

    companion object {
        private const val TAG = "LocationSource"
        private const val WATCHDOG_MS = 5_000L
    }
}

/** Altitude acima do nível do mar pelo próprio Android 14+. Só é carregada (e a classe só é resolvida) nessa versão. */
@androidx.annotation.RequiresApi(34)
private object MslAltitude {
    private val converter by lazy { android.location.altitude.AltitudeConverter() }

    fun add(context: Context, loc: Location) = converter.addMslAltitudeToLocation(context, loc)
}

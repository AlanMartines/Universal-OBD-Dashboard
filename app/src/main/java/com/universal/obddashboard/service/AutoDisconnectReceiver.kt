package com.universal.obddashboard.service

import android.Manifest
import android.annotation.SuppressLint
import android.app.PendingIntent
import android.bluetooth.BluetoothDevice
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import android.util.Log
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import androidx.core.content.ContextCompat
import androidx.core.content.IntentCompat
import com.universal.obddashboard.AppSettings
import com.universal.obddashboard.MainActivity
import com.universal.obddashboard.R
import com.universal.obddashboard.obd.ProfileParser

/**
 * Gatilhos automáticos por Bluetooth (ACL_CONNECTED / ACL_DISCONNECTED são isentos das
 * restrições de broadcast implícito, então funcionam registrados no manifesto).
 *
 * - Conexão do adaptador OBD **ou** de um dispositivo-gatilho (ex.: central multimídia do carro)
 *   → inicia o [ObdForegroundService].
 * - Desconexão do adaptador OBD → avisa o serviço, que tenta reconectar e, se não conseguir,
 *   encerra e salva a viagem.
 *
 * Observação: adaptadores ELM327 SPP são passivos — o ACL só sobe quando o telefone abre o
 * socket. Por isso o gatilho mais confiável é a central multimídia (ou a sessão do Android
 * Auto, ver DashboardCarAppService).
 */
class AutoDisconnectReceiver : BroadcastReceiver() {

    override fun onReceive(context: Context, intent: Intent) {
        val device = IntentCompat.getParcelableExtra(intent, BluetoothDevice.EXTRA_DEVICE, BluetoothDevice::class.java)
            ?: return
        val name = deviceName(context, device)
        val adapterNames = adapterNames(context)
        val isAdapter = matches(adapterNames, name, device.address)
        val isTrigger = isAdapter || matches(AppSettings.extraTriggerDevices(context), name, device.address)

        when (intent.action) {
            BluetoothDevice.ACTION_ACL_CONNECTED -> {
                if (!isTrigger || ObdForegroundService.isRunning) return
                Log.i(TAG, "Dispositivo-gatilho conectado: $name")
                if (!ObdForegroundService.start(context, "bt_acl:$name")) postTapToStart(context, name)
            }
            BluetoothDevice.ACTION_ACL_DISCONNECTED -> {
                if (!isAdapter || !ObdForegroundService.isRunning) return
                Log.i(TAG, "Adaptador OBD desconectado: $name")
                ObdForegroundService.send(context, ObdForegroundService.ACTION_LINK_LOST)
            }
        }
    }

    private fun adapterNames(context: Context): List<String> {
        val profileDefaults = runCatching { ProfileParser.loadSelected(context).profile.adapter.deviceNames }
            .getOrDefault(listOf("OBDII"))
        return AppSettings.adapterNames(context, profileDefaults)
    }

    private fun matches(candidates: List<String>, name: String?, address: String) =
        candidates.any { it.equals(address, ignoreCase = true) || (name != null && it.equals(name, ignoreCase = true)) }

    @SuppressLint("MissingPermission")
    private fun deviceName(context: Context, device: BluetoothDevice): String? {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S &&
            ContextCompat.checkSelfPermission(context, Manifest.permission.BLUETOOTH_CONNECT) != PackageManager.PERMISSION_GRANTED
        ) return null
        return try {
            device.name
        } catch (e: SecurityException) {
            null
        }
    }

    /** Android 12+ pode bloquear o início do FGS a partir de segundo plano: pede um toque ao usuário. */
    @SuppressLint("MissingPermission")
    private fun postTapToStart(context: Context, name: String?) {
        if (Build.VERSION.SDK_INT >= 33 &&
            ContextCompat.checkSelfPermission(context, Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED
        ) return
        ObdForegroundService.createChannels(context)
        val open = PendingIntent.getActivity(
            context, 0,
            Intent(context, MainActivity::class.java).setAction(MainActivity.ACTION_START_CAPTURE),
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
        )
        val notification = NotificationCompat.Builder(context, ObdForegroundService.CHANNEL_ALERTS)
            .setSmallIcon(R.drawable.ic_stat_obd)
            .setColor(context.getColor(R.color.ic_launcher_background))
            .setContentTitle("${name ?: "Veículo"} conectado")
            .setContentText("Toque para iniciar a captura de telemetria")
            .setAutoCancel(true)
            .setContentIntent(open)
            .build()
        try {
            NotificationManagerCompat.from(context).notify(NOTIF_TAP_TO_START, notification)
        } catch (_: SecurityException) {
        }
    }

    private companion object {
        const val TAG = "AutoBtReceiver"
        const val NOTIF_TAP_TO_START = 1003
    }
}

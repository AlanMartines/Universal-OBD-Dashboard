package com.universal.obddashboard.car

import android.content.Intent
import android.content.pm.ApplicationInfo
import androidx.car.app.CarAppService
import androidx.car.app.Screen
import androidx.car.app.Session
import androidx.car.app.validation.HostValidator
import com.universal.obddashboard.R
import com.universal.obddashboard.service.ObdForegroundService

/**
 * Ponto de entrada do Android Auto. Quando o celular conecta à central (carro ligado), o host
 * cria uma sessão — usamos isso como gatilho confiável para iniciar a captura.
 */
class DashboardCarAppService : CarAppService() {

    override fun createHostValidator(): HostValidator =
        if (applicationInfo.flags and ApplicationInfo.FLAG_DEBUGGABLE != 0) {
            HostValidator.ALLOW_ALL_HOSTS_VALIDATOR
        } else {
            HostValidator.Builder(applicationContext)
                .addAllowedHosts(R.array.car_hosts_allowlist)
                .build()
        }

    override fun onCreateSession(): Session = DashboardSession()
}

class DashboardSession : Session() {
    override fun onCreateScreen(intent: Intent): Screen {
        if (!ObdForegroundService.isRunning) {
            ObdForegroundService.start(carContext, "android_auto_session")
        }
        return TelemetryScreen(carContext)
    }
}

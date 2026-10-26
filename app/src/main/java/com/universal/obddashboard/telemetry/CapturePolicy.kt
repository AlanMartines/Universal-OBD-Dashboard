package com.universal.obddashboard.telemetry

import com.universal.obddashboard.db.TripEntity

/**
 * Regras de continuidade da captura, sem Android (testáveis na JVM).
 *
 * A viagem de teste virou 9 sessões separadas por pausas de 0,3 a 18 min (paradas,
 * Bluetooth caindo, captura encerrada por inatividade): com a retomada, viraria 2 viagens.
 */
object CapturePolicy {

    const val SCAN_INTERVAL_MS = 24 * 60 * 60 * 1000L
    const val GPS_LOST_AFTER_MS = 2 * 60 * 1000L
    const val GPS_LOST_MIN_SPEED_KMH = 5.0

    /**
     * Encerramentos feitos à mão ("Encerrar viagem" no app, na notificação ou no Android Auto, e
     * "Encerrar agora" da inatividade): a próxima captura sempre começa uma viagem nova. Os mesmos
     * valores de ObdForegroundService.REASON_USER_STOP e REASON_IDLE_CONFIRMED.
     */
    val MANUAL_END_REASONS = setOf("user_stop", "idle_confirmed")

    /**
     * Retoma a última viagem se ela é do mesmo perfil, não foi encerrada à mão ([MANUAL_END_REASONS])
     * e terminou (ou teve a última amostra, quando o processo morreu sem encerrá-la) há no máximo [windowMs].
     * @param lastSampleAt horário da última amostra de telemetria da viagem, se houver
     * @return id da viagem a retomar, ou null para começar uma nova
     */
    fun tripToResume(last: TripEntity?, lastSampleAt: Long?, profileId: String, now: Long, windowMs: Long): Long? {
        if (last == null || windowMs <= 0 || last.profileId != profileId || last.endReason in MANUAL_END_REASONS) return null
        val endedAt = maxOf(last.endTime ?: 0L, lastSampleAt ?: 0L).takeIf { it > 0 } ?: last.startTime
        val gap = now - endedAt
        return if (gap in 0..windowMs) last.id else null
    }

    /** A varredura de diagnóstico (~8 s na linha K) roda no máximo uma vez por dia por veículo. */
    fun scanDue(lastScanAt: Long?, now: Long): Boolean = lastScanAt == null || now - lastScanAt !in 0 until SCAN_INTERVAL_MS

    /** Tempo de inatividade efetivo: ajuste do usuário (0 = nunca → null) ou o do perfil. */
    fun idleTimeoutS(userMinutes: Int?, profileSeconds: Long): Long? = when {
        userMinutes == null -> profileSeconds
        userMinutes <= 0 -> null
        else -> userMinutes * 60L
    }

    /** GPS "perdido": em movimento e sem posição há mais de [GPS_LOST_AFTER_MS]. */
    fun gpsLost(speedKmh: Double?, lastFixAgeMs: Long): Boolean =
        speedKmh != null && speedKmh >= GPS_LOST_MIN_SPEED_KMH && lastFixAgeMs > GPS_LOST_AFTER_MS
}

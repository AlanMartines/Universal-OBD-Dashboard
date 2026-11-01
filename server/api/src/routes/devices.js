import { audit } from '../db.js';
import { fail } from '../errors.js';
import { deviceName, MAX_LIVE_PER_USER, PAIRING_MINUTES, uuidParam } from '../schemas.js';
import { formatPairingCode, generatePairingCode, sha256 } from '../security.js';

export default function devicesRoutes(app, { config, pool, live, limit, requireReady, loadDevice, publicDevice }) {
  app.get('/internal/devices', { preValidation: requireReady }, async (request) => {
    const { user } = request.session;
    const { rows } = await pool.query(
      `SELECT d.id, d.name, d.installation_id, d.app_version, d.created_at, d.paired_at, d.last_seen_at, d.revoked_at, u.username AS owner
         FROM devices d JOIN users u ON u.id = d.user_id
        WHERE (d.user_id = $1 OR $2) AND (d.paired_at IS NOT NULL OR d.pairing_expires_at > now())
        ORDER BY d.revoked_at NULLS FIRST, d.last_seen_at DESC NULLS LAST, d.created_at DESC`,
      [user.id, user.role === 'admin'],
    );
    return { devices: rows.map(publicDevice) };
  });

  app.post('/internal/devices', {
    ...limit(20, '1 hour'),
    preValidation: requireReady,
    schema: {
      body: { type: 'object', required: ['name'], additionalProperties: false, properties: { name: deviceName } },
    },
  }, async (request) => {
    const { user } = request.session;
    const { rows } = await pool.query(
      `SELECT count(*)::int AS n FROM devices WHERE user_id = $1 AND revoked_at IS NULL`,
      [user.id],
    );
    if (rows[0].n >= config.maxDevicesPerUser) throw fail(409, 'device_limit');
    const code = generatePairingCode();
    const created = await pool.query(
      `INSERT INTO devices (user_id, name, pairing_code_hash, pairing_expires_at)
       VALUES ($1, $2, $3, now() + make_interval(mins => $4)) RETURNING id`,
      [user.id, request.body.name.trim(), sha256(code), PAIRING_MINUTES],
    );
    await audit(pool, { actor: user.username, action: 'dispositivo_criado', target: created.rows[0].id, ip: request.clientIp });
    return { id: created.rows[0].id, pairingCode: formatPairingCode(code), expiresInMinutes: PAIRING_MINUTES };
  });

  app.get('/internal/devices/:id', { preValidation: requireReady, schema: { params: uuidParam } }, async (request) => {
    const device = await loadDevice(request);
    const { rows } = await pool.query(
      `SELECT ts, metrics, dtcs, latitude, longitude, gps_speed
         FROM telemetry_samples WHERE device_id = $1 ORDER BY ts DESC LIMIT 1`,
      [device.id],
    );
    const s = rows[0];
    return {
      device: publicDevice(device),
      latest: s ? {
        ts: s.ts,
        metrics: s.metrics,
        dtcs: s.dtcs,
        gps: s.latitude === null ? null : { lat: s.latitude, lon: s.longitude, speedKmh: s.gps_speed },
      } : null,
    };
  });

  app.get('/internal/devices/:id/history', {
    preValidation: requireReady,
    schema: {
      params: uuidParam,
      querystring: {
        type: 'object',
        required: ['metric', 'hours'],
        additionalProperties: false,
        properties: {
          metric: { type: 'string', pattern: '^[A-Za-z0-9_.-]{1,48}$' },
          hours: { type: 'string', pattern: '^(1|6|24|168)$' },
        },
      },
    },
  }, async (request) => {
    const device = await loadDevice(request);
    const hours = Number(request.query.hours);
    const { rows } = await pool.query(
      `SELECT date_bin(make_interval(secs => $3), ts, 'epoch'::timestamptz) AS bucket,
              avg((metrics->>$2)::double precision) AS value
         FROM telemetry_samples
        WHERE device_id = $1 AND ts > now() - make_interval(hours => $4) AND metrics ? $2
        GROUP BY bucket ORDER BY bucket`,
      [device.id, request.query.metric, Math.ceil((hours * 3600) / 300), hours],
    );
    return { points: rows.map((r) => ({ t: r.bucket, v: r.value })) };
  });

  app.post('/internal/devices/:id/revoke', { preValidation: requireReady, schema: { params: uuidParam } }, async (request) => {
    const device = await loadDevice(request);
    await pool.query(
      `UPDATE devices SET revoked_at = COALESCE(revoked_at, now()), token_hash = NULL, pairing_code_hash = NULL WHERE id = $1`,
      [device.id],
    );
    await audit(pool, { actor: request.session.user.username, action: 'dispositivo_revogado', target: device.id, ip: request.clientIp });
    return { ok: true };
  });

  app.post('/internal/devices/:id/delete', { preValidation: requireReady, schema: { params: uuidParam } }, async (request) => {
    const device = await loadDevice(request);
    await pool.query('DELETE FROM devices WHERE id = $1', [device.id]);
    await audit(pool, { actor: request.session.user.username, action: 'dispositivo_excluido', target: device.id, ip: request.clientIp });
    return { ok: true };
  });

  const liveCount = new Map();

  // Tempo real via SSE: canal só de descida para o navegador.
  app.get('/internal/devices/:id/live', {
    config: { rateLimit: { max: 60 * config.rateLimitMax, timeWindow: '1 minute' } },
    preValidation: requireReady,
    schema: { params: uuidParam },
  }, async (request, reply) => {
    const device = await loadDevice(request);
    const { user, tokenHash } = request.session;
    const open = liveCount.get(user.id) ?? 0;
    if (open >= MAX_LIVE_PER_USER) throw fail(429, 'too_many_requests');
    liveCount.set(user.id, open + 1);

    reply.hijack();
    reply.raw.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Accel-Buffering': 'no',
      Connection: 'keep-alive',
    });
    // Envia os cabeçalhos já: sem isso, a conexão só abre quando chega o primeiro dado.
    reply.raw.write(': conectado\n\n');
    const send = (sample) => reply.raw.write(`event: sample\ndata: ${JSON.stringify(sample)}\n\n`);
    live.on(device.id, send);
    const heartbeat = setInterval(() => reply.raw.write(': ping\n\n'), 25000);
    // Logout, revogação de sessão ou conta desativada encerram a transmissão aberta.
    const recheck = setInterval(async () => {
      try {
        const { rowCount } = await pool.query(
          `SELECT 1 FROM sessions s JOIN users u ON u.id = s.user_id
            WHERE s.token_hash = $1 AND s.expires_at > now() AND NOT u.disabled`,
          [tokenHash],
        );
        if (!rowCount) reply.raw.destroy();
      } catch { /* banco indisponível: tenta de novo no próximo ciclo */ }
    }, 60000);
    let closed = false;
    reply.raw.on('close', () => {
      if (closed) return;
      closed = true;
      live.off(device.id, send);
      clearInterval(heartbeat);
      clearInterval(recheck);
      const remaining = (liveCount.get(user.id) ?? 1) - 1;
      if (remaining > 0) liveCount.set(user.id, remaining); else liveCount.delete(user.id);
    });
  });
}

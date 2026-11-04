import { fuelSummary } from '../fuel.js';
import { audit, FUEL_REMOVED_DAYS } from '../db.js';
import { fail } from '../errors.js';
import { pageNumberSchema, pageSizeSchema, paged } from '../pagination.js';
import { deviceName, MAX_LIVE_PER_USER, PAIRING_MINUTES, uuidParam } from '../schemas.js';
import { formatPairingCode, generatePairingCode, sha256 } from '../security.js';

const ROUTE_MAX_POINTS = 2000;

export default function devicesRoutes(app, { config, pool, live, limit, requireReady, requireManager, loadDevice, publicDevice, locationAllowed }) {
  app.get('/internal/devices', {
    preValidation: requireReady,
    schema: {
      querystring: {
        type: 'object',
        additionalProperties: false,
        properties: { page: pageNumberSchema, pageSize: pageSizeSchema },
      },
    },
  }, async (request) => {
    const { user } = request.session;
    const scope = '(d.user_id = $1 OR $2) AND (d.paired_at IS NOT NULL OR d.pairing_expires_at > now())';
    const { rows, pagination } = await paged(pool, {
      countSql: `SELECT count(*)::int AS total FROM devices d WHERE ${scope}`,
      listSql: `SELECT d.id, d.name, d.installation_id, d.app_version, d.created_at, d.paired_at, d.last_seen_at, d.revoked_at, u.username AS owner
         FROM devices d JOIN users u ON u.id = d.user_id
        WHERE ${scope}
        ORDER BY d.revoked_at NULLS FIRST, d.last_seen_at DESC NULLS LAST, d.created_at DESC, d.id`,
      params: [user.tenantId, user.role === 'superadmin'],
      page: request.query.page,
      pageSize: request.query.pageSize,
    });
    return { devices: rows.map(publicDevice), pagination };
  });

  app.post('/internal/devices', {
    ...limit(20, '1 hour'),
    preValidation: requireManager,
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
    const allowed = locationAllowed(request.session, device);
    return {
      locationAllowed: allowed,
      device: publicDevice(device),
      latest: s ? {
        ts: s.ts,
        metrics: s.metrics,
        dtcs: s.dtcs,
        gps: !allowed || s.latitude === null ? null : { lat: s.latitude, lon: s.longitude, speedKmh: s.gps_speed },
      } : null,
    };
  });

  app.get('/internal/devices/:id/fuel-ups', { preValidation: requireReady, schema: { params: uuidParam } }, async (request) => {
    const device = await loadDevice(request);
    const { rows } = await pool.query(
      `SELECT local_id, ts, odometer_km, liters, total_price, price_per_liter, fuel_type, ethanol_pct, full_tank, removed_at
         FROM fuel_ups WHERE device_id = $1 ORDER BY ts`,
      [device.id],
    );
    const items = rows.map((r) => ({
      id: Number(r.local_id), ts: r.ts.getTime(), odometerKm: r.odometer_km, liters: r.liters, totalPrice: r.total_price,
      pricePerLiter: r.price_per_liter, fuelType: r.fuel_type, ethanolPct: r.ethanol_pct, fullTank: r.full_tank,
      removedAt: r.removed_at ? r.removed_at.getTime() : null,
    }));
    // Os removidos no app aparecem na lista, marcados, mas não entram nas contas.
    const summary = fuelSummary(items.filter((f) => f.removedAt === null));
    return { items: items.reverse().slice(0, 100), summary, removedDays: FUEL_REMOVED_DAYS };
  });

  app.get('/internal/devices/:id/history', {
    preValidation: requireReady,
    schema: {
      params: uuidParam,
      querystring: {
        type: 'object',
        required: ['metric'],
        additionalProperties: false,
        properties: {
          metric: { type: 'string', pattern: '^[A-Za-z0-9_.-]{1,48}$' },
          hours: { type: 'string', pattern: '^(1|6|24|168)$' },
          minutes: { type: 'string', pattern: '^(5|15|60|360|1440|10080)$' },
        },
      },
    },
  }, async (request) => {
    const device = await loadDevice(request);
    const minutes = request.query.minutes ? Number(request.query.minutes) : Number(request.query.hours) * 60;
    if (!minutes) throw fail(400, 'invalid_request');
    const bucketSeconds = Math.max(1, Math.ceil((minutes * 60) / 300));
    const { rows } = await pool.query(
      `SELECT date_bin(make_interval(secs => $3), ts, 'epoch'::timestamptz) AS bucket,
              avg((metrics->>$2)::double precision) AS value
         FROM telemetry_samples
        WHERE device_id = $1 AND ts > now() - make_interval(mins => $4) AND metrics ? $2
        GROUP BY bucket ORDER BY bucket`,
      [device.id, request.query.metric, bucketSeconds, minutes],
    );
    return { bucketSeconds, points: rows.map((r) => ({ t: r.bucket, v: r.value })) };
  });

  app.get('/internal/devices/:id/route', {
    preValidation: requireReady,
    schema: {
      params: uuidParam,
      querystring: {
        type: 'object',
        required: ['minutes'],
        additionalProperties: false,
        properties: {
          minutes: { type: 'string', pattern: '^(60|1440|10080)$' },
          tripId: { type: 'string', pattern: '^[0-9]{1,15}$' },
        },
      },
    },
  }, async (request) => {
    const device = await loadDevice(request);
    if (!locationAllowed(request.session, device)) throw fail(403, 'location_restricted');
    const minutes = Number(request.query.minutes);
    const tripId = request.query.tripId ?? null;
    const { rows: trips } = await pool.query(
      `SELECT trip_id AS id, min(ts) AS start FROM telemetry_samples
        WHERE device_id = $1 AND latitude IS NOT NULL AND trip_id IS NOT NULL AND ts > now() - make_interval(mins => $2)
        GROUP BY trip_id ORDER BY start DESC LIMIT 100`,
      [device.id, minutes],
    );
    // Sem viagem escolhida vale o período; com viagem, ela inteira dentro da retenção.
    const scope = `device_id = $1 AND latitude IS NOT NULL AND longitude IS NOT NULL
      AND ($2::bigint IS NULL OR trip_id = $2::bigint) AND ($2::bigint IS NOT NULL OR ts > now() - make_interval(mins => $3))`;
    const { rows: [{ total }] } = await pool.query(`SELECT count(*)::int AS total FROM telemetry_samples WHERE ${scope}`, [device.id, tripId, minutes]);
    const step = Math.max(1, Math.ceil(total / ROUTE_MAX_POINTS));
    const { rows } = await pool.query(
      `SELECT ts, latitude, longitude, speed FROM (
         SELECT ts, latitude, longitude, COALESCE((metrics->>'speed')::double precision, gps_speed) AS speed,
                row_number() OVER (ORDER BY ts) AS n, count(*) OVER () AS c
           FROM telemetry_samples WHERE ${scope}
       ) t WHERE n % $4 = 1 OR $4 = 1 OR n = c ORDER BY ts`,
      [device.id, tripId, minutes, step],
    );
    return {
      total,
      gapSeconds: Math.max(60, step * 10),
      trips,
      points: rows.map((r) => ({ t: r.ts, lat: r.latitude, lon: r.longitude, speed: r.speed })),
    };
  });

  app.post('/internal/devices/:id/revoke', { preValidation: requireManager, schema: { params: uuidParam } }, async (request) => {
    const device = await loadDevice(request);
    await pool.query(
      `UPDATE devices SET revoked_at = COALESCE(revoked_at, now()), token_hash = NULL, pairing_code_hash = NULL WHERE id = $1`,
      [device.id],
    );
    await audit(pool, { actor: request.session.impersonatedBy ?? request.session.user.username, action: 'dispositivo_revogado', target: device.id, ip: request.clientIp });
    return { ok: true };
  });

  app.post('/internal/devices/:id/delete', { preValidation: requireManager, schema: { params: uuidParam } }, async (request) => {
    const device = await loadDevice(request);
    await pool.query('DELETE FROM devices WHERE id = $1', [device.id]);
    await audit(pool, { actor: request.session.impersonatedBy ?? request.session.user.username, action: 'dispositivo_excluido', target: device.id, ip: request.clientIp });
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
    const allowed = locationAllowed(request.session, device);
    const send = (sample) => reply.raw.write(`event: sample\ndata: ${JSON.stringify(allowed ? sample : { ...sample, gps: null })}\n\n`);
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

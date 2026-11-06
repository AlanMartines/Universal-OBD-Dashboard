import { dashLimitsFrom } from '../dash-limits.js';
import { audit } from '../db.js';
import { fail } from '../errors.js';
import { FUTURE_TOLERANCE_MS, MAX_AGE_MS, sampleSchema } from '../schemas.js';
import { normalizePairingCode, randomToken, sha256 } from '../security.js';

const LIVE_MAX_AGE_MS = 5 * 60 * 1000;

/** Métricas do computador de bordo (pc.*) guardadas para o cartão do veículo. */
const COMPUTER_KEYS = ['rangeReserveKm', 'rangeEmptyKm', 'rangeKmPerL', 'fuelUpKm', 'fuelUpKmPerL', 'recentKmPerL', 'tripAKmPerL'];

export default function deviceRoutes(app, { pool, live, limit }) {
  app.post('/api/v1/devices/register', {
    ...limit(10, '15 minutes'),
    schema: {
      body: {
        type: 'object',
        required: ['code', 'installationId'],
        additionalProperties: false,
        properties: {
          code: { type: 'string', minLength: 12, maxLength: 20 },
          installationId: { type: 'string', format: 'uuid' },
          appVersion: { type: 'string', maxLength: 32, pattern: '^[A-Za-z0-9._+-]*$' },
        },
      },
    },
  }, async (request) => {
    const { code, installationId, appVersion } = request.body;
    const token = `obd_dev_${randomToken()}`;
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      // Código de uso único: o UPDATE atômico impede usar o mesmo código duas vezes.
      const { rows } = await client.query(
        `UPDATE devices
            SET token_hash = $1, installation_id = $2, app_version = $3, paired_at = now(), last_seen_at = now(),
                pairing_code_hash = NULL, pairing_expires_at = NULL
          WHERE pairing_code_hash = $4 AND pairing_expires_at > now() AND revoked_at IS NULL
        RETURNING id, user_id, name`,
        [sha256(token), installationId, appVersion ?? null, sha256(normalizePairingCode(code))],
      );
      if (!rows.length) {
        await client.query('ROLLBACK');
        await audit(pool, { action: 'pareamento_recusado', ip: request.clientIp });
        throw fail(401, 'invalid_code');
      }
      // A mesma instalação refez o pareamento nesta conta: o token anterior deixa de valer.
      await client.query(
        `UPDATE devices SET revoked_at = now(), token_hash = NULL
          WHERE user_id = $1 AND installation_id = $2 AND id <> $3 AND revoked_at IS NULL`,
        [rows[0].user_id, installationId, rows[0].id],
      );
      await audit(client, { action: 'dispositivo_pareado', target: rows[0].id, ip: request.clientIp });
      await client.query('COMMIT');
      return { deviceId: rows[0].id, deviceName: rows[0].name, deviceToken: token };
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      throw error;
    } finally {
      client.release();
    }
  });

  const requireDevice = async (request) => {
    const header = request.headers.authorization;
    const match = typeof header === 'string' ? /^Bearer (obd_dev_[A-Za-z0-9_-]{20,128})$/.exec(header) : null;
    if (!match) throw fail(401, 'unauthenticated');
    const { rows } = await pool.query(
      `SELECT d.id, d.user_id FROM devices d JOIN users u ON u.id = d.user_id
        WHERE d.token_hash = $1 AND d.revoked_at IS NULL AND NOT u.disabled`,
      [sha256(match[1])],
    );
    if (!rows.length) throw fail(401, 'unauthenticated');
    request.device = rows[0];
  };

  // Único canal de entrada do aparelho. A resposta só confirma a gravação: nunca leva comandos.
  app.post('/api/v1/telemetry', {
    // Limite por token também barra um aparelho com defeito; a chave não guarda o token em claro.
    ...limit(120, '1 minute', (request) => sha256(String(request.headers.authorization ?? request.clientIp)).toString('hex')),
    preValidation: requireDevice,
    schema: {
      body: {
        type: 'object',
        required: ['samples'],
        additionalProperties: false,
        properties: { samples: { type: 'array', minItems: 1, maxItems: 500, items: sampleSchema } },
      },
    },
  }, async (request) => {
    const now = Date.now();
    const accepted = request.body.samples.filter((s) => s.ts <= now + FUTURE_TOLERANCE_MS && s.ts >= now - MAX_AGE_MS);
    const rejected = request.body.samples.length - accepted.length;
    let inserted = 0;
    if (accepted.length) {
      const payload = accepted.map((s) => ({
        seq: s.seq,
        ts: new Date(s.ts).toISOString(),
        trip_id: s.tripId ?? null,
        metrics: s.metrics,
        dtcs: s.dtcs ?? [],
        latitude: s.gps?.lat ?? null,
        longitude: s.gps?.lon ?? null,
        gps_speed: s.gps?.speedKmh ?? null,
        gps_accuracy: s.gps?.accuracyM ?? null,
      }));
      const result = await pool.query(
        `INSERT INTO telemetry_samples (device_id, seq, ts, trip_id, metrics, dtcs, latitude, longitude, gps_speed, gps_accuracy)
         SELECT $1, r.seq, r.ts, r.trip_id, r.metrics,
                ARRAY(SELECT jsonb_array_elements_text(r.dtcs)), r.latitude, r.longitude, r.gps_speed, r.gps_accuracy
           FROM jsonb_to_recordset($2::jsonb) AS r(
                seq bigint, ts timestamptz, trip_id bigint, metrics jsonb, dtcs jsonb,
                latitude double precision, longitude double precision, gps_speed double precision, gps_accuracy double precision)
         ON CONFLICT (device_id, seq) DO NOTHING`,
        [request.device.id, JSON.stringify(payload)],
      );
      inserted = result.rowCount;
      const newest = payload.reduce((a, b) => (a.ts > b.ts ? a : b));
      live.emit(request.device.id, {
        ts: newest.ts,
        metrics: newest.metrics,
        dtcs: newest.dtcs,
        gps: newest.latitude === null ? null : { lat: newest.latitude, lon: newest.longitude, speedKmh: newest.gps_speed },
      });
    }
    await pool.query('UPDATE devices SET last_seen_at = now() WHERE id = $1', [request.device.id]);
    return { received: request.body.samples.length, stored: inserted, rejected };
  });

  // Lista inteira de abastecimentos do veículo. O que não vier mais foi apagado no celular: fica
  // marcado como removido (o worker apaga depois de 30 dias). Se voltar na lista, deixa de estar removido.
  app.post('/api/v1/fuel-ups', {
    ...limit(30, '1 minute', (request) => sha256(String(request.headers.authorization ?? request.clientIp)).toString('hex')),
    bodyLimit: 256 * 1024,
    preValidation: requireDevice,
    schema: {
      body: {
        type: 'object',
        required: ['items'],
        additionalProperties: false,
        properties: {
          items: {
            type: 'array',
            maxItems: 1000,
            items: {
              type: 'object',
              required: ['id', 'ts', 'liters', 'fuelType', 'fullTank'],
              additionalProperties: false,
              properties: {
                id: { type: 'integer', minimum: 1, maximum: Number.MAX_SAFE_INTEGER },
                ts: { type: 'integer', minimum: 0, maximum: 8640000000000000 },
                odometerKm: { type: ['number', 'null'], minimum: 0, maximum: 10000000 },
                liters: { type: 'number', exclusiveMinimum: 0, maximum: 1000 },
                totalPrice: { type: ['number', 'null'], minimum: 0, maximum: 100000 },
                pricePerLiter: { type: ['number', 'null'], minimum: 0, maximum: 1000 },
                fuelType: { type: 'string', enum: ['gasoline', 'gasoline_premium', 'ethanol', 'mix'] },
                ethanolPct: { type: ['number', 'null'], minimum: 0, maximum: 100 },
                fullTank: { type: 'boolean' },
              },
            },
          },
        },
      },
    },
  }, async (request) => {
    const { items } = request.body;
    const ids = items.map((f) => f.id);
    if (new Set(ids).size !== ids.length) throw fail(400, 'duplicate_id');
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(
        'UPDATE fuel_ups SET removed_at = now() WHERE device_id = $1 AND removed_at IS NULL AND NOT (local_id = ANY($2::bigint[]))',
        [request.device.id, ids],
      );
      for (const f of items) {
        await client.query(
          `INSERT INTO fuel_ups (device_id, local_id, ts, odometer_km, liters, total_price, price_per_liter, fuel_type, ethanol_pct, full_tank)
           VALUES ($1, $2, to_timestamp($3 / 1000.0), $4, $5, $6, $7, $8, $9, $10)
           ON CONFLICT (device_id, local_id) DO UPDATE SET ts = EXCLUDED.ts, odometer_km = EXCLUDED.odometer_km, liters = EXCLUDED.liters,
             total_price = EXCLUDED.total_price, price_per_liter = EXCLUDED.price_per_liter, fuel_type = EXCLUDED.fuel_type,
             ethanol_pct = EXCLUDED.ethanol_pct, full_tank = EXCLUDED.full_tank, received_at = now(), removed_at = NULL`,
          [request.device.id, f.id, f.ts, f.odometerKm ?? null, f.liters, f.totalPrice ?? null, f.pricePerLiter ?? null, f.fuelType, f.ethanolPct ?? null, f.fullTank],
        );
      }
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      throw error;
    } finally {
      client.release();
    }
    return { stored: items.length };
  });

  // Última leitura, para quem está olhando agora. Não vai ao banco; quem guarda o histórico é /telemetry.
  // A resposta só diz quantas pessoas assistem, para o app reduzir o envio: nunca leva comandos.
  app.post('/api/v1/live', {
    ...limit(240, '1 minute', (request) => sha256(String(request.headers.authorization ?? request.clientIp)).toString('hex')),
    bodyLimit: 32 * 1024,
    preValidation: requireDevice,
    schema: {
      body: {
        type: 'object',
        required: ['ts', 'metrics'],
        additionalProperties: false,
        properties: {
          ts: sampleSchema.properties.ts,
          appVersion: { type: 'string', maxLength: 32, pattern: '^[A-Za-z0-9._+-]+$' },
          metrics: sampleSchema.properties.metrics,
          dtcs: sampleSchema.properties.dtcs,
          gps: sampleSchema.properties.gps,
          alerts: {
            type: 'array',
            maxItems: 5,
            items: {
              type: 'object',
              required: ['level', 'message'],
              additionalProperties: false,
              properties: {
                level: { type: 'string', enum: ['WARNING', 'CRITICAL'] },
                message: { type: 'string', minLength: 1, maxLength: 160, pattern: '^[^\\u0000-\\u001f<>]+$' },
              },
            },
          },
        },
      },
    },
  }, async (request) => {
    const { ts, metrics, dtcs, gps, alerts, appVersion } = request.body;
    if (appVersion) {
      // O pareamento grava a versão uma vez; daqui em diante, ela acompanha as atualizações do app.
      await pool.query('UPDATE devices SET app_version = $2 WHERE id = $1 AND app_version IS DISTINCT FROM $2', [request.device.id, appVersion]);
    }
    const now = Date.now();
    if (ts > now + FUTURE_TOLERANCE_MS || ts < now - LIVE_MAX_AGE_MS) return { viewers: live.listenerCount(request.device.id), accepted: false };
    // Hodômetro: o do painel (escuta CAN) vale mais que o Total calculado pelo app.
    const odometer = [metrics.odometer_km, metrics['app.odometer_km']].find((v) => typeof v === 'number' && v >= 0 && v <= 10000000);
    if (odometer !== undefined) {
      await pool.query(
        'UPDATE devices SET odometer_km = $2, odometer_at = now() WHERE id = $1 AND odometer_km IS DISTINCT FROM $2',
        [request.device.id, odometer],
      );
    }
    // Computador de bordo: guarda o último retrato (no máximo 1×/min) para a página inicial do painel.
    const computer = Object.fromEntries(COMPUTER_KEYS
      .map((k) => [k, metrics[`pc.${k}`]])
      .filter(([, v]) => typeof v === 'number' && Number.isFinite(v)));
    if (Object.keys(computer).length) {
      await pool.query(
        `UPDATE devices SET computer = $2::jsonb, computer_at = now()
          WHERE id = $1 AND (computer_at IS NULL OR computer_at < now() - interval '60 seconds')`,
        [request.device.id, JSON.stringify(computer)],
      );
    }
    const limits = dashLimitsFrom(metrics);
    if (limits) {
      // Só grava quando muda: esta rota recebe uma leitura por segundo.
      await pool.query(
        'UPDATE devices SET dash_limits = $2::jsonb WHERE id = $1 AND dash_limits IS DISTINCT FROM $2::jsonb',
        [request.device.id, JSON.stringify(limits)],
      );
    }
    live.emit(request.device.id, {
      ts: new Date(ts).toISOString(),
      metrics,
      dtcs: dtcs ?? [],
      // Alertas só seguem ao vivo: não vão ao banco
      alerts: alerts ?? [],
      gps: gps ? { lat: gps.lat, lon: gps.lon, speedKmh: gps.speedKmh ?? null } : null,
    });
    return { viewers: live.listenerCount(request.device.id), accepted: true };
  });
}

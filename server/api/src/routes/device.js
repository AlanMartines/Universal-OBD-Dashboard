import { audit } from '../db.js';
import { fail } from '../errors.js';
import { FUTURE_TOLERANCE_MS, MAX_AGE_MS, sampleSchema } from '../schemas.js';
import { normalizePairingCode, randomToken, sha256 } from '../security.js';

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
}

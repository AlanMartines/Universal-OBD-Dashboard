import { audit } from '../db.js';
import { fail } from '../errors.js';
import { uuidParam } from '../schemas.js';
import { generatePassword, hashPassword, randomToken, sha256 } from '../security.js';

const DAYS = { type: 'integer', minimum: 1, maximum: 30 };
const LABEL = { type: 'string', maxLength: 60, pattern: '^[^<>\\u0000-\\u001f]*$' };
const TOKEN = { type: 'string', minLength: 40, maxLength: 60, pattern: '^[A-Za-z0-9_-]+$' };

/**
 * Link temporário para a oficina. O dono gera um link de um veículo com prazo (até 30 dias); quem abre
 * entra numa sessão de um mecânico oculto, criado junto com o link: só leitura, só aquele veículo, sem
 * localização e sem "Meus Dados". Cancelar o link apaga esse mecânico e derruba as sessões dele.
 * O link em si só aparece uma vez, na criação; o banco guarda o hash.
 */
export default function sharesRoutes(app, {
  pool, limit, requireManager, requireRecentAuth, loadDevice, createSession,
}) {
  const quem = (request) => request.session.impersonatedBy ?? request.session.user.username;
  // Só o dono do veículo (ou o suporte entrando como ele) mexe nos links: o Super Admin não compartilha carro alheio.
  const veiculoDoDono = async (request) => {
    const device = await loadDevice(request);
    if (device.user_id !== request.session.user.tenantId) throw fail(404, 'not_found');
    return device;
  };

  app.post('/internal/devices/:id/shares', {
    ...limit(20, '1 hour'),
    preValidation: [requireManager, requireRecentAuth],
    schema: {
      params: uuidParam,
      body: { type: 'object', required: ['days'], additionalProperties: false, properties: { days: DAYS, label: LABEL } },
    },
  }, async (request, reply) => {
    const device = await veiculoDoDono(request);
    if (!device.paired_at || device.revoked_at) throw fail(400, 'device_inactive');
    const { days } = request.body;
    const label = request.body.label?.trim() || null;
    const token = randomToken(32);
    const client = await pool.connect();
    let link;
    try {
      await client.query('BEGIN');
      // O mecânico oculto: nome aleatório, senha que ninguém conhece, mesmo prazo do link
      const { rows: [mech] } = await client.query(
        `INSERT INTO users (username, password_hash, role, account_id, must_change_password, access_until, via_link, display_name)
         VALUES ($1, $2, 'mechanic', $3, false, now() + make_interval(days => $4), true, $5) RETURNING id, access_until`,
        [`oficina-${randomToken(9).toLowerCase().replace(/[^a-z0-9]/g, '')}`, await hashPassword(generatePassword()), device.user_id, days, label ?? 'Oficina (link)'],
      );
      await client.query('INSERT INTO mechanic_devices (user_id, device_id) VALUES ($1, $2)', [mech.id, device.id]);
      ({ rows: [link] } = await client.query(
        `INSERT INTO share_links (token_hash, user_id, device_id, created_by, label, expires_at)
         VALUES ($1, $2, $3, $4, $5, $6) RETURNING id, label, created_at, expires_at`,
        [sha256(token), mech.id, device.id, request.session.user.id, label, mech.access_until],
      ));
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
    await audit(pool, { actor: quem(request), action: 'link_oficina_criado', target: `${device.name}: ${days} dia(s)`, ip: request.clientIp });
    reply.code(201);
    return { token, link: publicLink(link) };
  });

  app.get('/internal/devices/:id/shares', { preValidation: requireManager, schema: { params: uuidParam } }, async (request) => {
    const device = await veiculoDoDono(request);
    const { rows } = await pool.query(
      `SELECT id, label, created_at, expires_at, revoked_at, last_used_at, uses FROM share_links
        WHERE device_id = $1 AND (revoked_at IS NULL AND expires_at > now() OR created_at > now() - interval '30 days')
        ORDER BY created_at DESC LIMIT 20`,
      [device.id],
    );
    return { links: rows.map(publicLink) };
  });

  app.post('/internal/devices/:id/shares/:shareId/revoke', {
    preValidation: requireManager,
    schema: {
      params: {
        type: 'object', required: ['id', 'shareId'], additionalProperties: false,
        properties: { id: uuidParam.properties.id, shareId: uuidParam.properties.id },
      },
    },
  }, async (request) => {
    const device = await veiculoDoDono(request);
    const { rows } = await pool.query(
      'UPDATE share_links SET revoked_at = coalesce(revoked_at, now()) WHERE id = $1 AND device_id = $2 RETURNING user_id, label',
      [request.params.shareId, device.id],
    );
    if (!rows.length) throw fail(404, 'not_found');
    // Sem o mecânico oculto, as sessões abertas pelo link caem na hora
    await pool.query('UPDATE users SET disabled = true, access_until = now() WHERE id = $1', [rows[0].user_id]);
    await pool.query('DELETE FROM sessions WHERE user_id = $1', [rows[0].user_id]);
    await audit(pool, { actor: quem(request), action: 'link_oficina_cancelado', target: device.name, ip: request.clientIp });
    return { ok: true };
  });

  // Abrir o link: troca o link por uma sessão do mecânico oculto, que vale até o fim do prazo.
  app.post('/internal/shares/open', {
    ...limit(30, '1 minute'),
    schema: { body: { type: 'object', required: ['token'], additionalProperties: false, properties: { token: TOKEN } } },
  }, async (request) => {
    const { rows } = await pool.query(
      `UPDATE share_links s SET uses = uses + 1, last_used_at = now()
        FROM users u, devices d
        WHERE s.token_hash = $1 AND s.revoked_at IS NULL AND s.expires_at > now()
          AND u.id = s.user_id AND NOT u.disabled AND d.id = s.device_id AND d.revoked_at IS NULL
        RETURNING s.user_id, s.device_id, s.expires_at, d.name`,
      [sha256(request.body.token)],
    );
    if (!rows.length) throw fail(404, 'share_invalid');
    const link = rows[0];
    const hours = Math.max(1, Math.ceil((link.expires_at.getTime() - Date.now()) / 3600000));
    const token = await createSession(link.user_id, { request, hours, freshAuth: false });
    await audit(pool, { actor: 'link da oficina', action: 'link_oficina_aberto', target: link.name, ip: request.clientIp });
    return { token, deviceId: link.device_id };
  });
}

function publicLink(l) {
  const now = Date.now();
  return {
    id: l.id,
    label: l.label,
    createdAt: l.created_at,
    expiresAt: l.expires_at,
    revokedAt: l.revoked_at ?? null,
    lastUsedAt: l.last_used_at ?? null,
    uses: l.uses ?? 0,
    active: !l.revoked_at && new Date(l.expires_at).getTime() > now,
  };
}

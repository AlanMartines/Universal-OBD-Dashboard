import { audit } from '../db.js';
import { fail } from '../errors.js';
import { pageNumberSchema, pageSizeSchema, paged } from '../pagination.js';
import { uuidParam } from '../schemas.js';
import { generatePassword, hashPassword, isValidUsername, normalizeUsername } from '../security.js';

const MECHANIC_DEVICES = { type: 'array', minItems: 1, maxItems: 50, uniqueItems: true, items: { type: 'string', format: 'uuid' } };
const ACCESS_DAYS = { type: 'integer', minimum: 1, maximum: 365 };

export default function adminRoutes(app, {
  pool, limit, requireManager, requireSuperadmin, requireRecentAuth, signupOpen,
}) {
  // Super Admin vê tudo; Admin vê só os usuários da própria conta, sem auditoria nem configurações.
  app.get('/internal/admin/overview', {
    preValidation: requireManager,
    schema: {
      querystring: {
        type: 'object',
        additionalProperties: false,
        properties: { usersPage: pageNumberSchema, auditPage: pageNumberSchema, pageSize: pageSizeSchema },
      },
    },
  }, async (request) => {
    const { user } = request.session;
    const { usersPage, auditPage, pageSize } = request.query;
    const isSuper = user.role === 'superadmin';
    const users = await paged(pool, {
      countSql: 'SELECT count(*)::int AS total FROM users u WHERE ($1 OR u.account_id = $2) AND NOT u.via_link',
      listSql: `SELECT u.id, u.username, u.email, u.role, u.disabled, u.must_change_password, u.created_at,
              u.totp_enabled_at IS NOT NULL AS mfa, u.access_until,
              -- Mecânico: veículos liberados para ele
              (SELECT coalesce(json_agg(json_build_object('id', d.id, 'name', d.name) ORDER BY d.name), '[]'::json)
                 FROM mechanic_devices m JOIN devices d ON d.id = m.device_id WHERE m.user_id = u.id) AS mechanic_devices,
              a.username AS account,
              (SELECT count(*)::int FROM devices d WHERE d.user_id = u.id AND d.revoked_at IS NULL AND d.paired_at IS NOT NULL) AS devices
         FROM users u LEFT JOIN users a ON a.id = u.account_id
        WHERE ($1 OR u.account_id = $2) AND NOT u.via_link
        ORDER BY u.created_at, u.id`,
      params: [isSuper, user.id],
      page: usersPage,
      pageSize,
    });
    // Números do topo da tela (só do que a pessoa pode ver).
    const { rows: [stats] } = await pool.query(
      `SELECT (SELECT count(*)::int FROM users u WHERE ($1 OR u.account_id = $2) AND NOT u.via_link) AS users,
              (SELECT count(*)::int FROM users u WHERE ($1 OR u.account_id = $2) AND NOT u.via_link AND NOT u.disabled) AS active,
              (SELECT count(*)::int FROM users u WHERE ($1 OR u.account_id = $2) AND NOT u.via_link AND u.totp_enabled_at IS NOT NULL) AS mfa,
              (SELECT count(*)::int FROM devices d JOIN users o ON o.id = d.user_id
                WHERE ($1 OR o.id = $2 OR o.account_id = $2) AND d.paired_at IS NOT NULL AND d.revoked_at IS NULL) AS devices,
              (SELECT count(*)::int FROM audit_log WHERE $1 AND action IN ('login_recusado', 'codigo_2fa_recusado', 'pareamento_recusado')
                AND at > now() - interval '24 hours') AS refused`,
      [isSuper, user.id],
    );
    if (!isSuper) return { users: users.rows, usersPagination: users.pagination, stats };
    const auditLog = await paged(pool, {
      countSql: 'SELECT count(*)::int AS total FROM audit_log',
      listSql: 'SELECT at, actor, action, target, ip FROM audit_log ORDER BY at DESC, id DESC',
      page: auditPage,
      pageSize,
    });
    const accounts = await pool.query(`SELECT id, username FROM users WHERE role = 'admin' AND NOT disabled ORDER BY username`);
    return {
      signupOpen: await signupOpen(),
      mfaRequiredAdmins: (await pool.query(`SELECT value FROM settings WHERE key = 'mfa_required_admins'`)).rows[0]?.value === true,
      users: users.rows,
      usersPagination: users.pagination,
      audit: auditLog.rows,
      auditPagination: auditLog.pagination,
      accounts: accounts.rows,
      stats,
    };
  });

  app.post('/internal/admin/signup', {
    preValidation: [requireSuperadmin, requireRecentAuth],
    schema: { body: { type: 'object', required: ['open'], additionalProperties: false, properties: { open: { type: 'boolean' } } } },
  }, async (request) => {
    await pool.query(`UPDATE settings SET value = $1::jsonb WHERE key = 'signup_open'`, [JSON.stringify(request.body.open)]);
    await audit(pool, { actor: request.session.impersonatedBy ?? request.session.user.username, action: request.body.open ? 'cadastro_aberto' : 'cadastro_fechado', ip: request.clientIp });
    return { ok: true };
  });

  app.post('/internal/admin/mfa-admins', {
    preValidation: [requireSuperadmin, requireRecentAuth],
    schema: { body: { type: 'object', required: ['required'], additionalProperties: false, properties: { required: { type: 'boolean' } } } },
  }, async (request) => {
    await pool.query(
      `INSERT INTO settings (key, value) VALUES ('mfa_required_admins', $1::jsonb)
       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
      [JSON.stringify(request.body.required)],
    );
    await audit(pool, {
      actor: request.session.impersonatedBy ?? request.session.user.username,
      action: request.body.required ? '2fa_admins_obrigatorio' : '2fa_admins_opcional',
      ip: request.clientIp,
    });
    return { ok: true };
  });

  app.post('/internal/admin/users', {
    ...limit(30, '1 hour'),
    preValidation: [requireManager, requireRecentAuth],
    schema: {
      body: {
        type: 'object',
        required: ['username', 'role'],
        additionalProperties: false,
        properties: {
          username: { type: 'string', maxLength: 64 },
          role: { enum: ['superadmin', 'admin', 'user', 'mechanic'] },
          accountId: { type: 'string', format: 'uuid' },
          // Mecânico: veículos da conta que ele pode ver e, se quiser, por quantos dias
          deviceIds: MECHANIC_DEVICES,
          accessDays: ACCESS_DAYS,
        },
      },
    },
  }, async (request) => {
    const { user } = request.session;
    const { role } = request.body;
    const username = normalizeUsername(request.body.username);
    if (!isValidUsername(username)) throw fail(400, 'username_invalid');

    let accountId = null;
    const linked = role === 'user' || role === 'mechanic';
    if (user.role === 'admin') {
      // Admin só cria Usuário ou Mecânico, sempre na própria conta. O vínculo não vem do formulário.
      if (!linked || request.body.accountId) throw fail(403, 'forbidden');
      accountId = user.id;
    } else if (linked) {
      if (!request.body.accountId) throw fail(400, 'account_required');
      const account = await pool.query(`SELECT 1 FROM users WHERE id = $1 AND role = 'admin' AND NOT disabled`, [request.body.accountId]);
      if (!account.rowCount) throw fail(400, 'account_invalid');
      accountId = request.body.accountId;
    } else if (request.body.accountId) {
      throw fail(400, 'account_invalid');
    }

    if (role !== 'mechanic' && (request.body.deviceIds || request.body.accessDays)) throw fail(400, 'invalid_request');
    const deviceIds = role === 'mechanic' ? await ownDevices(accountId, request.body.deviceIds) : [];

    const password = generatePassword();
    const client = await pool.connect();
    let result;
    try {
      await client.query('BEGIN');
      result = await client.query(
        `INSERT INTO users (username, password_hash, role, account_id, must_change_password, access_until)
         VALUES ($1, $2, $3, $4, true, CASE WHEN $5::int IS NULL THEN NULL ELSE now() + make_interval(days => $5::int) END)
         ON CONFLICT (username) DO NOTHING RETURNING id`,
        [username, await hashPassword(password), role, accountId, request.body.accessDays ?? null],
      );
      if (result.rowCount && deviceIds.length) {
        await client.query(
          'INSERT INTO mechanic_devices (user_id, device_id) SELECT $1, unnest($2::uuid[])',
          [result.rows[0].id, deviceIds],
        );
      }
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
    if (!result.rowCount) throw fail(409, 'username_taken');
    await audit(pool, { actor: request.session.impersonatedBy ?? user.username, action: 'usuario_criado', target: username, ip: request.clientIp });
    return { username, password };
  });

  /** Só veículos pareados e ativos da própria conta; pelo menos um. */
  async function ownDevices(accountId, ids) {
    if (!Array.isArray(ids) || !ids.length) throw fail(400, 'mechanic_devices_required');
    const { rows } = await pool.query(
      `SELECT id FROM devices WHERE id = ANY($1::uuid[]) AND user_id = $2 AND paired_at IS NOT NULL AND revoked_at IS NULL`,
      [ids, accountId],
    );
    if (rows.length !== new Set(ids).size) throw fail(400, 'mechanic_devices_invalid');
    return rows.map((r) => r.id);
  }

  // Fora do alcance responde como inexistente, sem revelar contas de outros.
  async function loadTargetUser(request) {
    const { user } = request.session;
    if (request.params.id === user.id) throw fail(400, 'cannot_change_self');
    const { rows } = await pool.query(
      `SELECT id, username, role, disabled, account_id FROM users WHERE id = $1 AND ($2 OR account_id = $3) AND NOT via_link`,
      [request.params.id, user.role === 'superadmin', user.id],
    );
    if (!rows.length) throw fail(404, 'not_found');
    return rows[0];
  }

  app.post('/internal/admin/users/:id/disabled', {
    preValidation: [requireManager, requireRecentAuth],
    schema: {
      params: uuidParam,
      body: { type: 'object', required: ['disabled'], additionalProperties: false, properties: { disabled: { type: 'boolean' } } },
    },
  }, async (request) => {
    const target = await loadTargetUser(request);
    await pool.query('UPDATE users SET disabled = $2 WHERE id = $1', [target.id, request.body.disabled]);
    if (request.body.disabled) await pool.query('DELETE FROM sessions WHERE user_id = $1', [target.id]);
    await audit(pool, { actor: request.session.impersonatedBy ?? request.session.user.username, action: request.body.disabled ? 'usuario_desativado' : 'usuario_ativado', target: target.username, ip: request.clientIp });
    return { ok: true };
  });

  // Mecânico: troca os veículos liberados e o prazo (accessDays null tira o prazo). As sessões abertas
  // passam a valer com a regra nova na próxima requisição.
  app.post('/internal/admin/users/:id/mechanic', {
    preValidation: [requireManager, requireRecentAuth],
    schema: {
      params: uuidParam,
      body: {
        type: 'object', required: ['deviceIds'], additionalProperties: false,
        properties: { deviceIds: MECHANIC_DEVICES, accessDays: { anyOf: [ACCESS_DAYS, { type: 'null' }] } },
      },
    },
  }, async (request) => {
    const target = await loadTargetUser(request);
    if (target.role !== 'mechanic') throw fail(400, 'not_mechanic');
    const deviceIds = await ownDevices(target.account_id, request.body.deviceIds);
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('DELETE FROM mechanic_devices WHERE user_id = $1', [target.id]);
      await client.query('INSERT INTO mechanic_devices (user_id, device_id) SELECT $1, unnest($2::uuid[])', [target.id, deviceIds]);
      if (request.body.accessDays !== undefined) {
        await client.query(
          `UPDATE users SET access_until = CASE WHEN $2::int IS NULL THEN NULL ELSE now() + make_interval(days => $2::int) END WHERE id = $1`,
          [target.id, request.body.accessDays],
        );
      }
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
    await audit(pool, { actor: request.session.impersonatedBy ?? request.session.user.username, action: 'mecanico_alterado', target: target.username, ip: request.clientIp });
    return { ok: true };
  });

  app.post('/internal/admin/users/:id/delete', { preValidation: [requireManager, requireRecentAuth], schema: { params: uuidParam } }, async (request) => {
    const target = await loadTargetUser(request);
    await pool.query('DELETE FROM users WHERE id = $1', [target.id]);
    await audit(pool, { actor: request.session.impersonatedBy ?? request.session.user.username, action: 'usuario_excluido', target: target.username, ip: request.clientIp });
    return { ok: true };
  });
}

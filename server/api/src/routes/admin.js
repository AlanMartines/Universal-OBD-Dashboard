import { audit } from '../db.js';
import { fail } from '../errors.js';
import { pageNumberSchema, pageSizeSchema, paged } from '../pagination.js';
import { uuidParam } from '../schemas.js';
import { generatePassword, hashPassword, isValidUsername, normalizeUsername } from '../security.js';

export default function adminRoutes(app, {
  pool, limit, requireManager, requireSuperadmin, signupOpen,
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
      countSql: 'SELECT count(*)::int AS total FROM users u WHERE $1 OR u.account_id = $2',
      listSql: `SELECT u.id, u.username, u.email, u.role, u.disabled, u.must_change_password, u.created_at,
              a.username AS account,
              (SELECT count(*)::int FROM devices d WHERE d.user_id = u.id AND d.revoked_at IS NULL AND d.paired_at IS NOT NULL) AS devices
         FROM users u LEFT JOIN users a ON a.id = u.account_id
        WHERE $1 OR u.account_id = $2
        ORDER BY u.created_at, u.id`,
      params: [isSuper, user.id],
      page: usersPage,
      pageSize,
    });
    if (!isSuper) return { users: users.rows, usersPagination: users.pagination };
    const auditLog = await paged(pool, {
      countSql: 'SELECT count(*)::int AS total FROM audit_log',
      listSql: 'SELECT at, actor, action, target, ip FROM audit_log ORDER BY at DESC, id DESC',
      page: auditPage,
      pageSize,
    });
    const accounts = await pool.query(`SELECT id, username FROM users WHERE role = 'admin' AND NOT disabled ORDER BY username`);
    return {
      signupOpen: await signupOpen(),
      users: users.rows,
      usersPagination: users.pagination,
      audit: auditLog.rows,
      auditPagination: auditLog.pagination,
      accounts: accounts.rows,
    };
  });

  app.post('/internal/admin/signup', {
    preValidation: requireSuperadmin,
    schema: { body: { type: 'object', required: ['open'], additionalProperties: false, properties: { open: { type: 'boolean' } } } },
  }, async (request) => {
    await pool.query(`UPDATE settings SET value = $1::jsonb WHERE key = 'signup_open'`, [JSON.stringify(request.body.open)]);
    await audit(pool, { actor: request.session.user.username, action: request.body.open ? 'cadastro_aberto' : 'cadastro_fechado', ip: request.clientIp });
    return { ok: true };
  });

  app.post('/internal/admin/users', {
    ...limit(30, '1 hour'),
    preValidation: requireManager,
    schema: {
      body: {
        type: 'object',
        required: ['username', 'role'],
        additionalProperties: false,
        properties: {
          username: { type: 'string', maxLength: 64 },
          role: { enum: ['superadmin', 'admin', 'user'] },
          accountId: { type: 'string', format: 'uuid' },
        },
      },
    },
  }, async (request) => {
    const { user } = request.session;
    const { role } = request.body;
    const username = normalizeUsername(request.body.username);
    if (!isValidUsername(username)) throw fail(400, 'username_invalid');

    let accountId = null;
    if (user.role === 'admin') {
      // Admin só cria Usuário, sempre na própria conta. O vínculo não vem do formulário.
      if (role !== 'user' || request.body.accountId) throw fail(403, 'forbidden');
      accountId = user.id;
    } else if (role === 'user') {
      if (!request.body.accountId) throw fail(400, 'account_required');
      const account = await pool.query(`SELECT 1 FROM users WHERE id = $1 AND role = 'admin' AND NOT disabled`, [request.body.accountId]);
      if (!account.rowCount) throw fail(400, 'account_invalid');
      accountId = request.body.accountId;
    } else if (request.body.accountId) {
      throw fail(400, 'account_invalid');
    }

    const password = generatePassword();
    const result = await pool.query(
      `INSERT INTO users (username, password_hash, role, account_id, must_change_password) VALUES ($1, $2, $3, $4, true)
       ON CONFLICT (username) DO NOTHING RETURNING id`,
      [username, await hashPassword(password), role, accountId],
    );
    if (!result.rowCount) throw fail(409, 'username_taken');
    await audit(pool, { actor: user.username, action: 'usuario_criado', target: username, ip: request.clientIp });
    return { username, password };
  });

  // Fora do alcance responde como inexistente, sem revelar contas de outros.
  async function loadTargetUser(request) {
    const { user } = request.session;
    if (request.params.id === user.id) throw fail(400, 'cannot_change_self');
    const { rows } = await pool.query(
      `SELECT id, username, role, disabled FROM users WHERE id = $1 AND ($2 OR account_id = $3)`,
      [request.params.id, user.role === 'superadmin', user.id],
    );
    if (!rows.length) throw fail(404, 'not_found');
    return rows[0];
  }

  app.post('/internal/admin/users/:id/disabled', {
    preValidation: requireManager,
    schema: {
      params: uuidParam,
      body: { type: 'object', required: ['disabled'], additionalProperties: false, properties: { disabled: { type: 'boolean' } } },
    },
  }, async (request) => {
    const target = await loadTargetUser(request);
    await pool.query('UPDATE users SET disabled = $2 WHERE id = $1', [target.id, request.body.disabled]);
    if (request.body.disabled) await pool.query('DELETE FROM sessions WHERE user_id = $1', [target.id]);
    await audit(pool, { actor: request.session.user.username, action: request.body.disabled ? 'usuario_desativado' : 'usuario_ativado', target: target.username, ip: request.clientIp });
    return { ok: true };
  });

  app.post('/internal/admin/users/:id/delete', { preValidation: requireManager, schema: { params: uuidParam } }, async (request) => {
    const target = await loadTargetUser(request);
    await pool.query('DELETE FROM users WHERE id = $1', [target.id]);
    await audit(pool, { actor: request.session.user.username, action: 'usuario_excluido', target: target.username, ip: request.clientIp });
    return { ok: true };
  });
}

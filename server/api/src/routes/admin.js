import { audit } from '../db.js';
import { fail } from '../errors.js';
import { uuidParam } from '../schemas.js';
import { generatePassword, hashPassword, isValidUsername, normalizeUsername } from '../security.js';

export default function adminRoutes(app, { pool, limit, requireAdmin, signupOpen }) {
  app.get('/internal/admin/overview', { preValidation: requireAdmin }, async () => {
    const users = await pool.query(
      `SELECT u.id, u.username, u.email, u.role, u.disabled, u.must_change_password, u.created_at,
              (SELECT count(*)::int FROM devices d WHERE d.user_id = u.id AND d.revoked_at IS NULL AND d.paired_at IS NOT NULL) AS devices
         FROM users u ORDER BY u.created_at`,
    );
    const auditRows = await pool.query('SELECT at, actor, action, target, ip FROM audit_log ORDER BY at DESC LIMIT 50');
    return { signupOpen: await signupOpen(), users: users.rows, audit: auditRows.rows };
  });

  app.post('/internal/admin/signup', {
    preValidation: requireAdmin,
    schema: { body: { type: 'object', required: ['open'], additionalProperties: false, properties: { open: { type: 'boolean' } } } },
  }, async (request) => {
    await pool.query(`UPDATE settings SET value = $1::jsonb WHERE key = 'signup_open'`, [JSON.stringify(request.body.open)]);
    await audit(pool, { actor: request.session.user.username, action: request.body.open ? 'cadastro_aberto' : 'cadastro_fechado', ip: request.clientIp });
    return { ok: true };
  });

  app.post('/internal/admin/users', {
    ...limit(30, '1 hour'),
    preValidation: requireAdmin,
    schema: {
      body: {
        type: 'object',
        required: ['username', 'role'],
        additionalProperties: false,
        properties: { username: { type: 'string', maxLength: 64 }, role: { enum: ['user', 'admin'] } },
      },
    },
  }, async (request) => {
    const username = normalizeUsername(request.body.username);
    if (!isValidUsername(username)) throw fail(400, 'username_invalid');
    const password = generatePassword();
    const result = await pool.query(
      `INSERT INTO users (username, password_hash, role, must_change_password) VALUES ($1, $2, $3, true)
       ON CONFLICT (username) DO NOTHING RETURNING id`,
      [username, await hashPassword(password), request.body.role],
    );
    if (!result.rowCount) throw fail(409, 'username_taken');
    await audit(pool, { actor: request.session.user.username, action: 'usuario_criado', target: username, ip: request.clientIp });
    return { username, password };
  });

  async function loadTargetUser(request) {
    if (request.params.id === request.session.user.id) throw fail(400, 'cannot_change_self');
    const { rows } = await pool.query('SELECT id, username, role, disabled FROM users WHERE id = $1', [request.params.id]);
    if (!rows.length) throw fail(404, 'not_found');
    return rows[0];
  }

  app.post('/internal/admin/users/:id/disabled', {
    preValidation: requireAdmin,
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

  app.post('/internal/admin/users/:id/delete', { preValidation: requireAdmin, schema: { params: uuidParam } }, async (request) => {
    const target = await loadTargetUser(request);
    await pool.query('DELETE FROM users WHERE id = $1', [target.id]);
    await audit(pool, { actor: request.session.user.username, action: 'usuario_excluido', target: target.username, ip: request.clientIp });
    return { ok: true };
  });
}

import { audit } from '../db.js';
import { fail } from '../errors.js';
import { LOCK_AFTER, LOCK_MAX_MINUTES, passwordField } from '../schemas.js';
import {
  burnPasswordCheck, hashPassword, isValidUsername, normalizeUsername, passwordProblem, randomToken, sha256, verifyPassword,
} from '../security.js';

export default function authRoutes(app, {
  pool, limit, requireSession, requireOwnSession, requireOwnReady, createSession, signupOpen,
}) {
  const credentials = {
    type: 'object',
    required: ['username', 'password'],
    additionalProperties: false,
    properties: { username: { type: 'string', minLength: 1, maxLength: 254 }, password: passwordField },
  };

  app.get('/internal/signup', async () => ({ open: await signupOpen() }));

  app.post('/internal/auth/login', { ...limit(10, '1 minute'), schema: { body: credentials } }, async (request) => {
    const username = normalizeUsername(request.body.username);
    const { password } = request.body;
    const { rows } = await pool.query(
      // Nome de usuário nunca tem @, então não há como confundir com um e-mail.
      `SELECT u.id, u.username, u.password_hash, u.failed_logins, u.locked_until, u.totp_enabled_at,
              u.disabled OR COALESCE(owner.disabled, false) AS disabled
         FROM users u LEFT JOIN users owner ON owner.id = u.account_id
        WHERE u.${username.includes('@') ? 'email' : 'username'} = $1`,
      [username],
    );
    const user = rows[0];
    const locked = user?.locked_until && user.locked_until > new Date();
    // Mesma resposta e custo parecido em todos os casos: não dá para descobrir contas.
    if (!user || user.disabled || locked) {
      await burnPasswordCheck(password);
      await audit(pool, { actor: user?.username ?? '(desconhecido)', action: 'login_recusado', ip: request.clientIp });
      throw fail(401, 'invalid_credentials');
    }
    if (!(await verifyPassword(user.password_hash, password))) {
      const failures = user.failed_logins + 1;
      const minutes = failures >= LOCK_AFTER ? Math.min(2 ** (failures - LOCK_AFTER), LOCK_MAX_MINUTES) : 0;
      await pool.query(
        `UPDATE users SET failed_logins = $2,
                locked_until = CASE WHEN $3::int > 0 THEN now() + make_interval(mins => $3::int) ELSE locked_until END
          WHERE id = $1`,
        [user.id, failures, minutes],
      );
      await audit(pool, { actor: user.username, action: 'login_recusado', ip: request.clientIp });
      throw fail(401, 'invalid_credentials');
    }
    await pool.query('UPDATE users SET failed_logins = 0, locked_until = NULL WHERE id = $1', [user.id]);
    // Senha certa com 2FA ativo ainda não abre sessão: só um desafio curto para o segundo passo.
    if (user.totp_enabled_at) {
      const mfaToken = randomToken();
      await pool.query(
        `INSERT INTO mfa_challenges (token_hash, user_id, expires_at) VALUES ($1, $2, now() + interval '5 minutes')`,
        [sha256(mfaToken), user.id],
      );
      return { mfaRequired: true, mfaToken };
    }
    await audit(pool, { actor: user.username, action: 'login', ip: request.clientIp });
    return { token: await createSession(user.id, { request }) };
  });

  app.post('/internal/auth/register', { ...limit(5, '1 hour'), schema: { body: credentials } }, async (request) => {
    if (!(await signupOpen())) throw fail(403, 'signup_closed');
    const username = normalizeUsername(request.body.username);
    if (!isValidUsername(username)) throw fail(400, 'username_invalid');
    const problem = passwordProblem(request.body.password, username);
    if (problem) throw fail(400, problem);
    const hash = await hashPassword(request.body.password);
    const result = await pool.query(
      `INSERT INTO users (username, password_hash) VALUES ($1, $2) ON CONFLICT (username) DO NOTHING RETURNING id`,
      [username, hash],
    );
    if (!result.rowCount) throw fail(409, 'username_taken');
    await audit(pool, { actor: username, action: 'cadastro', ip: request.clientIp });
    return { token: await createSession(result.rows[0].id, { request }) };
  });

  app.get('/internal/auth/session', { preValidation: requireSession }, async (request) => ({
    user: request.session.user,
    csrf: request.session.csrf,
  }));

  app.post('/internal/auth/logout', { preValidation: requireSession }, async (request) => {
    await pool.query('DELETE FROM sessions WHERE token_hash = $1', [request.session.tokenHash]);
    return { ok: true };
  });

  app.post('/internal/auth/password', {
    ...limit(10, '15 minutes'),
    preValidation: requireOwnSession,
    schema: {
      body: {
        type: 'object',
        required: ['currentPassword', 'newPassword'],
        additionalProperties: false,
        properties: { currentPassword: passwordField, newPassword: passwordField },
      },
    },
  }, async (request) => {
    const { user } = request.session;
    const { rows } = await pool.query('SELECT password_hash FROM users WHERE id = $1', [user.id]);
    if (!(await verifyPassword(rows[0].password_hash, request.body.currentPassword))) throw fail(400, 'current_password_wrong');
    const problem = passwordProblem(request.body.newPassword, user.username);
    if (problem) throw fail(400, problem);
    if (request.body.currentPassword === request.body.newPassword) throw fail(400, 'password_unchanged');
    await pool.query(
      'UPDATE users SET password_hash = $2, must_change_password = false, failed_logins = 0, locked_until = NULL WHERE id = $1',
      [user.id, await hashPassword(request.body.newPassword)],
    );
    // Encerra as outras sessões: quem tinha a senha antiga perde o acesso.
    await pool.query('DELETE FROM sessions WHERE user_id = $1 AND token_hash <> $2', [user.id, request.session.tokenHash]);
    await audit(pool, { actor: user.username, action: 'senha_alterada', target: user.username, ip: request.clientIp });
    return { ok: true };
  });

  app.post('/internal/account/delete', {
    ...limit(5, '15 minutes'),
    preValidation: requireOwnReady,
    schema: {
      body: { type: 'object', required: ['password'], additionalProperties: false, properties: { password: passwordField } },
    },
  }, async (request) => {
    const { user } = request.session;
    // Só o dono apaga a própria conta. Usuário de atendimento é removido pelo Admin dele.
    if (user.role !== 'admin') throw fail(400, 'admin_cannot_self_delete');
    const { rows } = await pool.query('SELECT password_hash FROM users WHERE id = $1', [user.id]);
    if (!(await verifyPassword(rows[0].password_hash, request.body.password))) throw fail(400, 'current_password_wrong');
    await pool.query('DELETE FROM users WHERE id = $1', [user.id]);
    await audit(pool, { actor: user.username, action: 'conta_excluida', target: user.username, ip: request.clientIp });
    return { ok: true };
  });
}

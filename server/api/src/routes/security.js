import { audit } from '../db.js';
import { fail } from '../errors.js';
import { passwordField, uuidParam } from '../schemas.js';
import {
  hashPassword, normalizeEmail, passwordProblem, randomToken, sha256, verifyPassword,
} from '../security.js';
import {
  generateRecoveryCodes, generateSecret, normalizeRecoveryCode, openSecret, otpauthUri, sealSecret, verifyTotp,
} from '../totp.js';

const MFA_ATTEMPTS = 5;
const RESET_HOURS = 1;
const RESET_RESEND_SECONDS = 60;
const MAIL_READY_MINUTES = 15;
const IMPERSONATION_HOURS = 1;

export default function securityRoutes(app, {
  config, pool, limit, requireSession, requireOwnReady, requireSuperadmin, createSession,
}) {
  const perUser = (request) => request.session?.user.id ?? request.clientIp;
  const codeField = { type: 'string', minLength: 6, maxLength: 16 };

  async function checkPassword(userId, password) {
    const { rows } = await pool.query('SELECT password_hash FROM users WHERE id = $1', [userId]);
    if (!(await verifyPassword(rows[0].password_hash, password))) throw fail(400, 'current_password_wrong');
  }

  /** Consome o código do autenticador. O mesmo código não vale duas vezes. */
  async function consumeTotp(userId, sealed, code) {
    const step = verifyTotp(openSecret(sealed, config.totpKey), code);
    if (step === null) return false;
    const { rowCount } = await pool.query(
      'UPDATE users SET totp_last_step = $2 WHERE id = $1 AND (totp_last_step IS NULL OR totp_last_step < $2)',
      [userId, step],
    );
    return rowCount === 1;
  }

  // ---------- Segundo passo do login ----------

  app.post('/internal/auth/mfa', {
    ...limit(10, '1 minute'),
    schema: {
      body: {
        type: 'object',
        required: ['mfaToken', 'code'],
        additionalProperties: false,
        properties: { mfaToken: { type: 'string', minLength: 20, maxLength: 128 }, code: codeField },
      },
    },
  }, async (request) => {
    const hash = sha256(request.body.mfaToken);
    const { rows } = await pool.query(
      `SELECT c.attempts, u.id, u.username, u.totp_secret, u.disabled
         FROM mfa_challenges c JOIN users u ON u.id = c.user_id
        WHERE c.token_hash = $1 AND c.expires_at > now()`,
      [hash],
    );
    const challenge = rows[0];
    if (!challenge || challenge.disabled || !challenge.totp_secret) throw fail(401, 'mfa_expired');
    const { code } = request.body;
    let accepted = await consumeTotp(challenge.id, challenge.totp_secret, code);
    if (!accepted) {
      const used = await pool.query(
        'DELETE FROM recovery_codes WHERE code_hash = $1 AND user_id = $2',
        [sha256(normalizeRecoveryCode(code)), challenge.id],
      );
      accepted = used.rowCount === 1;
    }
    if (!accepted) {
      if (challenge.attempts + 1 >= MFA_ATTEMPTS) {
        await pool.query('DELETE FROM mfa_challenges WHERE token_hash = $1', [hash]);
      } else {
        await pool.query('UPDATE mfa_challenges SET attempts = attempts + 1 WHERE token_hash = $1', [hash]);
      }
      await audit(pool, { actor: challenge.username, action: 'codigo_2fa_recusado', ip: request.clientIp });
      throw fail(401, 'mfa_code_invalid');
    }
    await pool.query('DELETE FROM mfa_challenges WHERE user_id = $1', [challenge.id]);
    await audit(pool, { actor: challenge.username, action: 'login', ip: request.clientIp });
    return { token: await createSession(challenge.id, { request }) };
  });

  // ---------- Configurar dois fatores ----------

  app.post('/internal/account/mfa/setup', {
    ...limit(10, '1 hour', perUser),
    preValidation: requireOwnReady,
    schema: { body: { type: 'object', required: ['currentPassword'], additionalProperties: false, properties: { currentPassword: passwordField } } },
  }, async (request) => {
    const { user } = request.session;
    await checkPassword(user.id, request.body.currentPassword);
    const { rows } = await pool.query('SELECT totp_enabled_at FROM users WHERE id = $1', [user.id]);
    if (rows[0].totp_enabled_at) throw fail(400, 'mfa_already_enabled');
    const secret = generateSecret();
    await pool.query('UPDATE users SET totp_pending = $2 WHERE id = $1', [user.id, sealSecret(secret, config.totpKey)]);
    return { ok: true };
  });

  app.get('/internal/account/mfa/pending', { preValidation: requireOwnReady }, async (request) => {
    const { user } = request.session;
    const { rows } = await pool.query('SELECT totp_pending FROM users WHERE id = $1', [user.id]);
    if (!rows[0].totp_pending) throw fail(404, 'not_found');
    const secret = openSecret(rows[0].totp_pending, config.totpKey);
    return { secret, uri: otpauthUri(secret, user.username) };
  });

  app.post('/internal/account/mfa/enable', {
    ...limit(20, '1 hour', perUser),
    preValidation: requireOwnReady,
    schema: { body: { type: 'object', required: ['code'], additionalProperties: false, properties: { code: codeField } } },
  }, async (request) => {
    const { user } = request.session;
    const { rows } = await pool.query('SELECT totp_pending FROM users WHERE id = $1', [user.id]);
    if (!rows[0].totp_pending) throw fail(400, 'mfa_expired');
    const step = verifyTotp(openSecret(rows[0].totp_pending, config.totpKey), request.body.code);
    if (step === null) throw fail(400, 'mfa_code_invalid');
    const codes = generateRecoveryCodes();
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(
        'UPDATE users SET totp_secret = totp_pending, totp_pending = NULL, totp_enabled_at = now(), totp_last_step = $2 WHERE id = $1',
        [user.id, step],
      );
      await client.query('DELETE FROM recovery_codes WHERE user_id = $1', [user.id]);
      for (const code of codes) {
        await client.query('INSERT INTO recovery_codes (code_hash, user_id) VALUES ($1, $2)', [sha256(normalizeRecoveryCode(code)), user.id]);
      }
      await client.query('DELETE FROM sessions WHERE user_id = $1 AND token_hash <> $2', [user.id, request.session.tokenHash]);
      await audit(client, { actor: user.username, action: '2fa_ativado', target: user.username, ip: request.clientIp });
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      throw error;
    } finally {
      client.release();
    }
    return { recoveryCodes: codes };
  });

  app.post('/internal/account/mfa/disable', {
    ...limit(10, '1 hour', perUser),
    preValidation: requireOwnReady,
    schema: {
      body: {
        type: 'object',
        required: ['currentPassword', 'code'],
        additionalProperties: false,
        properties: { currentPassword: passwordField, code: codeField },
      },
    },
  }, async (request) => {
    const { user } = request.session;
    await checkPassword(user.id, request.body.currentPassword);
    const { rows } = await pool.query('SELECT totp_secret FROM users WHERE id = $1', [user.id]);
    if (!rows[0].totp_secret) throw fail(400, 'mfa_expired');
    let accepted = await consumeTotp(user.id, rows[0].totp_secret, request.body.code);
    if (!accepted) {
      const used = await pool.query('DELETE FROM recovery_codes WHERE code_hash = $1 AND user_id = $2', [sha256(normalizeRecoveryCode(request.body.code)), user.id]);
      accepted = used.rowCount === 1;
    }
    if (!accepted) throw fail(400, 'mfa_code_invalid');
    await pool.query(
      'UPDATE users SET totp_secret = NULL, totp_pending = NULL, totp_enabled_at = NULL, totp_last_step = NULL WHERE id = $1',
      [user.id],
    );
    await pool.query('DELETE FROM recovery_codes WHERE user_id = $1', [user.id]);
    await audit(pool, { actor: user.username, action: '2fa_desativado', target: user.username, ip: request.clientIp });
    return { ok: true };
  });

  // ---------- Sessões ativas ----------

  app.get('/internal/account/sessions', { preValidation: requireOwnReady }, async (request) => {
    const { rows } = await pool.query(
      `SELECT id, ip, user_agent, created_at, last_seen_at, impersonator_id IS NOT NULL AS support, token_hash = $2 AS current
         FROM sessions WHERE user_id = $1 AND expires_at > now() ORDER BY last_seen_at DESC LIMIT 100`,
      [request.session.user.id, request.session.tokenHash],
    );
    return { sessions: rows };
  });

  app.post('/internal/account/sessions/:id/revoke', {
    preValidation: requireOwnReady,
    schema: { params: uuidParam },
  }, async (request) => {
    const { user, tokenHash } = request.session;
    const { rowCount } = await pool.query(
      'DELETE FROM sessions WHERE id = $1 AND user_id = $2 AND token_hash <> $3',
      [request.params.id, user.id, tokenHash],
    );
    if (!rowCount) throw fail(404, 'not_found');
    await audit(pool, { actor: user.username, action: 'sessao_encerrada', target: user.username, ip: request.clientIp });
    return { ok: true };
  });

  app.post('/internal/account/sessions/revoke-others', { preValidation: requireOwnReady }, async (request) => {
    const { user, tokenHash } = request.session;
    await pool.query('DELETE FROM sessions WHERE user_id = $1 AND token_hash <> $2', [user.id, tokenHash]);
    await audit(pool, { actor: user.username, action: 'sessoes_encerradas', target: user.username, ip: request.clientIp });
    return { ok: true };
  });

  // ---------- Esqueci a senha ----------

  async function mailReady() {
    const { rows } = await pool.query(`SELECT value FROM settings WHERE key = 'mail_ready'`);
    const at = rows[0]?.value?.at;
    return Boolean(config.appUrl && at && Date.now() - at <= MAIL_READY_MINUTES * 60000);
  }

  // A resposta é sempre a mesma: não revela quais e-mails têm conta.
  app.post('/internal/auth/forgot', {
    ...limit(5, '1 hour'),
    schema: { body: { type: 'object', required: ['email'], additionalProperties: false, properties: { email: { type: 'string', maxLength: 254 } } } },
  }, async (request) => {
    const email = normalizeEmail(request.body.email);
    const { rows } = await pool.query(
      `SELECT u.id, u.username FROM users u LEFT JOIN users owner ON owner.id = u.account_id
        WHERE u.email = $1 AND NOT u.disabled AND NOT COALESCE(owner.disabled, false)`,
      [email],
    );
    const user = rows[0];
    if (!user || !(await mailReady())) return { ok: true };
    const recent = await pool.query(
      'SELECT 1 FROM password_resets WHERE user_id = $1 AND created_at > now() - make_interval(secs => $2)',
      [user.id, RESET_RESEND_SECONDS],
    );
    if (recent.rowCount) return { ok: true };
    const token = randomToken();
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('DELETE FROM password_resets WHERE user_id = $1', [user.id]);
      await client.query(
        'INSERT INTO password_resets (token_hash, user_id, expires_at) VALUES ($1, $2, now() + make_interval(hours => $3))',
        [sha256(token), user.id, RESET_HOURS],
      );
      await client.query(
        'INSERT INTO mail_outbox (recipient, subject, body) VALUES ($1, $2, $3)',
        [email, 'Redefinir senha', [
          `Foi pedida a redefinição de senha da conta "${user.username}" na Telemetria OBD.`,
          '',
          `Para criar uma nova senha, abra este link em até ${RESET_HOURS} hora:`,
          `${config.appUrl}/redefinir-senha?token=${token}`,
          '',
          'Se não foi você, ignore esta mensagem. Sua senha continua a mesma.',
        ].join('\n')],
      );
      await audit(client, { actor: user.username, action: 'redefinicao_pedida', target: user.username, ip: request.clientIp });
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      throw error;
    } finally {
      client.release();
    }
    return { ok: true };
  });

  app.post('/internal/auth/reset', {
    ...limit(20, '1 hour'),
    schema: {
      body: {
        type: 'object',
        required: ['token', 'newPassword'],
        additionalProperties: false,
        properties: { token: { type: 'string', minLength: 20, maxLength: 128 }, newPassword: passwordField },
      },
    },
  }, async (request) => {
    const hash = sha256(request.body.token);
    const found = await pool.query(
      `SELECT u.id, u.username, u.email FROM password_resets r JOIN users u ON u.id = r.user_id
        WHERE r.token_hash = $1 AND r.expires_at > now()`,
      [hash],
    );
    if (!found.rows.length) throw fail(400, 'reset_link_invalid');
    const user = found.rows[0];
    // Senha recusada não gasta o link: a pessoa pode tentar outra.
    const problem = passwordProblem(request.body.newPassword, user.username);
    if (problem) throw fail(400, problem);
    const passwordHash = await hashPassword(request.body.newPassword);
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const { rowCount } = await client.query('DELETE FROM password_resets WHERE token_hash = $1', [hash]);
      if (!rowCount) throw fail(400, 'reset_link_invalid');
      await client.query(
        'UPDATE users SET password_hash = $2, must_change_password = false, failed_logins = 0, locked_until = NULL WHERE id = $1',
        [user.id, passwordHash],
      );
      await client.query('DELETE FROM sessions WHERE user_id = $1', [user.id]);
      await client.query('DELETE FROM mfa_challenges WHERE user_id = $1', [user.id]);
      await client.query(
        'INSERT INTO mail_outbox (recipient, subject, body) VALUES ($1, $2, $3)',
        [user.email, 'Sua senha foi alterada', `A senha da conta "${user.username}" na Telemetria OBD foi alterada.\n\nSe não foi você, fale com o administrador.`],
      );
      await audit(client, { actor: user.username, action: 'senha_redefinida', target: user.username, ip: request.clientIp });
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      throw error;
    } finally {
      client.release();
    }
    return { ok: true };
  });

  // ---------- Personificação ----------

  app.post('/internal/admin/users/:id/impersonate', {
    ...limit(30, '1 hour', perUser),
    preValidation: requireSuperadmin,
    schema: { params: uuidParam },
  }, async (request) => {
    const { user, tokenHash, impersonatedBy } = request.session;
    if (impersonatedBy) throw fail(403, 'forbidden');
    const { rows } = await pool.query(
      `SELECT id, username FROM users WHERE id = $1 AND role <> 'superadmin' AND NOT disabled`,
      [request.params.id],
    );
    if (!rows.length) throw fail(404, 'not_found');
    const token = await createSession(rows[0].id, { request, impersonatorId: user.id, hours: IMPERSONATION_HOURS });
    await pool.query('DELETE FROM sessions WHERE token_hash = $1', [tokenHash]);
    await audit(pool, { actor: user.username, action: 'personificacao_iniciada', target: rows[0].username, ip: request.clientIp });
    return { token };
  });

  app.post('/internal/auth/impersonate/stop', { preValidation: requireSession }, async (request) => {
    const { user, tokenHash, impersonatedBy, impersonatorId } = request.session;
    if (!impersonatedBy) throw fail(400, 'invalid_request');
    await pool.query('DELETE FROM sessions WHERE token_hash = $1', [tokenHash]);
    await audit(pool, { actor: impersonatedBy, action: 'personificacao_encerrada', target: user.username, ip: request.clientIp });
    return { token: await createSession(impersonatorId, { request }) };
  });
}

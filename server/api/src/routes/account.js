import sharp from 'sharp';
import { audit } from '../db.js';
import { fail } from '../errors.js';
import { passwordField } from '../schemas.js';
import { normalizeEmail, isValidEmail, randomToken, sha256, verifyPassword } from '../security.js';

const EMAIL_LINK_HOURS = 1;
const EMAIL_RESEND_SECONDS = 60;
const AVATAR_SIZE = 256;
const AVATAR_MAX_BYTES = 5 * 1024 * 1024;
const MAIL_READY_MINUTES = 15;

/** Regrava a imagem: aceita só formatos reais e elimina metadados, como o GPS de fotos de celular. */
export async function processAvatar(input) {
  try {
    const image = sharp(input, { limitInputPixels: 110_000_000, failOn: 'error' });
    const { format } = await image.metadata();
    if (!['jpeg', 'png', 'webp'].includes(format)) throw new Error('formato');
    return await image.rotate().resize(AVATAR_SIZE, AVATAR_SIZE, { fit: 'cover' }).webp({ quality: 82 }).toBuffer();
  } catch {
    throw fail(400, 'image_invalid');
  }
}

export default function accountRoutes(app, {
  config, pool, limit, requireSession, requireOwnReady,
}) {
  const perUser = (request) => request.session?.user.id ?? request.clientIp;

  app.get('/internal/account', { preValidation: requireSession }, async (request) => {
    const { rows } = await pool.query(
      `SELECT u.username, u.display_name, u.email, u.role, u.disabled, u.avatar_updated_at, u.totp_enabled_at,
              (SELECT count(*)::int FROM recovery_codes r WHERE r.user_id = u.id) AS recovery_left,
              c.new_email AS pending_email
         FROM users u LEFT JOIN email_changes c ON c.user_id = u.id AND c.expires_at > now()
        WHERE u.id = $1`,
      [request.session.user.id],
    );
    const u = rows[0];
    return {
      username: u.username,
      displayName: u.display_name,
      email: u.email,
      pendingEmail: u.pending_email,
      role: u.role,
      mfaEnabled: Boolean(u.totp_enabled_at),
      recoveryLeft: u.recovery_left,
      avatarVersion: u.avatar_updated_at ? u.avatar_updated_at.getTime() : null,
    };
  });

  app.post('/internal/account/profile', {
    ...limit(30, '1 hour', perUser),
    preValidation: requireOwnReady,
    schema: {
      body: {
        type: 'object',
        required: ['displayName'],
        additionalProperties: false,
        properties: { displayName: { type: 'string', maxLength: 80, pattern: '^[^\\u0000-\\u001f\\u007f]*$' } },
      },
    },
  }, async (request) => {
    const name = request.body.displayName.trim() || null;
    await pool.query('UPDATE users SET display_name = $2 WHERE id = $1', [request.session.user.id, name]);
    return { ok: true };
  });

  // ---------- E-mail ----------

  app.post('/internal/account/email', {
    ...limit(5, '1 hour', perUser),
    preValidation: requireOwnReady,
    schema: {
      body: {
        type: 'object',
        required: ['newEmail', 'currentPassword'],
        additionalProperties: false,
        properties: { newEmail: { type: 'string', maxLength: 254 }, currentPassword: passwordField },
      },
    },
  }, async (request) => {
    const { user } = request.session;
    const newEmail = normalizeEmail(request.body.newEmail);
    if (!isValidEmail(newEmail)) throw fail(400, 'email_invalid');
    const { rows } = await pool.query('SELECT password_hash, email FROM users WHERE id = $1', [user.id]);
    if (!(await verifyPassword(rows[0].password_hash, request.body.currentPassword))) throw fail(400, 'current_password_wrong');
    if (rows[0].email === newEmail) throw fail(400, 'email_unchanged');

    const ready = await pool.query(`SELECT value FROM settings WHERE key = 'mail_ready'`);
    const at = ready.rows[0]?.value?.at;
    if (!config.appUrl || !at || Date.now() - at > MAIL_READY_MINUTES * 60000) throw fail(503, 'mail_unavailable');

    const recent = await pool.query(
      'SELECT 1 FROM email_changes WHERE user_id = $1 AND created_at > now() - make_interval(secs => $2)',
      [user.id, EMAIL_RESEND_SECONDS],
    );
    if (recent.rowCount) throw fail(429, 'too_many_requests');

    const taken = await pool.query('SELECT 1 FROM users WHERE email = $1', [newEmail]);
    await pool.query('DELETE FROM email_changes WHERE user_id = $1', [user.id]);
    // Endereço já em uso: a resposta é igual e nada é enviado, para não revelar quem tem conta.
    if (!taken.rowCount) {
      const token = randomToken();
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        await client.query(
          `INSERT INTO email_changes (token_hash, user_id, new_email, expires_at)
           VALUES ($1, $2, $3, now() + make_interval(hours => $4))`,
          [sha256(token), user.id, newEmail, EMAIL_LINK_HOURS],
        );
        await client.query(
          'INSERT INTO mail_outbox (recipient, subject, body) VALUES ($1, $2, $3)',
          [newEmail, 'Confirme seu e-mail', [
            `Foi pedida a inclusão deste e-mail na conta "${user.username}" da Telemetria OBD.`,
            '',
            `Para confirmar, abra este link em até ${EMAIL_LINK_HOURS} hora:`,
            `${config.appUrl}/conta/email/confirmar?token=${token}`,
            '',
            'Se não foi você, ignore esta mensagem. Nada será alterado.',
          ].join('\n')],
        );
        await client.query('COMMIT');
      } catch (error) {
        await client.query('ROLLBACK').catch(() => {});
        throw error;
      } finally {
        client.release();
      }
    }
    await audit(pool, { actor: user.username, action: 'troca_email_pedida', target: user.username, ip: request.clientIp });
    return { ok: true };
  });

  app.post('/internal/account/email/confirm', {
    ...limit(20, '1 hour'),
    schema: {
      body: {
        type: 'object',
        required: ['token'],
        additionalProperties: false,
        properties: { token: { type: 'string', minLength: 20, maxLength: 128 } },
      },
    },
  }, async (request) => {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const { rows } = await client.query(
        'DELETE FROM email_changes WHERE token_hash = $1 AND expires_at > now() RETURNING user_id, new_email',
        [sha256(request.body.token)],
      );
      if (!rows.length) throw fail(400, 'email_link_invalid');
      const { user_id: userId, new_email: newEmail } = rows[0];
      const old = await client.query('SELECT username, email FROM users WHERE id = $1 FOR UPDATE', [userId]);
      const taken = await client.query('SELECT 1 FROM users WHERE email = $1 AND id <> $2', [newEmail, userId]);
      if (taken.rowCount) throw fail(400, 'email_link_invalid');
      await client.query('UPDATE users SET email = $2 WHERE id = $1', [userId, newEmail]);
      // Avisa o endereço antigo: se a troca não foi da pessoa, ela fica sabendo.
      if (old.rows[0].email) {
        await client.query(
          'INSERT INTO mail_outbox (recipient, subject, body) VALUES ($1, $2, $3)',
          [old.rows[0].email, 'Seu e-mail foi alterado', `O e-mail da conta "${old.rows[0].username}" na Telemetria OBD foi alterado.\n\nSe não foi você, troque sua senha e fale com o administrador.`],
        );
      }
      await audit(client, { actor: old.rows[0].username, action: 'email_confirmado', target: old.rows[0].username, ip: request.clientIp });
      await client.query('COMMIT');
      return { ok: true };
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      throw error;
    } finally {
      client.release();
    }
  });

  // ---------- Foto ----------

  app.get('/internal/account/avatar', { preValidation: requireSession }, async (request, reply) => {
    const { rows } = await pool.query('SELECT avatar FROM users WHERE id = $1', [request.session.user.id]);
    if (!rows[0]?.avatar) throw fail(404, 'not_found');
    return reply.type('image/webp').send(rows[0].avatar);
  });

  app.post('/internal/account/avatar', {
    ...limit(20, '1 hour', perUser),
    bodyLimit: 8 * 1024 * 1024,
    preValidation: requireOwnReady,
    schema: {
      body: {
        type: 'object',
        required: ['imageBase64'],
        additionalProperties: false,
        properties: { imageBase64: { type: 'string', minLength: 1, maxLength: Math.ceil(AVATAR_MAX_BYTES * 1.4) } },
      },
    },
  }, async (request) => {
    const input = Buffer.from(request.body.imageBase64, 'base64');
    if (input.length > AVATAR_MAX_BYTES) throw fail(400, 'image_too_large');
    const avatar = await processAvatar(input);
    await pool.query('UPDATE users SET avatar = $2, avatar_updated_at = now() WHERE id = $1', [request.session.user.id, avatar]);
    return { ok: true };
  });

  app.post('/internal/account/avatar/delete', { preValidation: requireOwnReady }, async (request) => {
    await pool.query('UPDATE users SET avatar = NULL, avatar_updated_at = NULL WHERE id = $1', [request.session.user.id]);
    return { ok: true };
  });
}

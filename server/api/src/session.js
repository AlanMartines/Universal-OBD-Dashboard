import { randomToken, sha256 } from './security.js';
import { fail } from './errors.js';

/** Sessões de navegador, papéis e acesso aos dispositivos. */
export function createAccess({ config, pool }) {
  async function loadSession(token) {
    if (typeof token !== 'string' || token.length < 20 || token.length > 128) return null;
    const hash = sha256(token);
    const { rows } = await pool.query(
      `SELECT s.csrf_token, s.last_seen_at, u.id, u.username, u.role, u.must_change_password,
              u.display_name, u.avatar_updated_at
         FROM sessions s JOIN users u ON u.id = s.user_id
        WHERE s.token_hash = $1 AND s.expires_at > now() AND NOT u.disabled
          AND s.last_seen_at > now() - make_interval(hours => $2)`,
      [hash, config.sessionIdleHours],
    );
    if (!rows.length) return null;
    const row = rows[0];
    if (Date.now() - row.last_seen_at.getTime() > 60000) {
      await pool.query('UPDATE sessions SET last_seen_at = now() WHERE token_hash = $1', [hash]);
    }
    return {
      tokenHash: hash,
      csrf: row.csrf_token,
      user: {
        id: row.id,
        username: row.username,
        role: row.role,
        mustChangePassword: row.must_change_password,
        displayName: row.display_name,
        avatarVersion: row.avatar_updated_at ? row.avatar_updated_at.getTime() : null,
      },
    };
  }

  const requireSession = async (request) => {
    const session = await loadSession(request.headers['x-session-token']);
    if (!session) throw fail(401, 'unauthenticated');
    request.session = session;
  };
  // Senha inicial ou resetada: nada funciona até o usuário definir uma nova.
  const requireReady = async (request) => {
    await requireSession(request);
    if (request.session.user.mustChangePassword) throw fail(403, 'password_change_required');
  };
  const requireAdmin = async (request) => {
    await requireReady(request);
    if (request.session.user.role !== 'admin') throw fail(403, 'forbidden');
  };

  async function createSession(userId) {
    const token = randomToken();
    const csrf = randomToken();
    await pool.query(
      `INSERT INTO sessions (token_hash, user_id, csrf_token, expires_at)
       VALUES ($1, $2, $3, now() + make_interval(days => $4))`,
      [sha256(token), userId, csrf, config.sessionMaxDays],
    );
    return token;
  }

  async function signupOpen() {
    const { rows } = await pool.query(`SELECT value FROM settings WHERE key = 'signup_open'`);
    return rows[0]?.value === true;
  }

  // Dono ou admin. Dispositivo de outra conta responde 404, sem revelar que existe.
  async function loadDevice(request) {
    const { user } = request.session;
    const { rows } = await pool.query(
      `SELECT d.id, d.user_id, d.name, d.installation_id, d.app_version, d.created_at, d.paired_at,
              d.last_seen_at, d.revoked_at, u.username AS owner
         FROM devices d JOIN users u ON u.id = d.user_id
        WHERE d.id = $1 AND (d.user_id = $2 OR $3)`,
      [request.params.id, user.id, user.role === 'admin'],
    );
    if (!rows.length) throw fail(404, 'not_found');
    return rows[0];
  }

  const publicDevice = (d) => ({
    id: d.id,
    name: d.name,
    owner: d.owner,
    installationId: d.installation_id,
    appVersion: d.app_version,
    createdAt: d.created_at,
    pairedAt: d.paired_at,
    lastSeenAt: d.last_seen_at,
    revokedAt: d.revoked_at,
  });

  return { requireSession, requireReady, requireAdmin, createSession, signupOpen, loadDevice, publicDevice };
}

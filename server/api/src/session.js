import { randomToken, sha256 } from './security.js';
import { fail } from './errors.js';

/** Minutos que uma confirmação de senha vale para as ações críticas. */
export const REAUTH_MINUTES = 10;

/** Sessões de navegador, papéis e acesso aos dispositivos. */
export function createAccess({ config, pool }) {
  async function loadSession(token) {
    if (typeof token !== 'string' || token.length < 20 || token.length > 128) return null;
    const hash = sha256(token);
    const { rows } = await pool.query(
      `SELECT s.csrf_token, s.last_seen_at, s.reauth_at, u.id, u.username, u.role, u.must_change_password,
              u.display_name, u.avatar_updated_at, u.account_id,
              s.impersonator_id, imp.username AS impersonator,
              u.totp_enabled_at IS NOT NULL AS mfa_enabled,
              -- quem confirma a senha no modo suporte é o Super Admin, com o 2FA dele
              CASE WHEN s.impersonator_id IS NULL THEN u.totp_enabled_at IS NOT NULL
                   ELSE imp.totp_enabled_at IS NOT NULL END AS reauth_needs_code,
              COALESCE((SELECT value FROM settings WHERE key = 'mfa_required_admins') = 'true'::jsonb, false) AS mfa_admins
         FROM sessions s JOIN users u ON u.id = s.user_id
         LEFT JOIN users imp ON imp.id = s.impersonator_id
         LEFT JOIN users owner ON owner.id = u.account_id
        WHERE s.token_hash = $1 AND s.expires_at > now() AND NOT u.disabled AND NOT COALESCE(owner.disabled, false)
          AND s.last_seen_at > now() - make_interval(hours => $2)`,
      [hash, config.sessionIdleHours],
    );
    if (!rows.length) return null;
    const row = rows[0];
    // 2FA obrigatório: sempre para o Super Admin; para o dono de conta (Admin), quando o ajuste estiver ligado.
    const mfaRequired = row.role === 'superadmin' || (row.role === 'admin' && row.mfa_admins);
    if (Date.now() - row.last_seen_at.getTime() > 60000) {
      await pool.query('UPDATE sessions SET last_seen_at = now() WHERE token_hash = $1', [hash]);
    }
    return {
      impersonatedBy: row.impersonator ?? null,
      impersonatorId: row.impersonator_id ?? null,
      tokenHash: hash,
      csrf: row.csrf_token,
      reauthAt: row.reauth_at,
      user: {
        id: row.id,
        username: row.username,
        role: row.role,
        // Conta cujos dados a pessoa enxerga: a própria ou aquela à qual está vinculada.
        tenantId: row.account_id ?? row.id,
        // Na personificação, a troca obrigatória é da pessoa, não do suporte.
        mustChangePassword: row.must_change_password && !row.impersonator_id,
        impersonatedBy: row.impersonator ?? null,
        mfaRequired,
        reauthNeedsCode: row.reauth_needs_code,
        // Na personificação, quem configura o 2FA é a pessoa, não o suporte.
        // Vem depois da troca obrigatória de senha.
        mfaSetupRequired: mfaRequired && !row.mfa_enabled && !row.impersonator_id && !row.must_change_password,
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
  // Senha, e-mail, 2FA e dados pessoais são só da própria pessoa, nunca do suporte personificando.
  const requireOwnSession = async (request) => {
    await requireSession(request);
    if (request.session.impersonatedBy) throw fail(403, 'forbidden');
  };
  // Senha inicial ou resetada: nada funciona até o usuário definir uma nova.
  // Depois, quem tem 2FA obrigatório e ainda não ativou só consegue configurá-lo.
  const requireReady = async (request) => {
    await requireSession(request);
    if (request.session.user.mustChangePassword) throw fail(403, 'password_change_required');
    if (request.session.user.mfaSetupRequired) throw fail(403, 'mfa_setup_required');
  };
  // Rotas de configurar o 2FA: liberadas mesmo enquanto ele é exigido, mas nunca na personificação.
  const requireOwnMfaSetup = async (request) => {
    await requireOwnSession(request);
    if (request.session.user.mustChangePassword) throw fail(403, 'password_change_required');
  };
  const requireOwnReady = async (request) => {
    await requireReady(request);
    if (request.session.impersonatedBy) throw fail(403, 'forbidden');
  };
  const requireSuperadmin = async (request) => {
    await requireReady(request);
    if (request.session.user.role !== 'superadmin') throw fail(403, 'forbidden');
  };
  // Super Admin e Admin. O perfil Usuário só visualiza.
  const requireManager = async (request) => {
    await requireReady(request);
    if (request.session.user.role === 'user') throw fail(403, 'forbidden');
  };
  // Ações críticas: além do papel, a senha precisa ter sido confirmada há pouco (vai depois do guarda do papel).
  const requireRecentAuth = async (request) => {
    const at = request.session?.reauthAt;
    if (!at || Date.now() - at.getTime() > REAUTH_MINUTES * 60000) throw fail(403, 'reauth_required');
  };

  // freshAuth: a senha acabou de ser digitada (login), então as ações críticas já valem; o modo suporte e a
  // volta dele não contam como confirmação.
  async function createSession(userId, { request, impersonatorId = null, hours = null, freshAuth = impersonatorId === null } = {}) {
    const token = randomToken();
    const csrf = randomToken();
    const agent = request?.headers['x-client-ua'];
    await pool.query(
      `INSERT INTO sessions (token_hash, user_id, csrf_token, expires_at, ip, user_agent, impersonator_id, reauth_at)
       VALUES ($1, $2, $3, now() + make_interval(hours => $4), $5, $6, $7, CASE WHEN $8::boolean THEN now() END)`,
      [
        sha256(token), userId, csrf, hours ?? config.sessionMaxDays * 24,
        request?.clientIp ?? null, typeof agent === 'string' ? agent.slice(0, 200) : null, impersonatorId, freshAuth,
      ],
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
              d.last_seen_at, d.revoked_at, d.dash_limits, u.username AS owner
         FROM devices d JOIN users u ON u.id = d.user_id
        WHERE d.id = $1 AND (d.user_id = $2 OR $3)`,
      [request.params.id, user.tenantId, user.role === 'superadmin'],
    );
    if (!rows.length) throw fail(404, 'not_found');
    return rows[0];
  }

  // O percurso revela onde a pessoa mora e circula. Super Admin só vê o de outra conta no modo
  // suporte, em que a sessão é da própria conta e fica na auditoria.
  const locationAllowed = (session, device) => session.user.role !== 'superadmin' || device.user_id === session.user.id;

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
    dashLimits: d.dash_limits ?? null,
  });

  return { requireSession, requireReady, requireOwnSession, requireOwnReady, requireOwnMfaSetup, requireManager, requireSuperadmin, requireRecentAuth, createSession, signupOpen, loadDevice, publicDevice, locationAllowed };
}

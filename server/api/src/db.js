import { readdir, readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { hashPassword, isValidUsername, normalizeUsername, passwordProblem } from './security.js';

const MIGRATIONS_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'migrations');
const BOOTSTRAP_LOCK = 7263001;

export function createPool(databaseUrl) {
  return new pg.Pool({
    connectionString: databaseUrl,
    max: 10,
    statement_timeout: 15000,
    idle_in_transaction_session_timeout: 15000,
    connectionTimeoutMillis: 5000,
  });
}

/** Aplica migrações e cria o admin inicial. A trava evita corrida entre processos. */
export async function bootstrap(pool, config, log = console) {
  const client = await pool.connect();
  try {
    await client.query('SELECT pg_advisory_lock($1)', [BOOTSTRAP_LOCK]);
    await migrate(client);
    await seedSettings(client, config);
    await seedAdmin(client, config, log);
  } finally {
    await client.query('SELECT pg_advisory_unlock($1)', [BOOTSTRAP_LOCK]).catch(() => {});
    client.release();
  }
}

async function migrate(client) {
  await client.query(
    'CREATE TABLE IF NOT EXISTS schema_migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())',
  );
  const files = (await readdir(MIGRATIONS_DIR)).filter((f) => f.endsWith('.sql')).sort();
  for (const name of files) {
    const { rowCount } = await client.query('SELECT 1 FROM schema_migrations WHERE name = $1', [name]);
    if (rowCount) continue;
    const sql = await readFile(join(MIGRATIONS_DIR, name), 'utf8');
    await client.query('BEGIN');
    try {
      await client.query(sql);
      await client.query('INSERT INTO schema_migrations (name) VALUES ($1)', [name]);
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    }
  }
}

async function seedSettings(client, config) {
  await client.query(
    `INSERT INTO settings (key, value) VALUES ('signup_open', $1::jsonb) ON CONFLICT (key) DO NOTHING`,
    [JSON.stringify(config.signupDefaultOpen)],
  );
}

async function seedAdmin(client, config, log) {
  const { rowCount } = await client.query(`SELECT 1 FROM users WHERE role = 'superadmin' LIMIT 1`);
  if (rowCount) {
    if (config.adminPassword) {
      log.warn?.('Já existe administrador: ADMIN_PASSWORD foi ignorada e pode ser apagada do .env');
    }
    return;
  }
  const username = normalizeUsername(config.adminUsername);
  if (!isValidUsername(username)) {
    throw new Error('Primeira subida: defina ADMIN_USERNAME válido (3 a 32 caracteres: a-z, 0-9, ponto, _ ou -)');
  }
  const problem = passwordProblem(config.adminPassword, username);
  if (problem || /troque|change.?me|exemplo|example/i.test(config.adminPassword)) {
    throw new Error('Primeira subida: defina ADMIN_PASSWORD própria e forte, com pelo menos 15 caracteres');
  }
  const hash = await hashPassword(config.adminPassword);
  await client.query(
    `INSERT INTO users (username, password_hash, role, must_change_password) VALUES ($1, $2, 'superadmin', true)`,
    [username, hash],
  );
  await client.query(`INSERT INTO audit_log (actor, action, target) VALUES ('sistema', 'admin_inicial_criado', $1)`, [username]);
  log.info?.(`Administrador inicial criado: ${username}`);
}

export async function audit(db, { actor = null, action, target = null, ip = null }) {
  await db.query('INSERT INTO audit_log (actor, action, target, ip) VALUES ($1, $2, $3, $4)', [actor, action, target, ip]);
}

/** Dias que um abastecimento apagado no app fica no painel, marcado como removido. */
export const FUEL_REMOVED_DAYS = 30;

export async function purgeExpired(pool, retentionDays) {
  await pool.query('DELETE FROM sessions WHERE expires_at < now()');
  await pool.query('DELETE FROM email_changes WHERE expires_at < now()');
  await pool.query('DELETE FROM mfa_challenges WHERE expires_at < now()');
  await pool.query('DELETE FROM password_resets WHERE expires_at < now()');
  await pool.query(`DELETE FROM mail_outbox WHERE created_at < now() - interval '1 day'`);
  await pool.query(`DELETE FROM telemetry_samples WHERE ts < now() - make_interval(days => $1)`, [retentionDays]);
  await pool.query(`DELETE FROM audit_log WHERE at < now() - interval '365 days'`);
  await pool.query(`DELETE FROM fuel_ups WHERE removed_at < now() - interval '${FUEL_REMOVED_DAYS} days'`);
  await pool.query(
    `DELETE FROM devices WHERE paired_at IS NULL AND pairing_expires_at < now() - interval '1 day'`,
  );
}

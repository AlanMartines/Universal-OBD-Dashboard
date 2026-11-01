import { loadConfig } from '../src/config.js';
import { buildApp } from '../src/app.js';
import { bootstrap, createPool } from '../src/db.js';

export const DB_URL = process.env.TEST_DATABASE_URL;
export const KEY = 'chave-interna-de-teste-com-mais-de-32-caracteres';
export const ADMIN = { username: 'raiz', password: 'frase longa do administrador' };

export function testConfig(extra = {}) {
  return loadConfig({
    DATABASE_URL: DB_URL,
    INTERNAL_API_KEY: KEY,
    ADMIN_USERNAME: ADMIN.username,
    ADMIN_PASSWORD: ADMIN.password,
    RATE_LIMIT_FACTOR: '1000',
    ...extra,
  });
}

export async function freshDb() {
  const pool = createPool(DB_URL);
  await pool.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
  return pool;
}

export async function startApi(extra = {}) {
  const pool = await freshDb();
  const config = testConfig(extra);
  await bootstrap(pool, config, {});
  const app = await buildApp({ config, pool, logger: false });
  return { app, pool, config };
}

export const internal = (app, method, url, { body, token, ip } = {}) => app.inject({
  method,
  url,
  headers: {
    'x-internal-key': KEY,
    ...(token ? { 'x-session-token': token } : {}),
    ...(ip ? { 'x-client-ip': ip } : {}),
  },
  ...(body !== undefined ? { payload: body } : {}),
});

export async function login(app, username, password) {
  const res = await internal(app, 'POST', '/internal/auth/login', { body: { username, password } });
  return res.statusCode === 200 ? res.json().token : null;
}

/** Admin pronto para uso, depois da troca obrigatória de senha. */
export async function adminToken(app) {
  const token = await login(app, ADMIN.username, ADMIN.password);
  const res = await internal(app, 'POST', '/internal/auth/password', {
    token,
    body: { currentPassword: ADMIN.password, newPassword: 'outra frase longa do administrador' },
  });
  if (res.statusCode !== 200) throw new Error(`troca de senha: ${res.body}`);
  return token;
}

/** Cria usuário comum pronto e devolve o token de sessão. */
export async function userToken(app, admin, username) {
  const created = await internal(app, 'POST', '/internal/admin/users', { token: admin, body: { username, role: 'user' } });
  const { password } = created.json();
  const token = await login(app, username, password);
  await internal(app, 'POST', '/internal/auth/password', {
    token,
    body: { currentPassword: password, newPassword: USER_PASSWORD },
  });
  return token;
}

export const USER_PASSWORD = 'uma frase nova e bem comprida';

export const INSTALL = '6f1d2c3b-4a59-4e6f-8a7b-0c1d2e3f4a5b';

export async function pairDevice(app, token, installationId = INSTALL) {
  const created = await internal(app, 'POST', '/internal/devices', { token, body: { name: 'Celular de teste' } });
  const { id, pairingCode } = created.json();
  const res = await app.inject({
    method: 'POST',
    url: '/api/v1/devices/register',
    payload: { code: pairingCode, installationId, appVersion: '1.0.0' },
  });
  return { id, pairingCode, deviceToken: res.json().deviceToken, res };
}

export const send = (app, deviceToken, samples) => app.inject({
  method: 'POST',
  url: '/api/v1/telemetry',
  headers: deviceToken ? { authorization: `Bearer ${deviceToken}` } : {},
  payload: { samples },
});

export const sample = (seq, extra = {}) => ({ seq, ts: Date.now(), metrics: { rpm: 900, speed: 40 }, ...extra });

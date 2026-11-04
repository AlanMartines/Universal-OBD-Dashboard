import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { loadConfig } from '../src/config.js';
import { bootstrap } from '../src/db.js';
import sharp from 'sharp';
import { resetPassword } from '../bin/user-reset-password.js';
import { base32Encode, codeForStep, generateRecoveryCodes, stepAt } from '../src/totp.js';
import { setMailReady, sendPending, mailConfig, parseTimeout } from '../src/mailer.js';
import { processAvatar } from '../src/routes/account.js';
import { isValidEmail } from '../src/security.js';
import { passwordProblem, sha256 } from '../src/security.js';
import {
  ADMIN, adminToken, freshDb, internal, login, pairDevice, sample, send, startApi, testConfig, userToken, KEY, USER_PASSWORD,
} from './helpers.js';

describe('configuração e admin inicial', () => {
  test('recusa segredo de exemplo ou curto', () => {
    assert.throws(() => loadConfig({ DATABASE_URL: 'x', INTERNAL_API_KEY: 'curta' }));
    assert.throws(() => loadConfig({ DATABASE_URL: 'x', INTERNAL_API_KEY: 'troque-por-um-segredo-longo-com-muitos-caracteres' }));
  });

  test('não sobe sem senha forte de admin no banco vazio', async () => {
    const pool = await freshDb();
    await assert.rejects(bootstrap(pool, testConfig({ ADMIN_PASSWORD: '' }), {}));
    await assert.rejects(bootstrap(pool, testConfig({ ADMIN_PASSWORD: 'curta' }), {}));
    await assert.rejects(bootstrap(pool, testConfig({ ADMIN_PASSWORD: 'troque-por-uma-frase-longa' }), {}));
    await pool.end();
  });

  test('segunda subida não altera nada, mesmo com outro .env', async () => {
    const pool = await freshDb();
    await bootstrap(pool, testConfig(), {});
    const first = await pool.query('SELECT password_hash FROM users');
    await bootstrap(pool, testConfig({ ADMIN_USERNAME: 'outro', ADMIN_PASSWORD: 'uma outra frase bem comprida' }), {});
    const second = await pool.query('SELECT username, password_hash FROM users');
    assert.equal(second.rowCount, 1);
    assert.equal(second.rows[0].username, ADMIN.username);
    assert.equal(second.rows[0].password_hash, first.rows[0].password_hash);
    assert.match(second.rows[0].password_hash, /^\$argon2id\$/);
    await pool.end();
  });

  test('duas subidas simultâneas criam um só admin', async () => {
    const pool = await freshDb();
    await Promise.all([bootstrap(pool, testConfig(), {}), bootstrap(pool, testConfig(), {})]);
    assert.equal((await pool.query('SELECT 1 FROM users')).rowCount, 1);
    await pool.end();
  });

  test('política de senha', () => {
    assert.equal(passwordProblem('curta'), 'password_too_short');
    assert.equal(passwordProblem('a'.repeat(257)), 'password_too_long');
    assert.equal(passwordProblem('aaaaaaaaaaaaaaaaaaaa'), 'password_common');
    assert.equal(passwordProblem('minha frase com alan dentro', 'alan'), 'password_contains_username');
    assert.equal(passwordProblem('uma frase longa qualquer'), null);
  });
});

describe('API', () => {
  let app; let pool; let admin; let alice; let bob;

  before(async () => {
    ({ app, pool } = await startApi());
    admin = await adminToken(app);
    alice = await userToken(app, admin, 'alice');
    bob = await userToken(app, admin, 'bob');
  });
  after(async () => {
    await app.close();
    await pool.end();
  });

  describe('fronteira interna', () => {
    test('rota interna sem a chave responde como inexistente', async () => {
      const res = await app.inject({ method: 'GET', url: '/internal/signup' });
      assert.equal(res.statusCode, 404);
      const wrong = await app.inject({ method: 'GET', url: '/internal/signup', headers: { 'x-internal-key': `${KEY}x` } });
      assert.equal(wrong.statusCode, 404);
    });

    test('rotas exigem sessão e erros não vazam detalhes', async () => {
      assert.equal((await internal(app, 'GET', '/internal/devices')).statusCode, 401);
      const bad = await internal(app, 'POST', '/internal/auth/login', { body: { username: 'x' } });
      assert.equal(bad.statusCode, 400);
      assert.deepEqual(bad.json(), { error: 'invalid_request' });
    });

    test('resposta não fica em cache', async () => {
      const res = await internal(app, 'GET', '/internal/signup');
      assert.equal(res.headers['cache-control'], 'no-store');
    });
  });

  describe('login', () => {
    test('usuário inexistente e senha errada são indistinguíveis', async () => {
      const a = await internal(app, 'POST', '/internal/auth/login', { body: { username: 'ninguem', password: 'x' } });
      const b = await internal(app, 'POST', '/internal/auth/login', { body: { username: 'bob', password: 'x' } });
      assert.equal(a.statusCode, 401);
      assert.equal(a.statusCode, b.statusCode);
      assert.equal(a.body, b.body);
      await pool.query(`UPDATE users SET failed_logins = 0, locked_until = NULL`);
    });

    test('bloqueia após tentativas erradas, mesmo com a senha certa, e a resposta é igual', async () => {
      const t = await internal(app, 'POST', '/internal/admin/users', { token: admin, body: { username: 'travado', role: 'admin' } });
      const { password } = t.json();
      for (let i = 0; i < 5; i += 1) await login(app, 'travado', 'errada');
      const res = await internal(app, 'POST', '/internal/auth/login', { body: { username: 'travado', password } });
      assert.equal(res.statusCode, 401);
      assert.deepEqual(res.json(), { error: 'invalid_credentials' });
    });

    test('injeção SQL no login não passa e não quebra a tabela', async () => {
      for (const username of ["' OR '1'='1", "admin'--", "x'; DROP TABLE users;--"]) {
        const res = await internal(app, 'POST', '/internal/auth/login', { body: { username, password: "' OR '1'='1" } });
        assert.equal(res.statusCode, 401);
      }
      assert.ok((await pool.query('SELECT count(*) FROM users')).rows[0].count > 0);
    });

    test('senha nova é obrigatória antes de usar o sistema', async () => {
      const c = await internal(app, 'POST', '/internal/admin/users', { token: admin, body: { username: 'novato', role: 'admin' } });
      const token = await login(app, 'novato', c.json().password);
      const res = await internal(app, 'GET', '/internal/devices', { token });
      assert.equal(res.statusCode, 403);
      assert.deepEqual(res.json(), { error: 'password_change_required' });
    });

    test('token e senha não ficam em claro no banco', async () => {
      const token = await login(app, ADMIN.username, 'outra frase longa do administrador');
      const raw = await pool.query('SELECT 1 FROM sessions WHERE token_hash = $1', [sha256(token)]);
      assert.equal(raw.rowCount, 1);
      const dump = JSON.stringify((await pool.query('SELECT * FROM sessions')).rows);
      assert.ok(!dump.includes(token));
    });

    test('trocar a senha encerra as outras sessões', async () => {
      const c = await internal(app, 'POST', '/internal/admin/users', { token: admin, body: { username: 'dupla', role: 'admin' } });
      const a = await login(app, 'dupla', c.json().password);
      const b = await login(app, 'dupla', c.json().password);
      await internal(app, 'POST', '/internal/auth/password', { token: a, body: { currentPassword: c.json().password, newPassword: 'frase nova bem comprida aqui' } });
      assert.equal((await internal(app, 'GET', '/internal/auth/session', { token: b })).statusCode, 401);
      assert.equal((await internal(app, 'GET', '/internal/auth/session', { token: a })).statusCode, 200);
    });

    test('logout invalida a sessão', async () => {
      const token = await login(app, 'bob', USER_PASSWORD);
      await internal(app, 'POST', '/internal/auth/logout', { token });
      assert.equal((await internal(app, 'GET', '/internal/auth/session', { token })).statusCode, 401);
    });
  });

  describe('cadastro', () => {
    const body = { username: 'visitante', password: 'uma frase longa para entrar' };

    test('fechado por padrão', async () => {
      const res = await internal(app, 'POST', '/internal/auth/register', { body });
      assert.deepEqual(res.json(), { error: 'signup_closed' });
    });

    test('aberto pelo admin; usuário comum não consegue abrir', async () => {
      const denied = await internal(app, 'POST', '/internal/admin/signup', { token: alice, body: { open: true } });
      assert.equal(denied.statusCode, 403);
      await internal(app, 'POST', '/internal/admin/signup', { token: admin, body: { open: true } });
      assert.equal((await internal(app, 'POST', '/internal/auth/register', { body })).statusCode, 200);
      assert.equal((await internal(app, 'POST', '/internal/auth/register', { body })).statusCode, 409);
      const weak = await internal(app, 'POST', '/internal/auth/register', { body: { username: 'fraco', password: 'curta' } });
      assert.deepEqual(weak.json(), { error: 'password_too_short' });
      const role = await internal(app, 'POST', '/internal/auth/register', { body: { ...body, username: 'esperto', role: 'admin' } });
      assert.equal(role.statusCode, 400);
      await internal(app, 'POST', '/internal/admin/signup', { token: admin, body: { open: false } });
    });
  });

  describe('dispositivos', () => {
    test('código serve uma só vez e o token não fica em claro', async () => {
      const { pairingCode, deviceToken, res } = await pairDevice(app, alice);
      assert.equal(res.statusCode, 200);
      assert.match(deviceToken, /^obd_dev_/);
      const again = await app.inject({ method: 'POST', url: '/api/v1/devices/register', payload: { code: pairingCode, installationId: '11111111-1111-4111-8111-111111111111' } });
      assert.equal(again.statusCode, 401);
      const dump = JSON.stringify((await pool.query('SELECT * FROM devices')).rows);
      assert.ok(!dump.includes(deviceToken));
    });

    test('código vencido é recusado', async () => {
      const created = await internal(app, 'POST', '/internal/devices', { token: alice, body: { name: 'Vencido' } });
      await pool.query(`UPDATE devices SET pairing_expires_at = now() - interval '1 minute' WHERE id = $1`, [created.json().id]);
      const res = await app.inject({ method: 'POST', url: '/api/v1/devices/register', payload: { code: created.json().pairingCode, installationId: '22222222-2222-4222-8222-222222222222' } });
      assert.equal(res.statusCode, 401);
    });

    test('ID de instalação sozinho não dá acesso e precisa ser UUID', async () => {
      const res = await app.inject({ method: 'POST', url: '/api/v1/devices/register', payload: { code: 'AAAA-BBBB-CCCC', installationId: 'imei-123' } });
      assert.equal(res.statusCode, 400);
    });

    test('reparear a mesma instalação invalida o token anterior', async () => {
      const install = '33333333-3333-4333-8333-333333333333';
      const first = await pairDevice(app, alice, install);
      const second = await pairDevice(app, alice, install);
      assert.equal((await send(app, first.deviceToken, [sample(1)])).statusCode, 401);
      assert.equal((await send(app, second.deviceToken, [sample(1)])).statusCode, 200);
    });

    test('nome com HTML é recusado na entrada', async () => {
      const res = await internal(app, 'POST', '/internal/devices', { token: alice, body: { name: '<script>alert(1)</script>' } });
      assert.equal(res.statusCode, 400);
    });
  });

  describe('telemetria', () => {
    let dev;
    before(async () => { dev = await pairDevice(app, alice, '44444444-4444-4444-8444-444444444444'); });

    test('sem token ou com token inválido é recusada', async () => {
      assert.equal((await send(app, null, [sample(1)])).statusCode, 401);
      assert.equal((await send(app, 'obd_dev_tokeninvalidotokeninvalido', [sample(1)])).statusCode, 401);
    });

    test('resposta só confirma a gravação, sem comandos', async () => {
      const res = await send(app, dev.deviceToken, [sample(1), sample(2)]);
      assert.equal(res.statusCode, 200);
      assert.deepEqual(res.json(), { received: 2, stored: 2, rejected: 0 });
    });

    test('reenvio não duplica', async () => {
      const res = await send(app, dev.deviceToken, [sample(1), sample(3)]);
      assert.deepEqual(res.json(), { received: 2, stored: 1, rejected: 0 });
    });

    test('campo fora do contrato é recusado', async () => {
      for (const bad of [
        sample(9, { vin: '9BD00000000000000' }),
        sample(9, { metrics: { rpm: 'texto' } }),
        sample(9, { metrics: { "x'; DROP TABLE users;--": 1 } }),
        sample(9, { gps: { lat: 91, lon: 0 } }),
        sample(9, { dtcs: ['<img>'] }),
      ]) {
        assert.equal((await send(app, dev.deviceToken, [bad])).statusCode, 400);
      }
    });

    test('horário absurdo é descartado sem travar o resto do pacote', async () => {
      const res = await send(app, dev.deviceToken, [
        sample(10),
        sample(11, { ts: Date.now() + 86400000 }),
        sample(12, { ts: 1000 }),
      ]);
      assert.deepEqual(res.json(), { received: 3, stored: 1, rejected: 2 });
    });

    test('pacote grande demais é recusado', async () => {
      const samples = Array.from({ length: 501 }, (_, i) => sample(i + 100));
      assert.equal((await send(app, dev.deviceToken, samples)).statusCode, 400);
    });

    test('leitura ao vivo: chega a quem assiste, não vai ao banco e não leva comandos', async () => {
      const post = (token, payload) => app.inject({ method: 'POST', url: '/api/v1/live', headers: token ? { authorization: `Bearer ${token}` } : {}, payload });
      assert.equal((await post(null, { ts: Date.now(), metrics: { rpm: 1 } })).statusCode, 401);
      const before2 = (await pool.query('SELECT count(*)::int n FROM telemetry_samples WHERE device_id = $1', [dev.id])).rows[0].n;
      const noOne = await post(dev.deviceToken, { ts: Date.now(), metrics: { rpm: 1000 } });
      assert.deepEqual(noOne.json(), { viewers: 0, accepted: true });
      const got = [];
      const listener = (s) => got.push(s);
      app.liveBus.on(dev.id, listener);
      const one = await post(dev.deviceToken, { ts: Date.now(), metrics: { rpm: 1500, speed: 60 } });
      app.liveBus.off(dev.id, listener);
      assert.equal(one.json().viewers, 1);
      assert.equal(got[0].metrics.rpm, 1500);
      assert.equal((await pool.query('SELECT count(*)::int n FROM telemetry_samples WHERE device_id = $1', [dev.id])).rows[0].n, before2);
      assert.equal((await post(dev.deviceToken, { ts: Date.now(), metrics: { rpm: 'x' } })).statusCode, 400);
      assert.equal((await post(dev.deviceToken, { ts: Date.now(), metrics: {}, comando: 'x' })).statusCode, 400);
      assert.equal((await post(dev.deviceToken, { ts: Date.now() - 3600000, metrics: { rpm: 1 } })).json().accepted, false);
      // Alertas do app seguem ao vivo, só com nível e texto conhecidos
      const seen = [];
      const onSample = (s) => seen.push(s);
      app.liveBus.on(dev.id, onSample);
      await post(dev.deviceToken, { ts: Date.now(), metrics: { rpm: 6600 }, alerts: [{ level: 'CRITICAL', message: 'Rotação: 6600 RPM' }] });
      app.liveBus.off(dev.id, onSample);
      assert.deepEqual(seen[0].alerts, [{ level: 'CRITICAL', message: 'Rotação: 6600 RPM' }]);
      assert.equal((await post(dev.deviceToken, { ts: Date.now(), metrics: {}, alerts: [{ level: 'INFO', message: 'x' }] })).statusCode, 400);
      assert.equal((await post(dev.deviceToken, { ts: Date.now(), metrics: {}, alerts: [{ level: 'WARNING', message: '<b>x</b>' }] })).statusCode, 400);
    });

    test('abastecimentos: a lista do app substitui a do servidor e o resumo calcula o consumo', async () => {
      const send = (items) => app.inject({ method: 'POST', url: '/api/v1/fuel-ups', headers: { authorization: `Bearer ${dev.deviceToken}` }, payload: { items } });
      const day = 86400000;
      const t0 = Date.now() - 10 * day;
      const full1 = { id: 1, ts: t0, odometerKm: 1000, liters: 30, totalPrice: 180, pricePerLiter: 6, fuelType: 'gasoline', ethanolPct: null, fullTank: true };
      const part = { id: 2, ts: t0 + day, odometerKm: null, liters: 10, totalPrice: 60, pricePerLiter: 6, fuelType: 'gasoline_premium', ethanolPct: null, fullTank: false };
      const full2 = { id: 3, ts: t0 + 2 * day, odometerKm: 1400, liters: 20, totalPrice: 120, pricePerLiter: 6, fuelType: 'gasoline', ethanolPct: null, fullTank: true };
      assert.equal((await send([full1, part, full2])).statusCode, 200);
      const read = async () => (await internal(app, 'GET', `/internal/devices/${dev.id}/fuel-ups`, { token: alice })).json();
      let data = await read();
      assert.equal(data.items.length, 3);
      assert.equal(data.items[0].id, 3, 'mais recente primeiro');
      // 400 km com 10 + 20 L entre os dois tanques cheios
      assert.equal(data.summary.intervals.length, 1);
      assert.equal(data.summary.intervals[0].kmPerL, 400 / 30);
      assert.equal(data.summary.intervals[0].fuelType, 'gasoline');
      // Edição no celular (parcial vira cheio) e exclusão: a lista nova vale
      assert.equal((await send([full1, { ...part, fullTank: true, odometerKm: 1200 }])).statusCode, 200);
      data = await read();
      assert.deepEqual(data.items.map((f) => f.id), [2, 1]);
      assert.equal(data.summary.intervals[0].kmPerL, 200 / 10);
      assert.equal((await send([{ ...full1, station: 'posto' }])).statusCode, 400, 'campo fora da lista é recusado');
      assert.equal((await send([full1, full1])).statusCode, 400, 'id repetido');
      assert.equal((await app.inject({ method: 'POST', url: '/api/v1/fuel-ups', payload: { items: [] } })).statusCode, 401);
      assert.equal((await send([])).statusCode, 200);
      assert.equal((await read()).items.length, 0);
    });

    test('escalas dos mostradores ficam salvas no dispositivo, sem dados fora da lista ou da faixa', async () => {
      const post = (metrics) => app.inject({ method: 'POST', url: '/api/v1/live', headers: { authorization: `Bearer ${dev.deviceToken}` }, payload: { ts: Date.now(), metrics } });
      const saved = async () => (await pool.query('SELECT dash_limits FROM devices WHERE id = $1', [dev.id])).rows[0].dash_limits;
      await post({ rpm: 1000, 'dash.rpmMax': 7000, 'dash.rpmRedline': 6000, 'dash.speedMax': 180, 'dash.speedCorrectionPct': 3, 'dash.outro': 5, 'dash.tankL': 9999 });
      assert.deepEqual(await saved(), { 'dash.rpmMax': 7000, 'dash.rpmRedline': 6000, 'dash.speedMax': 180, 'dash.speedCorrectionPct': 3 });
      await post({ rpm: 1000 });
      assert.equal((await saved())['dash.speedMax'], 180, 'leitura sem escalas não apaga as salvas');
      await post({ 'dash.rpmMax': 8000 });
      assert.deepEqual(await saved(), { 'dash.rpmMax': 8000 });
    });

    test('GPS e falhas são gravados', async () => {
      await send(app, dev.deviceToken, [sample(20, { dtcs: ['P0301'], gps: { lat: -10.5, lon: -20.5, speedKmh: 12, accuracyM: 5 } })]);
      const res = await internal(app, 'GET', `/internal/devices/${dev.id}`, { token: alice });
      assert.deepEqual(res.json().latest.dtcs, ['P0301']);
      assert.equal(res.json().latest.gps.lat, -10.5);
    });

    test('histórico agrega e não aceita SQL no sinal', async () => {
      const ok = await internal(app, 'GET', `/internal/devices/${dev.id}/history?metric=rpm&hours=1`, { token: alice });
      assert.equal(ok.statusCode, 200);
      assert.ok(ok.json().points.length >= 1);
      const bad = await internal(app, 'GET', `/internal/devices/${dev.id}/history?metric=${encodeURIComponent("rpm' OR 1=1--")}&hours=1`, { token: alice });
      assert.equal(bad.statusCode, 400);
      const hours = await internal(app, 'GET', `/internal/devices/${dev.id}/history?metric=rpm&hours=99999`, { token: alice });
      const short = await internal(app, 'GET', `/internal/devices/${dev.id}/history?metric=rpm&minutes=5`, { token: alice });
      assert.equal(short.json().bucketSeconds, 1);
      assert.ok(short.json().points.length >= 1);
      assert.equal((await internal(app, 'GET', `/internal/devices/${dev.id}/history?metric=rpm&minutes=7`, { token: alice })).statusCode, 400);
      assert.equal((await internal(app, 'GET', `/internal/devices/${dev.id}/history?metric=rpm`, { token: alice })).statusCode, 400);
      assert.equal(hours.statusCode, 400);
    });
  });

  describe('isolamento entre contas', () => {
    test('uma conta não vê nem altera dispositivo de outra', async () => {
      const dev = await pairDevice(app, alice, '55555555-5555-4555-8555-555555555555');
      for (const [method, url] of [
        ['GET', `/internal/devices/${dev.id}`],
        ['GET', `/internal/devices/${dev.id}/history?metric=rpm&hours=1`],
        ['GET', `/internal/devices/${dev.id}/live`],
        ['POST', `/internal/devices/${dev.id}/revoke`],
        ['POST', `/internal/devices/${dev.id}/delete`],
      ]) {
        const token = await login(app, 'bob', USER_PASSWORD);
        assert.equal((await internal(app, method, url, { token })).statusCode, 404, url);
      }
      const token = await login(app, 'bob', USER_PASSWORD);
      const list = await internal(app, 'GET', '/internal/devices', { token });
      assert.ok(!list.body.includes(dev.id));
      assert.equal((await send(app, dev.deviceToken, [sample(1)])).statusCode, 200);
    });

    test('super admin vê todos; admin só a própria conta', async () => {
      const dev = await pairDevice(app, alice, '66666666-6666-4666-8666-666666666666');
      assert.equal((await internal(app, 'GET', `/internal/devices/${dev.id}`, { token: admin })).statusCode, 200);
      const own = await internal(app, 'GET', '/internal/admin/overview', { token: alice });
      assert.equal(own.statusCode, 200);
      assert.equal(own.json().audit, undefined);
      assert.ok(own.json().users.every((u) => u.account === 'alice'));
    });

    test('revogar corta o envio na hora', async () => {
      const dev = await pairDevice(app, alice, '77777777-7777-4777-8777-777777777777');
      await internal(app, 'POST', `/internal/devices/${dev.id}/revoke`, { token: alice });
      assert.equal((await send(app, dev.deviceToken, [sample(1)])).statusCode, 401);
    });

    test('desativar usuário corta sessões e aparelhos', async () => {
      const tok = await userToken(app, admin, 'carlos');
      const dev = await pairDevice(app, tok, '88888888-8888-4888-8888-888888888888');
      const { rows } = await pool.query(`SELECT id FROM users WHERE username = 'carlos'`);
      await internal(app, 'POST', `/internal/admin/users/${rows[0].id}/disabled`, { token: admin, body: { disabled: true } });
      assert.equal((await internal(app, 'GET', '/internal/devices', { token: tok })).statusCode, 401);
      assert.equal((await send(app, dev.deviceToken, [sample(1)])).statusCode, 401);
    });

    test('excluir a conta apaga aparelhos e telemetria', async () => {
      const tok = await userToken(app, admin, 'dora');
      const dev = await pairDevice(app, tok, '99999999-9999-4999-8999-999999999999');
      await send(app, dev.deviceToken, [sample(1)]);
      const wrong = await internal(app, 'POST', '/internal/account/delete', { token: tok, body: { password: 'errada' } });
      assert.equal(wrong.statusCode, 400);
      await internal(app, 'POST', '/internal/account/delete', { token: tok, body: { password: USER_PASSWORD } });
      assert.equal((await pool.query('SELECT 1 FROM telemetry_samples WHERE device_id = $1', [dev.id])).rowCount, 0);
    });

    test('admin não altera a própria conta pelo painel', async () => {
      const { rows } = await pool.query(`SELECT id FROM users WHERE username = $1`, [ADMIN.username]);
      const res = await internal(app, 'POST', `/internal/admin/users/${rows[0].id}/delete`, { token: admin });
      assert.equal(res.statusCode, 400);
    });
  });

  describe('perfis', () => {
    let dono; let outroDono; let dev; let atendente; let donoId; let atendenteId;
    const create = (token, body) => internal(app, 'POST', '/internal/admin/users', { token, body });
    async function makeAttendant(creator, username, extra = {}) {
      const res = await create(creator, { username, role: 'user', ...extra });
      assert.equal(res.statusCode, 200, res.body);
      const token = await login(app, username, res.json().password);
      await internal(app, 'POST', '/internal/auth/password', { token, body: { currentPassword: res.json().password, newPassword: USER_PASSWORD } });
      return token;
    }

    before(async () => {
      dono = await userToken(app, admin, 'dono');
      outroDono = await userToken(app, admin, 'outrodono');
      dev = await pairDevice(app, dono, 'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa');
      donoId = (await pool.query(`SELECT id FROM users WHERE username = 'dono'`)).rows[0].id;
      atendente = await makeAttendant(dono, 'atendente');
      atendenteId = (await pool.query(`SELECT id FROM users WHERE username = 'atendente'`)).rows[0].id;
    });

    test('super admin precisa informar a conta ao criar Usuário', async () => {
      assert.deepEqual((await create(admin, { username: 'semconta', role: 'user' })).json(), { error: 'account_required' });
      const superId = (await pool.query(`SELECT id FROM users WHERE role = 'superadmin'`)).rows[0].id;
      assert.deepEqual((await create(admin, { username: 'contaruim', role: 'user', accountId: superId })).json(), { error: 'account_invalid' });
      assert.deepEqual((await create(admin, { username: 'admincomconta', role: 'admin', accountId: donoId })).json(), { error: 'account_invalid' });
      await makeAttendant(admin, 'vinculado', { accountId: donoId });
      const { rows } = await pool.query(`SELECT account_id FROM users WHERE username = 'vinculado'`);
      assert.equal(rows[0].account_id, donoId);
    });

    test('admin só cria Usuário na própria conta', async () => {
      assert.equal((await create(dono, { username: 'novoadmin', role: 'admin' })).statusCode, 403);
      assert.equal((await create(dono, { username: 'novosuper', role: 'superadmin' })).statusCode, 403);
      const outroId = (await pool.query(`SELECT id FROM users WHERE username = 'outrodono'`)).rows[0].id;
      assert.equal((await create(dono, { username: 'infiltrado', role: 'user', accountId: outroId })).statusCode, 403);
    });

    test('Usuário visualiza a conta, mas não altera nada', async () => {
      assert.equal((await internal(app, 'GET', `/internal/devices/${dev.id}`, { token: atendente })).statusCode, 200);
      assert.equal((await internal(app, 'GET', `/internal/devices/${dev.id}/history?metric=rpm&hours=1`, { token: atendente })).statusCode, 200);
      assert.ok((await internal(app, 'GET', '/internal/devices', { token: atendente })).body.includes(dev.id));
      for (const [url, body] of [
        ['/internal/devices', { name: 'Novo' }],
        [`/internal/devices/${dev.id}/revoke`, undefined],
        [`/internal/devices/${dev.id}/delete`, undefined],
        ['/internal/admin/users', { username: 'sub', role: 'user' }],
        ['/internal/admin/signup', { open: true }],
        [`/internal/admin/users/${donoId}/delete`, undefined],
      ]) {
        assert.equal((await internal(app, 'POST', url, { token: atendente, body })).statusCode, 403, url);
      }
      assert.equal((await internal(app, 'GET', '/internal/admin/overview', { token: atendente })).statusCode, 403);
      assert.equal((await internal(app, 'POST', '/internal/account/delete', { token: atendente, body: { password: USER_PASSWORD } })).statusCode, 400);
    });

    test('Usuário e Admin não enxergam outras contas', async () => {
      const outroDev = await pairDevice(app, outroDono, 'bbbbbbbb-1111-4111-8111-bbbbbbbbbbbb');
      assert.equal((await internal(app, 'GET', `/internal/devices/${outroDev.id}`, { token: atendente })).statusCode, 404);
      assert.equal((await internal(app, 'POST', `/internal/admin/users/${atendenteId}/delete`, { token: outroDono })).statusCode, 404);
      assert.equal((await internal(app, 'POST', `/internal/admin/users/${donoId}/disabled`, { token: outroDono, body: { disabled: true } })).statusCode, 404);
      assert.equal((await internal(app, 'POST', '/internal/admin/signup', { token: dono, body: { open: true } })).statusCode, 403);
    });

    test('desativar o dono corta os usuários vinculados; excluir apaga junto', async () => {
      const tempDono = await userToken(app, admin, 'tempdono');
      const tempAt = await makeAttendant(tempDono, 'tempatendente');
      const id = (await pool.query(`SELECT id FROM users WHERE username = 'tempdono'`)).rows[0].id;
      await internal(app, 'POST', `/internal/admin/users/${id}/disabled`, { token: admin, body: { disabled: true } });
      assert.equal((await internal(app, 'GET', '/internal/devices', { token: tempAt })).statusCode, 401);
      assert.equal(await login(app, 'tempatendente', USER_PASSWORD), null);
      await internal(app, 'POST', `/internal/admin/users/${id}/delete`, { token: admin });
      assert.equal((await pool.query(`SELECT 1 FROM users WHERE username = 'tempatendente'`)).rowCount, 0);
    });

    test('cadastro público cria dono de conta, nunca super admin', async () => {
      await internal(app, 'POST', '/internal/admin/signup', { token: admin, body: { open: true } });
      await internal(app, 'POST', '/internal/auth/register', { body: { username: 'publico', password: 'uma frase longa para entrar' } });
      await internal(app, 'POST', '/internal/admin/signup', { token: admin, body: { open: false } });
      const { rows } = await pool.query(`SELECT role, account_id FROM users WHERE username = 'publico'`);
      assert.deepEqual(rows[0], { role: 'admin', account_id: null });
    });
  });

  describe('dois fatores', () => {
    let tok;
    const NAME = 'doisfatores';
    let secret; let recovery;
    const now = (delta = 0) => codeForStep(secret, stepAt(Date.now()) + delta);
    const log = (username, password = USER_PASSWORD) => internal(app, 'POST', '/internal/auth/login', { body: { username, password } });
    const mfa = (mfaToken, code) => internal(app, 'POST', '/internal/auth/mfa', { body: { mfaToken, code } });

    before(async () => { tok = await userToken(app, admin, NAME); });

    test('código segue a RFC 6238', () => {
      const s = base32Encode(Buffer.from('12345678901234567890'));
      assert.equal(s, 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ');
      assert.equal(codeForStep(s, Math.floor(59 / 30)), '287082');
      assert.equal(codeForStep(s, Math.floor(1111111109 / 30)), '081804');
      assert.equal(generateRecoveryCodes().length, 10);
    });

    test('ativar exige senha e um código válido; segredo fica cifrado', async () => {
      assert.equal((await internal(app, 'POST', '/internal/account/mfa/setup', { token: tok, body: { currentPassword: 'errada' } })).statusCode, 400);
      assert.equal((await internal(app, 'POST', '/internal/account/mfa/setup', { token: tok, body: { currentPassword: USER_PASSWORD } })).statusCode, 200);
      ({ secret } = (await internal(app, 'GET', '/internal/account/mfa/pending', { token: tok })).json());
      const stored = (await pool.query('SELECT totp_pending FROM users WHERE username = $1', [NAME])).rows[0].totp_pending;
      assert.ok(!stored.includes(secret));
      assert.equal((await log(NAME)).json().mfaRequired, undefined);
      assert.equal((await internal(app, 'POST', '/internal/account/mfa/enable', { token: tok, body: { code: '000000' } })).statusCode, 400);
      const on = await internal(app, 'POST', '/internal/account/mfa/enable', { token: tok, body: { code: now() } });
      assert.equal(on.statusCode, 200);
      recovery = on.json().recoveryCodes;
      assert.equal(recovery.length, 10);
      assert.ok(!JSON.stringify((await pool.query('SELECT * FROM recovery_codes')).rows).includes(recovery[0]));
    });

    test('senha sozinha não abre sessão; código repetido não vale', async () => {
      const first = await log(NAME);
      assert.equal(first.json().mfaRequired, true);
      assert.equal(first.json().token, undefined);
      assert.equal((await internal(app, 'GET', '/internal/auth/session', { token: first.json().mfaToken })).statusCode, 401);
      const used = now();
      const again = await mfa(first.json().mfaToken, used);
      assert.deepEqual(again.json(), { error: 'mfa_code_invalid' });
      const ok = await mfa(first.json().mfaToken, now(1));
      assert.ok(ok.json().token);
      assert.equal((await mfa(first.json().mfaToken, now(1))).statusCode, 401);
    });

    test('tentativas erradas derrubam o desafio', async () => {
      const { mfaToken } = (await log(NAME)).json();
      for (let i = 0; i < 5; i += 1) assert.deepEqual((await mfa(mfaToken, '111111')).json(), { error: 'mfa_code_invalid' });
      assert.deepEqual((await mfa(mfaToken, '111111')).json(), { error: 'mfa_expired' });
    });

    test('código de recuperação entra uma vez só', async () => {
      const a1 = (await log(NAME)).json().mfaToken;
      assert.ok((await mfa(a1, recovery[0].toLowerCase())).json().token);
      const a2 = (await log(NAME)).json().mfaToken;
      assert.equal((await mfa(a2, recovery[0])).statusCode, 401);
      const acc = await internal(app, 'GET', '/internal/account', { token: tok });
      assert.equal(acc.statusCode, 200);
      assert.equal(acc.json().recoveryLeft, 9);
    });

    test('desafio vencido não vale', async () => {
      const { mfaToken } = (await log(NAME)).json();
      await pool.query(`UPDATE mfa_challenges SET expires_at = now() - interval '1 minute'`);
      assert.deepEqual((await mfa(mfaToken, recovery[1])).json(), { error: 'mfa_expired' });
    });

    test('comando do servidor desativa em caso de perda', async () => {
      const t2 = await userToken(app, admin, 'perdeu2fa');
      await internal(app, 'POST', '/internal/account/mfa/setup', { token: t2, body: { currentPassword: USER_PASSWORD } });
      const p = (await internal(app, 'GET', '/internal/account/mfa/pending', { token: t2 })).json();
      await internal(app, 'POST', '/internal/account/mfa/enable', { token: t2, body: { code: codeForStep(p.secret, stepAt(Date.now())) } });
      await resetPassword(pool, 'perdeu2fa', 'senha nova pelo terminal', { disableMfa: true });
      const res = await log('perdeu2fa', 'senha nova pelo terminal');
      assert.ok(res.json().token);
      assert.equal((await pool.query(`SELECT 1 FROM recovery_codes r JOIN users u ON u.id = r.user_id WHERE u.username = 'perdeu2fa'`)).rowCount, 0);
    });
  });

  describe('sessões ativas', () => {
    test('lista as próprias e encerra sem atingir outras contas', async () => {
      const t1 = await userToken(app, admin, 'sessoes1');
      const t2 = await login(app, 'sessoes1', USER_PASSWORD);
      const list = (await internal(app, 'GET', '/internal/account/sessions', { token: t1 })).json().sessions;
      assert.equal(list.length, 2);
      assert.equal(list.filter((x) => x.current).length, 1);
      assert.ok(!JSON.stringify(list).includes('token_hash'));
      const other = list.find((x) => !x.current);
      const intruso = await userToken(app, admin, 'sessoes2');
      assert.equal((await internal(app, 'POST', `/internal/account/sessions/${other.id}/revoke`, { token: intruso })).statusCode, 404);
      const me = list.find((x) => x.current);
      assert.equal((await internal(app, 'POST', `/internal/account/sessions/${me.id}/revoke`, { token: t1 })).statusCode, 404);
      assert.equal((await internal(app, 'POST', `/internal/account/sessions/${other.id}/revoke`, { token: t1 })).statusCode, 200);
      assert.equal((await internal(app, 'GET', '/internal/auth/session', { token: t2 })).statusCode, 401);
      assert.equal((await internal(app, 'GET', '/internal/auth/session', { token: t1 })).statusCode, 200);
    });
  });

  describe('esqueci a senha', () => {
    const lastLink = async (to) => /token=([A-Za-z0-9_-]+)/.exec((await pool.query('SELECT body FROM mail_outbox WHERE recipient = $1 ORDER BY id DESC LIMIT 1', [to])).rows[0]?.body ?? '')?.[1];
    const forgot = (email) => internal(app, 'POST', '/internal/auth/forgot', { body: { email } });
    const reset = (token, newPassword) => internal(app, 'POST', '/internal/auth/reset', { body: { token, newPassword } });
    let tok;

    before(async () => {
      await setMailReady(pool, true);
      tok = await userToken(app, admin, 'esquecida');
      await pool.query(`UPDATE users SET email = 'esquecida@exemplo.test' WHERE username = 'esquecida'`);
    });

    test('e-mail desconhecido responde igual e nada é enviado', async () => {
      const a = await forgot('ninguem-aqui@exemplo.test');
      const b = await forgot('esquecida@exemplo.test');
      assert.equal(a.statusCode, b.statusCode);
      assert.equal(a.body, b.body);
      assert.equal((await pool.query(`SELECT 1 FROM mail_outbox WHERE recipient = 'ninguem-aqui@exemplo.test'`)).rowCount, 0);
    });

    test('senha fraca não gasta o link; troca encerra sessões; link vale uma vez', async () => {
      const token = await lastLink('esquecida@exemplo.test');
      assert.ok(!JSON.stringify((await pool.query('SELECT * FROM password_resets')).rows).includes(token));
      assert.deepEqual((await reset(token, 'curta')).json(), { error: 'password_too_short' });
      assert.equal((await reset(token, 'uma nova frase bem comprida aqui')).statusCode, 200);
      assert.equal((await reset(token, 'outra nova frase bem comprida')).statusCode, 400);
      assert.equal((await internal(app, 'GET', '/internal/auth/session', { token: tok })).statusCode, 401);
      assert.ok(await login(app, 'esquecida', 'uma nova frase bem comprida aqui'));
      assert.equal(await login(app, 'esquecida', USER_PASSWORD), null);
    });

    test('link vencido e pedido repetido são barrados', async () => {
      await pool.query('DELETE FROM password_resets');
      await forgot('esquecida@exemplo.test');
      const before2 = (await pool.query('SELECT count(*)::int n FROM mail_outbox')).rows[0].n;
      await forgot('esquecida@exemplo.test');
      assert.equal((await pool.query('SELECT count(*)::int n FROM mail_outbox')).rows[0].n, before2);
      const token = await lastLink('esquecida@exemplo.test');
      await pool.query(`UPDATE password_resets SET expires_at = now() - interval '1 minute'`);
      assert.deepEqual((await reset(token, 'uma nova frase bem comprida aqui')).json(), { error: 'reset_link_invalid' });
    });
  });

  describe('personificação', () => {
    let alvo; let alvoId; let superTok;

    before(async () => {
      alvo = await userToken(app, admin, 'alvo');
      alvoId = (await pool.query(`SELECT id FROM users WHERE username = 'alvo'`)).rows[0].id;
      await pairDevice(app, alvo, 'cccccccc-1111-4111-8111-cccccccccccc');
      superTok = await login(app, ADMIN.username, 'outra frase longa do administrador');
    });
    const go = (token, id = alvoId) => internal(app, 'POST', `/internal/admin/users/${id}/impersonate`, { token });

    test('só super admin, e nunca contra outro super admin', async () => {
      assert.equal((await go(alvo)).statusCode, 403);
      const superId = (await pool.query(`SELECT id FROM users WHERE role = 'superadmin'`)).rows[0].id;
      assert.equal((await go(superTok, superId)).statusCode, 404);
    });

    test('vê a conta, não toca em dados pessoais, fica na auditoria e volta', async () => {
      const { token } = (await go(superTok)).json();
      assert.equal((await internal(app, 'GET', '/internal/auth/session', { token: superTok })).statusCode, 401);
      const s = (await internal(app, 'GET', '/internal/auth/session', { token })).json();
      assert.equal(s.user.username, 'alvo');
      assert.equal(s.user.impersonatedBy, ADMIN.username);
      assert.ok((await internal(app, 'GET', '/internal/devices', { token })).json().devices.length >= 1);
      for (const [url, body] of [
        ['/internal/auth/password', { currentPassword: USER_PASSWORD, newPassword: 'frase nova bem comprida aqui' }],
        ['/internal/account/email', { newEmail: 'x@exemplo.test', currentPassword: USER_PASSWORD }],
        ['/internal/account/mfa/setup', { currentPassword: USER_PASSWORD }],
        ['/internal/account/delete', { password: USER_PASSWORD }],
        ['/internal/account/profile', { displayName: 'x' }],
        ['/internal/account/sessions/revoke-others', undefined],
      ]) {
        assert.equal((await internal(app, 'POST', url, { token, body })).statusCode, 403, url);
      }
      const logged = await pool.query(`SELECT actor, target FROM audit_log WHERE action = 'personificacao_iniciada' ORDER BY id DESC LIMIT 1`);
      assert.deepEqual(logged.rows[0], { actor: ADMIN.username, target: 'alvo' });
      await pool.query(`UPDATE sessions SET expires_at = expires_at`);
      const expires = (await pool.query(`SELECT expires_at < now() + interval '61 minutes' AS short FROM sessions WHERE impersonator_id IS NOT NULL`)).rows[0];
      assert.equal(expires.short, true);
      const back = await internal(app, 'POST', '/internal/auth/impersonate/stop', { token });
      assert.equal((await internal(app, 'GET', '/internal/auth/session', { token: back.json().token })).json().user.role, 'superadmin');
      assert.equal((await internal(app, 'GET', '/internal/auth/session', { token })).statusCode, 401);
    });

    test('quem não está personificando não pode usar o retorno', async () => {
      assert.equal((await internal(app, 'POST', '/internal/auth/impersonate/stop', { token: alvo })).statusCode, 400);
    });
  });

  describe('percurso', () => {
    let dono; let dev;
    const route = (token, q = 'minutes=1440', id = dev.id) => internal(app, 'GET', `/internal/devices/${id}/route?${q}`, { token });

    before(async () => {
      dono = await userToken(app, admin, 'donorota');
      dev = await pairDevice(app, dono, 'dddddddd-1111-4111-8111-dddddddddddd');
      const now = Date.now();
      const samples = [];
      for (let i = 1; i <= 30; i += 1) samples.push(sample(i, { ts: now - (40 - i) * 1000, tripId: i <= 20 ? 1 : 2, metrics: { speed: i }, gps: { lat: -10 - i / 1000, lon: -20 - i / 1000 } }));
      samples.push(sample(31, { ts: now - 5000, tripId: 2, metrics: { speed: 9 } }));
      await send(app, dev.deviceToken, samples);
    });

    test('dono vê o traçado em ordem, por período e por viagem', async () => {
      const all = (await route(dono)).json();
      assert.equal(all.total, 30);
      assert.equal(all.points[0].lat, -10.001);
      assert.equal(all.trips.length, 2);
      assert.equal((await route(dono, 'minutes=1440&tripId=1')).json().total, 20);
    });

    test('super admin não vê localização de outra conta, em nenhum caminho', async () => {
      const superTok = await login(app, ADMIN.username, 'outra frase longa do administrador');
      const res = await route(superTok);
      assert.equal(res.statusCode, 403);
      assert.deepEqual(res.json(), { error: 'location_restricted' });
      await send(app, dev.deviceToken, [sample(40, { gps: { lat: -11, lon: -21 } })]);
      const detail = (await internal(app, 'GET', `/internal/devices/${dev.id}`, { token: superTok })).json();
      assert.equal(detail.locationAllowed, false);
      assert.equal(detail.latest.gps, null);
      assert.equal((await internal(app, 'GET', `/internal/devices/${dev.id}`, { token: dono })).json().latest.gps.lat, -11);
    });

    test('outra conta não acessa e parâmetros estranhos são recusados', async () => {
      const outro = await userToken(app, admin, 'outrorota');
      assert.equal((await route(outro)).statusCode, 404);
      assert.equal((await route(dono, 'minutes=7')).statusCode, 400);
      assert.equal((await route(dono, "minutes=60&tripId=1'%20OR%201=1")).statusCode, 400);
    });

    test('percurso longo é reduzido sem perder o último ponto', async () => {
      const big = await userToken(app, admin, 'grande');
      const d = await pairDevice(app, big, 'eeeeeeee-1111-4111-8111-eeeeeeeeeeee');
      const { rows } = await pool.query(`SELECT 1`);
      assert.equal(rows.length, 1);
      await pool.query(
        `INSERT INTO telemetry_samples (device_id, seq, ts, metrics, latitude, longitude)
         SELECT $1, g, now() - make_interval(secs => 5000 - g), '{}'::jsonb, -10 - g / 100000.0, -20 FROM generate_series(1, 4500) g`,
        [d.id],
      );
      const r = (await route(big, 'minutes=1440', d.id)).json();
      assert.equal(r.total, 4500);
      assert.ok(r.points.length <= 2001);
      assert.ok(Math.abs(r.points.at(-1).lat - (-10 - 4500 / 100000)) < 1e-9);
    });
  });

  describe('paginação', () => {
    test('divide, informa o total, ajusta página além da última e recusa valor estranho', async () => {
      const dono = await userToken(app, admin, 'paginas');
      for (let i = 0; i < 5; i += 1) await internal(app, 'POST', '/internal/devices', { token: dono, body: { name: `Aparelho ${i}` } });
      const first = (await internal(app, 'GET', '/internal/devices?page=1&pageSize=2', { token: dono })).json();
      assert.equal(first.devices.length, 2);
      assert.deepEqual(first.pagination, { page: 1, pageSize: 2, total: 5, totalPages: 3 });
      const last = (await internal(app, 'GET', '/internal/devices?page=999&pageSize=2', { token: dono })).json();
      assert.equal(last.pagination.page, 3);
      assert.equal(last.devices.length, 1);
      const ids = new Set();
      for (const page of [1, 2, 3]) {
        const r = (await internal(app, 'GET', `/internal/devices?page=${page}&pageSize=2`, { token: dono })).json();
        r.devices.forEach((d) => ids.add(d.id));
      }
      assert.equal(ids.size, 5);
      for (const bad of ['0', '-1', 'abc', "1'%20OR%201=1"]) {
        assert.equal((await internal(app, 'GET', `/internal/devices?page=${bad}`, { token: dono })).statusCode, 400, bad);
      }
      const big = (await internal(app, 'GET', '/internal/devices?pageSize=999', { token: dono })).json();
      assert.equal(big.pagination.pageSize, 100);
    });

    test('admin pagina só os usuários da própria conta; auditoria é só do super admin', async () => {
      const dono = await userToken(app, admin, 'paginas2');
      await internal(app, 'POST', '/internal/admin/users', { token: dono, body: { username: 'pag-atendente', role: 'user' } });
      const own = (await internal(app, 'GET', '/internal/admin/overview?pageSize=1', { token: dono })).json();
      assert.equal(own.usersPagination.total, 1);
      assert.equal(own.auditPagination, undefined);
      const all = (await internal(app, 'GET', '/internal/admin/overview?pageSize=2&auditPage=2', { token: admin })).json();
      assert.ok(all.usersPagination.total > 2);
      assert.equal(all.auditPagination.page, 2);
    });
  });

  describe('Meus Dados', () => {
    let tok;
    const PW = USER_PASSWORD;
    const askEmail = (newEmail, currentPassword = PW, token = tok) => internal(app, 'POST', '/internal/account/email', { token, body: { newEmail, currentPassword } });
    const tokenOf = (body) => /token=([A-Za-z0-9_-]+)/.exec(body)[1];
    const lastMail = async (to) => (await pool.query('SELECT body FROM mail_outbox WHERE recipient = $1 ORDER BY id DESC LIMIT 1', [to])).rows[0]?.body;
    const allowResend = () => pool.query(`UPDATE email_changes SET created_at = now() - interval '1 hour'`);

    before(async () => { tok = await userToken(app, admin, 'perfil'); await setMailReady(pool, true); });

    test('nome: salva e aparece na sessão', async () => {
      await internal(app, 'POST', '/internal/account/profile', { token: tok, body: { displayName: '  Maria <b>Silva</b> ' } });
      const s = await internal(app, 'GET', '/internal/auth/session', { token: tok });
      assert.equal(s.json().user.displayName, 'Maria <b>Silva</b>');
    });

    test('e-mail só vale depois do link, e o token não fica em claro', async () => {
      assert.equal((await askEmail('nova@exemplo.test', 'errada')).statusCode, 400);
      assert.equal((await askEmail('invalido')).statusCode, 400);
      assert.equal((await askEmail('nova@exemplo.test')).statusCode, 200);
      const pending = await internal(app, 'GET', '/internal/account', { token: tok });
      assert.equal(pending.json().email, null);
      assert.equal(pending.json().pendingEmail, 'nova@exemplo.test');
      assert.equal(await login(app, 'nova@exemplo.test', PW), null);
      const token = tokenOf(await lastMail('nova@exemplo.test'));
      assert.ok(!JSON.stringify((await pool.query('SELECT * FROM email_changes')).rows).includes(token));
      assert.equal((await internal(app, 'POST', '/internal/account/email/confirm', { body: { token } })).statusCode, 200);
      assert.equal((await internal(app, 'POST', '/internal/account/email/confirm', { body: { token } })).statusCode, 400);
      assert.ok(await login(app, 'NOVA@exemplo.test', PW));
      assert.ok(await login(app, 'perfil', PW));
    });

    test('login por e-mail: erro igual e sem injeção', async () => {
      const a = await internal(app, 'POST', '/internal/auth/login', { body: { username: 'nova@exemplo.test', password: 'errada' } });
      const b = await internal(app, 'POST', '/internal/auth/login', { body: { username: 'ninguem@exemplo.test', password: 'errada' } });
      assert.equal(a.statusCode, b.statusCode);
      assert.equal(a.body, b.body);
      const sql = await internal(app, 'POST', '/internal/auth/login', { body: { username: "x@y' OR '1'='1", password: 'errada' } });
      assert.equal(sql.statusCode, 401);
      await pool.query(`UPDATE users SET failed_logins = 0, locked_until = NULL WHERE username = 'perfil'`);
    });

    test('e-mail em uso: mesma resposta e nada é enviado ao dono', async () => {
      const outro = await userToken(app, admin, 'outro');
      const before2 = (await pool.query(`SELECT count(*)::int AS n FROM mail_outbox WHERE recipient = 'nova@exemplo.test'`)).rows[0].n;
      assert.equal((await askEmail('nova@exemplo.test', PW, outro)).statusCode, 200);
      const after2 = (await pool.query(`SELECT count(*)::int AS n FROM mail_outbox WHERE recipient = 'nova@exemplo.test'`)).rows[0].n;
      assert.equal(after2, before2);
    });

    test('nova troca avisa o endereço antigo; link vencido não vale', async () => {
      assert.equal((await askEmail('terceira@exemplo.test')).statusCode, 200);
      const token = tokenOf(await lastMail('terceira@exemplo.test'));
      await pool.query(`UPDATE email_changes SET expires_at = now() - interval '1 minute' WHERE new_email = 'terceira@exemplo.test'`);
      assert.equal((await internal(app, 'POST', '/internal/account/email/confirm', { body: { token } })).statusCode, 400);
      await pool.query('DELETE FROM email_changes');
      assert.equal((await askEmail('quarta@exemplo.test')).statusCode, 200);
      await internal(app, 'POST', '/internal/account/email/confirm', { body: { token: tokenOf(await lastMail('quarta@exemplo.test')) } });
      assert.match(await lastMail('nova@exemplo.test'), /foi alterado/);
    });

    test('pedidos seguidos são barrados', async () => {
      assert.equal((await askEmail('quinta@exemplo.test')).statusCode, 200);
      assert.equal((await askEmail('sexta@exemplo.test')).statusCode, 429);
      await allowResend();
    });

    test('sem SMTP pronto, responde indisponível e não enfileira', async () => {
      await setMailReady(pool, false);
      const n = (await pool.query('SELECT count(*)::int AS n FROM mail_outbox')).rows[0].n;
      assert.deepEqual((await askEmail('setima@exemplo.test')).json(), { error: 'mail_unavailable' });
      assert.equal((await pool.query('SELECT count(*)::int AS n FROM mail_outbox')).rows[0].n, n);
      await setMailReady(pool, true);
    });

    test('foto: regrava, tira metadados, serve só para o dono e aceita remover', async () => {
      const jpg = await sharp({ create: { width: 900, height: 500, channels: 3, background: '#336699' } })
        .withExif({ IFD3: { GPSLatitude: '10/1 0/1 0/1' } }).jpeg().toBuffer();
      assert.ok((await sharp(jpg).metadata()).exif);
      const up = await internal(app, 'POST', '/internal/account/avatar', { token: tok, body: { imageBase64: jpg.toString('base64') } });
      assert.equal(up.statusCode, 200);
      const got = await internal(app, 'GET', '/internal/account/avatar', { token: tok });
      assert.equal(got.headers['content-type'], 'image/webp');
      const meta = await sharp(got.rawPayload).metadata();
      assert.equal(meta.width, 256);
      assert.equal(meta.height, 256);
      assert.equal(meta.exif, undefined);
      assert.equal((await internal(app, 'GET', '/internal/account/avatar')).statusCode, 401);
      const other = await login(app, 'bob', PW);
      assert.equal((await internal(app, 'GET', '/internal/account/avatar', { token: other })).statusCode, 404);
      await internal(app, 'POST', '/internal/account/avatar/delete', { token: tok });
      assert.equal((await internal(app, 'GET', '/internal/account/avatar', { token: tok })).statusCode, 404);
    });

    test('foto grande de celular (vários MB) é aceita', async () => {
      const jpg = await sharp({ create: { width: 2500, height: 2000, channels: 3, background: "#808080", noise: { type: 'gaussian', mean: 128, sigma: 60 } } }).jpeg({ quality: 90 }).toBuffer();
      assert.ok(jpg.length > 2 * 1024 * 1024 && jpg.length < 5 * 1024 * 1024, `tamanho ${jpg.length}`);
      const up = await internal(app, 'POST', '/internal/account/avatar', { token: tok, body: { imageBase64: jpg.toString('base64') } });
      assert.equal(up.statusCode, 200);
      await internal(app, 'POST', '/internal/account/avatar/delete', { token: tok });
    });

    test('arquivo disfarçado de imagem é recusado', async () => {
      for (const fake of ['<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"/>', '<?php echo 1;', 'GIF89a']) {
        const res = await internal(app, 'POST', '/internal/account/avatar', { token: tok, body: { imageBase64: Buffer.from(fake).toString('base64') } });
        assert.deepEqual(res.json(), { error: 'image_invalid' });
      }
      await assert.rejects(processAvatar(Buffer.from('nada')));
    });

    test('mailer: envia e apaga da fila; falha tenta de novo sem perder', async () => {
      await pool.query('DELETE FROM mail_outbox');
      await pool.query(`INSERT INTO mail_outbox (recipient, subject, body) VALUES ('a@exemplo.test', 's', 'b')`);
      const quiet = { error() {} };
      assert.equal(await sendPending(pool, { sendMail: async () => { const e = new Error('x'); e.code = 'ECONNECTION'; throw e; } }, 'de@exemplo.test', quiet), 0);
      const row = (await pool.query('SELECT attempts, next_try > now() AS later FROM mail_outbox')).rows[0];
      assert.equal(row.attempts, 1);
      assert.equal(row.later, true);
      await pool.query('UPDATE mail_outbox SET next_try = now()');
      const sent = [];
      assert.equal(await sendPending(pool, { sendMail: async (m) => { sent.push(m); } }, 'de@exemplo.test', quiet), 1);
      assert.equal(sent[0].to, 'a@exemplo.test');
      assert.equal((await pool.query('SELECT 1 FROM mail_outbox')).rowCount, 0);
    });

    test('valores de exemplo do SMTP não contam como configurado', () => {
      assert.equal(mailConfig({ SMTP_HOST: 'smtp.gmail.com', SMTP_USER: 'seuemail@gmail.com', SMTP_PASSWORD: 'sua_senha_de_app', SMTP_FROM: 'seuemail@gmail.com' }), null);
      assert.equal(mailConfig({ SMTP_HOST: '', SMTP_USER: '', SMTP_PASSWORD: '', SMTP_FROM: '' }), null);
      const ok = mailConfig({ SMTP_HOST: 'smtp.provedor.test', SMTP_USER: 'u@provedor.test', SMTP_PASSWORD: 'segredo', SMTP_FROM: 'u@provedor.test', SMTP_TIMEOUT: '30s' });
      assert.equal(ok.transport.requireTLS, true);
      assert.equal(ok.transport.connectionTimeout, 30000);
      assert.equal(parseTimeout('500ms'), 500);
      assert.equal(parseTimeout('1m'), 60000);
      assert.equal(parseTimeout('15'), 15000);
      assert.equal(parseTimeout('xyz'), 10000);
    });

    test('validação de e-mail', () => {
      for (const good of ['a@b.co', 'nome.sobre+tag@sub.dominio.com']) assert.equal(isValidEmail(good), true, good);
      for (const bad of ['a', 'a@b', 'a b@c.com', 'a@b.com\r\nBcc:x@y.com', '<a>@b.com', 'a@-b.com']) assert.equal(isValidEmail(bad), false, bad);
    });
  });

  describe('reset de senha pela linha de comando', () => {
    test('troca, encerra sessões, exige nova troca e libera o bloqueio', async () => {
      const tok = await userToken(app, admin, 'esquecido');
      await pool.query(`UPDATE users SET failed_logins = 9, locked_until = now() + interval '1 hour' WHERE username = 'esquecido'`);
      assert.equal(await resetPassword(pool, 'esquecido', 'senha nova pelo terminal'), true);
      assert.equal((await internal(app, 'GET', '/internal/auth/session', { token: tok })).statusCode, 401);
      const novo = await login(app, 'esquecido', 'senha nova pelo terminal');
      assert.ok(novo);
      const s = await internal(app, 'GET', '/internal/auth/session', { token: novo });
      assert.equal(s.json().user.mustChangePassword, true);
      const log = await pool.query(`SELECT * FROM audit_log WHERE action = 'senha_resetada'`);
      assert.ok(!JSON.stringify(log.rows).includes('senha nova pelo terminal'));
    });

    test('usuário inexistente não é criado', async () => {
      assert.equal(await resetPassword(pool, 'fantasma', 'senha nova pelo terminal'), false);
      assert.equal((await pool.query(`SELECT 1 FROM users WHERE username = 'fantasma'`)).rowCount, 0);
    });
  });
});

describe('limites por IP', () => {
  test('login limitado por IP real informado pela web', async () => {
    const { app, pool } = await startApi({ RATE_LIMIT_FACTOR: '1' });
    let last;
    for (let i = 0; i < 11; i += 1) {
      last = await internal(app, 'POST', '/internal/auth/login', { ip: '198.51.100.7', body: { username: 'x', password: 'y' } });
    }
    assert.equal(last.statusCode, 429);
    const other = await internal(app, 'POST', '/internal/auth/login', { ip: '198.51.100.8', body: { username: 'x', password: 'y' } });
    assert.equal(other.statusCode, 401);
    await app.close();
    await pool.end();
  });

  test('sem a chave interna, X-Client-IP é ignorado na rota pública', async () => {
    const { app, pool } = await startApi({ RATE_LIMIT_FACTOR: '1' });
    let last;
    for (let i = 0; i < 11; i += 1) {
      last = await app.inject({ method: 'POST', url: '/api/v1/devices/register', headers: { 'x-client-ip': `203.0.113.${i}` }, payload: { code: 'AAAABBBBCCCC', installationId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' } });
    }
    assert.equal(last.statusCode, 429);
    await app.close();
    await pool.end();
  });
});

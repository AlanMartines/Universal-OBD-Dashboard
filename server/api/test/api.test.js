import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { loadConfig } from '../src/config.js';
import { bootstrap } from '../src/db.js';
import sharp from 'sharp';
import { resetPassword } from '../bin/user-reset-password.js';
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
      const t = await internal(app, 'POST', '/internal/admin/users', { token: admin, body: { username: 'travado', role: 'user' } });
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
      const c = await internal(app, 'POST', '/internal/admin/users', { token: admin, body: { username: 'novato', role: 'user' } });
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
      const c = await internal(app, 'POST', '/internal/admin/users', { token: admin, body: { username: 'dupla', role: 'user' } });
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

    test('admin vê todos; usuário comum não entra na administração', async () => {
      const dev = await pairDevice(app, alice, '66666666-6666-4666-8666-666666666666');
      assert.equal((await internal(app, 'GET', `/internal/devices/${dev.id}`, { token: admin })).statusCode, 200);
      assert.equal((await internal(app, 'GET', '/internal/admin/overview', { token: alice })).statusCode, 403);
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

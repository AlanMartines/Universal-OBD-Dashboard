import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { after, before, describe, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { buildApp, checkFormToken, isSameOriginRequest, issueFormToken } from '../src/app.js';
import { loadConfig } from '../src/config.js';
// A API real, com banco real: o teste atravessa a mesma fronteira da produção.
import { ADMIN, KEY, sample, startApi } from '../../api/test/helpers.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const ORIGIN = 'https://painel.exemplo.test';
const SECRET = 'segredo-de-formulario-de-teste-com-muitos-caracteres';

function collectFiles(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? collectFiles(join(dir, e.name)) : [join(dir, e.name)]));
}

describe('funções puras', () => {
  test('token de formulário: assinatura, finalidade, idade', () => {
    const t = issueFormToken(SECRET, 'login');
    assert.equal(checkFormToken(SECRET, 'login', t), true);
    assert.equal(checkFormToken(SECRET, 'register', t), false);
    assert.equal(checkFormToken(`${SECRET}x`, 'login', t), false);
    assert.equal(checkFormToken(SECRET, 'login', `${t}x`), false);
    assert.equal(checkFormToken(SECRET, 'login', t, 3000), false);
    const old = issueFormToken(SECRET, 'login', Date.now() - 3 * 3600 * 1000);
    assert.equal(checkFormToken(SECRET, 'login', old), false);
    assert.equal(checkFormToken(SECRET, 'login', undefined), false);
  });

  test('origem da requisição', () => {
    assert.equal(isSameOriginRequest({ 'sec-fetch-site': 'same-origin', origin: ORIGIN }, ORIGIN), true);
    assert.equal(isSameOriginRequest({ origin: ORIGIN }, ORIGIN), true);
    assert.equal(isSameOriginRequest({ 'sec-fetch-site': 'cross-site', origin: ORIGIN }, ORIGIN), false);
    assert.equal(isSameOriginRequest({ 'sec-fetch-site': 'same-site' }, ORIGIN), false);
    assert.equal(isSameOriginRequest({ origin: 'https://painel.exemplo.test.mau.example' }, ORIGIN), false);
    assert.equal(isSameOriginRequest({ origin: 'null' }, ORIGIN), false);
    assert.equal(isSameOriginRequest({}, ORIGIN), false);
  });

  test('configuração exige https e segredos próprios', () => {
    const env = { APP_URL: 'http://x.test', INTERNAL_API_KEY: KEY, FORM_SECRET: SECRET };
    assert.throws(() => loadConfig(env));
    assert.throws(() => loadConfig({ ...env, APP_URL: ORIGIN, FORM_SECRET: 'curto' }));
    assert.equal(loadConfig({ ...env, APP_URL: ORIGIN }).cookieSecure, true);
  });
});

describe('arquivos', () => {
  const views = collectFiles(join(HERE, '../views'));
  test('sem saída sem escape além do corpo do layout', () => {
    for (const file of views) {
      const raw = readFileSync(file, 'utf8').replaceAll('{{{body}}}', '');
      assert.ok(!raw.includes('{{{'), file);
    }
  });
  test('sem CDN, script ou estilo embutido', () => {
    for (const file of [...views, ...collectFiles(join(HERE, '../public'))]) {
      const raw = readFileSync(file, 'utf8');
      assert.ok(!/(src|href)="https?:/.test(raw), file);
      assert.ok(!/ style="/.test(raw), file);
      assert.ok(!/ on[a-z]+="/.test(raw), file);
      assert.ok(!/innerHTML|eval\(|document\.write/.test(raw), file);
    }
  });
});

describe('fluxo pelo navegador', () => {
  let apiCtx; let apiUrl; let web;

  const browser = (cookie) => ({ ...(cookie ? { cookie } : {}), origin: ORIGIN, 'sec-fetch-site': 'same-origin' });
  const cookieOf = (res) => res.headers['set-cookie']?.split(';')[0];
  const field = (html, name) => new RegExp(`name="${name}" value="([^"]+)"`).exec(html)?.[1];
  const post = (url, payload, cookie, headers = browser(cookie)) => web.inject({
    method: 'POST', url, payload: new URLSearchParams(payload).toString(), headers: { ...headers, 'content-type': 'application/x-www-form-urlencoded' },
  });

  async function signIn(username, password) {
    const page = await web.inject({ method: 'GET', url: '/login' });
    return post('/login', { username, password, formToken: field(page.body, 'formToken') });
  }
  const csrfOf = async (cookie, url = '/painel') => field((await web.inject({ method: 'GET', url, headers: { cookie } })).body, '_csrf');

  let adminCookie;

  before(async () => {
    apiCtx = await startApi();
    apiUrl = await apiCtx.app.listen({ port: 0, host: '127.0.0.1' });
    web = await buildApp({
      logger: false,
      config: loadConfig({ APP_URL: ORIGIN, INTERNAL_API_KEY: KEY, FORM_SECRET: SECRET, API_URL: apiUrl, RATE_LIMIT_FACTOR: '1000' }),
    });
  });
  after(async () => {
    await web.close();
    await apiCtx.app.close();
    await apiCtx.pool.end();
  });

  test('cabeçalhos de segurança', async () => {
    const res = await web.inject({ method: 'GET', url: '/login' });
    const csp = res.headers['content-security-policy'];
    assert.match(csp, /default-src 'none'/);
    assert.match(csp, /script-src 'self'/);
    assert.ok(!csp.includes('unsafe-inline') && !csp.includes('unsafe-eval'));
    assert.match(csp, /frame-ancestors 'none'/);
    assert.equal(res.headers['x-content-type-options'], 'nosniff');
    assert.equal(res.headers['cache-control'], 'no-store');
    assert.match(res.headers['x-robots-tag'], /noindex/);
    assert.ok(res.headers['strict-transport-security']);
  });

  test('login com honeypot ou sem token de formulário não autentica', async () => {
    const page = await web.inject({ method: 'GET', url: '/login' });
    const creds = { username: ADMIN.username, password: ADMIN.password };
    const bot = await post('/login', { ...creds, formToken: field(page.body, 'formToken'), website: 'http://spam.example' });
    assert.equal(bot.statusCode, 400);
    assert.equal(bot.headers['set-cookie'], undefined);
    assert.equal((await post('/login', creds)).statusCode, 400);
  });

  test('login de outro site é barrado (CSRF de login)', async () => {
    const page = await web.inject({ method: 'GET', url: '/login' });
    const res = await post('/login', { username: ADMIN.username, password: ADMIN.password, formToken: field(page.body, 'formToken') }, null, { origin: 'https://mau.example', 'sec-fetch-site': 'cross-site' });
    assert.equal(res.statusCode, 403);
  });

  test('senha inicial: cookie protegido e troca obrigatória', async () => {
    const res = await signIn(ADMIN.username, ADMIN.password);
    assert.equal(res.statusCode, 303);
    const raw = res.headers['set-cookie'];
    assert.match(raw, /^__Host-obd_session=/);
    assert.match(raw, /HttpOnly/);
    assert.match(raw, /Secure/);
    assert.match(raw, /SameSite=Lax/);
    assert.match(raw, /Path=\//);
    adminCookie = cookieOf(res);
    const panel = await web.inject({ method: 'GET', url: '/painel', headers: { cookie: adminCookie } });
    assert.equal(panel.headers.location, '/conta/senha');
    const csrf = await csrfOf(adminCookie, '/conta/senha');
    const changed = await post('/conta/senha', { _csrf: csrf, currentPassword: ADMIN.password, newPassword: 'nova frase longa do administrador', confirm: 'nova frase longa do administrador' }, adminCookie);
    assert.equal(changed.statusCode, 303);
    assert.equal((await web.inject({ method: 'GET', url: '/painel', headers: { cookie: adminCookie } })).statusCode, 200);
  });

  test('POST sem token CSRF ou de outra origem é recusado', async () => {
    const csrf = await csrfOf(adminCookie);
    assert.equal((await post('/dispositivos', { name: 'Sem token' }, adminCookie)).statusCode, 403);
    assert.equal((await post('/dispositivos', { name: 'Token errado', _csrf: 'x' }, adminCookie)).statusCode, 403);
    const cross = await post('/dispositivos', { name: 'Cruzado', _csrf: csrf }, adminCookie, { cookie: adminCookie, origin: 'https://mau.example', 'sec-fetch-site': 'cross-site' });
    assert.equal(cross.statusCode, 403);
  });

  test('sem sessão vai para o login; sessão inválida limpa o cookie', async () => {
    assert.equal((await web.inject({ method: 'GET', url: '/painel' })).headers.location, '/login');
    const bad = await web.inject({ method: 'GET', url: '/painel', headers: { cookie: '__Host-obd_session=invalida-invalida-invalida' } });
    assert.equal(bad.headers.location, '/login');
  });

  test('rotas internas e outras da API não são publicadas', async () => {
    for (const url of ['/internal/signup', '/api/v1/ingest', '/api/v1/devices', '/api/v1/devices/pair', '/.env']) {
      assert.equal((await web.inject({ method: 'GET', url })).statusCode, 404, url);
    }
    assert.ok([403, 404].includes((await web.inject({ method: 'POST', url: '/internal/auth/login', payload: {} })).statusCode));
  });

  test('arquivos fora da lista permitida não são servidos', async () => {
    assert.equal((await web.inject({ method: 'GET', url: '/vendor/bootstrap/css/bootstrap.min.css' })).statusCode, 200);
    assert.equal((await web.inject({ method: 'GET', url: '/vendor/chartjs/chart.umd.min.js' })).statusCode, 200);
    assert.notEqual((await web.inject({ method: 'GET', url: '/vendor/bootstrap/js/index.js' })).statusCode, 200);
    assert.notEqual((await web.inject({ method: 'GET', url: '/static/../src/config.js' })).statusCode, 200);
    assert.notEqual((await web.inject({ method: 'GET', url: '/static/..%2f..%2fpackage.json' })).statusCode, 200);
  });

  test('fluxo completo: pareia, envia pela rota pública e vê no painel', async () => {
    const csrf = await csrfOf(adminCookie);
    const created = await post('/dispositivos', { name: 'Celular <b>x</b> & cia', _csrf: csrf }, adminCookie);
    // O nome com < > é recusado pela API; a tela responde com erro e não reflete o HTML.
    assert.equal(created.statusCode, 400);
    assert.ok(!created.body.includes('<b>x</b>'));

    const ok = await post('/dispositivos', { name: 'Celular "do" carro & cia', _csrf: csrf }, adminCookie);
    assert.equal(ok.statusCode, 200);
    const code = /font-monospace mb-2">([A-Z0-9-]+)</.exec(ok.body)[1];

    const reg = await web.inject({
      method: 'POST', url: '/api/v1/devices/register',
      payload: { code, installationId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', appVersion: '1.0.0' },
    });
    assert.equal(reg.statusCode, 200);
    const { deviceToken, deviceId } = reg.json();

    const denied = await web.inject({ method: 'POST', url: '/api/v1/telemetry', payload: { samples: [sample(1)] } });
    assert.equal(denied.statusCode, 401);
    const sent = await web.inject({
      method: 'POST', url: '/api/v1/telemetry', headers: { authorization: `Bearer ${deviceToken}` }, payload: { samples: [sample(1)] },
    });
    assert.deepEqual(sent.json(), { received: 1, stored: 1, rejected: 0 });

    const panel = await web.inject({ method: 'GET', url: '/painel', headers: { cookie: adminCookie } });
    assert.ok(panel.body.includes('&quot;do&quot; carro &amp; cia'));
    assert.ok(!panel.body.includes('"do" carro'));

    const page = await web.inject({ method: 'GET', url: `/dispositivos/${deviceId}`, headers: { cookie: adminCookie } });
    assert.equal(page.statusCode, 200);
    // A leitura inicial fica em atributo: dentro de <script>, o escape impediria o JSON.parse.
    assert.match(page.body, /id="latest-data" hidden data-sample="[^"]*&quot;rpm&quot;/);
    const hist = await web.inject({ method: 'GET', url: `/dispositivos/${deviceId}/historico?metric=rpm&hours=1`, headers: { cookie: adminCookie } });
    assert.equal(hist.json().points.length, 1);
  });

  test('corpo inválido na rota do aparelho responde JSON, sem HTML', async () => {
    const res = await web.inject({ method: 'POST', url: '/api/v1/telemetry', headers: { 'content-type': 'application/json' }, payload: '{quebrado' });
    assert.equal(res.statusCode, 400);
    assert.deepEqual(res.json(), { error: 'invalid_request' });
  });

  test('tempo real chega ao navegador pelo SSE', async () => {
    const csrf = await csrfOf(adminCookie);
    const ok = await post('/dispositivos', { name: 'Ao vivo', _csrf: csrf }, adminCookie);
    const code = /font-monospace mb-2">([A-Z0-9-]+)</.exec(ok.body)[1];
    const reg = await web.inject({ method: 'POST', url: '/api/v1/devices/register', payload: { code, installationId: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd' } });
    const { deviceId, deviceToken } = reg.json();

    const webUrl = await web.listen({ port: 0, host: '127.0.0.1' });
    const abort = new AbortController();
    const stream = await fetch(`${webUrl}/dispositivos/${deviceId}/ao-vivo`, { headers: { cookie: adminCookie }, signal: abort.signal });
    assert.equal(stream.status, 200);
    assert.match(stream.headers.get('content-type'), /text\/event-stream/);
    const reader = stream.body.getReader();
    setTimeout(async () => {
      const posted = await fetch(`${webUrl}/api/v1/telemetry`, {
        method: 'POST', headers: { authorization: `Bearer ${deviceToken}`, 'content-type': 'application/json' }, body: JSON.stringify({ samples: [sample(5, { metrics: { rpm: 1234 } })] }),
      });
      assert.equal(posted.status, 200);
    }, 300);
    let received = '';
    while (!received.includes('"rpm":1234')) {
      const { value, done } = await reader.read();
      assert.equal(done, false, `fluxo encerrou sem a amostra: ${received}`);
      received += Buffer.from(value).toString();
    }
    assert.match(received, /event: sample/);
    abort.abort();
  });

  test('não admin não entra na administração', async () => {
    const csrf = await csrfOf(adminCookie);
    const made = await post('/admin/usuarios', { _csrf: csrf, username: 'comum', role: 'user' }, adminCookie);
    const password = /user-select-all[^"]*">([^<]+)</.exec(made.body)[1];
    const login = await signIn('comum', password);
    const cookie = cookieOf(login);
    const c2 = await csrfOf(cookie, '/conta/senha');
    await post('/conta/senha', { _csrf: c2, currentPassword: password, newPassword: 'uma frase longa para esta conta', confirm: 'uma frase longa para esta conta' }, cookie);
    const denied = await web.inject({ method: 'GET', url: '/admin', headers: { cookie } });
    assert.equal(denied.statusCode, 403);
    assert.ok(!denied.body.includes('href="/admin"'));
  });

  test('menu lateral: só com login, item ativo, por papel e com arquivos locais', async () => {
    const anon = await web.inject({ method: 'GET', url: '/login' });
    assert.ok(!anon.body.includes('app-sidebar'));
    const panel = await web.inject({ method: 'GET', url: '/painel', headers: { cookie: adminCookie } });
    assert.match(panel.body, /id="app-sidebar"/);
    assert.match(panel.body, /href="\/painel"[^>]*class="active"/);
    assert.match(panel.body, /name="_csrf" value="[^"]+"/);
    const conta = await web.inject({ method: 'GET', url: '/conta', headers: { cookie: adminCookie } });
    assert.match(conta.body, /href="\/conta"[^>]*class="active"/);
    assert.match(conta.body, /href="\/admin"/);
    for (const url of ['/static/js/shell.js', '/vendor/fontawesome/css/all.min.css', '/vendor/fontawesome/webfonts/fa-solid-900.woff2']) {
      assert.equal((await web.inject({ method: 'GET', url })).statusCode, 200, url);
    }
    assert.notEqual((await web.inject({ method: 'GET', url: '/vendor/fontawesome/package.json' })).statusCode, 200);
  });

  test('cadastro público: fechado, aberto, velocidade de robô', async () => {
    assert.equal((await web.inject({ method: 'GET', url: '/cadastro' })).statusCode, 403);
    const csrf = await csrfOf(adminCookie);
    await post('/admin/cadastro', { _csrf: csrf, open: 'true' }, adminCookie);
    const page = await web.inject({ method: 'GET', url: '/cadastro' });
    assert.equal(page.statusCode, 200);
    const fast = await post('/cadastro', { username: 'rapido', password: 'frase longa de quem tem pressa', confirm: 'frase longa de quem tem pressa', formToken: field(page.body, 'formToken') });
    assert.equal(fast.statusCode, 400);
    const aged = issueFormToken(SECRET, 'register', Date.now() - 5000);
    const human = await post('/cadastro', { username: 'humano', password: 'frase longa de quem preencheu', confirm: 'frase longa de quem preencheu', formToken: aged });
    assert.equal(human.statusCode, 303);
    await post('/admin/cadastro', { _csrf: csrf, open: 'false' }, adminCookie);
  });
});

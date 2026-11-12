import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { after, before, describe, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { buildApp, checkFormToken, isSameOriginRequest, issueFormToken } from '../src/app.js';
import { loadConfig } from '../src/config.js';
import { ago, describeAgent } from '../src/modules/account/user-agent.js';
import { buildMaintenance, buildReport } from '../src/modules/devices/routes.js';
import { buildHealth, healthFindings } from '../src/modules/devices/health.js';
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

describe('relatórios do dispositivo', () => {
  test('km/l por tanque e resumo do mês', () => {
    const d = (iso) => Date.parse(iso);
    const fuel = {
      items: [
        { ts: d('2026-11-20T12:00:00Z'), liters: 40, totalPrice: 260, removedAt: null },
        { ts: d('2026-11-05T12:00:00Z'), liters: 38, totalPrice: 250, removedAt: null },
        { ts: d('2026-10-20T12:00:00Z'), liters: 10, totalPrice: 60, removedAt: d('2026-10-21T00:00:00Z') },
      ],
      summary: { avgKmPerL: 10.25, intervals: [{ from: d('2026-11-05T12:00:00Z'), to: d('2026-11-20T12:00:00Z'), km: 410, liters: 40, kmPerL: 10.25, fuelType: 'gasoline' }] },
    };
    const trips = [{ start: d('2026-11-10T12:00:00Z'), km: 200 }, { start: d('2026-11-12T12:00:00Z'), km: 210 }];
    const r = buildReport(fuel, trips);
    assert.deepEqual(r.chart.kmPerL, [10.3]);
    assert.equal(r.hasChart, true);
    const nov = r.monthly.find((m) => m.label === '11/2026');
    assert.equal(nov.km, 410);
    assert.equal(nov.trips, 2);
    assert.equal(nov.liters, 78);
    assert.equal(nov.cost, 510);
    assert.equal(nov.kmPerL, 10.25);
    assert.ok(!r.monthly.some((m) => m.label === '10/2026'), 'abastecimento removido não entra');
    assert.equal(r.lastPrice, 6.5);
  });
});

describe('sessões: nome do aparelho', () => {
  test('navegador e sistema legíveis; celular reconhecido', () => {
    assert.deepEqual(describeAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:132.0) Gecko/20100101 Firefox/132.0'), { label: 'Firefox — Windows', mobile: false });
    assert.deepEqual(describeAgent('Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Mobile Safari/537.36'), { label: 'Chrome — Android', mobile: true });
    assert.deepEqual(describeAgent('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1'), { label: 'Safari — iPhone', mobile: true });
    assert.equal(describeAgent('Mozilla/5.0 (Windows NT 10.0) AppleWebKit/537.36 Chrome/130.0 Safari/537.36 Edg/130.0').label, 'Edge — Windows');
    assert.equal(describeAgent('').label, 'Aparelho não identificado');
    assert.equal(describeAgent('curl/8.0').label, 'Navegador');
  });
  test('tempo desde o último uso', () => {
    const now = Date.parse('2026-01-01T12:00:00Z');
    assert.equal(ago(now - 20000, now), 'agora');
    assert.equal(ago(now - 60000, now), 'há 1 minuto');
    assert.equal(ago(now - 5 * 3600000, now), 'há 5 horas');
    assert.equal(ago(now - 2 * 86400000, now), 'há 2 dias');
  });
});

describe('arquivos', () => {
  const all = collectFiles(join(HERE, '../src'));
  const views = all.filter((f) => f.endsWith('.hbs'));
  test('sem saída sem escape além do corpo do layout', () => {
    for (const file of views) {
      const raw = readFileSync(file, 'utf8').replaceAll('{{{body}}}', '');
      assert.ok(!raw.includes('{{{'), file);
    }
  });
  test('todo campo obrigatório tem rótulo com asterisco', () => {
    for (const file of views) {
      const raw = readFileSync(file, 'utf8');
      for (const [tag] of raw.matchAll(/<(?:input|select|textarea)\b[^>]*>/g)) {
        if (!/\srequired\b/.test(tag)) continue;
        const id = /\sid="([^"]+)"/.exec(tag)?.[1];
        assert.ok(id, `${file}: campo sem id: ${tag}`);
        assert.match(raw, new RegExp(`<label class="[^"]*required-mark[^"]*" for="${id}">`), `${file}: ${id}`);
      }
    }
  });

  test('painel do veículo usa exatamente os mesmos mostradores do APK', () => {
    const app = join(HERE, '../../../app/src/main/assets/web');
    if (!existsSync(app)) return;
    for (const name of ['dash.js', 'dash.css', 'fonts/ChakraPetch-700.woff2', 'fonts/BarlowSemiCondensed-400.woff2']) {
      assert.ok(readFileSync(join(HERE, '../src/modules/vehicle/public', name)).equals(readFileSync(join(app, name))), name);
    }
    // A tabela de códigos de falha do site é a mesma do app
    assert.ok(readFileSync(join(HERE, '../src/shared/public/js/dtc-sae.js')).equals(readFileSync(join(app, 'dtc-sae.js'))), 'dtc-sae.js');
  });

  test('página da placa usa o mesmo modelo 3D da pasta do veículo', () => {
    const placa = join(HERE, '../../../veiculos/fiat-uno-vivace-2012/placa');
    if (!existsSync(placa)) return;
    // pinagens: a página /projeto usa cópias dos desenhos dos docs
    assert.ok(readFileSync(join(HERE, '../src/modules/projeto/public/pinagem-obd2.svg')).equals(readFileSync(join(HERE, '../../../docs/img/pinagem-obd2.svg'))), 'pinagem-obd2.svg: copie de docs/img');
    assert.ok(readFileSync(join(HERE, '../src/modules/projeto/public/pinagem-obd2-uno.svg')).equals(readFileSync(join(placa, '../img/pinagem-obd2-uno.svg'))), 'pinagem-obd2-uno.svg: copie de veiculos/.../img');
    for (const name of ['modelo3d-dados.js', 'modelo3d-sn65-dados.js']) {
      assert.ok(readFileSync(join(HERE, '../src/modules/projeto/public', name)).equals(readFileSync(join(placa, name))), `${name}: rode gerar_placa.py`);
    }
  });

  test('cada módulo publica o próprio JS e CSS', async () => {
    assert.ok(all.some((f) => f.endsWith('modules/devices/public/live.js')));
    assert.ok(all.some((f) => f.endsWith('modules/account/public/account.css')));
    assert.ok(!all.some((f) => f.endsWith('app.css')));
  });

  test('sem CDN, script ou estilo embutido', () => {
    for (const file of [...views, ...all.filter((f) => f.includes('/public/') && /\.(css|js)$/.test(f) && !f.includes('/modules/vehicle/public/dash.'))]) {
      const raw = readFileSync(file, 'utf8');
      assert.ok(!/(src|href)="https?:/.test(raw), file);
      assert.ok(!/ style="/.test(raw), file);
      assert.ok(!/ on[a-z]+="/.test(raw), file);
      assert.ok(!/innerHTML|eval\(|document\.write/.test(raw), file);
    }
  });
});

describe('fluxo pelo navegador', () => {
  let apiCtx; let apiUrl; let web; let mapDir;

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
    mapDir = mkdtempSync(join(tmpdir(), 'obd-mapa-'));
    writeFileSync(join(mapDir, 'brasil.pmtiles'), 'ABCDEFGH');
    apiUrl = await apiCtx.app.listen({ port: 0, host: '127.0.0.1' });
    web = await buildApp({
      logger: false,
      config: loadConfig({ APP_URL: ORIGIN, INTERNAL_API_KEY: KEY, FORM_SECRET: SECRET, API_URL: apiUrl, RATE_LIMIT_FACTOR: '1000', MAP_DATA_DIR: mapDir }),
    });
  });
  after(async () => {
    await web.close();
    await apiCtx.app.close();
    await apiCtx.pool.end();
  });

  test('área pública do projeto abre sem login', async () => {
    for (const [url, text] of [['/projeto', 'Universal OBD Dashboard'], ['/sobre', 'Todo mundo pode contribuir'], ['/projeto/placa', 'id="cena"']]) {
      const res = await web.inject({ method: 'GET', url });
      assert.equal(res.statusCode, 200, url);
      assert.ok(res.body.includes(text), url);
      assert.ok(res.body.includes('href="https://github.com/AlanMartines/Universal-OBD-Dashboard"'), url);
      assert.ok(res.body.includes('href="/login"'), url);
      assert.ok(!res.body.includes('app-sidebar'), url);
    }
    const placa = (await web.inject({ method: 'GET', url: '/projeto/placa' })).body;
    for (const src of ['/modules/projeto/modelo3d-dados.js', '/modules/projeto/placa3d.mjs']) {
      assert.ok(placa.includes(`src="${src}?v=`), src);
      assert.equal((await web.inject({ method: 'GET', url: src })).statusCode, 200, src);
    }
    // versão alternativa com o SN65HVD230: outro arquivo de dados; valor desconhecido cai na principal
    const sn65 = (await web.inject({ method: 'GET', url: '/projeto/placa?versao=sn65' })).body;
    assert.ok(sn65.includes('src="/modules/projeto/modelo3d-sn65-dados.js?v=') && sn65.includes('SN65HVD230'));
    assert.equal((await web.inject({ method: 'GET', url: '/modules/projeto/modelo3d-sn65-dados.js' })).statusCode, 200);
    const outra = (await web.inject({ method: 'GET', url: '/projeto/placa?versao=xyz' })).body;
    assert.ok(outra.includes('src="/modules/projeto/modelo3d-dados.js?v=') && !outra.includes('modelo3d-sn65'));
    // Three.js local: só os dois arquivos que o visor importa
    for (const [url, status] of [['/vendor/three/three.module.js', 200], ['/vendor/three/three.core.js', 200], ['/vendor/three/three.cjs', 404]]) {
      assert.equal((await web.inject({ method: 'GET', url })).statusCode, status, url);
    }
    assert.ok((await web.inject({ method: 'GET', url: '/login' })).body.includes('href="/projeto"'));
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
    assert.equal(panel.headers.location, '/meus-dados/senha');
    const csrf = await csrfOf(adminCookie, '/meus-dados/senha');
    const changed = await post('/meus-dados/senha', { _csrf: csrf, currentPassword: ADMIN.password, newPassword: 'nova frase longa do administrador', confirm: 'nova frase longa do administrador' }, adminCookie);
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

  test('PWA: manifesto, service worker, página sem conexão e pré-carregamento', async () => {
    const manifest = await web.inject({ method: 'GET', url: '/manifest.webmanifest' });
    assert.equal(manifest.statusCode, 200);
    assert.match(manifest.headers['content-type'], /manifest\+json/);
    assert.equal(manifest.json().start_url, '/painel');
    for (const icon of manifest.json().icons) assert.equal((await web.inject({ method: 'GET', url: icon.src })).statusCode, 200, icon.src);
    const sw = await web.inject({ method: 'GET', url: '/sw.js' });
    assert.equal(sw.statusCode, 200);
    assert.match(sw.headers['content-type'], /javascript/);
    assert.equal((await web.inject({ method: 'GET', url: '/offline' })).statusCode, 200);
    assert.equal((await web.inject({ method: 'GET', url: '/static/css/offline.css' })).statusCode, 200);
    const login = await web.inject({ method: 'GET', url: '/login' });
    assert.equal(login.headers['speculation-rules'], '"/speculation-rules.json"');
    assert.match(login.headers['content-security-policy'], /manifest-src 'self'/);
    assert.equal((await web.inject({ method: 'GET', url: '/speculation-rules.json' })).statusCode, 200);
    // Indicador "Ao vivo": só com login
    assert.notEqual((await web.inject({ method: 'GET', url: '/painel/ao-vivo' })).statusCode, 200);
  });

  test('arquivos fora da lista permitida não são servidos', async () => {
    assert.equal((await web.inject({ method: 'GET', url: '/vendor/bootstrap/css/bootstrap.min.css' })).statusCode, 200);
    assert.equal((await web.inject({ method: 'GET', url: '/vendor/chartjs/chart.umd.min.js' })).statusCode, 200);
    assert.equal((await web.inject({ method: 'GET', url: '/vendor/inter/inter-latin-wght-normal.woff2' })).statusCode, 200);
    assert.notEqual((await web.inject({ method: 'GET', url: '/vendor/inter/inter-greek-wght-normal.woff2' })).statusCode, 200);
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
    assert.match(page.body, /id="fuel-title"/);
    const newCode = await post(`/dispositivos/${deviceId}/novo-codigo`, { _csrf: await csrfOf(adminCookie) }, adminCookie);
    assert.equal(newCode.statusCode, 200);
    assert.match(newCode.body, /Novo código de pareamento/);
    assert.match(newCode.body, /font-monospace mb-2">[A-Z0-9-]+</);
    assert.match(page.body, /data-hash="viagens"/);
    assert.match(page.body, /data-hash="falhas"/);
    // Arquivos do painel com versão no endereço: depois de atualizar, o navegador busca o novo
    assert.match(page.body, /src="\/static\/js\/theme\.js\?v=[0-9a-z]+"/);
    assert.match(page.body, /href="\/modules\/devices\/devices\.css\?v=[0-9a-z]+"/);
    assert.match(page.body, /src="\/vendor\/chartjs\/chart\.umd\.min\.js"/);
    assert.match(page.body, /Nenhum abastecimento ainda/);
    assert.equal(page.statusCode, 200);
    // A leitura inicial fica em atributo: dentro de <script>, o escape impediria o JSON.parse.
    assert.match(page.body, /id="latest-data" hidden data-sample="[^"]*&quot;rpm&quot;/);
    const hist = await web.inject({ method: 'GET', url: `/dispositivos/${deviceId}/historico?metric=rpm&hours=1`, headers: { cookie: adminCookie } });
    assert.equal(hist.json().points.length, 1);
  });

  test('modal de dispositivo: responde JSON, informa pareamento e lista tem botão de visualizar', async () => {
    const csrf = await csrfOf(adminCookie);
    const made = await web.inject({
      method: 'POST', url: '/dispositivos', payload: new URLSearchParams({ _csrf: csrf, name: 'Pelo modal' }).toString(),
      headers: { ...browser(adminCookie), 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
    });
    assert.equal(made.statusCode, 200);
    const { id, pairingCode } = made.json();
    const state = () => web.inject({ method: 'GET', url: `/dispositivos/${id}/estado`, headers: { cookie: adminCookie } });
    assert.deepEqual((await state()).json(), { paired: false });
    await web.inject({ method: 'POST', url: '/api/v1/devices/register', payload: { code: pairingCode, installationId: 'abababab-abab-4bab-8bab-abababababab' } });
    assert.deepEqual((await state()).json(), { paired: true });
    const bad = await web.inject({
      method: 'POST', url: '/dispositivos', payload: new URLSearchParams({ _csrf: csrf, name: '<b>x</b>' }).toString(),
      headers: { ...browser(adminCookie), 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
    });
    assert.equal(bad.statusCode, 400);
    assert.ok(bad.json().error);
    const panel = await web.inject({ method: 'GET', url: '/painel', headers: { cookie: adminCookie } });
    assert.match(panel.body, /id="add-device-modal"/);
    assert.ok(!panel.body.includes(`<a href="/dispositivos/${id}">`));
    assert.match(panel.body, new RegExp(`btn btn-primary btn-sm" href="/dispositivos/${id}"`));
  });

  test('mapa próprio: arquivo só com sessão, com leitura por trechos e sem sair do servidor', async () => {
    const page = await web.inject({ method: 'GET', url: '/mapa/brasil.pmtiles' });
    assert.equal(page.statusCode, 401);
    const partial = await web.inject({ method: 'GET', url: '/mapa/brasil.pmtiles', headers: { cookie: adminCookie, range: 'bytes=0-3' } });
    assert.equal(partial.statusCode, 206);
    assert.equal(partial.body, 'ABCD');
    assert.equal((await web.inject({ method: 'GET', url: '/mapa/brasil.pmtiles', headers: { cookie: '__Host-obd_session=invalida-invalida-invalida' } })).statusCode, 401);
    assert.notEqual((await web.inject({ method: 'GET', url: '/mapa/../package.json', headers: { cookie: adminCookie } })).statusCode, 200);
    for (const url of ['/vendor/maplibre/maplibre-gl.mjs', '/vendor/maplibre/maplibre-gl-worker.mjs', '/vendor/pmtiles/pmtiles.js', '/vendor/basemaps/basemaps.js']) {
      assert.equal((await web.inject({ method: 'GET', url })).statusCode, 200, url);
    }
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

  test('sair da página durante a conexão ao vivo não prende vagas', async () => {
    const csrf = await csrfOf(adminCookie);
    const ok = await post('/dispositivos', { name: 'Vagas', _csrf: csrf }, adminCookie);
    const code = /font-monospace mb-2">([A-Z0-9-]+)</.exec(ok.body)[1];
    const reg = await web.inject({ method: 'POST', url: '/api/v1/devices/register', payload: { code, installationId: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee' } });
    const { deviceId } = reg.json();
    const webUrl = web.server.listening ? `http://127.0.0.1:${web.server.address().port}` : await web.listen({ port: 0, host: '127.0.0.1' });
    for (let i = 0; i < 8; i += 1) {
      const abort = new AbortController();
      setTimeout(() => abort.abort(), i % 2 ? 1 : 150);
      await fetch(`${webUrl}/dispositivos/${deviceId}/ao-vivo`, { headers: { cookie: adminCookie }, signal: abort.signal }).then((r) => r.body.cancel()).catch(() => {});
      await new Promise((resolve) => { setTimeout(resolve, 60); });
    }
    const final = await fetch(`${webUrl}/dispositivos/${deviceId}/ao-vivo`, { headers: { cookie: adminCookie }, signal: AbortSignal.timeout(2000) });
    assert.equal(final.status, 200);
    await final.body.cancel();
  });

  test('Meus Dados: foto por envio real, iniciais, e foto só com login', async () => {
    const page = await web.inject({ method: 'GET', url: '/meus-dados', headers: { cookie: adminCookie } });
    assert.match(page.body, /sidebar-avatar[\s\S]*?<span aria-hidden="true">[A-Z?]+<\/span>/);
    const csrf = field(page.body, '_csrf');
    // PNG válido de 1 × 1.
    const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M/wHwAEBgIApD5fRAAAAABJRU5ErkJggg==', 'base64');
    const send2 = (content, filename) => {
      const b = 'limite-do-teste';
      const payload = Buffer.concat([
        Buffer.from(`--${b}\r\nContent-Disposition: form-data; name="_csrf"\r\n\r\n${csrf}\r\n--${b}\r\nContent-Disposition: form-data; name="avatar"; filename="${filename}"\r\nContent-Type: image/png\r\n\r\n`),
        content,
        Buffer.from(`\r\n--${b}--\r\n`),
      ]);
      return web.inject({ method: 'POST', url: '/meus-dados/foto', payload, headers: { ...browser(adminCookie), 'content-type': `multipart/form-data; boundary=${b}` } });
    };
    const fake = await send2(Buffer.from('<svg onload="alert(1)"/>'), 'foto.png');
    assert.equal(fake.statusCode, 400);
    assert.equal((await send2(png, 'foto.png')).statusCode, 303);
    const after2 = await web.inject({ method: 'GET', url: '/painel', headers: { cookie: adminCookie } });
    const src = /src="(\/meus-dados\/foto\?v=\d+)"/.exec(after2.body)[1];
    const img = await web.inject({ method: 'GET', url: src, headers: { cookie: adminCookie } });
    assert.equal(img.headers['content-type'], 'image/webp');
    assert.match(img.headers['cache-control'], /private/);
    assert.equal((await web.inject({ method: 'GET', url: src })).headers.location, '/login');
    const noCsrf = await post('/meus-dados/foto/remover', {}, adminCookie);
    assert.equal(noCsrf.statusCode, 403);
    assert.equal((await post('/meus-dados/foto/remover', { _csrf: csrf }, adminCookie)).statusCode, 303);
  });

  test('foto acima do limite volta à tela com mensagem, sem página de erro', async () => {
    const page = await web.inject({ method: 'GET', url: '/meus-dados', headers: { cookie: adminCookie } });
    const csrf = field(page.body, '_csrf');
    const b = 'limite-grande';
    const payload = Buffer.concat([
      Buffer.from(`--${b}\r\nContent-Disposition: form-data; name="_csrf"\r\n\r\n${csrf}\r\n--${b}\r\nContent-Disposition: form-data; name="avatar"; filename="g.jpg"\r\nContent-Type: image/jpeg\r\n\r\n`),
      Buffer.alloc(5 * 1024 * 1024 + 10),
      Buffer.from(`\r\n--${b}--\r\n`),
    ]);
    const res = await web.inject({ method: 'POST', url: '/meus-dados/foto', payload, headers: { ...browser(adminCookie), 'content-type': `multipart/form-data; boundary=${b}` } });
    assert.equal(res.statusCode, 303);
    assert.equal(res.headers.location, '/meus-dados?erro=image_too_large');
    const shown = await web.inject({ method: 'GET', url: res.headers.location, headers: { cookie: adminCookie } });
    assert.match(shown.body, /passa de 5 MB/);
    const injected = await web.inject({ method: 'GET', url: `/meus-dados?erro=${encodeURIComponent('<script>x</script>')}&aviso=${encodeURIComponent('<b>x</b>')}`, headers: { cookie: adminCookie } });
    assert.ok(!injected.body.includes('<script>x') && !injected.body.includes('<b>x</b>'));
  });

  test('formulários carregam validação e medidor com arquivos locais', async () => {
    const page = await web.inject({ method: 'GET', url: '/meus-dados', headers: { cookie: adminCookie } });
    assert.match(page.body, /data-password-meter="newPassword"/);
    assert.match(page.body, /id="current-email"/);
    for (const url of ['/vendor/jquery/jquery.min.js', '/vendor/jquery-validation/jquery.validate.min.js', '/static/js/forms.js']) {
      assert.match(page.body, new RegExp(`src="${url}(\\?v=[0-9a-z]+)?"`));
      assert.equal((await web.inject({ method: 'GET', url })).statusCode, 200, url);
    }
    assert.notEqual((await web.inject({ method: 'GET', url: '/vendor/jquery/jquery.js' })).statusCode, 200);
  });

  test('link de e-mail: abrir não altera nada; confirmar exige a mesma origem', async () => {
    const opened = await web.inject({ method: 'GET', url: '/meus-dados/email/confirmar?token=token-invalido-de-teste-1234567890' });
    assert.equal(opened.statusCode, 200);
    assert.match(opened.body, /name="token" value="token-invalido-de-teste-1234567890"/);
    const cross = await post('/meus-dados/email/confirmar', { token: 'token-invalido-de-teste-1234567890' }, null, { origin: 'https://mau.example', 'sec-fetch-site': 'cross-site' });
    assert.equal(cross.statusCode, 403);
    const bad = await post('/meus-dados/email/confirmar', { token: 'token-invalido-de-teste-1234567890' });
    assert.equal(bad.statusCode, 400);
    const xss = await web.inject({ method: 'GET', url: `/meus-dados/email/confirmar?token=${encodeURIComponent('"><script>alert(1)</script>')}` });
    assert.ok(!xss.body.includes('<script>alert(1)'));
  });

  test('perfis: tela do Admin e do Usuário; Super Admin escolhe a conta', async () => {
    const enter = async (username, password, newPassword) => {
      const cookie = cookieOf(await signIn(username, password));
      const c = await csrfOf(cookie, '/meus-dados/senha');
      await post('/meus-dados/senha', { _csrf: c, currentPassword: password, newPassword, confirm: newPassword }, cookie);
      return cookie;
    };
    const senhaDe = (body) => /user-select-all[^"]*">([^<]+)</.exec(body)[1];
    const csrf = await csrfOf(adminCookie);
    const superPage = await web.inject({ method: 'GET', url: '/admin', headers: { cookie: adminCookie } });
    assert.match(superPage.body, /name="accountId"/);
    assert.match(superPage.body, /Auditoria recente/);
    const semConta = await post('/admin/usuarios', { _csrf: csrf, username: 'semconta', role: 'user', accountId: '' }, adminCookie);
    assert.equal(semConta.statusCode, 400);
    assert.match(semConta.body, /Escolha a conta/);

    const madeAdmin = await post('/admin/usuarios', { _csrf: csrf, username: 'contadono', role: 'admin' }, adminCookie);
    const donoCookie = await enter('contadono', senhaDe(madeAdmin.body), 'uma frase longa para esta conta');
    const donoPage = await web.inject({ method: 'GET', url: '/admin', headers: { cookie: donoCookie } });
    assert.equal(donoPage.statusCode, 200);
    assert.ok(!donoPage.body.includes('name="accountId"'));
    assert.ok(!donoPage.body.includes('Auditoria recente'));
    assert.ok(!donoPage.body.includes('Cadastro público'));

    const donoCsrf = await csrfOf(donoCookie);
    const madeUser = await post('/admin/usuarios', { _csrf: donoCsrf, username: 'atendimento', role: 'user' }, donoCookie);
    const cookie = await enter('atendimento', senhaDe(madeUser.body), 'uma frase longa para esta conta');
    const denied = await web.inject({ method: 'GET', url: '/admin', headers: { cookie } });
    assert.equal(denied.statusCode, 403);
    assert.ok(!denied.body.includes('href="/admin"'));
    const panel = await web.inject({ method: 'GET', url: '/painel', headers: { cookie } });
    assert.ok(!panel.body.includes('action="/dispositivos"'));
    assert.ok(!panel.body.includes('Revogar'));
    const conta = await web.inject({ method: 'GET', url: '/meus-dados', headers: { cookie } });
    assert.ok(!conta.body.includes('action="/meus-dados/excluir"'));
  });

  test('menu lateral: só com login, item ativo, por papel e com arquivos locais', async () => {
    const anon = await web.inject({ method: 'GET', url: '/login' });
    assert.ok(!anon.body.includes('app-sidebar'));
    const panel = await web.inject({ method: 'GET', url: '/painel', headers: { cookie: adminCookie } });
    assert.match(panel.body, /id="app-sidebar"/);
    assert.match(panel.body, /href="\/painel"[^>]*class="active"/);
    assert.match(panel.body, /name="_csrf" value="[^"]+"/);
    const conta = await web.inject({ method: 'GET', url: '/meus-dados', headers: { cookie: adminCookie } });
    assert.match(conta.body, /href="\/meus-dados"[^>]*class="active"/);
    assert.match(conta.body, /href="\/admin"/);
    for (const url of ['/static/js/shell.js', '/assets/images/body/bg01.png', '/assets/images/body/bg02.png', '/assets/logos/eletroinfo.svg', '/assets/favicons/favicon-32x32.png', '/vendor/fontawesome/css/all.min.css', '/vendor/fontawesome/webfonts/fa-solid-900.woff2']) {
      assert.equal((await web.inject({ method: 'GET', url })).statusCode, 200, url);
    }
    assert.notEqual((await web.inject({ method: 'GET', url: '/vendor/fontawesome/package.json' })).statusCode, 200);
  });

  test('login em dois passos: cookie curto, sem sessão antes do código', async () => {
    const { codeForStep, stepAt } = await import('../../api/src/totp.js');
    const csrf = await csrfOf(adminCookie);
    const made = await post('/admin/usuarios', { _csrf: csrf, username: 'comcodigo', role: 'admin' }, adminCookie);
    const temp = /user-select-all[^"]*">([^<]+)</.exec(made.body)[1];
    const PW = 'uma frase longa para esta conta';
    const cookie = cookieOf(await signIn('comcodigo', temp));
    await post('/meus-dados/senha', { _csrf: await csrfOf(cookie, '/meus-dados/senha'), currentPassword: temp, newPassword: PW, confirm: PW }, cookie);
    const accountPage = await web.inject({ method: 'GET', url: '/meus-dados', headers: { cookie } });
    const c = field(accountPage.body, '_csrf');
    assert.match(accountPage.body, /\/meus-dados\/sessoes/);
    assert.equal((await post('/meus-dados/2fa/iniciar', { _csrf: c, currentPassword: PW }, cookie)).headers.location, '/meus-dados/2fa');
    const setup = await web.inject({ method: 'GET', url: '/meus-dados/2fa', headers: { cookie } });
    assert.match(setup.body, /src="data:image\/png;base64,/);
    const secret = /user-select-all text-break">([A-Z2-7]+)</.exec(setup.body)[1];
    const on = await post('/meus-dados/2fa/ativar', { _csrf: c, code: codeForStep(secret, stepAt(Date.now())) }, cookie);
    assert.match(on.body, /Códigos de recuperação/);
    const first = await signIn('comcodigo', PW);
    assert.equal(first.headers.location, '/login/verificacao');
    const raw = first.headers['set-cookie'];
    assert.match(raw, /^obd_mfa=/);
    assert.match(raw, /HttpOnly/);
    assert.match(raw, /Path=\/login/);
    assert.ok(!raw.includes('__Host-obd_session'));
    const mfaCookie = cookieOf(first);
    const wrong = await post('/login/verificacao', { code: '000000' }, mfaCookie);
    assert.equal(wrong.statusCode, 401);
    const good = await post('/login/verificacao', { code: codeForStep(secret, stepAt(Date.now()) + 1) }, mfaCookie);
    assert.equal(good.statusCode, 303);
    assert.match(String(good.headers['set-cookie']), /__Host-obd_session=/);
  });

  test('esqueci a senha: mesma tela para qualquer e-mail; link abre sem alterar nada', async () => {
    const page = await web.inject({ method: 'GET', url: '/login' });
    assert.match(page.body, /href="\/esqueci-senha"/);
    const form = await web.inject({ method: 'GET', url: '/esqueci-senha' });
    const sent = await post('/esqueci-senha', { email: 'ninguem@exemplo.test', formToken: field(form.body, 'formToken') });
    assert.match(sent.body, /Se houver uma conta/);
    const bot = await post('/esqueci-senha', { email: 'a@exemplo.test', website: 'x', formToken: field(form.body, 'formToken') });
    assert.match(bot.body, /Se houver uma conta/);
    const open = await web.inject({ method: 'GET', url: '/redefinir-senha?token=token-de-teste-1234567890123' });
    assert.match(open.body, /name="newPassword"/);
    const dead = await post('/redefinir-senha', { token: 'token-de-teste-1234567890123', newPassword: 'uma frase longa qualquer', confirm: 'uma frase longa qualquer' });
    assert.equal(dead.statusCode, 400);
    assert.match(dead.body, /inválido ou já venceu/);
  });

  test('sessões e modo suporte: faixa visível, cartões pessoais ocultos e retorno', async () => {
    const list = await web.inject({ method: 'GET', url: '/meus-dados/sessoes', headers: { cookie: adminCookie } });
    const old = await web.inject({ method: 'GET', url: '/conta/sessoes?ok=1', headers: { cookie: adminCookie } });
    assert.equal(old.statusCode, 301);
    assert.equal(old.headers.location, '/meus-dados/sessoes?ok=1');
    assert.match(list.body, /Sessão atual/);
    assert.match(list.body, /Expira /);
    const admin = await web.inject({ method: 'GET', url: '/admin', headers: { cookie: adminCookie } });
    const target = /action="(\/admin\/usuarios\/[0-9a-f-]+\/personificar)"/.exec(admin.body)[1];
    const started = await post(target, { _csrf: field(admin.body, '_csrf') }, adminCookie);
    assert.equal(started.statusCode, 303);
    const support = cookieOf(started);
    const account = await web.inject({ method: 'GET', url: '/meus-dados', headers: { cookie: support } });
    assert.match(account.body, /Modo suporte/);
    assert.ok(!account.body.includes('action="/meus-dados/email"'));
    assert.ok(!account.body.includes('action="/meus-dados/excluir"'));
    const back = await post('/meus-dados/personificacao/sair', { _csrf: field(account.body, '_csrf') }, support);
    assert.equal(back.headers.location, '/admin');
    adminCookie = cookieOf(back);
    assert.equal((await web.inject({ method: 'GET', url: '/admin', headers: { cookie: adminCookie } })).statusCode, 200);
  });

  test('painel do veículo: sem dispositivo avisa; só abre o que a conta pode ver', async () => {
    const empty = await web.inject({ method: 'GET', url: '/painel-veiculo?dispositivo=11111111-1111-4111-8111-111111111111', headers: { cookie: adminCookie } });
    assert.equal(empty.statusCode, 404);
    const page = await web.inject({ method: 'GET', url: '/painel-veiculo', headers: { cookie: adminCookie } });
    assert.equal(page.statusCode, 200);
    assert.match(page.body, /data-device-id="[0-9a-f-]{36}"/);
    assert.match(page.body, /data-limits="/);
    assert.match(page.body, /src="\/modules\/vehicle\/dash\.js\?v=[0-9a-z]+"/);
    assert.match(page.body, /aria-current="page"[^>]*>|class="active"/);
    assert.equal((await web.inject({ method: 'GET', url: '/modules/vehicle/fonts/ChakraPetch-700.woff2' })).statusCode, 200);
    assert.equal((await web.inject({ method: 'GET', url: '/painel-veiculo' })).headers.location, '/login');
  });

  test('paginação: links preservam a outra lista e não repetem aviso', async () => {
    const { rows } = await apiCtx.pool.query("SELECT id FROM users WHERE role = 'superadmin'");
    assert.ok(rows.length);
    for (let i = 0; i < 30; i += 1) {
      await apiCtx.pool.query("INSERT INTO users (username, password_hash, role) VALUES ($1, 'x', 'admin') ON CONFLICT DO NOTHING", [`lote-${i}`]);
    }
    const page = await web.inject({ method: 'GET', url: '/admin?auditoria=1&ok=user_updated', headers: { cookie: adminCookie } });
    assert.match(page.body, /aria-label="Páginas de usuários"/);
    assert.match(page.body, /1 a 25 de \d+/);
    assert.match(page.body, /href="\/admin\?auditoria&#x3D;1&amp;usuarios&#x3D;2"/);
    assert.match(page.body, /data-message="Usuário atualizado\."/);
    const second = await web.inject({ method: 'GET', url: '/admin?usuarios=2', headers: { cookie: adminCookie } });
    assert.match(second.body, /26 a \d+ de \d+/);
    const strange = await web.inject({ method: 'GET', url: "/admin?usuarios=1'%20OR%201=1", headers: { cookie: adminCookie } });
    assert.equal(strange.statusCode, 200);
    const unknown = await web.inject({ method: 'GET', url: `/admin?ok=${encodeURIComponent('<script>x</script>')}`, headers: { cookie: adminCookie } });
    assert.ok(!unknown.body.includes('<script>x') && !unknown.body.includes('app-flash'));
  });

  test('ações destrutivas pedem confirmação, com texto escapado', async () => {
    const csrf = await csrfOf(adminCookie);
    await post('/dispositivos', { name: 'Confirmar "aspas"', _csrf: csrf }, adminCookie);
    const panel = await web.inject({ method: 'GET', url: '/painel', headers: { cookie: adminCookie } });
    assert.match(panel.body, /data-confirm="Excluir Confirmar &quot;aspas&quot; e toda/);
    assert.match(panel.body, /id="confirm-modal"/);
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

describe('saúde do carro', () => {
  const dia = (i, extra) => ({ day: `2026-10-${String(i + 1).padStart(2, '0')}`, samples: 100, stftWarmAvg: 1, voltsOffAvg: 12.6, voltsOffMin: 12.5,
    voltsRunningAvg: 14.1, coolantWarmAvg: 90, coolantMax: 97, lambdaPostSd: 0.05, milOn: false, ...extra });
  const nivel = (f, topic) => f.filter((x) => x.topic === topic).map((x) => x.level);

  test('tudo normal com dias suficientes', () => {
    const f = healthFindings(Array.from({ length: 10 }, (_, i) => dia(i)));
    for (const t of ['Mistura', 'Bateria', 'Alternador', 'Arrefecimento', 'Catalisador']) assert.deepEqual(nivel(f, t), ['ok'], t);
  });

  test('pouca coisa vira silêncio, não alarme', () => {
    assert.equal(healthFindings([dia(0, { stftWarmAvg: 20 }), dia(1, { stftWarmAvg: 20 })]).length, 0);
  });

  test('mistura pobre, bateria fraca, alternador baixo, superaquecimento e catalisador', () => {
    const f = healthFindings(Array.from({ length: 5 }, (_, i) => dia(i, {
      stftWarmAvg: 11, voltsOffAvg: 12.1, voltsRunningAvg: 13, coolantMax: 106, lambdaPostSd: 0.3, milOn: i === 4,
    })));
    assert.deepEqual(nivel(f, 'Mistura'), ['warn']);
    assert.deepEqual(nivel(f, 'Bateria'), ['bad']);
    assert.deepEqual(nivel(f, 'Alternador'), ['warn']);
    assert.deepEqual(nivel(f, 'Arrefecimento'), ['bad']);
    assert.deepEqual(nivel(f, 'Catalisador'), ['warn']);
    assert.deepEqual(nivel(f, 'Injeção'), ['bad']);
  });

  test('mudança da correção em relação às semanas anteriores', () => {
    const days = [...Array.from({ length: 10 }, (_, i) => dia(i, { stftWarmAvg: -2 })), ...Array.from({ length: 14 }, (_, i) => dia(i + 10, { stftWarmAvg: 4 }))];
    assert.deepEqual(nivel(healthFindings(days), 'Mistura'), ['ok', 'info']);
  });

  test('gráficos e tabela', () => {
    const h = buildHealth([dia(0), dia(1, { stftWarmAvg: null })]);
    assert.deepEqual(h.chart.labels, ['01/10', '02/10']);
    assert.deepEqual(h.chart.stftWarm, [1, null]);
    assert.equal(h.table[0].day, '02/10/2026');
    assert.equal(h.since, '01/10/2026');
  });
});

describe('manutenção no painel', () => {
  test('texto do vencimento, selo e histórico', () => {
    const m = buildMaintenance({ items: [
      { id: 1, name: 'Óleo', notes: null, records: [{ id: 1, ts: Date.UTC(2026, 9, 1, 15), odometerKm: 183000, cost: 230 }],
        status: { level: 'SOON', nextKm: 190000, remainingKm: 400, nextAt: null, remainingDays: null } },
      { id: 2, name: 'Fluido de freio', notes: null, records: [],
        status: { level: 'DUE', nextKm: null, remainingKm: null, nextAt: Date.UTC(2026, 9, 1, 15), remainingDays: -12 } },
    ], totalCost: 230, due: 1, soon: 1, odometerKm: 189600 });
    assert.equal(m.items[0].when, 'faltam 400 km (aos 190.000 km)');
    assert.equal(m.items[0].label, 'Perto de vencer');
    assert.equal(m.items[0].last, '01/10/2026 · 183.000 km');
    assert.equal(m.items[0].spent, 230);
    assert.equal(m.items[1].when, 'vencido há 12 dias');
    assert.equal(m.items[1].tone, 'bad');
    assert.equal(m.items[1].last, null);
  });
});

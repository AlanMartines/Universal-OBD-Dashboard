/*
 * Teste de tela: abre as páginas do painel e a tela do app num Chrome sem janela e falha com erro de
 * JavaScript, erro no console ou página em branco. Pega o que os testes do servidor não veem (eles só
 * conferem o HTML), como o modelo 3D que deixou de abrir na v0.9.67.
 *
 * Sem dependência nova: fala com o Chrome pelo protocolo de depuração, com o WebSocket do próprio Node.
 * Uso, em server/web: TEST_DATABASE_URL=... node test/telas.mjs   (CHROME_BIN escolhe o navegador;
 * TELAS_FILTRO=placa roda só as telas com "placa" no nome)
 * As capturas ficam em test/telas-capturas/ (o CI guarda como artefato).
 */
import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/config.js';
import { KEY, adminToken, internal, pairDevice, send, startApi, userToken } from '../../api/test/helpers.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const SAIDA = join(HERE, 'telas-capturas');
const APP_WEB = join(HERE, '../../../app/src/main/assets/web/index.html');
const CHROME = process.env.CHROME_BIN || 'google-chrome';
const LOOKS = ['minimal', 'capsule', 'hud', 'sport', 'classic', 'horizon'];
const ABAS_APP = ['panel', 'fuel', 'history', 'settings', 'sensors'];

/* ------------------------------------------------------------------ Chrome pelo protocolo de depuração */
async function abrirChrome() {
  const perfil = mkdtempSync(join(tmpdir(), 'obd-telas-'));
  const chrome = spawn(CHROME, [
    '--headless=new', '--no-sandbox', '--disable-gpu-sandbox', '--no-first-run', '--hide-scrollbars',
    '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--allow-file-access-from-files',
    '--remote-debugging-port=0', `--user-data-dir=${perfil}`, 'about:blank',
  ], { stdio: ['ignore', 'ignore', 'pipe'] });
  const ws = await new Promise((resolve, reject) => {
    let texto = '';
    const prazo = setTimeout(() => reject(new Error('o Chrome não abriu')), 20000);
    chrome.stderr.on('data', (pedaco) => {
      texto += pedaco;
      const achou = texto.match(/DevTools listening on (ws:\/\/\S+)/);
      if (achou) { clearTimeout(prazo); resolve(achou[1]); }
    });
    chrome.on('exit', () => reject(new Error(`o Chrome fechou: ${texto.slice(-300)}`)));
  });
  const fechar = async () => {
    const saiu = new Promise((resolve) => { chrome.once('exit', resolve); });
    chrome.kill();
    await saiu;
    try { rmSync(perfil, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }); } catch { /* pasta temporária: o sistema limpa depois */ }
  };
  return { porta: new URL(ws).port, fechar };
}

/** Uma aba nova, com envio de comandos e coleta de erros. */
async function novaAba(porta) {
  const alvo = await (await fetch(`http://127.0.0.1:${porta}/json/new?about:blank`, { method: 'PUT' })).json();
  const ws = new WebSocket(alvo.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });
  let id = 0;
  const pendentes = new Map();
  const ouvintes = new Map();
  const erros = [];
  ws.onmessage = (evento) => {
    const msg = JSON.parse(evento.data);
    if (msg.id && pendentes.has(msg.id)) {
      const { resolve, reject } = pendentes.get(msg.id);
      pendentes.delete(msg.id);
      if (msg.error) reject(new Error(msg.error.message)); else resolve(msg.result);
      return;
    }
    if (msg.method === 'Runtime.exceptionThrown') {
      const d = msg.params.exceptionDetails;
      erros.push(`exceção: ${d.exception?.description?.split('\n')[0] ?? d.text} (${d.url ?? ''}:${d.lineNumber ?? ''})`);
    }
    if (msg.method === 'Runtime.consoleAPICalled' && msg.params.type === 'error') {
      erros.push(`console: ${msg.params.args.map((a) => a.value ?? a.description ?? '').join(' ')}`);
    }
    if (msg.method === 'Log.entryAdded' && msg.params.entry.level === 'error') {
      erros.push(`log: ${msg.params.entry.text} ${msg.params.entry.url ?? ''}`);
    }
    (ouvintes.get(msg.method) ?? []).forEach((fn) => fn(msg.params));
  };
  const cmd = (method, params = {}) => new Promise((resolve, reject) => {
    id += 1;
    pendentes.set(id, { resolve, reject });
    ws.send(JSON.stringify({ id, method, params }));
  });
  const uma = (method) => new Promise((resolve) => {
    const lista = ouvintes.get(method) ?? [];
    const fn = (p) => { ouvintes.set(method, lista.filter((x) => x !== fn)); resolve(p); };
    lista.push(fn);
    ouvintes.set(method, lista);
  });
  await cmd('Page.enable');
  await cmd('Runtime.enable');
  await cmd('Log.enable');
  await cmd('Network.enable');
  return {
    erros,
    cmd,
    async ir(url, { largura = 1280, altura = 900, escuro = false, cookie } = {}) {
      await cmd('Emulation.setDeviceMetricsOverride', { width: largura, height: altura, deviceScaleFactor: 1, mobile: largura < 600 });
      await cmd('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: escuro ? 'dark' : 'light' }] });
      await cmd('Network.clearBrowserCookies');
      if (cookie) await cmd('Network.setCookie', { url, ...cookie });
      const carregou = uma('Page.loadEventFired');
      await cmd('Page.navigate', { url });
      await carregou;
      await esperar(800);
    },
    async avaliar(expressao) {
      const r = await cmd('Runtime.evaluate', { expression: expressao, awaitPromise: true, returnByValue: true });
      if (r.exceptionDetails) throw new Error(`${expressao}: ${r.exceptionDetails.exception?.description ?? r.exceptionDetails.text}`);
      return r.result.value;
    },
    async capturar(nome) {
      const { data } = await cmd('Page.captureScreenshot', { format: 'png' });
      writeFileSync(join(SAIDA, `${nome}.png`), Buffer.from(data, 'base64'));
    },
    fechar: () => ws.close(),
  };
}

const esperar = (ms) => new Promise((r) => { setTimeout(r, ms); });

/* ------------------------------------------------------------------ Servidor de teste com dados */
async function subirPainel() {
  const api = await startApi();
  const apiUrl = await api.app.listen({ port: 0, host: '127.0.0.1' });
  const mapas = mkdtempSync(join(tmpdir(), 'obd-telas-mapa-'));
  const web = await buildApp({
    logger: false,
    config: loadConfig({ APP_URL: 'http://127.0.0.1', ALLOW_INSECURE_COOKIE: 'true', INTERNAL_API_KEY: KEY, FORM_SECRET: 'segredo-dos-formularios-de-teste-com-32+', API_URL: apiUrl, RATE_LIMIT_FACTOR: '1000', MAP_DATA_DIR: mapas }),
    pwned: async () => false,
  });
  const webUrl = await web.listen({ port: 0, host: '127.0.0.1' });
  const admin = await adminToken(api.app);
  const dono = await userToken(api.app, admin, 'donotelas');
  const dev = await pairDevice(api.app, dono, '7a1d2c3b-4a59-4e6f-8a7b-0c1d2e3f4a5c');
  // Uma viagem curta com GPS, para o percurso, o gráfico do trajeto e os mostradores terem dados
  const agora = Date.now();
  const amostras = Array.from({ length: 40 }, (_, i) => ({
    seq: i + 1, ts: agora - (45 - i) * 5000, tripId: 1,
    metrics: { rpm: 900 + i * 50, speed: 10 + i, coolant_temp: 88, battery_volts: 14.1, 'derived.instantKmPerL': 12 },
    gps: { lat: -10 - i / 2000, lon: -20 - i / 2000, speedKmh: 10 + i, accuracyM: 5 },
  }));
  await send(api.app, dev.deviceToken, amostras);
  await internal(api.app, 'GET', '/internal/devices', { token: dono });
  return {
    webUrl, dev, admin, dono,
    fechar: async () => { await web.close(); await api.app.close(); await api.pool.end(); rmSync(mapas, { recursive: true, force: true }); },
  };
}

/* ------------------------------------------------------------------ Roteiro */
mkdirSync(SAIDA, { recursive: true });
const falhas = [];
const painel = await subirPainel();
const chrome = await abrirChrome();
const aba = await novaAba(chrome.porta);

// TELAS_FILTRO (expressão regular) roda só as telas cujo nome bate, para conferir uma mudança rápido.
const FILTRO = process.env.TELAS_FILTRO ? new RegExp(process.env.TELAS_FILTRO) : null;

async function conferir(nome, fn) {
  if (FILTRO && !FILTRO.test(nome)) return;
  aba.erros.length = 0;
  try {
    await fn();
    const texto = await aba.avaliar('document.body ? document.body.innerText.trim().length : 0');
    if (texto < 20) throw new Error('página em branco');
  } catch (erro) {
    aba.erros.push(`falhou: ${erro.message}`);
  }
  await aba.capturar(nome).catch(() => {});
  // Sem mapa base no teste, o painel não pede o arquivo; o ícone da aba pode faltar em file://
  const reais = aba.erros.filter((e) => !/favicon/.test(e));
  if (reais.length) falhas.push(`${nome}:\n  ${reais.join('\n  ')}`);
  console.log(`${reais.length ? 'FALHOU' : 'ok    '} ${nome}`);
}

const sessao = (token) => ({ cookie: { name: 'obd_session', value: token, path: '/' } });
const u = (caminho) => `${painel.webUrl}${caminho}`;

for (const escuro of [false, true]) {
  const tema = escuro ? 'escuro' : 'claro';
  // Área pública
  for (const [nome, caminho] of [['login', '/login'], ['projeto', '/projeto'], ['sobre', '/sobre'], ['notas', '/projeto/notas']]) {
    await conferir(`${tema}-${nome}`, () => aba.ir(u(caminho), { escuro }));
  }
  // Modelo 3D, nas três variações: o aviso de erro não pode aparecer
  for (const [nome, caminho] of [['placa-tja', '/projeto/placa'], ['placa-sn65', '/projeto/placa?versao=sn65'], ['placa-pcb', '/projeto/placa?placa=pcb']]) {
    await conferir(`${tema}-${nome}`, async () => {
      await aba.ir(u(caminho), { escuro });
      await esperar(1500);
      const ok = await aba.avaliar(`(() => { const a = document.getElementById('aviso'); const c = document.getElementById('cena'); return !!c && c.width > 0 && (!a || a.hidden); })()`);
      if (!ok) throw new Error('o modelo 3D não abriu');
    });
  }
  // Dono da conta
  const dono = sessao(painel.dono);
  for (const [nome, caminho] of [['painel', '/painel'], ['dispositivo', `/dispositivos/${painel.dev.id}`], ['meus-dados', '/meus-dados']]) {
    await conferir(`${tema}-${nome}`, () => aba.ir(u(caminho), { escuro, ...dono }));
  }
  await conferir(`${tema}-percurso`, async () => {
    await aba.ir(u(`/dispositivos/${painel.dev.id}#percurso`), { escuro, ...dono });
    await esperar(1500);
    const ok = await aba.avaliar(`!document.getElementById('route-map').hidden && !document.getElementById('route-profile').hidden`);
    if (!ok) throw new Error('mapa ou gráfico do trajeto não apareceu');
  });
  await conferir(`${tema}-celular-dispositivo`, () => aba.ir(u(`/dispositivos/${painel.dev.id}`), { escuro, largura: 390, altura: 844, ...dono }));
  for (const look of LOOKS) {
    await conferir(`${tema}-veiculo-${look}`, async () => {
      await aba.ir(u(`/painel-veiculo?dispositivo=${painel.dev.id}`), { escuro, ...dono });
      await aba.avaliar(`window.Dash.setLook('${look}'), true`);
      await esperar(300);
      if (!(await aba.avaliar(`document.getElementById('dash-host').children.length > 0`))) throw new Error('mostradores vazios');
    });
  }
  // Super Admin
  const admin = sessao(painel.admin);
  for (const [nome, caminho] of [['admin', '/admin'], ['admin-mapas', '/admin/mapas']]) {
    await conferir(`${tema}-${nome}`, () => aba.ir(u(caminho), { escuro, ...admin }));
  }
}

// Tela do app (pré-visualização, sem o Android): cada aba e cada tema dos mostradores, de dia e de noite
const appUrl = pathToFileURL(APP_WEB).href;
for (const escuro of [false, true]) {
  const tema = escuro ? 'escuro' : 'claro';
  for (const tab of ABAS_APP) {
    await conferir(`app-${tema}-${tab}`, async () => {
      await aba.ir(appUrl, { escuro, largura: 412, altura: 860 });
      await aba.avaliar(`document.documentElement.dataset.appTheme = ${escuro ? "''" : "'light'"}, true`);
      await aba.avaliar(`document.querySelector('[data-tab=${tab}]').click(), true`);
      await esperar(300);
    });
  }
  for (const look of LOOKS) {
    await conferir(`app-${tema}-mostrador-${look}`, async () => {
      await aba.ir(appUrl, { escuro, largura: 412, altura: 860 });
      await aba.avaliar(`window.Dash.setLook('${look}'), window.Dash.setMode('${escuro ? 'night' : 'day'}'), true`);
      await esperar(300);
    });
  }
}

aba.fechar();
await chrome.fechar();
await painel.fechar();
if (falhas.length) {
  console.error(`\n${falhas.length} tela(s) com problema:\n${falhas.join('\n')}`);
  process.exit(1);
}
console.log('\nTodas as telas abriram sem erro.');

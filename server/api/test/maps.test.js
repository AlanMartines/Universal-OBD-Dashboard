import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { after, before, describe, test } from 'node:test';
import { createMapsClient } from '../src/maps.js';
import { adminToken, internal, startApi, userToken } from './helpers.js';

/** Contêiner "mapas" de mentira: responde como o de verdade e guarda os pedidos recebidos. */
function falsoMapas() {
  const pedidos = [];
  let ocupado = false;
  const estado = {
    base: { instalado: true, area: 'monaco', nome: 'Monaco', bytes: 10 },
    encaixe: { instalado: false },
    trabalho: null,
    disco: { mapas: 1, encaixe: 1 },
  };
  const server = createServer((req, res) => {
    let corpo = '';
    req.on('data', (d) => { corpo += d; });
    req.on('end', () => {
      pedidos.push({ method: req.method, url: req.url, body: corpo ? JSON.parse(corpo) : null });
      const json = (status, dados) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(dados)); };
      if (req.url === '/estado') return json(200, estado);
      if (req.url === '/catalogo') return json(200, { areas: [{ id: 'planeta', nome: 'Planeta inteiro', pai: null }, { id: 'monaco', nome: 'Monaco', pai: 'europe' }] });
      if (req.url.startsWith('/tamanho')) return json(200, { area: 'monaco', bytesPbf: 700000, memoriaEncaixe: 3500000 });
      if (req.method === 'POST' && req.url === '/trabalhos') return ocupado ? json(409, { error: 'busy' }) : json(202, { ok: true });
      if (req.method === 'DELETE') return json(200, { ok: true });
      return json(404, { error: 'not_found' });
    });
  });
  return { server, pedidos, estado, ocupar: (v) => { ocupado = v; } };
}

describe('mapas (painel)', () => {
  let app; let pool; let admin; let comum; let falso;

  before(async () => {
    falso = falsoMapas();
    await new Promise((r) => falso.server.listen(0, '127.0.0.1', r));
    ({ app, pool } = await startApi({ MAPAS_URL: `http://127.0.0.1:${falso.server.address().port}` }));
    admin = await adminToken(app);
    comum = await userToken(app, admin, 'mapasuser');
  });
  after(async () => {
    await app.close();
    await pool.end();
    falso.server.close();
  });

  test('só o Super Admin vê a situação e o catálogo', async () => {
    const estado = await internal(app, 'GET', '/internal/admin/maps', { token: admin });
    assert.equal(estado.statusCode, 200);
    assert.equal(estado.json().base.area, 'monaco');
    assert.equal((await internal(app, 'GET', '/internal/admin/maps/catalog', { token: admin })).json().areas.length, 2);
    assert.equal((await internal(app, 'GET', '/internal/admin/maps/size?area=monaco', { token: admin })).json().bytesPbf, 700000);
    for (const url of ['/internal/admin/maps', '/internal/admin/maps/catalog', '/internal/admin/maps/size?area=monaco']) {
      assert.equal((await internal(app, 'GET', url, { token: comum })).statusCode, 403, url);
    }
  });

  test('baixar repassa ao serviço de mapas e fica na auditoria; área e mapa são conferidos', async () => {
    const ok = await internal(app, 'POST', '/internal/admin/maps', { token: admin, body: { map: 'encaixe', area: 'monaco' } });
    assert.equal(ok.statusCode, 202);
    assert.deepEqual(falso.pedidos.at(-1), { method: 'POST', url: '/trabalhos', body: { mapa: 'encaixe', area: 'monaco' } });
    const log = await pool.query(`SELECT action, target FROM audit_log WHERE action = 'mapa_pedido'`);
    assert.deepEqual(log.rows, [{ action: 'mapa_pedido', target: 'encaixe: monaco' }]);
    for (const body of [{ map: 'encaixe', area: '../etc' }, { map: 'outro', area: 'monaco' }, { map: 'base' }, { map: 'base', area: 'monaco', url: 'https://x' }]) {
      assert.equal((await internal(app, 'POST', '/internal/admin/maps', { token: admin, body })).statusCode, 400, JSON.stringify(body));
    }
    assert.equal((await internal(app, 'POST', '/internal/admin/maps', { token: comum, body: { map: 'base', area: 'monaco' } })).statusCode, 403);
  });

  test('um trabalho por vez; excluir fica na auditoria', async () => {
    falso.ocupar(true);
    const ocupado = await internal(app, 'POST', '/internal/admin/maps', { token: admin, body: { map: 'base', area: 'monaco' } });
    assert.equal(ocupado.statusCode, 409);
    assert.equal(ocupado.json().error, 'maps_busy');
    falso.ocupar(false);
    assert.equal((await internal(app, 'DELETE', '/internal/admin/maps/base', { token: admin })).statusCode, 200);
    assert.deepEqual(falso.pedidos.at(-1), { method: 'DELETE', url: '/mapas/base', body: null });
    assert.equal((await pool.query(`SELECT count(*)::int AS n FROM audit_log WHERE action = 'mapa_excluido' AND target = 'base'`)).rows[0].n, 1);
    assert.equal((await internal(app, 'DELETE', '/internal/admin/maps/outro', { token: admin })).statusCode, 400);
  });
});

describe('cliente do serviço de mapas', () => {
  test('sem endereço: desligado, e o encaixe fica por conta do OSRM_URL', async () => {
    const cliente = createMapsClient({ url: '' });
    assert.equal(cliente.enabled, false);
    assert.equal(await cliente.encaixeInstalado(), null);
    await assert.rejects(cliente.estado(), { code: 'maps_unconfigured' });
  });

  test('fora do ar não derruba nada: encaixe "não sei" (null) e erro maps_unavailable', async () => {
    const cliente = createMapsClient({ url: 'http://127.0.0.1:9', timeoutMs: 1000 });
    assert.equal(await cliente.encaixeInstalado(), null);
    await assert.rejects(cliente.estado(), { code: 'maps_unavailable' });
  });

  test('encaixe instalado ou não, pela situação do serviço', async () => {
    let instalado = false;
    const cliente = createMapsClient({
      url: 'http://mapas',
      fetchImpl: async () => new Response(JSON.stringify({ encaixe: { instalado } }), { status: 200 }),
    });
    assert.equal(await cliente.encaixeInstalado(), false);
    instalado = true;
    assert.equal(await cliente.encaixeInstalado(), false, 'guardado por 30 s');
    await cliente.comecar('encaixe', 'monaco');
    assert.equal(await cliente.encaixeInstalado(), true, 'baixar limpa o cache');
    await assert.rejects(cliente.comecar('outro', 'monaco'), { code: 'invalid_request' });
  });
});

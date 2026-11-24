import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

const maps = mkdtempSync(join(tmpdir(), 'mapas-tamanhos-'));
process.env.MAPS_DIR = maps;
process.env.OSRM_DIR = mkdtempSync(join(tmpdir(), 'osrm-tamanhos-'));
const hoje = new Date().toISOString();
const velho = new Date(Date.now() - 40 * 24 * 3600 * 1000).toISOString();
writeFileSync(join(maps, 'tamanhos.json'), JSON.stringify({ areas: {
  'brasil-go': { pbf: 200e6, pbfEm: hoje, base: 300e6, baseEm: hoje },
  sul: { pbf: 400e6, pbfEm: velho, base: 900e6, baseEm: velho },
} }));
const { consultar, precisa, iniciarFundo } = await import('../src/tamanhos.js');
// Endereços que nunca devem ser chamados nestes testes (sem rede)
const area = (id) => ({ id, nome: id, pbf: 'https://download.geofabrik.de/nada.osm.pbf' });

test('guardado e em dia: responde na hora, sem consultar nada', async () => {
  const t0 = Date.now();
  const t = await consultar(area('brasil-go'));
  assert.equal(t.pbf, 200e6);
  assert.equal(t.base, 300e6);
  assert.equal(t.baseCalculando, false);
  assert.ok(Date.now() - t0 < 200);
  assert.equal(precisa(area('brasil-go')), false);
});

test('guardado e velho: responde na hora com o antigo e só pede a atualização em segundo plano', async () => {
  const t0 = Date.now();
  const t = await consultar(area('sul'));
  assert.equal(t.base, 900e6);
  assert.ok(Date.now() - t0 < 200);
  assert.equal(precisa(area('sul')), true);
  assert.equal(precisa(area('nunca-visto')), true);
  // O laço de fundo não roda com o serviço ocupado
  const fundo = iniciarFundo({ ocupado: () => true, preferidas: async () => [area('sul')], intervaloMs: 3600000 });
  await fundo.passo();
  fundo.parar();
  assert.equal(JSON.parse(readFileSync(join(maps, 'tamanhos.json'), 'utf8')).areas.sul.baseEm, velho);
});

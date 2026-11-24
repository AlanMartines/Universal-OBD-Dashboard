import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

// Pastas temporárias antes de carregar os módulos (eles leem MAPS_DIR e OSRM_DIR ao carregar)
const maps = mkdtempSync(join(tmpdir(), 'mapas-medicao-'));
process.env.MAPS_DIR = maps;
process.env.OSRM_DIR = mkdtempSync(join(tmpdir(), 'osrm-medicao-'));
const hoje = new Date().toISOString().slice(0, 10);
// Medição completa e de hoje (todos os 27 estados), para o teste nunca disparar uma medição de verdade
const UFS = JSON.parse((await import('node:fs')).readFileSync(new URL('../src/ufs.json', import.meta.url), 'utf8')).estados;
const fracoes = Object.fromEntries(UFS.map((e) => [e.uf, 0.1]));
fracoes.GO = 0.4242;
writeFileSync(join(maps, 'ufs-fracoes.json'), JSON.stringify({ medidoEm: hoje, parcial: false, fracoes }));
const { medirSePreciso, medicaoDoServidor } = await import('../src/medicao.js');
const { normalizarIndice } = await import('../src/catalogo.js');

test('a medição mensal do servidor vale mais que a do projeto, com a data dela', () => {
  assert.equal(medicaoDoServidor().fracoes.GO, 0.4242);
  const areas = normalizarIndice({ features: [
    { properties: { id: 'brazil', name: 'Brazil', parent: 'south-america', urls: { pbf: 'https://download.geofabrik.de/south-america/brazil-latest.osm.pbf' } } },
    { properties: { id: 'centro-oeste', name: 'Centro-Oeste', parent: 'brazil', urls: { pbf: 'https://download.geofabrik.de/south-america/brazil/centro-oeste-latest.osm.pbf' } } },
  ] });
  const go = areas.find((a) => a.id === 'brasil-go');
  assert.equal(go.recorte.fracaoDados, 0.4242);
  assert.equal(go.recorte.medidoEm, hoje);
  assert.equal(areas.find((a) => a.id === 'brasil-mt').recorte.fracaoDados, 0.1);
});

test('não mede de novo com o serviço ocupado nem com medição de menos de 30 dias', async () => {
  const log = [];
  assert.equal(await medirSePreciso({ ocupado: () => true, log: (m) => log.push(m) }), false);
  assert.equal(await medirSePreciso({ ocupado: () => false, log: (m) => log.push(m) }), false);
  assert.deepEqual(log, []);
});

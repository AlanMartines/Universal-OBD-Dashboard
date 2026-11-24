import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
  PLANETA, bboxDoPoly, discoEstimadoEncaixe, enderecoPermitido, memoriaEstimada, normalizarIndice,
  polyUrl, ultimaVersaoProtomaps,
} from '../src/catalogo.js';

describe('catálogo de mapas', () => {
  test('só baixa dos servidores conhecidos, por https', () => {
    assert.equal(enderecoPermitido('https://download.geofabrik.de/europe/monaco-latest.osm.pbf'), true);
    assert.equal(enderecoPermitido('https://planet.openstreetmap.org/pbf/planet-latest.osm.pbf'), true);
    assert.equal(enderecoPermitido('http://download.geofabrik.de/x.pbf'), false);
    assert.equal(enderecoPermitido('https://exemplo.invalid/x.pbf'), false);
    assert.equal(enderecoPermitido('https://download.geofabrik.de.exemplo.invalid/x.pbf'), false);
    assert.equal(enderecoPermitido('nada'), false);
  });

  test('índice da Geofabrik vira lista com o planeta na raiz e descarta o que é suspeito', () => {
    const indice = {
      features: [
        { properties: { id: 'europe', name: 'Europe', urls: { pbf: 'https://download.geofabrik.de/europe-latest.osm.pbf' } } },
        { properties: { id: 'monaco', parent: 'europe', name: 'Monaco', urls: { pbf: 'https://download.geofabrik.de/europe/monaco-latest.osm.pbf' } } },
        { properties: { id: 'fora', name: 'Fora', urls: { pbf: 'https://exemplo.invalid/fora.pbf' } } },
        { properties: { id: '../x', name: 'Caminho', urls: { pbf: 'https://download.geofabrik.de/x-latest.osm.pbf' } } },
        { properties: { id: 'sem-pbf', name: 'Sem pbf', urls: {} } },
      ],
    };
    const areas = normalizarIndice(indice);
    assert.deepEqual(areas.map((a) => a.id), ['planeta', 'europe', 'monaco']);
    assert.equal(areas[0], PLANETA);
    assert.equal(areas[2].pai, 'europe');
    assert.deepEqual(normalizarIndice(null).map((a) => a.id), ['planeta']);
  });

  test('contorno da área: endereço do .poly e retângulo com margem', () => {
    assert.equal(polyUrl({ pbf: 'https://download.geofabrik.de/europe/monaco-latest.osm.pbf' }), 'https://download.geofabrik.de/europe/monaco.poly');
    const poly = 'monaco\n1\n   7.40 43.72\n   7.44 43.75\n   7.41 43.76\nEND\nEND\n';
    assert.deepEqual(bboxDoPoly(poly, 0.05), [7.35, 43.67, 7.49, 43.81]);
    assert.deepEqual(bboxDoPoly('   179.99 84.99\n  -179.99 -84.99\n', 0.05), [-180, -85, 180, 85]);
    assert.equal(bboxDoPoly('sem coordenadas\nEND\n'), null);
  });

  test('versão mais nova do mapa base e estimativas do encaixe', () => {
    assert.equal(ultimaVersaoProtomaps([{ key: '20251101.pmtiles' }, { key: '20251120.pmtiles' }, { key: 'x.txt' }]), '20251120.pmtiles');
    assert.equal(ultimaVersaoProtomaps(null), null);
    const brasil = 1.8 * 1024 ** 3;
    assert.ok(Math.abs(memoriaEstimada(brasil) / 1024 ** 3 - 9) < 0.01);
    assert.ok(Math.abs(discoEstimadoEncaixe(brasil) / 1024 ** 3 - 14.4) < 0.01);
    assert.equal(memoriaEstimada(null), null);
  });
});

test('estados do Brasil: filhos da região certa, baixam o arquivo dela e recortam pelo contorno', async () => {
  const { estadosDoBrasil, geojsonDoRecorte, normalizarIndice } = await import('../src/catalogo.js');
  const indice = { features: [
    { properties: { id: 'brazil', name: 'Brazil', parent: 'south-america', urls: { pbf: 'https://download.geofabrik.de/south-america/brazil-latest.osm.pbf' } } },
    { properties: { id: 'centro-oeste', name: 'Centro-Oeste', parent: 'brazil', urls: { pbf: 'https://download.geofabrik.de/south-america/brazil/centro-oeste-latest.osm.pbf' } } },
  ] };
  const areas = normalizarIndice(indice);
  assert.equal(areas.find((a) => a.id === 'brazil').nome, 'Brasil');
  const go = areas.find((a) => a.id === 'brasil-go');
  assert.equal(go.nome, 'Goiás');
  assert.equal(go.pai, 'centro-oeste');
  assert.equal(go.pbf, 'https://download.geofabrik.de/south-america/brazil/centro-oeste-latest.osm.pbf');
  assert.ok(go.recorte.fracao > 0.2 && go.recorte.fracao < 0.3, 'Goiás é cerca de 1/5 do Centro-Oeste');
  // Só os estados das regiões que estão no índice; ids no formato aceito pela API
  const ids = areas.filter((a) => a.recorte).map((a) => a.id).sort();
  assert.deepEqual(ids, ['brasil-df', 'brasil-go', 'brasil-ms', 'brasil-mt']);
  assert.ok(ids.every((id) => /^[a-z0-9-]{1,80}$/.test(id)));
  assert.equal(estadosDoBrasil([]).length, 0);
  const geo = JSON.parse(geojsonDoRecorte(go.recorte));
  assert.equal(geo.type, 'Feature');
  assert.ok(['Polygon', 'MultiPolygon'].includes(geo.geometry.type));
});

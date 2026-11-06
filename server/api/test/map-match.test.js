import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { cleanPoints, createMatcher, legsFromMatch, splitRuns } from '../src/map-match.js';

// Coordenadas fictícias, em linha reta, ~11 m por passo e um ponto a cada 2 s.
const T0 = Date.parse('2026-01-01T12:00:00Z');
const pt = (i, extra = {}) => ({ t: new Date(T0 + i * 2000).toISOString(), lat: -10 + i * 0.0001, lon: -50, speed: 20, ...extra });

describe('encaixe nas ruas', () => {
  test('tira posições imprecisas e saltos impossíveis', () => {
    const pts = [pt(0), pt(1, { accuracy: 80 }), pt(2), pt(3, { lat: -9 }), pt(4)];
    assert.deepEqual(cleanPoints(pts).map((p) => p.t), [pt(0).t, pt(2).t, pt(4).t]);
  });

  test('corta em buracos de tempo e em pedaços com a emenda repetida', () => {
    const run = Array.from({ length: 250 }, (_, i) => pt(i));
    const chunks = splitRuns(run, 60000);
    assert.deepEqual(chunks.map((c) => c.length), [100, 100, 52]);
    assert.equal(chunks[0][99], chunks[1][0]);
    const gap = [pt(0), pt(1), pt(100), pt(101)];
    assert.deepEqual(splitRuns(gap, 60000).map((c) => c.length), [2, 2]);
  });

  test('pernas do OSRM viram linhas pelas ruas; o que não encaixou fica reto', () => {
    const chunk = [pt(0), pt(1), pt(2), pt(3)];
    const step = (a, b) => ({ geometry: { coordinates: [[-50, a], [-50.00001, (a + b) / 2], [-50, b]] } });
    const body = {
      code: 'Ok',
      tracepoints: [
        { matchings_index: 0, waypoint_index: 0 },
        { matchings_index: 0, waypoint_index: 1 },
        { matchings_index: 0, waypoint_index: 2 },
        null,
      ],
      matchings: [{ legs: [{ steps: [step(-10, -9.9999)] }, { steps: [step(-9.9999, -9.9998)] }] }],
    };
    const legs = legsFromMatch(chunk, body);
    assert.equal(legs.length, 3);
    assert.equal(legs[0].coords.length, 3);
    assert.equal(legs[1].t, chunk[2].t);
    assert.equal(legs[2].raw, true);
    assert.deepEqual(legs[2].coords, [[chunk[2].lon, chunk[2].lat], [chunk[3].lon, chunk[3].lat]]);
  });

  test('resposta sem encaixe devolve o traço; OSRM fora do ar é erro', async () => {
    const pts = [pt(0), pt(1), pt(2)];
    const noMatch = createMatcher({ url: 'http://osrm.test', fetchImpl: async () => new Response(JSON.stringify({ code: 'NoMatch' }), { status: 400 }) });
    const legs = await noMatch.match(pts, 60000);
    assert.equal(legs.length, 2);
    assert.ok(legs.every((l) => l.raw));
    const down = createMatcher({ url: 'http://osrm.test', fetchImpl: async () => new Response('', { status: 503 }) });
    await assert.rejects(down.match(pts, 60000));
    assert.equal(createMatcher({ url: '' }).enabled, false);
  });
});

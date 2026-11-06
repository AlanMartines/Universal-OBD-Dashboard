/*
 * Encaixe do percurso nas ruas (map matching) pelo OSRM do próprio servidor.
 *
 * Só para desenhar: os pontos gravados não mudam, e distância e consumo continuam vindo da velocidade.
 * Devolve "pernas": o caminho pelas ruas entre duas posições seguidas, com a velocidade e a hora da
 * posição de chegada (para colorir como o traço bruto). Trecho que o OSRM não consegue encaixar
 * (estacionamento, rua nova, sinal ruim) volta como linha reta entre as posições, marcado "raw".
 */

/** O OSRM aceita até --max-matching-size posições por pedido; o compose sobe com 500. */
const CHUNK = 100;
const PARALLEL = 4;
/** Precisão pior que isso não ajuda a achar a rua: fica de fora. */
const MAX_ACCURACY_M = 30;
/** Salto mais rápido que isso entre duas posições é erro do GPS, não o carro. */
const MAX_JUMP_KMH = 250;

const rad = Math.PI / 180;
function meters(a, b) {
  const dx = (b.lon - a.lon) * rad * Math.cos(((a.lat + b.lat) / 2) * rad);
  const dy = (b.lat - a.lat) * rad;
  return Math.hypot(dx, dy) * 6371000;
}

/** Tira posições imprecisas e saltos impossíveis. */
export function cleanPoints(points) {
  const out = [];
  for (const p of points) {
    if (!Number.isFinite(p.lat) || !Number.isFinite(p.lon)) continue;
    if (p.accuracy != null && p.accuracy > MAX_ACCURACY_M) continue;
    const prev = out[out.length - 1];
    if (prev) {
      const dt = (new Date(p.t) - new Date(prev.t)) / 1000;
      if (dt <= 0) continue;
      if ((meters(prev, p) / dt) * 3.6 > MAX_JUMP_KMH) continue;
    }
    out.push(p);
  }
  return out;
}

/** Corta em trechos sem buraco de tempo e em pedaços de até CHUNK posições, repetindo a emenda. */
export function splitRuns(points, gapMs) {
  const runs = [];
  let run = [];
  for (const p of points) {
    const prev = run[run.length - 1];
    if (prev && new Date(p.t) - new Date(prev.t) > gapMs) {
      runs.push(run);
      run = [];
    }
    run.push(p);
  }
  if (run.length) runs.push(run);
  const chunks = [];
  for (const r of runs) {
    if (r.length < 2) continue;
    for (let i = 0; i < r.length - 1; i += CHUNK - 1) chunks.push(r.slice(i, i + CHUNK));
  }
  return chunks.filter((c) => c.length >= 2);
}

const rawLegs = (chunk) => chunk.slice(1).map((p, i) => ({
  t: p.t, speed: p.speed ?? null, raw: true, coords: [[chunk[i].lon, chunk[i].lat], [p.lon, p.lat]],
}));

const validCoord = (c) => Array.isArray(c) && c.length >= 2 && Number.isFinite(c[0]) && Number.isFinite(c[1])
  && Math.abs(c[0]) <= 180 && Math.abs(c[1]) <= 90;

/** Converte a resposta do /match em pernas; o que não encaixou vira linha reta. */
export function legsFromMatch(chunk, body) {
  if (!body || body.code !== 'Ok' || !Array.isArray(body.matchings) || !Array.isArray(body.tracepoints)) return rawLegs(chunk);
  // Para cada encaixe, as posições na ordem do caminho.
  const byMatching = new Map();
  body.tracepoints.forEach((tp, i) => {
    if (!tp || !Number.isInteger(tp.matchings_index) || !Number.isInteger(tp.waypoint_index)) return;
    if (!byMatching.has(tp.matchings_index)) byMatching.set(tp.matchings_index, []);
    byMatching.get(tp.matchings_index)[tp.waypoint_index] = i;
  });
  const legs = [];
  let lastMatched = null;
  const sorted = [...byMatching.keys()].sort((a, b) => a - b);
  for (const m of sorted) {
    const order = byMatching.get(m).filter((i) => i !== undefined);
    const matching = body.matchings[m];
    if (!matching || !Array.isArray(matching.legs)) continue;
    // Buraco entre um encaixe e o próximo (posições sem rua): liga em linha reta.
    if (lastMatched !== null && order.length) {
      legs.push(...rawLegs(chunk.slice(lastMatched, order[0] + 1)));
    }
    matching.legs.forEach((leg, j) => {
      const to = chunk[order[j + 1]];
      if (!to) return;
      const coords = (leg.steps || []).flatMap((s) => (s.geometry && Array.isArray(s.geometry.coordinates) ? s.geometry.coordinates : []))
        .filter(validCoord).map((c) => [c[0], c[1]]);
      if (coords.length < 2) {
        legs.push(...rawLegs([chunk[order[j]], to]));
        return;
      }
      legs.push({ t: to.t, speed: to.speed ?? null, coords });
    });
    if (order.length) lastMatched = order[order.length - 1];
  }
  if (!legs.length) return rawLegs(chunk);
  if (lastMatched !== null && lastMatched < chunk.length - 1) legs.push(...rawLegs(chunk.slice(lastMatched)));
  return legs;
}

/**
 * [url]: endereço do OSRM (vazio desliga). match() devolve as pernas, ou lança erro se o OSRM
 * não respondeu (o painel então mostra o traço bruto e avisa).
 */
export function createMatcher({ url, fetchImpl = fetch, timeoutMs = 5000 }) {
  const base = (url || '').replace(/\/+$/, '');
  async function matchChunk(chunk) {
    const coords = chunk.map((p) => `${p.lon.toFixed(6)},${p.lat.toFixed(6)}`).join(';');
    const query = new URLSearchParams({
      timestamps: chunk.map((p) => Math.floor(new Date(p.t).getTime() / 1000)).join(';'),
      radiuses: chunk.map((p) => String(Math.min(40, Math.max(10, Math.round((p.accuracy ?? 10) * 2))))).join(';'),
      steps: 'true',
      geometries: 'geojson',
      overview: 'false',
      gaps: 'split',
      tidy: 'false',
    });
    const res = await fetchImpl(`${base}/match/v1/driving/${coords}?${query}`, { signal: AbortSignal.timeout(timeoutMs) });
    // 400 com NoMatch/NoSegment é resposta válida ("não achei rua"), não falha do serviço.
    if (!res.ok && res.status !== 400) throw new Error(`osrm ${res.status}`);
    return legsFromMatch(chunk, await res.json().catch(() => null));
  }
  return {
    enabled: Boolean(base),
    async match(points, gapMs) {
      const chunks = splitRuns(cleanPoints(points), gapMs);
      const out = new Array(chunks.length);
      let next = 0;
      async function worker() {
        while (next < chunks.length) {
          const i = next;
          next += 1;
          out[i] = await matchChunk(chunks[i]);
        }
      }
      await Promise.all(Array.from({ length: Math.min(PARALLEL, chunks.length) }, worker));
      return out.flat();
    },
  };
}

/*
 * Catálogo das áreas de mapa, do mundo inteiro: o índice público da Geofabrik (continente → país →
 * região ou estado), mais o planeta inteiro. O painel escolhe só por esse catálogo, nunca por um
 * endereço digitado, e os downloads só saem para os servidores abaixo.
 */

import { readFileSync } from 'node:fs';

/**
 * Estados do Brasil: a Geofabrik só divide o Brasil em 5 regiões. Cada estado vira uma área filha da sua
 * região, recortada pelo contorno do IBGE (src/ufs.json, gerado por scripts/gerar-ufs.mjs).
 */
const UFS = JSON.parse(readFileSync(new URL('./ufs.json', import.meta.url), 'utf8')).estados;

/** Nomes em português onde a Geofabrik usa o inglês (o resto fica como vem do índice). */
const NOMES = { brazil: 'Brasil' };

/** Servidores de onde o contêiner pode baixar. Qualquer outro endereço é recusado. */
export const HOSTS = new Set([
  'download.geofabrik.de',
  'planet.openstreetmap.org',
  'build.protomaps.com',
  'build-metadata.protomaps.dev',
  'github.com',
  'codeload.github.com',
]);

export const INDICE_URL = 'https://download.geofabrik.de/index-v1-nogeom.json';

/** O planeta inteiro não está no índice da Geofabrik: vem do próprio OpenStreetMap. */
export const PLANETA = {
  id: 'planeta',
  nome: 'Planeta inteiro',
  pai: null,
  pbf: 'https://planet.openstreetmap.org/pbf/planet-latest.osm.pbf',
  bbox: [-180, -85, 180, 85],
};

/** Recusa endereço fora da lista de servidores (protege contra um índice adulterado). */
export function enderecoPermitido(url) {
  try {
    const u = new URL(url);
    return u.protocol === 'https:' && HOSTS.has(u.hostname);
  } catch {
    return false;
  }
}

/**
 * Índice da Geofabrik (GeoJSON sem geometria) → lista simples [{ id, nome, pai, pbf }], com o planeta
 * na raiz. Entradas sem .pbf ou com endereço fora da lista ficam de fora.
 */
export function normalizarIndice(indice) {
  const areas = [PLANETA];
  for (const f of indice?.features ?? []) {
    const p = f?.properties ?? {};
    const pbf = p.urls?.pbf;
    if (typeof p.id !== 'string' || !/^[a-z0-9-]+$/.test(p.id) || !pbf || !enderecoPermitido(pbf)) continue;
    areas.push({ id: p.id, nome: NOMES[p.id] ?? String(p.name ?? p.id), pai: typeof p.parent === 'string' ? p.parent : null, pbf });
  }
  return [...areas, ...estadosDoBrasil(areas)];
}

/**
 * Os estados de cada região do Brasil presente no índice: baixam o arquivo da região (pbf) e recortam o
 * estado (recorte). fracao é a parte da área da região, para estimar o tamanho depois do recorte.
 */
export function estadosDoBrasil(areas) {
  const regioes = new Map(areas.filter((a) => a.pai === 'brazil').map((a) => [a.id, a]));
  const total = {};
  for (const e of UFS) total[e.regiao] = (total[e.regiao] ?? 0) + e.areaKm2;
  return UFS.filter((e) => regioes.has(e.regiao)).map((e) => ({
    id: `brasil-${e.uf.toLowerCase()}`,
    nome: e.nome,
    pai: e.regiao,
    pbf: regioes.get(e.regiao).pbf,
    recorte: { uf: e.uf, bbox: e.bbox, geometria: e.geometria, fracao: e.areaKm2 / total[e.regiao] },
  }));
}

/** Contorno do recorte como GeoJSON (para o pmtiles e o osmium). */
export function geojsonDoRecorte(recorte) {
  return JSON.stringify({ type: 'Feature', properties: { uf: recorte.uf }, geometry: recorte.geometria });
}

/** Contorno (.poly) da área na Geofabrik: mesmo endereço do .pbf, com outro final. */
export function polyUrl(area) {
  return area.pbf.replace(/-latest\.osm\.pbf$/, '.poly');
}

/**
 * Retângulo [oeste, sul, leste, norte] de um arquivo .poly (formato do Osmosis): pares "lon lat" entre
 * as linhas de nome e os END. Uma pequena margem evita cortar ruas na divisa.
 */
export function bboxDoPoly(texto, margem = 0.05) {
  let oeste = Infinity; let sul = Infinity; let leste = -Infinity; let norte = -Infinity;
  for (const linha of String(texto).split(/\r?\n/)) {
    const partes = linha.trim().split(/\s+/);
    if (partes.length !== 2) continue;
    const lon = Number(partes[0]); const lat = Number(partes[1]);
    if (!Number.isFinite(lon) || !Number.isFinite(lat) || Math.abs(lon) > 180 || Math.abs(lat) > 90) continue;
    oeste = Math.min(oeste, lon); leste = Math.max(leste, lon);
    sul = Math.min(sul, lat); norte = Math.max(norte, lat);
  }
  if (!Number.isFinite(oeste)) return null;
  return [
    Math.max(-180, oeste - margem), Math.max(-85, sul - margem),
    Math.min(180, leste + margem), Math.min(85, norte + margem),
  ].map((v) => Math.round(v * 1e4) / 1e4);
}

/** Versão mais nova do mapa base do Protomaps (as chaves são datas, AAAAMMDD.pmtiles). */
export function ultimaVersaoProtomaps(builds) {
  const chaves = (Array.isArray(builds) ? builds : [])
    .map((b) => b?.key)
    .filter((k) => typeof k === 'string' && /^\d{8}\.pmtiles$/.test(k))
    .sort();
  return chaves.at(-1) ?? null;
}

/** Memória aproximada para o encaixe a partir do tamanho do .pbf (o Brasil, 1,8 GB, ocupa uns 9 GB). */
export function memoriaEstimada(bytesPbf) {
  return Number.isFinite(bytesPbf) && bytesPbf > 0 ? Math.round(bytesPbf * 5) : null;
}

/** Disco aproximado do encaixe processado (o Brasil, 1,8 GB, ocupa uns 13 GB). */
export function discoEstimadoEncaixe(bytesPbf) {
  return Number.isFinite(bytesPbf) && bytesPbf > 0 ? Math.round(bytesPbf * 8) : null;
}

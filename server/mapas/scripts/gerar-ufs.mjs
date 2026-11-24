/*
 * Gera src/ufs.json: contorno simplificado (malha "mínima" do IBGE), retângulo, área e região de cada um dos
 * 27 estados, para a página Mapas recortar um estado de dentro da região da Geofabrik. Rodar só quando o
 * IBGE mudar as malhas:  node scripts/gerar-ufs.mjs
 * Dados: IBGE, Malhas territoriais (API de serviços de dados), uso livre com crédito à fonte.
 */
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const API = 'https://servicodados.ibge.gov.br/api';
const REGIAO = { 'Centro-Oeste': 'centro-oeste', Nordeste: 'nordeste', Norte: 'norte', Sudeste: 'sudeste', Sul: 'sul' };
const arred = (v) => Math.round(v * 1e4) / 1e4;

/** Área aproximada em km² (projeção plana local, suficiente para comparar estados da mesma região). */
function areaKm2(geometria) {
  const poligonos = geometria.type === 'Polygon' ? [geometria.coordinates] : geometria.coordinates;
  let total = 0;
  for (const [externo, ...buracos] of poligonos) {
    const anel = (pts) => {
      const lat0 = pts.reduce((s, p) => s + p[1], 0) / pts.length * Math.PI / 180;
      let a = 0;
      for (let i = 0; i < pts.length - 1; i += 1) {
        const [x1, y1] = pts[i]; const [x2, y2] = pts[i + 1];
        a += (x1 * Math.cos(lat0)) * y2 - (x2 * Math.cos(lat0)) * y1;
      }
      return Math.abs(a / 2) * 111.32 * 110.57;
    };
    total += anel(externo) - buracos.reduce((s, b) => s + anel(b), 0);
  }
  return Math.round(total);
}

function retangulo(geometria) {
  const pts = (geometria.type === 'Polygon' ? [geometria.coordinates] : geometria.coordinates).flat(2);
  const xs = pts.map((p) => p[0]); const ys = pts.map((p) => p[1]);
  return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)].map(arred);
}

const estados = await (await fetch(`${API}/v1/localidades/estados?orderBy=nome`)).json();
const saida = [];
for (const e of estados) {
  const malha = await (await fetch(`${API}/v3/malhas/estados/${e.id}?formato=application/vnd.geo%2Bjson&qualidade=minima`)).json();
  const g = malha.features[0].geometry;
  const arredondar = (c) => (typeof c[0] === 'number' ? c.map(arred) : c.map(arredondar));
  const geometria = { type: g.type, coordinates: arredondar(g.coordinates) };
  saida.push({ uf: e.sigla, nome: e.nome, regiao: REGIAO[e.regiao.nome], bbox: retangulo(geometria), areaKm2: areaKm2(geometria), geometria });
}
const destino = join(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'ufs.json');
writeFileSync(destino, `${JSON.stringify({ fonte: 'IBGE, Malhas territoriais (qualidade mínima)', estados: saida })}\n`);
console.log(`${saida.length} estados → ${destino}`);

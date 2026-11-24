/*
 * API interna do contêiner "mapas": só a API do painel fala com ela, por uma rede interna do Compose
 * (sem porta publicada). Baixa, atualiza, exclui e informa os mapas; não tem acesso ao Docker.
 *
 *   GET    /saude                 vivo?
 *   GET    /estado                mapa base, encaixe, trabalho em andamento e disco livre
 *   GET    /catalogo              áreas do mundo inteiro (Geofabrik + planeta)
 *   GET    /tamanho?area=<id>     tamanho do arquivo da área e estimativas para o encaixe
 *   POST   /trabalhos             { mapa: 'base' | 'encaixe', area: '<id>' }
 *   DELETE /mapas/base | /mapas/encaixe
 */
import { createServer } from 'node:http';
import {
  INDICE_URL, PLANETA, discoEstimadoEncaixe, enderecoPermitido, memoriaEstimada, normalizarIndice,
} from './catalogo.js';
import {
  MAPS, OSRM, comecar, excluir, gravavel, limparSobras, ocupado, situacao,
} from './trabalhos.js';
import { consultar, iniciarFundo, tamanhoPbf } from './tamanhos.js';
import { medirSePreciso } from './medicao.js';

const PORTA = Number(process.env.MAPAS_PORT || 28473);
const UM_DIA = 24 * 3600 * 1000;

let catalogo = null;
let catalogoEm = 0;

async function carregarCatalogo() {
  if (catalogo && Date.now() - catalogoEm < UM_DIA) return catalogo;
  const res = await fetch(INDICE_URL);
  if (!res.ok) throw new Error(`catálogo indisponível (${res.status})`);
  catalogo = normalizarIndice(await res.json());
  catalogoEm = Date.now();
  return catalogo;
}

async function areaPorId(id) {
  if (id === PLANETA.id) return PLANETA;
  return (await carregarCatalogo()).find((a) => a.id === id) ?? null;
}

function responder(res, status, corpo) {
  const texto = JSON.stringify(corpo);
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'content-length': Buffer.byteLength(texto) });
  res.end(texto);
}

function lerCorpo(req) {
  return new Promise((resolve, reject) => {
    let dados = '';
    req.on('data', (pedaco) => {
      dados += pedaco;
      if (dados.length > 4096) { reject(Object.assign(new Error('corpo grande demais'), { status: 413 })); req.destroy(); }
    });
    req.on('end', () => {
      try { resolve(dados ? JSON.parse(dados) : {}); } catch { reject(Object.assign(new Error('JSON inválido'), { status: 400 })); }
    });
    req.on('error', reject);
  });
}

const ID = /^[a-z0-9-]{1,80}$/;

async function rotear(req, res) {
  const url = new URL(req.url, 'http://mapas');
  const caminho = url.pathname;
  if (req.method === 'GET' && caminho === '/saude') return responder(res, 200, { ok: true });
  if (req.method === 'GET' && caminho === '/estado') return responder(res, 200, await situacao());
  if (req.method === 'GET' && caminho === '/catalogo') {
    return responder(res, 200, { areas: (await carregarCatalogo()).map(({ id, nome, pai }) => ({ id, nome, pai })) });
  }
  if (req.method === 'GET' && caminho === '/tamanho') {
    const id = url.searchParams.get('area') ?? '';
    const area = ID.test(id) ? await areaPorId(id) : null;
    if (!area) return responder(res, 404, { error: 'area_not_found' });
    // Tamanhos guardados (30 dias) ou calculados na hora; o mapa base de área grande segue em segundo plano
    const t = await consultar(area);
    const bytes = t.pbf;
    // Estado: baixa o arquivo da região inteira; o encaixe pronto fica do tamanho da parte medida do estado
    // (fracaoDados, medição mensal). Sem a medida, a estimativa é o teto, o da região.
    const fracao = area.recorte ? area.recorte.fracaoDados : 1;
    const base = bytes && fracao ? Math.round(bytes * fracao) : bytes;
    return responder(res, 200, {
      area: area.id, nome: area.nome, bytesPbf: bytes, recorte: Boolean(area.recorte),
      estimado: Boolean(area.recorte && fracao), bytesEstado: area.recorte && fracao && bytes ? base : null,
      medidoEm: area.recorte?.medidoEm ?? null, guardadoEm: t.guardadoEm,
      memoriaEncaixe: memoriaEstimada(base), discoEncaixe: discoEstimadoEncaixe(base),
      bytesBase: t.base, baseCalculando: t.baseCalculando,
    });
  }
  if (req.method === 'POST' && caminho === '/trabalhos') {
    const { mapa, area: id } = await lerCorpo(req);
    if (!['base', 'encaixe'].includes(mapa) || typeof id !== 'string' || !ID.test(id)) return responder(res, 400, { error: 'invalid_request' });
    const area = await areaPorId(id);
    if (!area) return responder(res, 404, { error: 'area_not_found' });
    if (!(await gravavel(mapa === 'base' ? MAPS : OSRM))) {
      return responder(res, 403, { error: 'no_permission', message: 'sem permissão de escrita na pasta do mapa (chown -R 1000:1000 data/maps data/osrm)' });
    }
    const bytes = mapa === 'encaixe' ? await tamanhoPbf(area).catch(() => null) : null;
    comecar(mapa, area, bytes);
    return responder(res, 202, { ok: true });
  }
  const excluirMapa = caminho.match(/^\/mapas\/(base|encaixe)$/);
  if (req.method === 'DELETE' && excluirMapa) {
    if (!(await gravavel(excluirMapa[1] === 'base' ? MAPS : OSRM))) return responder(res, 403, { error: 'no_permission' });
    await excluir(excluirMapa[1]);
    return responder(res, 200, { ok: true });
  }
  return responder(res, 404, { error: 'not_found' });
}

await limparSobras().catch(() => {});

// Uma vez por mês, a fatia de dados de cada estado é medida de novo (só com o serviço livre). Confere 10 min
// depois de subir e depois a cada dia; ao terminar, o catálogo é refeito com as frações novas.
const conferirMedicao = () => medirSePreciso({ ocupado, log: (m) => console.log(`mapas: ${m}`) })
  .then((mediu) => { if (mediu) catalogo = null; })
  .catch(() => {});
setTimeout(conferirMedicao, 10 * 60 * 1000).unref();
setInterval(conferirMedicao, 24 * 3600 * 1000).unref();

// Tamanhos em segundo plano, com calma: uma área por minuto, começando 2 min depois de subir. O Brasil, as
// regiões e os estados ficam sempre calculados; o resto, conforme alguém consulta.
const preferidas = async () => (await carregarCatalogo())
  .filter((a) => a.id === 'brazil' || a.pai === 'brazil' || a.id.startsWith('brasil-'));
setTimeout(() => iniciarFundo({ ocupado, preferidas, log: (m) => console.log(`mapas: ${m}`) }), 2 * 60 * 1000).unref();
createServer((req, res) => {
  rotear(req, res).catch((erro) => {
    const status = erro.status ?? 500;
    responder(res, status, { error: status === 409 ? 'busy' : status >= 500 ? 'internal_error' : 'invalid_request', message: erro.message });
  });
}).listen(PORTA, '0.0.0.0', () => console.log(`mapas: ouvindo na porta ${PORTA}`));

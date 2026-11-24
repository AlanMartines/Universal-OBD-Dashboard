/*
 * Tamanhos guardados de cada área (mapa base e download do encaixe), para a página Mapas responder na hora.
 * Ficam num arquivo da pasta dos mapas, que sobrevive às atualizações do contêiner (o serviço não tem acesso
 * ao banco, de propósito). Valem 30 dias:
 *   - guardado e em dia: responde com ele;
 *   - guardado e velho: responde com ele mesmo e atualiza em segundo plano, com calma;
 *   - nunca consultado: calcula na hora (o download é rápido; o mapa base, de segundos a 1 min) e guarda.
 * Em segundo plano, uma área por minuto e só com o serviço livre, o Brasil, as regiões e os estados ficam
 * sempre calculados; o resto do mundo entra no guardado conforme alguém consulta.
 */
import { readFileSync } from 'node:fs';
import { rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { enderecoPermitido } from './catalogo.js';
import { simularBase } from './trabalhos.js';

const MAPS = process.env.MAPS_DIR || '/maps';
export const ARQUIVO = join(MAPS, 'tamanhos.json');
export const VALIDADE_MS = 30 * 24 * 3600 * 1000;

let guardados = {};
try { guardados = JSON.parse(readFileSync(ARQUIVO, 'utf8')).areas ?? {}; } catch { guardados = {}; }

let gravando = null;
let pendenteGravar = false;
/** Grava o arquivo (troca atômica), juntando várias mudanças seguidas numa gravação só. */
function gravar() {
  pendenteGravar = true;
  if (gravando) return gravando;
  gravando = (async () => {
    while (pendenteGravar) {
      pendenteGravar = false;
      const tmp = `${ARQUIVO}.tmp`;
      await writeFile(tmp, `${JSON.stringify({ areas: guardados })}\n`);
      await rename(tmp, ARQUIVO);
    }
  })().catch(() => {}).finally(() => { gravando = null; });
  return gravando;
}

function guardar(id, campos) {
  guardados[id] = { ...(guardados[id] ?? {}), ...campos };
  return gravar();
}

const velho = (em) => !em || Date.now() - new Date(em).getTime() > VALIDADE_MS;
const agora = () => new Date().toISOString();

/** Tamanho do arquivo .pbf da área (só o cabeçalho, sem baixar). */
export async function tamanhoPbf(area) {
  if (!enderecoPermitido(area.pbf)) return null;
  const res = await fetch(area.pbf, { method: 'HEAD', redirect: 'follow', signal: AbortSignal.timeout(15000) });
  const bytes = Number(res.headers.get('content-length'));
  return res.ok && bytes > 0 ? bytes : null;
}

const baseEmCurso = new Map();
/** Simula o mapa base e guarda; uma simulação por área de cada vez. */
function calcularBase(area) {
  if (!baseEmCurso.has(area.id)) {
    baseEmCurso.set(area.id, simularBase(area)
      .then(async (bytes) => { if (bytes) await guardar(area.id, { base: bytes, baseEm: agora() }); return bytes; })
      .catch(() => null)
      .finally(() => baseEmCurso.delete(area.id)));
  }
  return baseEmCurso.get(area.id);
}

async function calcularPbf(area) {
  const bytes = await tamanhoPbf(area).catch(() => null);
  if (bytes) await guardar(area.id, { pbf: bytes, pbfEm: agora() });
  return bytes;
}

/* Fila de atualização em segundo plano (áreas consultadas com valor velho). */
const fila = new Map();
const pedirAtualizacao = (area) => { fila.set(area.id, area); };

/**
 * Tamanhos de uma área para a página: { pbf, base, baseCalculando, guardadoEm }. Nunca faz a página esperar
 * mais que [esperarMs] pelo mapa base: se a simulação não terminou, devolve baseCalculando e ela segue.
 */
export async function consultar(area, { esperarMs = 5000 } = {}) {
  const g = guardados[area.id] ?? {};
  let { pbf = null, base = null } = g;
  let baseCalculando = false;
  if (pbf == null) pbf = await calcularPbf(area);
  else if (velho(g.pbfEm)) pedirAtualizacao(area);
  if (area.id !== 'planeta') {
    if (base == null) {
      const r = await Promise.race([calcularBase(area), new Promise((ok) => { setTimeout(() => ok('calculando'), esperarMs).unref(); })]);
      if (r === 'calculando') baseCalculando = true; else base = r;
    } else if (velho(g.baseEm)) {
      pedirAtualizacao(area);
    }
  }
  return { pbf, base, baseCalculando, guardadoEm: guardados[area.id]?.baseEm ?? guardados[area.id]?.pbfEm ?? null };
}

/** Uma área precisa de cálculo (nunca calculada ou com mais de 30 dias)? */
export function precisa(area) {
  const g = guardados[area.id];
  if (!g) return true;
  return velho(g.pbfEm) || (area.id !== 'planeta' && velho(g.baseEm));
}

/**
 * Laço calmo em segundo plano: a cada [intervaloMs], com o serviço livre, atualiza uma área (primeiro as
 * consultadas com valor velho, depois as preferidas: Brasil, regiões e estados).
 */
export function iniciarFundo({ ocupado, preferidas, intervaloMs = 60000, log = () => {} }) {
  let trabalhando = false;
  const passo = async () => {
    if (trabalhando || ocupado()) return;
    let area = fila.values().next().value ?? null;
    if (area) fila.delete(area.id);
    else area = (await preferidas().catch(() => [])).find(precisa) ?? null;
    if (!area) return;
    trabalhando = true;
    try {
      await calcularPbf(area);
      await calcularBase(area);
      log(`tamanho guardado: ${area.nome}`);
    } finally {
      trabalhando = false;
    }
  };
  const timer = setInterval(() => { passo().catch(() => {}); }, intervaloMs);
  timer.unref();
  return { passo, parar: () => clearInterval(timer) };
}

/** Só para os testes: o que está guardado agora. */
export const guardadosAgora = () => guardados;

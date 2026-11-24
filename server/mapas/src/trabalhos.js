/*
 * Trabalhos de mapa, um por vez: baixar e recortar o mapa base (pmtiles), baixar e processar o encaixe
 * nas ruas (OSRM), excluir e informar a situação. Tudo dentro das duas pastas montadas: /maps (mapa
 * base, lido pela web) e /osrm (encaixe, lido pelo contêiner osrm). Sem acesso ao Docker.
 *
 * Troca sem parar nada: o arquivo novo é gravado ao lado e só no fim toma o lugar do antigo. No encaixe,
 * cada versão fica numa pasta própria e o arquivo "ativo" diz qual usar; o vigia do contêiner osrm
 * percebe a troca e recarrega.
 */
import { spawn } from 'node:child_process';
import { createWriteStream, existsSync } from 'node:fs';
import { constants } from 'node:fs';
import { access, chmod, mkdir, readdir, readFile, rename, rm, stat, statfs, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { lerProgresso, textoProgresso } from './progresso.js';
import {
  bboxDoPoly, discoEstimadoEncaixe, enderecoPermitido, geojsonDoRecorte, memoriaEstimada, polyUrl, ultimaVersaoProtomaps,
} from './catalogo.js';

export const MAPS = process.env.MAPS_DIR || '/maps';
export const OSRM = process.env.OSRM_DIR || '/osrm';
const ZOOM_MAX = Number(process.env.MAP_MAXZOOM || 15);
const GB = 1024 ** 3;

/** Trabalho em andamento (ou o último, com o resultado), para o painel acompanhar. */
let atual = null;
const registro = [];
const anotar = (linha) => {
  const texto = String(linha).trim();
  if (!texto) return;
  registro.push(texto.slice(0, 300));
  if (registro.length > 40) registro.shift();
};

export function trabalhoAtual() {
  return atual ? { ...atual, registro: registro.slice(-8) } : null;
}
export const ocupado = () => Boolean(atual && !atual.fim);

async function baixar(url, destino, aoAvancar) {
  if (!enderecoPermitido(url)) throw new Error(`endereço fora da lista permitida: ${url}`);
  const res = await fetch(url, { redirect: 'follow' });
  if (!enderecoPermitido(res.url)) throw new Error(`redirecionado para fora da lista permitida: ${res.url}`);
  if (!res.ok || !res.body) throw new Error(`download recusado (${res.status}): ${url}`);
  const total = Number(res.headers.get('content-length')) || null;
  let feito = 0;
  const contador = new Transform({
    transform(pedaco, _enc, cb) {
      feito += pedaco.length;
      if (aoAvancar) aoAvancar(feito, total);
      cb(null, pedaco);
    },
  });
  await pipeline(Readable.fromWeb(res.body), contador, createWriteStream(destino));
  return feito;
}

async function textoDe(url) {
  if (!enderecoPermitido(url)) throw new Error(`endereço fora da lista permitida: ${url}`);
  const res = await fetch(url, { redirect: 'follow' });
  if (!res.ok || !enderecoPermitido(res.url)) throw new Error(`falha ao ler ${url} (${res.status})`);
  return res.text();
}

/**
 * Roda uma ferramenta, guardando as últimas linhas da saída para mostrar se falhar. Com [progresso], as
 * linhas de barra em texto (pmtiles) vão para ela, e não para o registro.
 */
function rodar(cmd, args, { cwd, entrada, progresso } = {}) {
  return new Promise((resolve, reject) => {
    anotar(`$ ${cmd} ${args.join(' ')}`);
    const filho = spawn(cmd, args, { cwd, stdio: [entrada ? 'pipe' : 'ignore', 'pipe', 'pipe'] });
    const linha = (texto) => {
      const p = progresso ? lerProgresso(texto) : null;
      if (p) progresso(p); else anotar(texto);
    };
    const ler = (fluxo) => fluxo.on('data', (d) => String(d).split(/[\r\n]+/).forEach(linha));
    ler(filho.stdout);
    ler(filho.stderr);
    if (entrada) entrada(filho.stdin).catch(reject);
    filho.on('error', reject);
    filho.on('close', (codigo) => (codigo === 0 ? resolve() : reject(new Error(`${cmd} terminou com código ${codigo}`))));
  });
}

async function livre(pasta) {
  const s = await statfs(pasta);
  return s.bavail * s.bsize;
}

async function tamanhoDaPasta(pasta) {
  if (!existsSync(pasta)) return 0;
  let total = 0;
  for (const nome of await readdir(pasta, { withFileTypes: true })) {
    const caminho = join(pasta, nome.name);
    total += nome.isDirectory() ? await tamanhoDaPasta(caminho) : (await stat(caminho)).size;
  }
  return total;
}

async function lerJson(caminho) {
  try { return JSON.parse(await readFile(caminho, 'utf8')); } catch { return null; }
}

async function gravarJson(caminho, dados) {
  await writeFile(`${caminho}.tmp`, JSON.stringify(dados, null, 2));
  await rename(`${caminho}.tmp`, caminho);
}

/* ------------------------------------------------------------------ Situação */

/** O contêiner roda sem privilégio: as pastas precisam ser graváveis pelo usuário dele (uid 1000). */
export async function gravavel(pasta) {
  try { await access(pasta, constants.W_OK); return true; } catch { return false; }
}


export async function situacao() {
  const baseArq = existsSync(join(MAPS, 'base.pmtiles')) ? 'base.pmtiles' : existsSync(join(MAPS, 'brasil.pmtiles')) ? 'brasil.pmtiles' : null;
  const baseInfo = await lerJson(join(MAPS, 'base.json'));
  const base = baseArq ? {
    instalado: true,
    area: baseInfo?.area ?? null,
    nome: baseInfo?.nome ?? (baseArq === 'brasil.pmtiles' ? 'Brasil (instalado pelo script)' : 'Área desconhecida'),
    bytes: (await stat(join(MAPS, baseArq))).size,
    atualizado: baseInfo?.atualizado ?? (await stat(join(MAPS, baseArq))).mtime.toISOString(),
  } : { instalado: false };

  let encaixe = { instalado: false };
  const ativo = existsSync(join(OSRM, 'ativo')) ? (await readFile(join(OSRM, 'ativo'), 'utf8')).trim() : null;
  if (ativo && /^v\d+$/.test(ativo) && existsSync(join(OSRM, ativo))) {
    const info = await lerJson(join(OSRM, ativo, 'info.json'));
    encaixe = {
      instalado: true, area: info?.area ?? null, nome: info?.nome ?? 'Área desconhecida',
      bytes: await tamanhoDaPasta(join(OSRM, ativo)), memoria: info?.memoria ?? null, atualizado: info?.atualizado ?? null,
    };
  } else if (existsSync(join(OSRM, 'regiao.osrm.mldgr'))) {
    const nomes = (await readdir(OSRM)).filter((n) => n.startsWith('regiao.osrm'));
    let bytes = 0;
    for (const n of nomes) bytes += (await stat(join(OSRM, n))).size;
    encaixe = { instalado: true, area: null, nome: 'Instalado pelo script', bytes, memoria: null, atualizado: null };
  }
  return {
    base, encaixe, trabalho: trabalhoAtual(),
    gravavel: { mapas: await gravavel(MAPS), encaixe: await gravavel(OSRM) },
    disco: { mapas: await livre(MAPS).catch(() => null), encaixe: await livre(OSRM).catch(() => null) },
  };
}

/* ------------------------------------------------------------------ Limpeza na partida */

/** Sobras de um trabalho interrompido (o contêiner parou no meio). */
export async function limparSobras() {
  await rm(join(MAPS, 'base.tmp.pmtiles'), { force: true });
  await rm(join(MAPS, 'assets.tmp'), { recursive: true, force: true });
  await rm(join(OSRM, 'trabalho'), { recursive: true, force: true });
}

/* ------------------------------------------------------------------ Mapa base */

async function trabalhoBase(area) {
  atual.fase = 'Calculando a área';
  const bbox = area.recorte?.bbox ?? area.bbox ?? bboxDoPoly(await textoDe(polyUrl(area)));
  if (!bbox) throw new Error('não foi possível calcular a área do mapa');
  if (await livre(MAPS) < 2 * GB) throw new Error('menos de 2 GB livres na pasta dos mapas');

  atual.fase = 'Procurando a versão mais nova do mapa';
  const builds = JSON.parse(await textoDe('https://build-metadata.protomaps.dev/builds.json'));
  const versao = ultimaVersaoProtomaps(builds);
  if (!versao) throw new Error('não foi possível descobrir a versão mais nova do mapa');

  atual.fase = 'Recortando o mapa base (pode levar bastante tempo)';
  const tmp = join(MAPS, 'base.tmp.pmtiles');
  // Estado: recorta pelo contorno; o resto, pelo retângulo da área
  let limite = `--bbox=${bbox.join(',')}`;
  if (area.recorte) {
    const contorno = join(tmpdir(), 'recorte-base.geojson');
    await writeFile(contorno, geojsonDoRecorte(area.recorte));
    limite = `--region=${contorno}`;
  }
  await rodar('pmtiles', ['extract', `https://build.protomaps.com/${versao}`, tmp, limite, `--maxzoom=${ZOOM_MAX}`], {
    // A barra do painel segue o pmtiles, como no encaixe: percentual, tamanho, velocidade e quanto falta
    progresso: (p) => {
      atual.progresso = p.pct / 100;
      atual.fase = `Recortando o mapa base: ${textoProgresso(p)}`;
    },
  });
  atual.progresso = null;

  atual.fase = 'Baixando fontes e ícones do mapa';
  const assetsTmp = join(MAPS, 'assets.tmp');
  await rm(assetsTmp, { recursive: true, force: true });
  await mkdir(assetsTmp, { recursive: true });
  await rodar('tar', ['-xzf', '-', '-C', assetsTmp, '--strip-components=1', 'basemaps-assets-main/fonts', 'basemaps-assets-main/sprites'], {
    entrada: async (stdin) => {
      const url = 'https://github.com/protomaps/basemaps-assets/archive/refs/heads/main.tar.gz';
      const res = await fetch(url, { redirect: 'follow' });
      if (!res.ok || !res.body || !enderecoPermitido(res.url)) throw new Error('falha ao baixar fontes e ícones');
      await pipeline(Readable.fromWeb(res.body), stdin);
    },
  });

  atual.fase = 'Trocando o mapa base';
  await rm(join(MAPS, 'assets.old'), { recursive: true, force: true });
  if (existsSync(join(MAPS, 'assets'))) await rename(join(MAPS, 'assets'), join(MAPS, 'assets.old'));
  await rename(assetsTmp, join(MAPS, 'assets'));
  await rm(join(MAPS, 'assets.old'), { recursive: true, force: true });
  await rename(tmp, join(MAPS, 'base.pmtiles'));
  await rm(join(MAPS, 'brasil.pmtiles'), { force: true });   // o do script antigo, substituído
  await gravarJson(join(MAPS, 'base.json'), {
    area: area.id, nome: area.nome, bbox, versao, atualizado: new Date().toISOString(),
  });
}

/* ------------------------------------------------------------------ Encaixe nas ruas */

async function trabalhoEncaixe(area, bytesPbf) {
  const precisa = (discoEstimadoEncaixe(bytesPbf) ?? 0) + bytesPbf + GB;
  if (bytesPbf && await livre(OSRM) < precisa) {
    throw new Error(`espaço insuficiente: são precisos uns ${(precisa / GB).toFixed(1)} GB livres na pasta do encaixe`);
  }
  const trabalho = join(OSRM, 'trabalho');
  await rm(trabalho, { recursive: true, force: true });
  await mkdir(trabalho, { recursive: true });

  atual.fase = area.recorte ? 'Baixando as ruas da região' : 'Baixando as ruas';
  const baixado = join(trabalho, area.recorte ? 'regiao-inteira.osm.pbf' : 'regiao.osm.pbf');
  await baixar(area.pbf, baixado, (feito, total) => {
    atual.progresso = total ? Math.min(1, feito / total) : null;
  });
  atual.progresso = null;
  if (area.recorte) {
    // Estado: recorta da região pelo contorno do IBGE; as ruas que cruzam a divisa ficam inteiras
    atual.fase = `Recortando o estado (${area.recorte.uf})`;
    await writeFile(join(trabalho, 'recorte.geojson'), geojsonDoRecorte(area.recorte));
    await rodar('osmium', ['extract', '-p', 'recorte.geojson', '-s', 'smart', '-o', 'regiao.osm.pbf', '--overwrite', 'regiao-inteira.osm.pbf'], { cwd: trabalho });
    await rm(baixado, { force: true });
    await rm(join(trabalho, 'recorte.geojson'), { force: true });
    // A partir daqui, o tamanho que conta é o do estado recortado (memória do encaixe pronto)
    bytesPbf = (await stat(join(trabalho, 'regiao.osm.pbf'))).size;
  }

  atual.fase = 'Processando as ruas (1 de 3)';
  await rodar('osrm-extract', ['-p', '/opt/car.lua', 'regiao.osm.pbf'], { cwd: trabalho });
  atual.fase = 'Processando as ruas (2 de 3)';
  await rodar('osrm-partition', ['regiao.osrm'], { cwd: trabalho });
  atual.fase = 'Processando as ruas (3 de 3)';
  await rodar('osrm-customize', ['regiao.osrm'], { cwd: trabalho });
  await rm(join(trabalho, 'regiao.osm.pbf'), { force: true });
  // O OSRM v26 grava alguns arquivos (o .fileIndex) só para o dono; o contêiner osrm roda sem
  // capacidades e com outro usuário, então todos precisam ficar legíveis.
  for (const nome of await readdir(trabalho)) await chmod(join(trabalho, nome), 0o644);

  atual.fase = 'Trocando o encaixe';
  const versao = `v${Date.now()}`;
  await rename(trabalho, join(OSRM, versao));
  await gravarJson(join(OSRM, versao, 'info.json'), {
    area: area.id, nome: area.nome, bytesPbf, memoria: memoriaEstimada(bytesPbf), atualizado: new Date().toISOString(),
  });
  await writeFile(join(OSRM, 'ativo.tmp'), versao);
  await rename(join(OSRM, 'ativo.tmp'), join(OSRM, 'ativo'));
  // O OSRM carrega o mapa na memória: apagar a versão antiga não atrapalha o que ainda está no ar.
  for (const nome of await readdir(OSRM)) {
    if ((/^v\d+$/.test(nome) && nome !== versao) || nome.startsWith('regiao.osrm')) {
      await rm(join(OSRM, nome), { recursive: true, force: true });
    }
  }
}

/* ------------------------------------------------------------------ Entrada */

/** Começa um trabalho em segundo plano. [mapa]: 'base' ou 'encaixe'; [area]: do catálogo. */
export function comecar(mapa, area, bytesPbf = null) {
  if (ocupado()) throw Object.assign(new Error('já há um trabalho de mapa em andamento'), { status: 409 });
  registro.length = 0;
  atual = { mapa, area: area.id, nome: area.nome, fase: 'Começando', progresso: null, inicio: new Date().toISOString(), fim: null, erro: null };
  const tarefa = mapa === 'base' ? trabalhoBase(area) : trabalhoEncaixe(area, bytesPbf);
  tarefa
    .then(() => { atual.fase = 'Concluído'; })
    .catch(async (erro) => {
      atual.erro = erro.message;
      anotar(`erro: ${erro.message}`);
      await limparSobras().catch(() => {});
    })
    .finally(() => { atual.fim = new Date().toISOString(); atual.progresso = null; });
}

/** Exclui um mapa. Recusa enquanto um trabalho do mesmo mapa estiver rodando. */
export async function excluir(mapa) {
  if (ocupado() && atual.mapa === mapa) throw Object.assign(new Error('há um trabalho deste mapa em andamento'), { status: 409 });
  if (mapa === 'base') {
    for (const nome of ['base.pmtiles', 'brasil.pmtiles', 'base.json']) await rm(join(MAPS, nome), { force: true });
    await rm(join(MAPS, 'assets'), { recursive: true, force: true });
  } else {
    await rm(join(OSRM, 'ativo'), { force: true });
    for (const nome of await readdir(OSRM)) {
      if (/^v\d+$/.test(nome) || nome.startsWith('regiao.osrm')) await rm(join(OSRM, nome), { recursive: true, force: true });
    }
  }
}

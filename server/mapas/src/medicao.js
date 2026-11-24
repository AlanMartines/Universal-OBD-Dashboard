/*
 * Fatia de dados de cada estado dentro da sua região da Geofabrik: baixa as 5 regiões do Brasil e recorta
 * cada estado com o osmium, como o encaixe faz. A página Mapas usa essa fatia para estimar o encaixe de um
 * estado. Medida uma vez no projeto (scripts/medir-ufs.mjs, em src/ufs.json) e de novo, sozinha, uma vez por
 * mês no servidor (arquivo na pasta dos mapas, que sobrevive às atualizações do contêiner).
 */
import { execFileSync } from 'node:child_process';
import { createWriteStream, existsSync, readFileSync } from 'node:fs';
import { mkdir, readFile, rename, rm, stat, statfs, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

const UFS = JSON.parse(readFileSync(new URL('./ufs.json', import.meta.url), 'utf8'));
const MAPS = process.env.MAPS_DIR || '/maps';
const OSRM = process.env.OSRM_DIR || '/osrm';
/** Medição do servidor: { medidoEm, fracoes: { GO: 0.31, … } }. */
export const ARQUIVO = join(MAPS, 'ufs-fracoes.json');
const MES = 30 * 24 * 3600 * 1000;
const GB = 1024 ** 3;

let rodando = false;

/** Baixa com até 3 tentativas: a Geofabrik às vezes fecha a conexão no meio de um arquivo grande. */
async function baixar(url, destino, log) {
  for (let tentativa = 1; ; tentativa += 1) {
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`${url}: ${res.status}`);
      await pipeline(Readable.fromWeb(res.body), createWriteStream(destino));
      return;
    } catch (erro) {
      if (tentativa >= 3) throw erro;
      log(`download caiu (${erro.message}); tentando de novo`);
      await new Promise((r) => { setTimeout(r, 5000 * tentativa); });
    }
  }
}

/**
 * Mede todos os estados. [ja] traz frações medidas antes (retomar depois de uma queda); [aoTerminarRegiao]
 * recebe as frações a cada região, para gravar aos poucos. Devolve { UF: fração }.
 */
export async function medirEstados({ trabalho, ja = {}, aoTerminarRegiao = async () => {}, log = () => {} }) {
  await mkdir(trabalho, { recursive: true });
  const fracoes = { ...ja };
  for (const regiao of [...new Set(UFS.estados.map((e) => e.regiao))]) {
    const estados = UFS.estados.filter((e) => e.regiao === regiao);
    if (estados.every((e) => typeof fracoes[e.uf] === 'number')) continue;
    const pbf = join(trabalho, `${regiao}.osm.pbf`);
    log(`baixando ${regiao}`);
    await baixar(`https://download.geofabrik.de/south-america/brazil/${regiao}-latest.osm.pbf`, pbf, log);
    const total = (await stat(pbf)).size;
    for (const e of estados) {
      const contorno = join(trabalho, `${e.uf}.geojson`);
      const saida = join(trabalho, `${e.uf}.osm.pbf`);
      await writeFile(contorno, JSON.stringify({ type: 'Feature', properties: {}, geometry: e.geometria }));
      execFileSync('osmium', ['extract', '-p', contorno, '-s', 'smart', '-o', saida, '--overwrite', pbf], { stdio: 'ignore' });
      fracoes[e.uf] = Math.round(((await stat(saida)).size / total) * 1e4) / 1e4;
      await rm(saida, { force: true });
      await rm(contorno, { force: true });
    }
    await rm(pbf, { force: true });
    await aoTerminarRegiao(fracoes);
  }
  return fracoes;
}

/** Medição do servidor, se houver: { medidoEm, fracoes }. */
export function medicaoDoServidor() {
  try {
    const d = JSON.parse(readFileSync(ARQUIVO, 'utf8'));
    return d && typeof d.fracoes === 'object' ? d : null;
  } catch {
    return null;
  }
}

/**
 * Mede de novo se a última medição (do servidor ou do projeto) tem mais de 30 dias. Só com o serviço livre
 * ([ocupado] falso) e com 3 GB livres na pasta do encaixe, onde ficam os arquivos temporários.
 */
export async function medirSePreciso({ ocupado, log = console.log }) {
  if (rodando || ocupado()) return false;
  const servidor = medicaoDoServidor();
  const ultima = servidor?.medidoEm ?? UFS.medidoEm;
  // Algum estado sem medida (nem do servidor, nem do projeto): mede já, sem esperar o mês
  const falta = UFS.estados.some((e) => typeof servidor?.fracoes?.[e.uf] !== 'number' && typeof e.fracaoDados !== 'number');
  if (!falta && ultima && Date.now() - new Date(ultima).getTime() < MES) return false;
  const livre = await statfs(OSRM).then((s) => s.bavail * s.bsize).catch(() => 0);
  if (livre < 3 * GB) { log('medição dos estados adiada: menos de 3 GB livres'); return false; }
  rodando = true;
  const trabalho = join(OSRM, 'medicao');
  const parcial = existsSync(ARQUIVO) ? JSON.parse(await readFile(ARQUIVO, 'utf8').catch(() => '{}')) : {};
  const ja = parcial.parcial ? parcial.fracoes ?? {} : {};
  const gravar = async (fracoes, final) => {
    const tmp = `${ARQUIVO}.tmp`;
    await writeFile(tmp, `${JSON.stringify({ medidoEm: final ? new Date().toISOString().slice(0, 10) : (parcial.medidoEm ?? null), parcial: !final, fracoes })}\n`);
    await rename(tmp, ARQUIVO);
  };
  try {
    log('medição mensal dos estados: começando');
    const fracoes = await medirEstados({ trabalho, ja, aoTerminarRegiao: (f) => gravar(f, false), log: (m) => log(`medição: ${m}`) });
    await gravar(fracoes, true);
    log('medição mensal dos estados: concluída');
    return true;
  } catch (erro) {
    log(`medição mensal dos estados falhou: ${erro.message}`);
    return false;
  } finally {
    await rm(trabalho, { recursive: true, force: true });
    rodando = false;
  }
}

export const medindo = () => rodando;

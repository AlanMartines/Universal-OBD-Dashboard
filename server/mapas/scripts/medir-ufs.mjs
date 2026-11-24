/*
 * Mede a fatia de dados de cada estado dentro da sua região (fracaoDados em src/ufs.json), o ponto de partida
 * que vai no projeto. O servidor mede de novo sozinho uma vez por mês (src/medicao.js). Roda dentro da imagem
 * do contêiner mapas, que tem o osmium:
 *   docker run --rm -u 0 -v "$PWD:/m" -v /tmp/medir:/w --entrypoint node obd-mapas /m/scripts/medir-ufs.mjs /w
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { medirEstados } from '../src/medicao.js';

const arquivo = new URL('../src/ufs.json', import.meta.url);
const dados = JSON.parse(readFileSync(arquivo, 'utf8'));
const ja = Object.fromEntries(dados.estados.filter((e) => typeof e.fracaoDados === 'number').map((e) => [e.uf, e.fracaoDados]));
const gravar = (fracoes) => {
  for (const e of dados.estados) if (typeof fracoes[e.uf] === 'number') e.fracaoDados = fracoes[e.uf];
  dados.medidoEm = new Date().toISOString().slice(0, 10);
  writeFileSync(arquivo, `${JSON.stringify(dados)}\n`);
};
const fracoes = await medirEstados({ trabalho: process.argv[2] || '/tmp/medir', ja, aoTerminarRegiao: async (f) => gravar(f), log: (m) => console.log(m) });
gravar(fracoes);
for (const e of dados.estados) console.log(`${e.uf} (${e.regiao}): ${(e.fracaoDados * 100).toFixed(1)} %`);

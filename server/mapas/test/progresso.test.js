import assert from 'node:assert/strict';
import { test } from 'node:test';
import { lerProgresso, textoProgresso } from '../src/progresso.js';

test('linha de barra do pmtiles vira percentual, tamanho, velocidade e quanto falta', () => {
  const p = lerProgresso('fetching chunks  96% |██████████████████   | (1.4/1.4 GB, 1.2 MB/s) [3m48s:47s]');
  assert.deepEqual(p, { etapa: 'fetching chunks', pct: 96, feito: '1.4/1.4 GB', velocidade: '1.2 MB/s', falta: '47s' });
  assert.equal(textoProgresso(p), '1.4/1.4 GB · 1.2 MB/s · falta 47s');
  const semTempo = lerProgresso('fetching chunks   3% |                    | (12/1400 MB)');
  assert.equal(semTempo.pct, 3);
  assert.equal(textoProgresso(semTempo), '12/1400 MB');
});

test('o resto da saída não é barra e continua no registro', () => {
  assert.equal(lerProgresso('$ pmtiles extract https://exemplo/x.pmtiles base.tmp.pmtiles'), null);
  assert.equal(lerProgresso('Region tiles 1234, result tile entries 1200'), null);
  assert.equal(lerProgresso(''), null);
});

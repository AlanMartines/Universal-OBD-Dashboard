import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, describe, test } from 'node:test';

// As pastas vêm do ambiente na hora do import: pastas temporárias no lugar de /maps e /osrm.
const raiz = await mkdtemp(join(tmpdir(), 'mapas-'));
process.env.MAPS_DIR = join(raiz, 'maps');
process.env.OSRM_DIR = join(raiz, 'osrm');
await mkdir(process.env.MAPS_DIR);
await mkdir(process.env.OSRM_DIR);
const { excluir, limparSobras, situacao } = await import('../src/trabalhos.js');

after(() => rm(raiz, { recursive: true, force: true }));

describe('situação e exclusão dos mapas', () => {
  test('sem nada instalado', async () => {
    const s = await situacao();
    assert.equal(s.base.instalado, false);
    assert.equal(s.encaixe.instalado, false);
    assert.equal(s.trabalho, null);
    assert.ok(s.disco.mapas > 0);
  });

  test('formato antigo dos scripts é reconhecido e pode ser excluído', async () => {
    await writeFile(join(process.env.MAPS_DIR, 'brasil.pmtiles'), 'x'.repeat(10));
    await writeFile(join(process.env.OSRM_DIR, 'regiao.osrm.mldgr'), 'y'.repeat(20));
    await writeFile(join(process.env.OSRM_DIR, 'regiao.osrm.ebg'), 'z'.repeat(5));
    const s = await situacao();
    assert.equal(s.base.instalado, true);
    assert.match(s.base.nome, /script/);
    assert.equal(s.encaixe.instalado, true);
    assert.equal(s.encaixe.bytes, 25);
    await excluir('base');
    await excluir('encaixe');
    assert.deepEqual(await readdir(process.env.MAPS_DIR), []);
    assert.deepEqual(await readdir(process.env.OSRM_DIR), []);
  });

  test('encaixe em versões: só a pasta indicada em "ativo" conta', async () => {
    const v = join(process.env.OSRM_DIR, 'v123');
    await mkdir(v);
    await writeFile(join(v, 'regiao.osrm.mldgr'), 'a'.repeat(7));
    await writeFile(join(v, 'info.json'), JSON.stringify({ area: 'monaco', nome: 'Monaco', atualizado: '2026-11-22T00:00:00Z' }));
    await writeFile(join(process.env.OSRM_DIR, 'ativo'), 'v123');
    const s = await situacao();
    assert.equal(s.encaixe.instalado, true);
    assert.equal(s.encaixe.area, 'monaco');
    assert.ok(s.encaixe.bytes > 7);
    await excluir('encaixe');
    assert.equal(existsSync(v), false);
    assert.equal(existsSync(join(process.env.OSRM_DIR, 'ativo')), false);
  });

  test('sobras de um trabalho interrompido somem na partida', async () => {
    await writeFile(join(process.env.MAPS_DIR, 'base.tmp.pmtiles'), 'x');
    await mkdir(join(process.env.OSRM_DIR, 'trabalho'));
    await limparSobras();
    assert.equal(existsSync(join(process.env.MAPS_DIR, 'base.tmp.pmtiles')), false);
    assert.equal(existsSync(join(process.env.OSRM_DIR, 'trabalho')), false);
  });
});

// Regrava src/modules/notas/linha-do-tempo.json a partir do CHANGELOG.md da raiz. Rodar a cada versão:
//   node scripts/notas-linha-do-tempo.mjs
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseChangelog } from '../src/modules/notas/changelog.js';

const here = dirname(fileURLToPath(import.meta.url));
const md = readFileSync(join(here, '../../../CHANGELOG.md'), 'utf8');
const out = join(here, '../src/modules/notas/linha-do-tempo.json');
writeFileSync(out, `${JSON.stringify(parseChangelog(md), null, 1)}\n`);
console.log('ok:', out);

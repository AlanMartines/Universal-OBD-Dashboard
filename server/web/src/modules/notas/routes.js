// Notas do projeto (/projeto/notas): como tudo funciona, o que está feito, o que está pendente, as avaliações técnicas
// e as decisões. Pública, como o resto da área do projeto: só o que já está no repositório público, sem dado de ninguém.
import { readFileSync } from 'node:fs';
import { REPO_URL } from '../projeto/routes.js';

const KIND_BADGE = { added: 'text-bg-success', changed: 'text-bg-primary', fixed: 'text-bg-warning', removed: 'text-bg-danger', security: 'text-bg-danger' };
const brDate = (iso) => (iso ? iso.split('-').reverse().join('/') : null);

/** Linha do tempo gerada do CHANGELOG (scripts/notas-linha-do-tempo.mjs), pronta para a página. */
function loadTimeline() {
  const raw = JSON.parse(readFileSync(new URL('./linha-do-tempo.json', import.meta.url), 'utf8'));
  return raw.map((v, i) => ({
    version: v.version,
    when: brDate(v.date),
    open: i < 3,
    count: v.sections.reduce((n, s) => n + s.items.length, 0),
    sections: v.sections.map((s) => ({ ...s, badge: KIND_BADGE[s.kind] ?? 'text-bg-secondary' })),
  }));
}

export default function notasRoutes(app) {
  const timeline = loadTimeline();
  const released = timeline.filter((v) => v.when);
  const stats = {
    versions: released.length,
    items: timeline.reduce((n, v) => n + v.count, 0),
    first: released.at(-1)?.when,
    last: released[0]?.when,
    lastVersion: released[0]?.version,
  };
  app.get('/projeto/notas', async (_request, reply) => reply.view('modules/notas/views/notas.hbs', {
    publicPage: true, repoUrl: REPO_URL, title: 'Notas do projeto', activeTab: 'notas',
    pageCss: ['/modules/projeto/projeto.css', '/modules/notas/notas.css'], timeline, stats,
  }));
  // Endereço antigo, de quando a página era só do Super Admin
  app.get('/admin/notas', async (_request, reply) => reply.redirect('/projeto/notas', 301));
}

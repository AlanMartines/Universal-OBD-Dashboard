// Linha do tempo das Notas do projeto, tirada do CHANGELOG.md da raiz (Keep a Changelog, em português).
// O contêiner do painel só enxerga server/web, então o resultado fica guardado em linha-do-tempo.json
// (scripts/notas-linha-do-tempo.mjs); o teste confere se está igual ao CHANGELOG.

const SECTION = { Adicionado: 'added', Alterado: 'changed', Corrigido: 'fixed', Removido: 'removed', Segurança: 'security', Obsoleto: 'deprecated' };

/** Tira a marcação do Markdown que não cabe em texto puro: links viram o texto, sem crases e sem negrito. */
function plain(text) {
  return text
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Versões em ordem do arquivo (a mais nova primeiro): { version, date, sections: [{ kind, title, items: [{ title, text }] }] }.
 * O bloco "Não lançado" entra como version "próxima" quando tem itens.
 */
export function parseChangelog(md) {
  const out = [];
  let ver = null;
  let sec = null;
  let item = null;
  const flush = () => { item = null; };
  for (const raw of md.split('\n')) {
    const line = raw.replace(/\s+$/, '');
    const v = /^## \[([^\]]+)\](?: - (\d{4}-\d{2}-\d{2}))?/.exec(line);
    if (v) {
      flush();
      ver = { version: v[1] === 'Não lançado' ? 'próxima' : v[1], date: v[2] ?? null, sections: [] };
      out.push(ver);
      sec = null;
      continue;
    }
    if (!ver) continue;
    if (/^\[[^\]]+\]: /.test(line)) { ver = null; continue; } // links de comparação no fim do arquivo
    const s = /^### (.+)$/.exec(line);
    if (s) { flush(); sec = { kind: SECTION[s[1]] ?? 'other', title: s[1], items: [] }; ver.sections.push(sec); continue; }
    const b = /^- (.+)$/.exec(line);
    if (b) {
      if (!sec) { sec = { kind: 'other', title: 'Mudanças', items: [] }; ver.sections.push(sec); }
      const m = /^\*\*(.+?):?\*\*:?\s*(.*)$/.exec(b[1]);
      item = m ? { title: plain(m[1]).replace(/[:.]$/, ''), text: plain(m[2]) } : { title: '', text: plain(b[1]) };
      sec.items.push(item);
      continue;
    }
    // Continuação de um item (sub-itens e linhas quebradas) entra no texto dele
    if (item && /^\s+\S/.test(line)) item.text = plain(`${item.text} ${line.replace(/^\s+-\s*/, '')}`);
    else if (!line.trim()) flush();
  }
  return out.filter((v) => v.sections.some((s) => s.items.length));
}

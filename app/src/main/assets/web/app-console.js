'use strict';
/* Console da rede e identificação do adaptador. Os arquivos app-*.js compartilham o escopo global e são carregados em ordem (index.html). */
/* ---------------------------------------------------------------- Console da rede */
const CONSOLE_MAX_LINES = 1500;
let consoleSeq = 0;
let consoleTimer = null;

function consoleClass(line) {
  if (line.startsWith('>')) return 'c-cmd';
  if (line.startsWith('#')) return 'c-info';
  if (line.startsWith('!')) return 'c-err';
  return '';
}

function consoleAppend(lines) {
  const out = $('console-out');
  const stick = out.scrollTop + out.clientHeight >= out.scrollHeight - 24;
  const frag = document.createDocumentFragment();
  lines.forEach((l) => {
    const div = document.createElement('div');
    div.textContent = l;
    const c = consoleClass(l);
    if (c) div.className = c;
    frag.appendChild(div);
  });
  out.appendChild(frag);
  while (out.childElementCount > CONSOLE_MAX_LINES) out.removeChild(out.firstChild);
  if (stick) out.scrollTop = out.scrollHeight;
}

function consolePoll() {
  const s = parse(bridge.consolePoll(consoleSeq), { running: false, seq: consoleSeq, lines: [] });
  if (s.lines.length) consoleAppend(s.lines);
  consoleSeq = s.seq;
  $('console-run').textContent = s.running ? 'Parar' : 'Escutar 60 s';
  $('console-run').classList.toggle('btn-danger', s.running);
  $('console-baud').disabled = s.running;
  $('console-identify').disabled = s.running;
  $('console-status').textContent = s.running ? '● escutando' + (s.file ? ' — ' + s.file : '') : '';
}

function consoleShowOutput() {
  $('console-history').hidden = true;
  $('console-out').hidden = false;
  $('console-history-btn').textContent = 'Histórico';
}

/** Converte uma linha JSON Lines gravada de volta no texto do console. */
function consoleFormat(raw) {
  const e = parse(raw, null);
  if (!e) return [raw];
  switch (e.type) {
    case 'elm': return ['> ' + e.cmd, ...(e.rx !== undefined ? e.rx.split(/[\r\n]+/).filter((x) => x.trim()).map((x) => '  ' + x.trim()) : ['  (' + e.err + ')'])];
    case 'can': return [e.l];
    case 'can_probe': return ['  ' + e.baud + ': ' + e.frames + ' quadros'];
    case 'can_listen': return ['# ' + e.phase + (e.baud ? ' ' + e.baud : '')];
    case 'adapter_id': return ['# Resultado: ' + e.verdict + (e.version ? ' — diz ser ' + e.version : ''), ...(e.reasons || []).map((x) => '  • ' + x)];
    case 'can_summary': return ['# Resumo: ' + e.frames + ' quadros a ' + e.baud,
      ...Object.entries(e.ids || {}).map(([id, s]) => '  ' + id.padEnd(11) + ' ×' + s.count + '  ' + s.last +
        '  (' + (s.changed_bytes.length ? 'variam ' + s.changed_bytes.map((b) => 'b' + b).join(',') : 'fixo') + ')')];
    case 'session': return ['# Sessão ' + new Date(e.t).toLocaleString('pt-BR') + ' — app ' + e.app_version + (e.mode === 'adapter_identify' ? ' — identificar adaptador' : '')];
    case 'error': return ['! ' + e.where + ': ' + e.error];
    default: return ['# ' + e.type];
  }
}

function consoleRenderHistory() {
  const box = $('console-history');
  const files = parse(bridge.getDiagnostics(), { files: [] }).files.filter((f) => f.name.includes('_console-'));
  box.innerHTML = files.length ? '' : '<p class="muted small">Nenhuma escuta gravada.</p>';
  files.forEach((f) => {
    const el = document.createElement('div');
    el.className = 'item';
    el.innerHTML = `<b></b><div class="kv"><span>${mb(f.size)}</span><span>${dt(f.modified)}</span>${f.active ? '<span class="rec">● gravando</span>' : ''}</div>` +
      `<div class="actions"><button class="btn btn-small" data-c-view>Ver</button><button class="btn btn-small" data-diag-export>Exportar .gz</button>` +
      (f.active ? '' : `<button class="btn btn-small btn-danger" data-diag-delete>Apagar</button>`) + '</div>';
    el.querySelector('b').textContent = f.name;
    el.querySelectorAll('button').forEach((b) => { b.dataset.name = f.name; });
    box.appendChild(el);
  });
}

$('console-open').addEventListener('click', () => {
  $('console').hidden = false;
  consoleShowOutput();
  consolePoll();
  clearInterval(consoleTimer);
  consoleTimer = setInterval(consolePoll, 300);
});
$('console-close').addEventListener('click', () => {
  $('console').hidden = true;
  clearInterval(consoleTimer);
  consoleTimer = null;
  renderDiagnostics();
});
$('console-run').addEventListener('click', () => {
  if (parse(bridge.consolePoll(consoleSeq), {}).running) {
    bridge.consoleStop();
  } else {
    consoleShowOutput();
    $('console-out').innerHTML = '';
    const res = bridge.consoleStart($('console-baud').value);
    if (res !== 'ok') consoleAppend(['! ' + res]);
  }
  consolePoll();
});
$('console-identify').addEventListener('click', () => {
  consoleShowOutput();
  $('console-out').innerHTML = '';
  const res = bridge.consoleIdentify();
  if (res !== 'ok') consoleAppend(['! ' + res]);
  consolePoll();
});
$('console-history-btn').addEventListener('click', () => {
  if ($('console-history').hidden) {
    consoleRenderHistory();
    $('console-history').hidden = false;
    $('console-out').hidden = true;
    $('console-history-btn').textContent = 'Voltar';
  } else {
    consoleShowOutput();
  }
});
$('console-history').addEventListener('click', (e) => {
  const view = e.target.closest('[data-c-view]');
  const exp = e.target.closest('[data-diag-export]');
  const del = e.target.closest('[data-diag-delete]');
  if (view) {
    const r = parse(bridge.readDiagnostic(view.dataset.name), { error: 'resposta inválida' });
    consoleShowOutput();
    $('console-out').innerHTML = '';
    consoleAppend(r.error ? ['! ' + r.error] : ['# ' + view.dataset.name, ...r.lines.flatMap(consoleFormat)]);
  } else if (exp) {
    const res = bridge.exportDiagnostic(exp.dataset.name);
    if (res !== 'ok') alert(res);
  } else if (del && confirm('Apagar ' + del.dataset.name + '?')) {
    const res = bridge.deleteDiagnostic(del.dataset.name);
    if (res !== 'ok') alert(res);
    consoleRenderHistory();
  }
});

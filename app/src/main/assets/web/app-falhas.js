'use strict';
/* Aba Falhas: códigos ativos com descrição e análise com IA. Só leitura: nada aqui apaga falhas na injeção. */
let lastFaultsKey = '';

function faultItem(code, kind) {
  const d = dtcDescribe(code, meta.dtcDescriptions);
  const el = document.createElement('div');
  el.className = 'item';
  const head = document.createElement('div');
  head.className = 'row-between';
  const title = document.createElement('b');
  title.textContent = code;
  const tag = document.createElement('span');
  tag.className = 'pill ' + (kind === 'pending' ? 'pill-warn' : 'pill-bad');
  tag.textContent = { pending: 'Pendente', permanent: 'Permanente' }[kind] || 'Confirmada';
  head.append(title, tag);
  el.appendChild(head);
  const text = document.createElement('div');
  text.className = 'small';
  text.textContent = d.text || 'Sem descrição conhecida para este código.';
  el.appendChild(text);
  if (d.source === 'norma' || d.source === 'grupo') {
    const src = document.createElement('div');
    src.className = 'small muted';
    src.textContent = d.source === 'norma' ? 'Descrição genérica da norma SAE.' : 'O significado exato depende do fabricante.';
    el.appendChild(src);
  }
  const actions = document.createElement('div');
  actions.className = 'actions';
  if (aiReady()) {
    const b = document.createElement('button');
    b.className = 'btn btn-small';
    b.textContent = 'Analisar com IA';
    b.addEventListener('click', () => explainDtc({ code, kind, description: d.text }));
    actions.appendChild(b);
  } else {
    const hint = document.createElement('span');
    hint.className = 'small muted';
    hint.textContent = 'Configure a IA em Ajustes para analisar.';
    actions.appendChild(hint);
  }
  el.appendChild(actions);
  return el;
}

/* O botão só fica ativo quando a leitura pode acontecer de fato. */
const SCAN_WAIT = {
  CONNECTING: 'Conectando ao adaptador…', INITIALIZING: 'Inicializando o adaptador…', RECONNECTING: 'Reconectando ao adaptador…',
};
let scanBusy = false;
let lastScanKey = '';
let lastReadinessAt = 0;
function updateScanButton(s, force) {
  let ready;
  let hint;
  if (s && s.running) {
    ready = s.connection === 'STREAMING';
    hint = ready ? 'Lê pela captura em andamento.' : (SCAN_WAIT[s.connection] || 'Aguardando a conexão com a injeção.');
  } else {
    // A tela atualiza várias vezes por segundo; o Bluetooth basta conferir a cada 3 s.
    if (!force && Date.now() - lastReadinessAt < 3000) return;
    lastReadinessAt = Date.now();
    const r = parse(bridge.faultScanReadiness(), { ready: false, reason: '' });
    ready = r.ready;
    hint = r.reason;
  }
  const key = (ready && !scanBusy) + '|' + hint;
  if (key === lastScanKey) return;
  lastScanKey = key;
  $('fault-scan').disabled = !ready || scanBusy;
  $('fault-scan-hint').textContent = hint;
}

function renderFaultsNow(conf, pend, s) {
  updateScanButton(s);
  const mil = $('mil');
  $('fault-mil').textContent = mil.textContent;
  $('fault-mil').className = mil.className;
  const key = conf.join() + '|' + pend.join() + '|' + aiReady() + '|' + s.connection;
  if (key === lastFaultsKey) return;
  lastFaultsKey = key;
  const box = $('fault-now');
  box.innerHTML = '';
  if (conf.length + pend.length === 0) {
    box.className = 'list muted small';
    box.textContent = s.connection === 'STREAMING' ? 'Nenhuma falha ativa.' : 'Nenhuma falha lida ainda. Elas aparecem durante a captura.';
    return;
  }
  box.className = 'list';
  conf.forEach((c) => box.appendChild(faultItem(c, 'confirmed')));
  pend.forEach((c) => box.appendChild(faultItem(c, 'pending')));
}

document.querySelectorAll('[data-goto]').forEach((a) => a.addEventListener('click', (e) => {
  e.preventDefault();
  const tab = document.querySelector(`.tab[data-tab="${a.dataset.goto}"]`);
  if (tab) tab.click();
}));

/* ---------------------------------------------------------------- Ler falhas agora */
function scanLine(text, muted) {
  const p = document.createElement('p');
  p.className = muted ? 'muted small' : 'small';
  p.textContent = text;
  return p;
}

function renderScan(r) {
  const box = $('fault-scan-result');
  box.hidden = false;
  box.innerHTML = '';
  if (!r.ok) { box.appendChild(scanLine(r.error || 'Falha na leitura.')); return; }
  const when = new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  const mil = r.milOn == null ? 'luz da injeção não informada' : r.milOn ? 'luz da injeção ACESA' : 'luz da injeção apagada';
  const stored = r.storedCount != null ? ` · ${r.storedCount} ${r.storedCount === 1 ? 'código guardado' : 'códigos guardados'} pela injeção` : '';
  box.appendChild(scanLine(`Leitura das ${when} (${r.viaCapture ? 'pela captura' : 'conexão avulsa'}): ${mil}${stored}.`));
  let total = 0;
  [['confirmed', 'confirmadas'], ['pending', 'pendentes'], ['permanent', 'permanentes']].forEach(([kind, label]) => {
    const list = r[kind];
    if (list == null) { box.appendChild(scanLine(`Falhas ${label}: a injeção não informou.`, true)); return; }
    list.forEach((c) => box.appendChild(faultItem(c, kind)));
    total += list.length;
  });
  if (!total) box.appendChild(scanLine('Nenhuma falha encontrada.'));
  if (r.freezeCode) box.appendChild(scanLine(`A injeção guardou um freeze frame da falha ${r.freezeCode}.`, true));
}

$('fault-scan').addEventListener('click', async () => {
  const btn = $('fault-scan');
  if (btn.disabled) return;
  scanBusy = true;
  btn.disabled = true;
  btn.textContent = 'Lendo…';
  const res = parse(await nativeAsync((id) => bridge.scanFaults(id)).catch((e) => JSON.stringify({ ok: false, error: e.message })), { ok: false });
  scanBusy = false;
  btn.textContent = 'Ler falhas agora';
  lastScanKey = '';
  updateScanButton(lastState, true);
  renderScan(res);
  toast(res.ok ? 'Leitura de falhas concluída.' : res.error, !res.ok);
  if (res.ok) loadHistory();
});

// Sem captura a tela não recebe atualizações: confere ao abrir a aba e quando o app volta à frente.
document.querySelector('.tab[data-tab="faults"]').addEventListener('click', () => { lastScanKey = ''; updateScanButton(lastState, true); });
document.addEventListener('visibilitychange', () => { if (!document.hidden) { lastScanKey = ''; updateScanButton(lastState, true); } });
updateScanButton(lastState, true);

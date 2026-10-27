'use strict';
/* Assistente IA: configuração, falhas, viagens e perguntas. Os arquivos app-*.js compartilham o escopo global e são carregados em ordem (index.html). */
/* ---------------------------------------------------------------- Assistente IA */
let ai = parse(bridge.getAiSettings(), {});
let lastDtcKey = null;
let aiPending = null; // {id, req}
const aiReady = () => !!ai.ready;

function loadAiSettings() {
  ai = parse(bridge.getAiSettings(), {});
  const sel = $('ai-provider');
  sel.innerHTML = (ai.providers || []).map((p) => `<option value="${p.id}">${esc(p.label)}</option>`).join('');
  sel.value = ai.provider;
  $('ai-enabled').checked = !!ai.enabled;
  $('ai-url').value = ai.baseUrl || '';
  $('ai-model').value = ai.model || '';
  $('ai-key').value = '';
  $('ai-key').placeholder = ai.keyMasked ? 'salva: ' + ai.keyMasked : 'cole a chave do provedor';
  $('ai-model-list-wrap').hidden = true;
  aiHint();
  lastDtcKey = null;
}

function aiHint() {
  const p = (ai.providers || []).find((x) => x.id === $('ai-provider').value) || {};
  $('ai-model').placeholder = p.modelHint ? 'ex.: ' + p.modelHint : 'nome do modelo';
  $('ai-url').readOnly = p.id !== 'CUSTOM';
}

$('ai-provider').addEventListener('change', () => {
  const p = (ai.providers || []).find((x) => x.id === $('ai-provider').value) || {};
  if (p.id !== 'CUSTOM') $('ai-url').value = p.baseUrl;
  $('ai-model-list-wrap').hidden = true; // a lista era do provedor anterior
  aiHint();
});

/* Busca na conta do provedor os modelos que a chave pode usar; escolher na lista preenche o campo Modelo. */
$('ai-models-btn').addEventListener('click', async () => {
  const btn = $('ai-models-btn');
  const out = $('ai-result');
  btn.disabled = true;
  out.textContent = 'Buscando modelos…';
  out.style.color = '';
  const json = JSON.stringify({ baseUrl: $('ai-url').value.trim(), apiKey: $('ai-key').value.trim() });
  const r = parse(await nativeAsync((id) => bridge.aiListModels(id, json)).catch(() => null), { ok: false, error: 'resposta inválida' });
  btn.disabled = false;
  if (!r.ok || !r.models.length) {
    out.textContent = r.ok ? 'O provedor não devolveu nenhum modelo de texto. Digite o nome no campo Modelo.' : 'Erro: ' + r.error;
    out.style.color = 'var(--red)';
    return;
  }
  const cur = $('ai-model').value.trim();
  $('ai-model-list').innerHTML = '<option value="">Escolha um modelo…</option>'
    + r.models.map((m) => `<option value="${esc(m)}">${esc(m)}</option>`).join('');
  $('ai-model-list').value = r.models.includes(cur) ? cur : '';
  $('ai-model-list-wrap').hidden = false;
  out.textContent = `${r.models.length} modelo(s) encontrados. Escolha na lista e toque em Salvar.`;
});
$('ai-model-list').addEventListener('change', (e) => { if (e.target.value) $('ai-model').value = e.target.value; });

function aiSave(extra) {
  const res = bridge.saveAiSettings(JSON.stringify(Object.assign({
    enabled: $('ai-enabled').checked, provider: $('ai-provider').value, baseUrl: $('ai-url').value.trim(),
    model: $('ai-model').value.trim(), apiKey: $('ai-key').value.trim(),
  }, extra || {})));
  $('ai-result').textContent = res === 'ok' ? 'Salvo.' : res;
  $('ai-result').style.color = res === 'ok' ? 'var(--accent)' : 'var(--red)';
  if (res === 'ok') loadAiSettings();
  return res === 'ok';
}
$('ai-save').addEventListener('click', () => aiSave());
$('ai-clear').addEventListener('click', () => { if (confirm('Remover a chave de API deste celular?')) aiSave({ clearKey: true, apiKey: '' }); });
$('ai-test').addEventListener('click', () => {
  if (!aiSave()) return;
  $('ai-result').textContent = 'Testando…';
  $('ai-result').style.color = '';
  aiPending = { id: 'test-' + Date.now() };
  bridge.aiTest(aiPending.id);
});

/** Texto simples da resposta, com **negrito** do Markdown. */
const aiFormat = (t) => esc(t).replace(/\*\*(.+?)\*\*/g, '<b>$1</b>').replace(/^#{1,4}\s*/gm, '');

/* Um painel para os três usos: explicar falha ("dtc"), analisar viagem ("trip") e conversa ("ask").
   Antes do primeiro envio de cada tipo, mostra o texto exato e espera o "Enviar". */
let aiFlow = null;            // {kind, title, preview(id), send(id), saved(id)}
const aiChat = { turns: [], question: '' };
const aiConsented = (k) => (ai.consents || []).includes(k);

async function aiOpen(flow) {
  aiFlow = flow;
  aiPending = null;
  $('ai-panel').hidden = false;
  $('ai-title').textContent = flow.title;
  $('ai-answer').textContent = '';
  $('ai-status').textContent = '';
  $('ai-consent').hidden = true;
  $('ai-sent').hidden = true;
  $('ai-chat').hidden = flow.kind !== 'ask';
  $('ai-saved').hidden = true;
  const p = (ai.providers || []).find((x) => x.id === ai.provider) || {};
  $('ai-provider-name').textContent = (p.label || 'o provedor') + (ai.model ? ' · ' + ai.model : '');
  if (flow.kind === 'ask') { aiRenderChat(); $('ai-question').focus(); return; }
  const saved = flow.saved ? parse(await nativeAsync(flow.saved).catch(() => null), null) : null;
  if (aiFlow !== flow) return; // painel fechado ou trocado enquanto consultava
  if (saved && saved.text) {
    // Resposta guardada: mostra sem consultar (e sem gastar créditos) até pedir de novo
    $('ai-answer').innerHTML = aiFormat(saved.text);
    $('ai-saved-info').textContent = `Resposta de ${dt(saved.createdAt)}${saved.model ? ' · ' + saved.model : ''}.`;
    $('ai-saved').hidden = false;
    return;
  }
  aiStart();
}

$('ai-again').addEventListener('click', () => { $('ai-saved').hidden = true; $('ai-answer').textContent = ''; aiStart(); });

async function aiStart() {
  const flow = aiFlow;
  $('ai-status').textContent = 'preparando…';
  $('ai-ask').disabled = true; // a pergunta não sai duas vezes enquanto o texto é montado
  const preview = parse(await nativeAsync(flow.preview).catch(() => null), { ok: false, error: 'resposta inválida' });
  $('ai-ask').disabled = false;
  if (aiFlow !== flow) return; // painel fechado ou trocado enquanto montava o texto
  $('ai-status').textContent = '';
  if (!preview.ok) { aiShowError(preview.error); return; }
  $('ai-sent-text').textContent = preview.text;
  $('ai-sent').hidden = false;
  if (!aiConsented(aiFlow.kind)) {
    $('ai-sent-label').textContent = 'O que será enviado';
    $('ai-consent').hidden = false;
    $('ai-sent').open = true;
    return;
  }
  aiDispatch();
}

function aiDispatch() {
  $('ai-consent').hidden = true;
  $('ai-sent').open = false;
  $('ai-sent-label').textContent = 'O que foi enviado';
  $('ai-status').textContent = 'consultando…';
  if (aiFlow.kind === 'ask') aiRenderChat(true); else $('ai-answer').textContent = 'Consultando a IA…';
  aiPending = { id: aiFlow.kind + '-' + Date.now() };
  aiFlow.send(aiPending.id);
}

function aiShowError(msg) {
  $('ai-status').textContent = 'erro';
  if (aiFlow && aiFlow.kind === 'ask') { aiRenderChat(false, msg); return; }
  $('ai-answer').textContent = 'Não foi possível consultar: ' + msg;
}

function aiRenderChat(waiting, error) {
  const box = $('ai-turns');
  box.innerHTML = aiChat.turns.length || waiting ? '' :
    '<p class="muted small">Pergunte sobre consumo, gastos, viagens ou falhas. A IA recebe um resumo do histórico do carro.</p>';
  const add = (cls, html) => { const d = document.createElement('div'); d.className = 'ai-turn ' + cls; d.innerHTML = html; box.appendChild(d); };
  aiChat.turns.forEach((t) => add(t.role, t.role === 'user' ? esc(t.content) : aiFormat(t.content)));
  if (waiting) { add('user', esc(aiChat.question)); add('assistant muted', 'Consultando a IA…'); }
  if (error) add('error', 'Não foi possível consultar: ' + esc(error));
  $('ai-ask').disabled = !!waiting;
  $('ai-suggestions').hidden = aiChat.turns.length > 0 || !!waiting;
  box.lastElementChild && box.lastElementChild.scrollIntoView({ block: 'end' });
}

function explainDtc(req) {
  const json = JSON.stringify(req);
  aiOpen({ kind: 'dtc', title: 'Falha ' + req.code, preview: (id) => bridge.aiPreviewDtc(id, json), send: (id) => bridge.aiExplainDtc(id, json),
    saved: (id) => bridge.aiSavedAnswer(id, 'dtc', String(req.code).toUpperCase()) });
}

function analyzeTrip(t) {
  aiOpen({ kind: 'trip', title: 'Viagem de ' + dt(t.startTime), preview: (id) => bridge.aiPreviewTrip(id, t.id), send: (id) => bridge.aiAnalyzeTrip(id, t.id),
    saved: (id) => bridge.aiSavedAnswer(id, 'trip', String(t.id)) });
}

const AI_SUGGESTIONS = ['Quanto gastei de combustível este mês?', 'Por que o consumo variou entre as viagens?', 'O etanol compensa no meu carro?', 'Alguma viagem mostrou sinal de problema no motor?'];

function openAsk() {
  aiOpen({
    kind: 'ask', title: 'Perguntar à IA',
    preview: (id) => bridge.aiPreviewAsk(id, aiChat.question, JSON.stringify(aiChat.turns)),
    send: (id) => bridge.aiAsk(id, aiChat.question, JSON.stringify(aiChat.turns)),
  });
}

$('ai-ask').addEventListener('click', () => {
  const q = $('ai-question').value.trim();
  if (!q || aiPending) return;
  aiChat.question = q;
  aiStart();
});
$('ai-question').addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); $('ai-ask').click(); } });
$('ai-new').addEventListener('click', () => { aiChat.turns = []; aiChat.question = ''; $('ai-question').value = ''; $('ai-sent').hidden = true; aiRenderChat(); });
$('ai-suggestions').innerHTML = AI_SUGGESTIONS.map((q) => `<button class="btn btn-small" type="button">${esc(q)}</button>`).join('');
$('ai-suggestions').addEventListener('click', (e) => { const b = e.target.closest('button'); if (b) { $('ai-question').value = b.textContent; $('ai-question').focus(); } });
$('ask-ai').addEventListener('click', openAsk);

$('ai-send').addEventListener('click', () => {
  if (!aiFlow) return;
  bridge.setAiConsent(aiFlow.kind);
  ai.consents = [...(ai.consents || []), aiFlow.kind];
  aiDispatch();
});
const aiClose = () => { $('ai-panel').hidden = true; aiPending = null; aiFlow = null; };
$('ai-cancel').addEventListener('click', () => { if (aiFlow && aiFlow.kind === 'ask') { $('ai-consent').hidden = true; $('ai-sent').hidden = true; } else aiClose(); });
$('ai-close').addEventListener('click', aiClose);

window.onAiResult = (r) => {
  if (!aiPending || r.id !== aiPending.id) return; // resposta de um pedido já fechado
  aiPending = null;
  if (r.id.startsWith('test-')) {
    $('ai-result').textContent = r.ok ? 'Conexão OK: ' + r.text : 'Falhou: ' + r.error;
    $('ai-result').style.color = r.ok ? 'var(--accent)' : 'var(--red)';
    return;
  }
  if (!r.ok) { aiShowError(r.error); return; }
  $('ai-status').textContent = '';
  if (aiFlow && aiFlow.kind === 'ask') {
    aiChat.turns.push({ role: 'user', content: aiChat.question }, { role: 'assistant', content: r.text });
    aiChat.question = '';
    $('ai-question').value = '';
    aiRenderChat();
  } else {
    $('ai-answer').innerHTML = aiFormat(r.text);
  }
};

function renderPermissions(p) {
  $('permissions').innerHTML = Object.entries(p)
    .map(([k, v]) => `<div>${v ? '✅' : '⛔'} ${k}</div>`).join('') || '<span class="muted">--</span>';
}
window.onPermissions = renderPermissions;

$('profile-select').addEventListener('change', (e) => {
  const res = bridge.selectProfile(e.target.value);
  if (res !== 'ok') { alert(res); return; }
  meta = parse(bridge.getProfileMeta(), meta);
  setupGauge();
  Dash.setMeta(meta);
  loadSettings();
  if (lastState && lastState.running) alert('O novo perfil será usado na próxima captura.');
});
/* Lista em vez de controle deslizante: arrastar a página não muda o % sem querer. */
function setEthanolSelect(pct) {
  const sel = $('ethanol');
  const v = Math.round(pct);
  const values = [...new Set([...Array(21).keys()].map((i) => i * 5).concat(v))].sort((a, b) => a - b);
  sel.innerHTML = values.map((x) => `<option value="${x}">${x}%${x === 0 ? ' (só gasolina)' : x === 100 ? ' (só etanol)' : ''}</option>`).join('');
  sel.value = String(v);
}
$('ethanol').addEventListener('change', (e) => bridge.setEthanolPercent(Number(e.target.value)));
$('save-fuel').addEventListener('click', () => {
  const v = parseFloat(String($('fuel-level').value).replace(',', '.'));
  if (!Number.isNaN(v)) bridge.setFuelLevel(v);
});
$('tank-full').addEventListener('click', () => {
  const cap = bridge.markTankFull();
  if (cap > 0) $('fuel-level').value = cap.toFixed(1);
});

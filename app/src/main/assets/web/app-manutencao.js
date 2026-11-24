'use strict';
/* Manutenção: cada item com a próxima troca que o mecânico passou (km e, se quiser, data) e o registro de cada vez
   feita. Os itens do manual do veículo só sugerem valores no select. Os arquivos app-*.js compartilham o escopo
   global e são carregados em ordem (index.html). */
const MT_LEVEL = {
  DUE: { text: 'Vencido', cls: 'pill-bad' },
  SOON: { text: 'Perto de vencer', cls: 'pill-warn' },
  OK: { text: 'Em dia', cls: 'pill-ok' },
  UNKNOWN: { text: 'Sem registro', cls: '' },
};
const MT_OUTRO = '__outro__';
const dateOnly = (ms) => new Date(ms).toLocaleDateString('pt-BR');
const dateInput = (ms) => { const d = new Date(ms - new Date(ms).getTimezoneOffset() * 60000); return d.toISOString().slice(0, 10); };
/** "2026-11-11" do campo de data → meio-dia local (evita cair no dia anterior pelo fuso). */
const fromDateInput = (v) => (v ? new Date(v + 'T12:00:00').getTime() : null);
const numOrNull = (v) => { const n = parseFloat(String(v).replace(',', '.')); return Number.isFinite(n) ? n : null; };
const addMonthsMs = (ms, n) => { const d = new Date(ms); d.setMonth(d.getMonth() + n); return d.getTime(); };

let mtSeq = 0;
let mtItems = {};
let mtPresets = [];
let mtEditingId = null;
let mtRecordingId = null;
let mtTotalKm = null;

/* ---------------------------------------------------------------- próxima troca: "daqui a" ↔ "no km / na data" */
/**
 * Liga os campos da próxima troca de um formulário (prefixo pfx) à última vez (baseKm/baseDate: ids dos campos).
 * Digitando "daqui a", o "no km"/"na data" é calculado; digitando o valor final, o "daqui a" acompanha.
 */
function mtLinkNext(pfx, baseKmId, baseDateId) {
  const inKm = $(pfx + '-in-km'), nextKm = $(pfx + '-next-km');
  const inMo = $(pfx + '-in-months'), nextDate = $(pfx + '-next-date');
  const baseKm = () => numOrNull($(baseKmId).value);
  const baseDate = () => fromDateInput($(baseDateId).value) || Date.now();
  const fromInKm = () => { const b = baseKm(), d = numOrNull(inKm.value); if (b != null && d != null) nextKm.value = Math.round(b + d); };
  const fromNextKm = () => { const b = baseKm(), n = numOrNull(nextKm.value); inKm.value = b != null && n != null && n > b ? Math.round(n - b) : ''; };
  const fromInMo = () => { const m = numOrNull(inMo.value); nextDate.value = m ? dateInput(addMonthsMs(baseDate(), Math.round(m))) : ''; };
  const fromNextDate = () => {
    const t = fromDateInput(nextDate.value);
    inMo.value = t && t > baseDate() ? Math.max(1, Math.round((t - baseDate()) / (30.44 * 864e5))) : '';
  };
  inKm.addEventListener('input', fromInKm);
  nextKm.addEventListener('input', fromNextKm);
  inMo.addEventListener('input', fromInMo);
  nextDate.addEventListener('input', fromNextDate);
  $(baseKmId).addEventListener('input', () => { if (inKm.value) fromInKm(); else fromNextKm(); });
  $(baseDateId).addEventListener('input', () => { if (inMo.value) fromInMo(); });
  return {
    /** Preenche pela sugestão (intervalos) ou por valores já anotados. */
    set({ km = null, months = null, nextKmV = null, nextAtV = null } = {}) {
      inKm.value = km ? Math.round(km) : ''; nextKm.value = nextKmV ? Math.round(nextKmV) : '';
      inMo.value = months || ''; nextDate.value = nextAtV ? dateInput(nextAtV) : '';
      if (!nextKmV && km) fromInKm(); else if (nextKmV) fromNextKm();
      if (!nextAtV && months) fromInMo(); else if (nextAtV) fromNextDate();
    },
    /** {nextKm, nextAt} para enviar. Data ou km já passados valem: o item fica vencido e o app avisa. */
    read() {
      const at = fromDateInput(nextDate.value);
      return { nextKm: numOrNull(nextKm.value), nextAt: at || null };
    },
  };
}
const mtNext = mtLinkNext('mt', 'mt-last-km', 'mt-last-when');
const mtRecNext = mtLinkNext('mt-rec', 'mt-rec-km', 'mt-rec-when');

/* ---------------------------------------------------------------- lista */
function mtWhenText(s) {
  if (!s || s.level === 'UNKNOWN') return 'Registre a última vez e a próxima troca.';
  const p = [];
  if (s.remainingKm != null) p.push(s.remainingKm <= 0 ? `vencido há ${fmt(-s.remainingKm, 0)} km (era aos ${fmt(s.nextKm, 0)} km)` : `faltam ${fmt(s.remainingKm, 0)} km (aos ${fmt(s.nextKm, 0)} km)`);
  else if (s.nextKm != null) p.push(`aos ${fmt(s.nextKm, 0)} km`);
  if (s.remainingDays != null) p.push(s.remainingDays < 0 ? `vencido há ${-s.remainingDays} dias` : `até ${dateOnly(s.nextAt)} (${s.remainingDays} dias)`);
  return p.join(' · ') || 'Sem próxima troca anotada.';
}

function mtFillSelect() {
  const sel = $('mt-sel');
  const cur = sel.value;
  sel.textContent = '';
  const add = (v, t) => { const o = document.createElement('option'); o.value = v; o.textContent = t; sel.appendChild(o); };
  add('', 'Escolha o item…');
  mtPresets.forEach((p, i) => add(String(i), p.name));
  add(MT_OUTRO, 'Outro…');
  if ([...sel.options].some((o) => o.value === cur)) sel.value = cur;
}

/* ---------------------------------------------------------------- Saúde do carro (pré-diagnóstico) */
const HL_LEVEL = { NO_DATA: ['Sem dados', 'pill'], LEARNING: ['Aprendendo', 'pill'], OK: ['Normal', 'pill pill-ok'], WATCH: ['Atenção', 'pill pill-warn'], ALERT: ['Verificar', 'pill pill-bad'] };
const HL_SUB = {
  central: 'Central (injeção)', cooling: 'Arrefecimento', electric: 'Elétrica', intake: 'Admissão', idle: 'Marcha lenta',
  mixture: 'Mistura', exhaust: 'Escape', sensors: 'Sensores de temperatura', clutch: 'Embreagem',
};
/** Texto de cada checagem: o valor da última viagem e, fora do normal, o que olhar. */
const HL_CHECK = {
  warmup: (v, f) => (f ? `Demorou ${fmt(v, 0)} min para chegar a 80 °C: a válvula termostática pode estar presa aberta (ou o dia estava muito frio).` : `Chegou a 80 °C em ${fmt(v, 0)} min depois da partida a frio.`),
  road_cool: (v, f) => (f ? 'Esfriou abaixo de 75 °C na estrada com o motor já quente: a válvula termostática pode estar presa aberta.' : 'Manteve a temperatura na estrada.'),
  overheat: (v, f) => (f ? `Chegou a ${fmt(v, 0)} °C e passou um tempo acima da 2ª velocidade da ventoinha: confira o nível do líquido, a ventoinha e a termostática.` : `Máxima de ${fmt(v, 0)} °C.`),
  charging: (v, f) => (f ? `${fmt(v, 2)} V acima de 1.500 rpm: ${v < 13.5 ? 'o alternador pode não estar carregando bem' : 'acima do normal, verifique o regulador do alternador'} (o normal é 13,5 a 14,7 V).` : `${fmt(v, 2)} V acima de 1.500 rpm.`),
  rest_v: (v, f) => (f ? `${fmt(v, 2)} V em repouso, antes da partida: bateria descarregada ou fraca.` : `${fmt(v, 2)} V em repouso.`),
  crank_v: (v, f) => (f ? `Caiu a ${fmt(v, 2)} V na partida: bateria fraca ou motor de partida puxando demais.` : `${fmt(v, 2)} V na partida.`),
  idle_vacuum: (v, f) => (f ? `MAP em marcha lenta a ${fmt(v * 100, 0)}% da pressão do ar, acima do normal deste carro: vácuo fraco. Vale olhar entrada de ar falso, mangueiras, cânister e compressão.` : `MAP em marcha lenta a ${fmt(v * 100, 0)}% da pressão do ar.`),
  map_offset: (v, f) => (f ? `O sensor MAP marca ${fmt(Math.abs(v), 1)} kPa ${v > 0 ? 'acima' : 'abaixo'} da pressão do ar com o motor parado: sensor desregulado ou mangueira obstruída.` : `Sensor MAP a ${fmt(v, 1)} kPa da pressão do ar com o motor parado.`),
  idle_rpm: (v, f) => (f ? `A rotação oscila ±${fmt(v, 0)} rpm em marcha lenta quente: corpo de borboleta sujo, ar falso ou vela/cabo.` : `Rotação estável em marcha lenta (±${fmt(v, 0)} rpm).`),
  stft_idle: (v, f) => (f
    ? `Em marcha lenta a injeção ${v > 0 ? 'acrescenta' : 'tira'} ${fmt(Math.abs(v), 1)}% de combustível, fora do normal. Se for só na marcha lenta, o mais comum é ar falso (mangueira, junta do coletor, válvula do cânister).`
    : `Mistura em marcha lenta com correção de ${fmt(v, 1)}%.`),
  stft_cruise: (v, f) => (f
    ? `Rodando, a injeção ${v > 0 ? 'acrescenta' : 'tira'} ${fmt(Math.abs(v), 1)}% de combustível, fora do normal. Se acontecer também na marcha lenta, aponta combustível ou injeção (bomba, filtro, bicos, pressão) ou um sensor.`
    : `Mistura rodando com correção de ${fmt(v, 1)}%.`),
  o2_post: (v, f) => (f
    ? `A sonda depois do catalisador fica em ${fmt(v, 2)} V, baixa demais com o motor quente: costuma ser ar entrando no escapamento antes dela (junta ou furo) ou a própria sonda.`
    : `Sonda depois do catalisador em ${fmt(v, 2)} V (catalisador trabalhando).`),
  temp_plaus: (v, f) => (f
    ? `Logo depois da partida a frio, o ar admitido estava ${fmt(Math.abs(v), 0)} °C ${v > 0 ? 'mais quente' : 'mais frio'} que a água; parados há horas, os dois deveriam estar perto. Um dos sensores pode estar errado (ou o carro ficou ao sol).`
    : `Sensores de temperatura batendo na partida a frio (diferença de ${fmt(Math.abs(v), 0)} °C).`),
  clutch_slip: (v, f) => (f
    ? `Sob carga, a rotação sobe ${fmt(v, 1)}% acima do que a marcha pede: a embreagem pode estar patinando (disco gasto, platô ou ajuste do cabo).`
    : `Embreagem segurando sob carga (diferença de ${fmt(v, 1)}%).`),
};
const HL_EMPTY = {
  warmup: 'Ainda sem partida a frio.', road_cool: 'Ainda sem trecho de estrada com o motor quente.', overheat: 'Ainda sem motor aquecido.',
  charging: 'Ainda sem trecho acima de 1.500 rpm.', rest_v: 'Tensão em repouso: precisa do divisor da bateria no ESP32.', crank_v: 'Queda na partida: precisa do divisor da bateria e do firmware 1.7 no ESP32.',
  idle_vacuum: 'Ainda sem marcha lenta quente (parado, sem A/C).', map_offset: 'Ainda sem leitura com a chave ligada e o motor parado.', idle_rpm: 'Ainda sem marcha lenta quente.',
  stft_idle: 'Ainda sem marcha lenta quente.', stft_cruise: 'Ainda sem trecho rodando leve com o motor quente.',
  o2_post: 'Ainda sem 5 min de motor quente (ou o perfil não lê a sonda depois do catalisador).',
  temp_plaus: 'Ainda sem partida a frio, depois de o carro ficar parado por horas.',
  clutch_slip: 'Ainda sem aceleração forte numa marcha (ou o perfil não tem as relações das marchas).',
};
// Na mistura, a atenção vem da mediana das últimas viagens (não de uma viagem só): o texto segue o estado da checagem.
const HL_ROLLING = new Set(['stft_idle', 'stft_cruise']);
const hlFlagged = (c) => c.lastFlagged || (HL_ROLLING.has(c.id) && c.level === 'WATCH');
let hlData = null;

/** Bateria do ESP32 fora da rede do carro na última viagem: o repouso e a partida dela foram descartados. */
function hlEspBattLine(e) {
  if (!e || !e.off) return null;
  return `A bateria lida pelo ESP32 ficou ${fmt(Math.abs(e.diff), 1)} V ${e.diff < 0 ? 'abaixo' : 'acima'} da rede do carro na última viagem: repouso e partida descartados. Não é defeito do carro; confira a alimentação da placa (fusível, emendas e terra).`;
}

function hlCentralLines(c) {
  if (!c) return ['Ainda sem leitura da central.'];
  const out = [];
  if (c.mil) out.push('Luz de injeção acesa.');
  if (c.confirmed.length) out.push('Códigos confirmados: ' + c.confirmed.join(', ') + ' (veja a aba Falhas).');
  if (c.pending.length) out.push('Códigos pendentes: ' + c.pending.join(', ') + '.');
  if (!out.length) out.push('Sem luz de injeção e sem códigos.');
  if (c.incomplete && c.incomplete.length) out.push('Testes da própria central ainda não concluídos: ' + c.incomplete.join(', ') + ' (normal depois de desligar a bateria ou apagar códigos).');
  return out;
}

function renderHealth() {
  hlData = parse(bridge.getHealth(), null);
  const list = $('hl-list');
  list.textContent = '';
  if (!hlData) return;
  const order = ['NO_DATA', 'LEARNING', 'OK', 'WATCH', 'ALERT'];
  const worst = hlData.subsystems.reduce((w, s) => (order.indexOf(s.level) > order.indexOf(w) ? s.level : w), 'NO_DATA');
  $('hl-pill').textContent = HL_LEVEL[worst][0];
  $('hl-pill').className = HL_LEVEL[worst][1];
  for (const sub of hlData.subsystems) {
    const box = document.createElement('div');
    box.className = 'health-sub';
    const head = document.createElement('div');
    head.className = 'esp-head';
    const name = document.createElement('b');
    name.textContent = HL_SUB[sub.id] || sub.id;
    const pill = document.createElement('span');
    pill.className = HL_LEVEL[sub.level][1];
    pill.textContent = HL_LEVEL[sub.level][0];
    head.append(name, pill);
    const ul = document.createElement('ul');
    const lines = sub.id === 'central'
      ? hlCentralLines(hlData.central).map((t) => [t, sub.level !== 'OK'])
      : sub.checks.map((c) => {
        if (c.value == null) return [HL_EMPTY[c.id] || 'Sem dados.', false];
        const txt = HL_CHECK[c.id] ? HL_CHECK[c.id](c.value, hlFlagged(c)) : String(c.value);
        const rep = c.flagged ? ` Fora do normal em ${c.flagged} das últimas ${c.recent} viagens.` : c.level === 'LEARNING' ? ' Aprendendo o normal deste carro (5 viagens).' : '';
        return [txt + rep, c.level === 'WATCH' || c.level === 'ALERT'];
      });
    const espLine = sub.id === 'electric' ? hlEspBattLine(hlData.espBatt) : null;
    if (espLine) lines.push([espLine, true]);
    for (const [t, flag] of lines) {
      const li = document.createElement('li');
      li.textContent = t;
      if (flag) li.className = 'flag';
      ul.appendChild(li);
    }
    box.append(head, ul);
    list.appendChild(box);
  }
}

$('hl-share').addEventListener('click', () => {
  if (!hlData) return;
  const lines = ['Saúde do carro (pré-diagnóstico do app; sugere verificar, não é diagnóstico)', ''];
  for (const sub of hlData.subsystems) {
    lines.push(`${HL_SUB[sub.id] || sub.id}: ${HL_LEVEL[sub.level][0]}`);
    if (sub.id === 'central') hlCentralLines(hlData.central).forEach((t) => lines.push('- ' + t));
    else sub.checks.filter((c) => c.value != null).forEach((c) => lines.push('- ' + HL_CHECK[c.id](c.value, hlFlagged(c))));
    if (sub.id === 'electric' && hlEspBattLine(hlData.espBatt)) lines.push('- ' + hlEspBattLine(hlData.espBatt));
  }
  bridge.shareHealth(lines.join('\n'));
});
$('hl-reset').addEventListener('click', () => {
  if (!confirm('Recomeçar o pré-diagnóstico? O histórico das checagens é apagado e o app volta a observar do zero (bom depois de um conserto).')) return;
  okOrToast(bridge.clearHealth(), 'Pré-diagnóstico recomeçado.');
  renderHealth();
});

async function loadMaintenance() {
  renderHealth();
  const seq = ++mtSeq;
  const json = await nativeAsync((id) => bridge.getMaintenance(id)).catch((e) => { toast(e.message, true); return null; });
  if (seq !== mtSeq) return;
  const data = parse(json, { items: [], presets: [] });
  mtTotalKm = Number.isFinite(data.totalKm) ? data.totalKm : null;
  mtPresets = data.presets || [];
  mtFillSelect();
  if (mtEditingId == null && !$('mt-last-km').value && mtTotalKm != null) $('mt-last-km').value = Math.round(mtTotalKm);
  if (mtEditingId == null && !$('mt-last-when').value) $('mt-last-when').value = dateInput(Date.now());
  $('mt-km').textContent = mtTotalKm != null ? fmt(mtTotalKm, 0) : '--';
  $('mt-due').textContent = data.items.filter((i) => i.status.level === 'DUE').length;
  $('mt-soon').textContent = data.items.filter((i) => i.status.level === 'SOON').length;
  mtItems = {};
  const lb = $('mt-list');
  lb.innerHTML = html`${data.items.length ? '' : emptyState('maint', 'Nenhum item ainda', 'Escolha um item no formulário e anote a próxima troca: o app avisa pelo hodômetro ou pela data.')}`;
  data.items.forEach((it) => {
    mtItems[it.id] = it;
    const lv = MT_LEVEL[it.status.level] || MT_LEVEL.UNKNOWN;
    const last = it.records[0];
    const el = document.createElement('div');
    el.className = 'item';
    el.innerHTML = html`<b>${it.name}</b> <span class="pill ${lv.cls}">${lv.text}</span>
      <div class="small">${mtWhenText(it.status)}</div>
      <div class="kv"><span>${last ? 'última: ' + dateOnly(last.timestamp) + (last.odometerKm != null ? ' · ' + fmt(last.odometerKm, 0) + ' km' : '') : 'nunca registrado'}</span></div>
      ${it.notes ? html`<div class="small muted">${it.notes}</div>` : ''}
      ${it.records.length ? html`<details class="small"><summary>Histórico (${it.records.length})</summary>${it.records.map((r) =>
        html`<div class="kv"><span>${dateOnly(r.timestamp)}</span><span>${r.odometerKm != null ? fmt(r.odometerKm, 0) + ' km' : 'sem km'}</span>
        <span>${r.cost != null ? 'R$ ' + fmt(r.cost, 2) : ''}</span><span>${r.notes || ''}</span>
        <button class="btn btn-small btn-danger-outline" data-mt-rdel="${r.id}">Apagar</button></div>`)}</details>` : ''}
      <div class="actions"><button class="btn btn-small btn-primary" data-mt-done="${it.id}">Feito</button>
      <button class="btn btn-small" data-mt-edit="${it.id}">Editar</button>
      <button class="btn btn-small btn-danger-outline" data-mt-del="${it.id}">Apagar</button></div>`;
    lb.appendChild(el);
  });
}

/* ---------------------------------------------------------------- novo item / edição */
$('mt-sel').addEventListener('change', () => {
  const v = $('mt-sel').value;
  $('mt-name-wrap').hidden = v !== MT_OUTRO;
  const p = v !== '' && v !== MT_OUTRO ? mtPresets[Number(v)] : null;
  if (p) {
    // Sugestão do manual: o mecânico pode passar outro número, é só trocar
    mtNext.set({ km: p.intervalKm, months: p.intervalMonths });
    if (!$('mt-notes').value && p.notes) $('mt-notes').value = p.notes;
  }
});

function mtResetForm() {
  mtEditingId = null;
  ['mt-name', 'mt-notes'].forEach((id) => { $(id).value = ''; });
  $('mt-sel').value = '';
  $('mt-sel').disabled = false;
  $('mt-name-wrap').hidden = true;
  $('mt-last-when').value = dateInput(Date.now());
  $('mt-last-km').value = mtTotalKm != null ? Math.round(mtTotalKm) : '';
  mtNext.set({});
  $('mt-form-title').textContent = 'Novo item de manutenção';
  $('mt-last-wrap').hidden = false;
  $('mt-cancel').hidden = true;
}

async function mtCall(call, okText) {
  const r = parse(await nativeAsync(call).catch((e) => JSON.stringify({ ok: false, error: e.message })), { ok: false, error: 'erro' });
  if (!r.ok) { toast(r.error || 'Não foi possível salvar', true); return null; }
  if (okText) toast(okText);
  loadMaintenance();
  return r;
}

function mtItemName() {
  if (mtEditingId != null || $('mt-sel').value === MT_OUTRO) return $('mt-name').value.trim();
  const p = mtPresets[Number($('mt-sel').value)];
  return $('mt-sel').value !== '' && p ? p.name : '';
}

$('mt-save').addEventListener('click', async () => {
  const name = mtItemName();
  if (!name) { toast('Escolha o item ou dê um nome.', true); return; }
  if (mtEditingId == null && numOrNull($('mt-last-km').value) == null) { toast('Informe o km da última vez (o hodômetro de hoje, se não lembrar).', true); return; }
  const body = { id: mtEditingId, name, notes: $('mt-notes').value.trim(), ...mtNext.read() };
  if (mtEditingId == null) {
    body.lastAt = fromDateInput($('mt-last-when').value);
    body.lastKm = numOrNull($('mt-last-km').value);
  }
  // Próxima troca já passada (pela data ou pelo km de hoje): cadastra assim mesmo e avisa que já está vencido
  const vencido = (body.nextAt && body.nextAt < Date.now()) || (body.nextKm != null && mtTotalKm != null && body.nextKm <= mtTotalKm);
  const ok = (mtEditingId == null ? 'Item criado' : 'Item alterado') + (vencido ? '. Ele já está vencido: aparece em vermelho e o app vai lembrar você.' : '');
  if (await mtCall((id) => bridge.saveMaintenanceItem(id, JSON.stringify(body)), ok)) mtResetForm();
});
$('mt-cancel').addEventListener('click', mtResetForm);

/* ---------------------------------------------------------------- feito (registro) */
function mtOpenRecord(it) {
  mtRecordingId = it.id;
  $('mt-rec-name').textContent = it.name;
  $('mt-rec-when').value = dateInput(Date.now());
  $('mt-rec-km').value = mtTotalKm != null ? Math.round(mtTotalKm) : '';
  $('mt-rec-cost').value = '';
  $('mt-rec-notes').value = '';
  // Sugere o mesmo intervalo da vez anterior; o mecânico pode passar outro
  mtRecNext.set({ km: it.intervalKm, months: it.intervalMonths });
  $('mt-rec-form').hidden = false;
  $('mt-rec-form').scrollIntoView({ block: 'nearest', behavior: 'smooth' });
}
$('mt-rec-cancel').addEventListener('click', () => { $('mt-rec-form').hidden = true; mtRecordingId = null; });
$('mt-rec-save').addEventListener('click', async () => {
  if (mtRecordingId == null) return;
  if (numOrNull($('mt-rec-km').value) == null) { toast('Informe o km do hodômetro.', true); return; }
  const body = {
    itemId: mtRecordingId, timestamp: fromDateInput($('mt-rec-when').value), odometerKm: numOrNull($('mt-rec-km').value),
    cost: numOrNull($('mt-rec-cost').value), notes: $('mt-rec-notes').value.trim(), ...mtRecNext.read(),
  };
  if (await mtCall((id) => bridge.addMaintenanceRecord(id, JSON.stringify(body)), 'Serviço registrado')) {
    $('mt-rec-form').hidden = true;
    mtRecordingId = null;
  }
});

/* ---------------------------------------------------------------- ações da lista */
$('mt-list').addEventListener('click', (e) => {
  const b = e.target.closest('button');
  if (!b) return;
  if (b.dataset.mtDone) mtOpenRecord(mtItems[b.dataset.mtDone]);
  if (b.dataset.mtEdit) {
    const it = mtItems[b.dataset.mtEdit];
    mtEditingId = it.id;
    $('mt-sel').value = MT_OUTRO;
    $('mt-sel').disabled = true;
    $('mt-name-wrap').hidden = false;
    $('mt-name').value = it.name;
    $('mt-notes').value = it.notes || '';
    // a base do "daqui a" é a última vez registrada
    const last = it.records[0];
    $('mt-last-when').value = last ? dateInput(last.timestamp) : dateInput(Date.now());
    $('mt-last-km').value = last && last.odometerKm != null ? Math.round(last.odometerKm) : (mtTotalKm != null ? Math.round(mtTotalKm) : '');
    mtNext.set({ nextKmV: it.status.nextKm, nextAtV: it.setNextAt || (it.intervalMonths ? it.status.nextAt : null) });
    $('mt-form-title').textContent = 'Editar item';
    $('mt-last-wrap').hidden = true;
    $('mt-cancel').hidden = false;
    $('mt-name').focus();
  }
  if (b.dataset.mtDel && confirm(`Apagar "${mtItems[b.dataset.mtDel].name}" e o histórico dele?`)) {
    mtCall((id) => bridge.deleteMaintenanceItem(id, Number(b.dataset.mtDel)), 'Item apagado');
  }
  if (b.dataset.mtRdel && confirm('Apagar este registro?')) {
    mtCall((id) => bridge.deleteMaintenanceRecord(id, Number(b.dataset.mtRdel)), 'Registro apagado');
  }
});

mtResetForm();

/* ---------------------------------------------------------------- aviso de manutenção no alto do app */
/* Ao abrir o app (no máximo a cada 12 h) e durante a captura, quando o km lido faz um item vencer: uma faixa no
   alto com o item, "Ver na Manutenção" e o ✕. Fecha sozinha em 10 s. A notificação diária do Android continua. */
const MT_AVISO_KEY = 'manutencao.avisoEm';
const MT_AVISO_INTERVALO_MS = 12 * 3600e3;
const MT_AVISO_DURA_MS = 10000;
const mtAvisados = new Set();
let mtAvisoTimer = 0;

function mtEsconderAviso() {
  clearTimeout(mtAvisoTimer);
  $('mt-aviso').hidden = true;
}

function mtMostrarAviso(itens, vencidos) {
  const primeiro = itens[0];
  $('mt-aviso').classList.toggle('due', vencidos);
  $('mt-aviso-titulo').textContent = vencidos ? 'Manutenção vencida' : 'Manutenção perto de vencer';
  $('mt-aviso-texto').textContent = `${primeiro.name}: ${mtWhenText(primeiro.status)}` + (itens.length > 1 ? ` (e mais ${itens.length - 1})` : '');
  // Recomeça a barra de tempo
  const barra = $('mt-aviso-barra');
  barra.classList.remove('correndo');
  void barra.offsetWidth;
  barra.classList.add('correndo');
  $('mt-aviso').hidden = false;
  clearTimeout(mtAvisoTimer);
  mtAvisoTimer = setTimeout(mtEsconderAviso, MT_AVISO_DURA_MS);
}

async function mtConferirAvisos(origem) {
  const data = parse(await nativeAsync((id) => bridge.getMaintenance(id)).catch(() => null), null);
  if (!data || !Array.isArray(data.items)) return;
  const due = data.items.filter((i) => i.status.level === 'DUE');
  if (origem === 'abrir') {
    const soon = data.items.filter((i) => i.status.level === 'SOON');
    due.forEach((i) => mtAvisados.add(i.id));
    if (!due.length && !soon.length) return;
    let ultimo = 0;
    try { ultimo = Number(localStorage.getItem(MT_AVISO_KEY)) || 0; } catch (e) { /* sem armazenamento: avisa */ }
    if (Date.now() - ultimo < MT_AVISO_INTERVALO_MS) return;
    try { localStorage.setItem(MT_AVISO_KEY, String(Date.now())); } catch (e) { /* idem */ }
    mtMostrarAviso(due.length ? due : soon, due.length > 0);
    return;
  }
  // Durante a captura: só o que acabou de vencer com o km lido agora
  const novos = due.filter((i) => !mtAvisados.has(i.id));
  novos.forEach((i) => mtAvisados.add(i.id));
  if (novos.length) mtMostrarAviso(novos, true);
}

$('mt-aviso-fechar').addEventListener('click', mtEsconderAviso);
$('mt-aviso-ver').addEventListener('click', () => {
  mtEsconderAviso();
  const aba = document.querySelector('.tab[data-tab="maint"]');
  if (aba) aba.click();
});
setInterval(() => { if (lastState && lastState.running) mtConferirAvisos('captura').catch(() => {}); }, 90000);

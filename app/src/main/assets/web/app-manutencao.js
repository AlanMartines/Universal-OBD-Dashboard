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
    /** {nextKm, nextAt} para enviar; data de hoje ou passada não conta (o item vence só pelo km). */
    read() {
      const at = fromDateInput(nextDate.value);
      return { nextKm: numOrNull(nextKm.value), nextAt: at && at > Date.now() + 12 * 3600e3 ? at : null };
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

async function loadMaintenance() {
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
  lb.innerHTML = data.items.length ? '' : '<p class="muted small">Nenhum item ainda. Escolha um item no formulário e anote a próxima troca.</p>';
  data.items.forEach((it) => {
    mtItems[it.id] = it;
    const lv = MT_LEVEL[it.status.level] || MT_LEVEL.UNKNOWN;
    const last = it.records[0];
    const el = document.createElement('div');
    el.className = 'item';
    el.innerHTML = `<b>${esc(it.name)}</b> <span class="pill ${lv.cls}">${lv.text}</span>
      <div class="small">${mtWhenText(it.status)}</div>
      <div class="kv"><span>${last ? 'última: ' + dateOnly(last.timestamp) + (last.odometerKm != null ? ' · ' + fmt(last.odometerKm, 0) + ' km' : '') : 'nunca registrado'}</span></div>
      ${it.notes ? `<div class="small muted">${esc(it.notes)}</div>` : ''}
      ${it.records.length ? `<details class="small"><summary>Histórico (${it.records.length})</summary>${it.records.map((r) =>
        `<div class="kv"><span>${dateOnly(r.timestamp)}</span><span>${r.odometerKm != null ? fmt(r.odometerKm, 0) + ' km' : 'sem km'}</span>
        <span>${r.cost != null ? 'R$ ' + fmt(r.cost, 2) : ''}</span><span>${esc(r.notes || '')}</span>
        <button class="btn btn-small btn-danger" data-mt-rdel="${r.id}">Apagar</button></div>`).join('')}</details>` : ''}
      <div class="actions"><button class="btn btn-small btn-primary" data-mt-done="${it.id}">Feito</button>
      <button class="btn btn-small" data-mt-edit="${it.id}">Editar</button>
      <button class="btn btn-small btn-danger" data-mt-del="${it.id}">Apagar</button></div>`;
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
  if (await mtCall((id) => bridge.saveMaintenanceItem(id, JSON.stringify(body)), mtEditingId == null ? 'Item criado' : 'Item alterado')) mtResetForm();
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

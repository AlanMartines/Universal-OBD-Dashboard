'use strict';
/* Manutenção: itens com intervalo em km e/ou meses, registro de cada vez feita e o plano do manual do veículo.
   Os arquivos app-*.js compartilham o escopo global e são carregados em ordem (index.html). */
const MT_LEVEL = {
  DUE: { text: 'Vencido', cls: 'pill-bad' },
  SOON: { text: 'Perto de vencer', cls: 'pill-warn' },
  OK: { text: 'Em dia', cls: 'pill-ok' },
  UNKNOWN: { text: 'Sem registro', cls: '' },
};
const dateOnly = (ms) => new Date(ms).toLocaleDateString('pt-BR');
const dateInput = (ms) => { const d = new Date(ms - new Date(ms).getTimezoneOffset() * 60000); return d.toISOString().slice(0, 10); };
/** "2026-11-11" do campo de data → meio-dia local (evita cair no dia anterior pelo fuso). */
const fromDateInput = (v) => (v ? new Date(v + 'T12:00:00').getTime() : null);
const numOrNull = (v) => { const n = parseFloat(String(v).replace(',', '.')); return Number.isFinite(n) ? n : null; };

let mtSeq = 0;
let mtItems = {};
let mtEditingId = null;
let mtRecordingId = null;
let mtTotalKm = null;

function mtIntervalText(it) {
  const p = [];
  if (it.intervalKm) p.push(fmt(it.intervalKm, 0) + ' km');
  if (it.intervalMonths) p.push(it.intervalMonths + (it.intervalMonths === 1 ? ' mês' : ' meses'));
  return 'a cada ' + p.join(' ou ');
}

function mtWhenText(s) {
  if (!s || s.level === 'UNKNOWN') return 'Registre a última vez feita para calcular o vencimento.';
  const p = [];
  if (s.remainingKm != null) p.push(s.remainingKm <= 0 ? `vencido há ${fmt(-s.remainingKm, 0)} km` : `faltam ${fmt(s.remainingKm, 0)} km (aos ${fmt(s.nextKm, 0)} km)`);
  else if (s.nextKm != null) p.push(`aos ${fmt(s.nextKm, 0)} km`);
  if (s.remainingDays != null) p.push(s.remainingDays < 0 ? `vencido há ${-s.remainingDays} dias` : `vence em ${dateOnly(s.nextAt)} (${s.remainingDays} dias)`);
  return p.join(' · ') || 'Sem intervalo calculável (anote o km da última vez).';
}

async function loadMaintenance() {
  const seq = ++mtSeq;
  const json = await nativeAsync((id) => bridge.getMaintenance(id)).catch((e) => { toast(e.message, true); return null; });
  if (seq !== mtSeq) return;
  const data = parse(json, { items: [], presets: [] });
  mtTotalKm = Number.isFinite(data.totalKm) ? data.totalKm : null;
  $('mt-km').textContent = mtTotalKm != null ? fmt(mtTotalKm, 0) : '--';
  $('mt-due').textContent = data.items.filter((i) => i.status.level === 'DUE').length;
  $('mt-soon').textContent = data.items.filter((i) => i.status.level === 'SOON').length;
  mtItems = {};
  const lb = $('mt-list');
  lb.innerHTML = data.items.length ? '' : '<p class="muted small">Nenhum item ainda. Adicione do plano sugerido ou crie um.</p>';
  data.items.forEach((it) => {
    mtItems[it.id] = it;
    const lv = MT_LEVEL[it.status.level] || MT_LEVEL.UNKNOWN;
    const last = it.records[0];
    const el = document.createElement('div');
    el.className = 'item';
    el.innerHTML = `<b>${esc(it.name)}</b> <span class="pill ${lv.cls}">${lv.text}</span>
      <div class="kv"><span>${mtIntervalText(it)}</span>
      <span>${last ? 'última: ' + dateOnly(last.timestamp) + (last.odometerKm != null ? ' · ' + fmt(last.odometerKm, 0) + ' km' : '') : 'nunca registrado'}</span></div>
      <div class="small">${mtWhenText(it.status)}</div>
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

  const pending = (data.presets || []).filter((p) => !p.exists);
  $('mt-presets-card').hidden = !pending.length;
  $('mt-presets-title').textContent = data.presetsFromProfile ? 'Plano do manual do veículo' : 'Plano sugerido (genérico; confira no manual)';
  const pb = $('mt-presets');
  pb.innerHTML = '';
  pending.forEach((p, i) => {
    const l = document.createElement('label');
    l.className = 'check';
    l.innerHTML = `<input type="checkbox" checked data-mt-preset="${i}"> ${esc(p.name)} <small class="muted">(${mtIntervalText(p)})</small>`;
    l.querySelector('input').dataset.name = p.name;
    pb.appendChild(l);
  });
}

function mtResetForm() {
  mtEditingId = null;
  ['mt-name', 'mt-ikm', 'mt-imonths', 'mt-notes', 'mt-last-when', 'mt-last-km'].forEach((id) => { $(id).value = ''; });
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

$('mt-save').addEventListener('click', async () => {
  const body = {
    id: mtEditingId, name: $('mt-name').value.trim(), intervalKm: numOrNull($('mt-ikm').value),
    intervalMonths: numOrNull($('mt-imonths').value), notes: $('mt-notes').value.trim(),
  };
  if (mtEditingId == null) {
    body.lastAt = fromDateInput($('mt-last-when').value);
    body.lastKm = numOrNull($('mt-last-km').value);
  }
  if (await mtCall((id) => bridge.saveMaintenanceItem(id, JSON.stringify(body)), mtEditingId == null ? 'Item criado' : 'Item alterado')) mtResetForm();
});
$('mt-cancel').addEventListener('click', mtResetForm);

$('mt-presets-add').addEventListener('click', () => {
  const names = [...document.querySelectorAll('[data-mt-preset]:checked')].map((c) => c.dataset.name);
  if (!names.length) return;
  mtCall((id) => bridge.addMaintenancePresets(id, JSON.stringify(names)), 'Itens adicionados. Registre a última vez de cada um.');
});

function mtOpenRecord(it) {
  mtRecordingId = it.id;
  $('mt-rec-name').textContent = it.name;
  $('mt-rec-when').value = dateInput(Date.now());
  $('mt-rec-km').value = mtTotalKm != null ? Math.round(mtTotalKm) : '';
  $('mt-rec-cost').value = '';
  $('mt-rec-notes').value = '';
  $('mt-rec-form').hidden = false;
  $('mt-rec-form').scrollIntoView({ block: 'nearest', behavior: 'smooth' });
}
$('mt-rec-cancel').addEventListener('click', () => { $('mt-rec-form').hidden = true; mtRecordingId = null; });
$('mt-rec-save').addEventListener('click', async () => {
  if (mtRecordingId == null) return;
  const body = {
    itemId: mtRecordingId, timestamp: fromDateInput($('mt-rec-when').value), odometerKm: numOrNull($('mt-rec-km').value),
    cost: numOrNull($('mt-rec-cost').value), notes: $('mt-rec-notes').value.trim(),
  };
  if (await mtCall((id) => bridge.addMaintenanceRecord(id, JSON.stringify(body)), 'Serviço registrado')) {
    $('mt-rec-form').hidden = true;
    mtRecordingId = null;
  }
});

$('mt-list').addEventListener('click', (e) => {
  const b = e.target.closest('button');
  if (!b) return;
  if (b.dataset.mtDone) mtOpenRecord(mtItems[b.dataset.mtDone]);
  if (b.dataset.mtEdit) {
    const it = mtItems[b.dataset.mtEdit];
    mtEditingId = it.id;
    $('mt-name').value = it.name;
    $('mt-ikm').value = it.intervalKm ?? '';
    $('mt-imonths').value = it.intervalMonths ?? '';
    $('mt-notes').value = it.notes || '';
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

'use strict';
/* Abastecimentos: registro, consumo real, calibração e CSV. Os arquivos app-*.js compartilham o escopo global e são carregados em ordem (index.html). */
/* ---------------------------------------------------------------- Abastecimentos */
const FUEL_NAMES = { gasoline: 'Gasolina', gasoline_premium: 'Gasolina aditivada', ethanol: 'Etanol', mix: 'Mistura' };
const brl = (v, d = 2) => (v == null ? '--' : 'R$ ' + fmt(v, d));
const localInput = (ms) => { const d = new Date(ms - new Date(ms).getTimezoneOffset() * 60000); return d.toISOString().slice(0, 16); };

let fuelSeq = 0;
let fuItems = {};
/** Abastecimento em edição no formulário de cima (null = novo registro). */
let fuEditingId = null;

/** Hodômetro de agora: o do painel do carro (escuta CAN) durante a captura, senão o Total do app. */
function currentOdometerKm() {
  const can = lastState && lastState.running && lastState.readings ? lastState.readings.odometer_km : null;
  if (Number.isFinite(can)) return can;
  const s = parse(bridge.getSettings(), {});
  return Number.isFinite(s.odometerKm) ? s.odometerKm : null;
}

/** Novo abastecimento: o hodômetro já vem preenchido e pode ser corrigido. */
function prefillFuelOdometer() {
  if (fuEditingId != null || $('fu-odo').value || document.activeElement === $('fu-odo')) return;
  const km = currentOdometerKm();
  if (km != null) $('fu-odo').value = String(Math.round(km));
}

async function loadFuel() {
  prefillFuelOdometer();
  const seq = ++fuelSeq;
  const json = await nativeAsync((id) => bridge.getFuelUps(id)).catch(() => null);
  if (seq !== fuelSeq) return; // outra atualização começou depois desta
  const data = parse(json, { items: [], summary: {}, intervals: [] });
  const s = data.summary || {};
  const last = data.intervals[0];
  // Valor que ainda não dá para calcular: frase curta do que falta, no lugar de "--"
  const tile = (id, v, missing) => { const b = $(id); b.textContent = v != null ? v : missing; b.classList.toggle('missing', v == null); };
  tile('fu-kml', s.avgKmPerL != null ? fmt(s.avgKmPerL, 1) + ' km/l' : null, 'falta 2º tanque cheio');
  $('fu-kml-note').textContent = last ? `último: ${fmt(last.kmPerL, 1)} km/l` : s.avgKmPerL != null ? 'entre tanques cheios' : '';
  tile('fu-rkm', s.costPerKm != null ? brl(s.costPerKm) : null, 'com o preço pago');
  const months = Object.entries(s.costByMonth || {});
  const cur = months.length ? months[months.length - 1] : null;
  tile('fu-month', cur ? brl(cur[1]) : null, 'nenhum este mês');
  $('fu-month-note').textContent = cur ? cur[0].split('-').reverse().join('/') : '';
  $('fu-rkm-note').textContent = s.totalCost ? `${brl(s.totalCost)} no total` : '';
  $('fu-breakeven').textContent = s.ethanolBreakEven != null
    ? `Etanol compensa neste carro quando custar menos de ${fmt(s.ethanolBreakEven * 100, 0)}% do preço da gasolina (consumo medido).`
    : 'Registre tanques cheios com etanol e com gasolina para calcular quando o etanol compensa neste carro.';

  renderCalibration(data.calibration);
  renderCalibration(data.calibrationEthanol, '-e');
  renderEthanolHint(data.ethanolHint);

  const ib = $('fu-intervals');
  ib.innerHTML = data.intervals.length ? '' : '<p class="muted small">Precisa de dois tanques cheios com hodômetro.</p>';
  data.intervals.forEach((iv) => {
    const el = document.createElement('div');
    el.className = 'item';
    let est = '';
    if (iv.estimatedLiters != null) {
      const diff = (iv.estimatedLiters / iv.liters - 1) * 100;
      est = html`<span class="${Math.abs(diff) <= 5 ? 'delta-ok' : 'delta-warn'}">app estimou ${fmt(iv.estimatedLiters, 1)} L (${diff > 0 ? '+' : ''}${fmt(diff, 0)}%)</span>`;
    }
    el.innerHTML = html`<b>${fmt(iv.kmPerL, 1)} km/l</b> · ${fmt(iv.km, 0)} km · ${fmt(iv.liters, 2)} L · ${FUEL_NAMES[iv.fuelType] || iv.fuelType}
      <div class="kv"><span>${dt(iv.from)} → ${dt(iv.to)}</span><span>${brl(iv.costPerKm)}/km</span>${est}</div>`;
    ib.appendChild(el);
  });

  fuItems = Object.fromEntries(data.items.map((f) => [String(f.id), f]));
  const lb = $('fu-list');
  lb.innerHTML = html`${data.items.length ? '' : emptyState('fuel', 'Nenhum abastecimento ainda', 'Registre cada abastecimento no formulário. Com dois tanques cheios, o app calcula o consumo real e o custo por km.')}`;
  data.items.forEach((f) => {
    const el = document.createElement('div');
    el.className = 'item';
    el.innerHTML = html`<b>${dt(f.timestamp)}</b> · ${fmt(f.liters, 3)} L · ${brl(f.totalPrice)}${f.fullTank ? ' · cheio' : ' · parcial'}
      <div class="kv"><span>${f.odometerKm != null ? fmt(f.odometerKm, 0) + ' km' : 'sem hodômetro'}</span><span>${brl(f.pricePerLiter, 3)}/L</span>
      <span>${FUEL_NAMES[f.fuelType] || f.fuelType}${f.ethanolPct != null ? ' ' + fmt(f.ethanolPct, 0) + '% etanol' : ''}</span><span>${f.station || ''}</span></div>
      <div class="actions"><button class="btn btn-small" data-fu-edit="${f.id}">Editar</button>
      <button class="btn btn-small btn-danger-outline" data-fu-delete="${f.id}">Apagar</button></div>`;
    lb.appendChild(el);
  });
  refreshFuelWhen();
  loadFuelSync();
}

/* ---------------------------------------------------------------- Painel web */
/** O painel é espelho do app: a lista inteira vai junto, com edições e exclusões. */
let fuSyncRecheck = null;
async function loadFuelSync(again) {
  const s = parse(await nativeAsync((id) => bridge.getFuelSyncStatus(id)).catch(() => null), { paired: false });
  // Ao salvar, o app já envia sozinho: confere de novo em alguns segundos em vez de deixar "aguardando".
  clearTimeout(fuSyncRecheck);
  if (s.paired && !s.inSync && !again) fuSyncRecheck = setTimeout(() => loadFuelSync(true), 4000);
  $('fu-sync').disabled = !s.paired;
  $('fu-sync-status').textContent = !s.paired ? 'Pareie este veículo em Ajustes → Telemetria remota para ver no painel.'
    : s.inSync ? `Painel atualizado${s.sentAt ? ' em ' + dt(s.sentAt) : ''}.` : 'Alterações aguardando envio ao painel.';
}

$('fu-sync').addEventListener('click', async () => {
  const btn = $('fu-sync');
  btn.disabled = true;
  btn.textContent = 'Enviando…';
  const res = await nativeAsync((id) => bridge.sendFuelUpsNow(id)).catch((e) => e.message);
  btn.textContent = 'Enviar ao painel';
  okOrToast(res, 'Abastecimentos enviados ao painel.');
  loadFuelSync();
});

/* Data e hora do abastecimento: acompanha o relógio até o usuário editar (senão um registro feito
   horas depois sairia com o horário do anterior e não acertaria o tanque). */
let fuWhenEdited = false;
function refreshFuelWhen() {
  if (!fuWhenEdited) $('fu-when').value = localInput(Date.now());
}
$('fu-when').addEventListener('input', () => { fuWhenEdited = true; });
setInterval(refreshFuelWhen, 30000);
refreshFuelWhen();
document.addEventListener('visibilitychange', () => { if (!document.hidden) refreshFuelWhen(); });

// Pista do % de etanol medida na primeira viagem depois do último abastecimento
let fuHint = null;
function renderEthanolHint(h) {
  fuHint = h;
  $('fu-ethanol-hint').hidden = !h;
  if (!h) return;
  const sinal = (x) => (x > 0 ? 'a mais' : 'a menos');
  const salto = `a mistura pediu ${fmt(Math.abs(h.shift), 0)}% de combustível ${sinal(h.shift)}`;
  const esperado = `pelo informado (${fmt(h.informed, 0)}% de etanol da bomba no tanque), o esperado era ${fmt(Math.abs(h.expected), 0)}% ${sinal(h.expected)}`;
  $('fu-hint-text').textContent = h.mismatch
    ? `Depois do abastecimento de ${dt(h.refuelAt)}, ${salto}; ${esperado}. O tanque parece ter cerca de ${fmt(h.estimated, 0)}% de etanol da bomba: confira o que foi colocado (a bomba pode ter outra mistura).`
    : `Depois do abastecimento de ${dt(h.refuelAt)}, ${salto}, perto do esperado pelo informado (${fmt(h.informed, 0)}% de etanol da bomba no tanque).`;
  $('fu-hint-apply').hidden = !h.mismatch;
  if (h.mismatch) $('fu-hint-apply').textContent = `Usar ${fmt(h.estimated, 0)}% no tanque`;
}
$('fu-hint-apply').addEventListener('click', () => {
  if (!fuHint || !confirm(`Considerar ${fmt(fuHint.estimated, 0)}% de etanol da bomba no tanque? O consumo passa a ser calculado com essa mistura.`)) return;
  bridge.setEthanolPercent(Math.round(fuHint.estimated));
  toast('Mistura do tanque atualizada.');
  loadFuel();
});

// Uma calibração por combustível: '' = gasolina, '-e' = etanol (tanque com metade ou mais de etanol da bomba)
const fuCal = { '': null, '-e': null };
function renderCalibration(c, sfx = '') {
  fuCal[sfx] = c;
  if (!c) { $('fu-calibration' + sfx).hidden = true; return; }
  $('fu-calibration' + sfx).hidden = false;
  const pct = (x) => (x > 0 ? '+' : '') + fmt(x * 100, 1) + '%';
  const ethanol = sfx === '-e';
  const factor = ethanol && !c.own
    ? `Sem correção própria: segue a da gasolina (fator ${fmt(c.factor, 3)}).`
    : `Fator atual: ${fmt(c.factor, 3)}${(c.factor !== 1 || ethanol) && c.since ? ' (desde ' + dt(c.since) + ')' : ' (padrão do perfil)'}.`;
  let msg;
  if (c.suggested != null) {
    msg = `Em ${c.used} intervalos, o app estimou ${pct(c.deviation)} em relação aos litros reais. Correção sugerida: fator ${fmt(c.suggested, 3)}.`;
  } else if (c.missing > 0) {
    msg = `Faltam ${c.missing} intervalo(s) entre tanques cheios com consumo gravado pelo app para sugerir uma correção` +
      (c.used ? ` (até agora ${c.used}, desvio ${pct(c.deviation)})` : '') + '.';
  } else {
    msg = `Em ${c.used} intervalos, o app está a ${pct(c.deviation)} dos litros reais: não precisa de correção.`;
  }
  if (c.ignored) msg += ` ${c.ignored} intervalo(s) ignorado(s) por diferença grande.`;
  $('fu-cal-text' + sfx).textContent = msg + ' ' + factor;
  $('fu-cal-apply' + sfx).hidden = c.suggested == null;
  if (c.suggested != null) $('fu-cal-apply' + sfx).textContent = `Aplicar fator ${fmt(c.suggested, 3)}`;
  $('fu-cal-reset' + sfx).hidden = ethanol ? !c.own : c.factor === 1;
}
$('fu-cal-apply').addEventListener('click', () => {
  const c = fuCal[''];
  if (!c || c.suggested == null || !confirm(`Aplicar o fator ${fmt(c.suggested, 3)} ao consumo calculado com gasolina?`)) return;
  const r = bridge.setFuelCorrection(c.suggested);
  if (r !== 'ok') alert(r);
  loadFuel();
});
$('fu-cal-reset').addEventListener('click', () => {
  if (!confirm('Voltar ao consumo calculado só pelo perfil (fator 1,000)?')) return;
  const r = bridge.setFuelCorrection(1);
  if (r !== 'ok') alert(r);
  loadFuel();
});
$('fu-cal-apply-e').addEventListener('click', () => {
  const c = fuCal['-e'];
  if (!c || c.suggested == null || !confirm(`Aplicar o fator ${fmt(c.suggested, 3)} ao consumo calculado com etanol?`)) return;
  const r = bridge.setFuelCorrectionEthanol(c.suggested);
  if (r !== 'ok') alert(r);
  loadFuel();
});
$('fu-cal-reset-e').addEventListener('click', () => {
  if (!confirm('O etanol volta a usar a correção da gasolina?')) return;
  const r = bridge.setFuelCorrectionEthanol(0);
  if (r !== 'ok') alert(r);
  loadFuel();
});

// Preço por litro ⇄ valor total, a partir dos litros
const num = (id) => { const v = parseFloat(String($(id).value).replace(',', '.')); return Number.isFinite(v) ? v : null; };
$('fu-total').addEventListener('input', () => { const l = num('fu-liters'), t = num('fu-total'); if (l && t != null) $('fu-ppl').value = (t / l).toFixed(3); });
$('fu-ppl').addEventListener('input', () => { const l = num('fu-liters'), p = num('fu-ppl'); if (l && p != null) $('fu-total').value = (p * l).toFixed(2); });
$('fu-type').addEventListener('change', (e) => { $('fu-eth-wrap').hidden = e.target.value !== 'mix'; });
$('fu-save').addEventListener('click', async () => {
  // Sem escolha pronta: o consumo real e a calibração dependem de saber se o tanque foi completado
  if (!$('fu-fill-full').checked && !$('fu-fill-partial').checked) {
    toast('Informe se completou o tanque ou se foi parcial.', true);
    $('fu-fill').scrollIntoView({ block: 'center' });
    return;
  }
  const when = fuWhenEdited && $('fu-when').value ? new Date($('fu-when').value).getTime() : Date.now();
  const json = JSON.stringify({
    timestamp: when, odometerKm: num('fu-odo'), liters: num('fu-liters'), totalPrice: num('fu-total'), pricePerLiter: num('fu-ppl'),
    fuelType: $('fu-type').value, ethanolPct: $('fu-type').value === 'mix' ? num('fu-eth') : null,
    fullTank: $('fu-fill-full').checked, station: $('fu-station').value,
  });
  $('fu-save').disabled = true; // evita salvar duas vezes com toques repetidos
  const editing = fuEditingId;
  const res = await (editing != null
    ? nativeAsync((id) => bridge.updateFuelUp(id, editing, json))
    : nativeAsync((id) => bridge.addFuelUp(id, json))).catch((err) => err.message);
  $('fu-save').disabled = false;
  const [status, info] = String(res).split('|');
  $('fu-result').textContent = status === 'ok' ? (editing != null ? 'Alterações salvas.' : 'Abastecimento salvo.') + (info ? ' ' + info + '.' : '') : res;
  const kindText = $('fu-fill-full').checked ? 'tanque cheio' : 'parcial';
  toast(status === 'ok' ? (editing != null ? `Alterações salvas (${kindText}).` : `Abastecimento salvo como ${kindText}.`) : res, status !== 'ok');
  if (status === 'ok') {
    ['fu-odo', 'fu-liters', 'fu-total', 'fu-ppl', 'fu-eth', 'fu-station'].forEach((id) => { $(id).value = ''; });
    resetFuelForm();
    fuWhenEdited = false;
    loadFuel();
  }
});
$('fu-list').addEventListener('click', async (e) => {
  const b = e.target.closest('[data-fu-delete]');
  if (!b || !confirm('Apagar este abastecimento?')) return;
  const res = await nativeAsync((id) => bridge.deleteFuelUp(id, Number(b.dataset.fuDelete))).catch((err) => err.message);
  if (res !== 'ok') alert(res);
  loadFuel();
});
$('fu-export').addEventListener('click', async () => {
  const r = await nativeAsync((id) => bridge.exportFuelUps(id)).catch((err) => err.message);
  if (r !== 'ok') alert(r);
});
$('fu-pick').addEventListener('click', () => bridge.pickFuelCsv());
window.onFuelCsvPicked = (r) => {
  if (r.ok) $('fu-csv').value = r.text;
  const lines = r.ok ? r.text.split(/\r?\n/).filter((l) => l.trim()).length - 1 : 0;
  $('fu-import-result').textContent = r.ok ? `Arquivo carregado: ${lines} linha(s). Confira e toque em Importar.` : 'Erro: ' + r.error;
  $('fu-import-result').style.color = r.ok ? '' : 'var(--red)';
};
$('fu-import').addEventListener('click', async () => {
  const replace = $('fu-replace').checked;
  if (replace && !confirm('Apagar os abastecimentos deste veículo e ficar só com os do CSV?')) return;
  const csv = $('fu-csv').value;
  $('fu-import').disabled = true;
  const r = parse(await nativeAsync((id) => bridge.importFuelUps(id, csv, replace)).catch(() => null), { ok: false, error: 'resposta inválida' });
  $('fu-import').disabled = false;
  $('fu-import-result').textContent = r.ok
    ? `${r.added} importado(s), ${r.skipped} já existia(m)${r.removed ? `, ${r.removed} substituído(s)` : ''}.` : 'Erro: ' + r.error;
  $('fu-import-result').style.color = r.ok ? 'var(--accent)' : 'var(--red)';
  if (r.ok) { $('fu-csv').value = ''; $('fu-replace').checked = false; loadFuel(); }
});


/* ---------------------------------------------------------------- Editar */
function resetFuelForm() {
  ['fu-odo', 'fu-liters', 'fu-total', 'fu-ppl', 'fu-eth', 'fu-station'].forEach((id) => { $(id).value = ''; });
  $('fu-fill-full').checked = false;
  $('fu-fill-partial').checked = false;
  $('fu-type').value = 'gasoline';
  $('fu-eth-wrap').hidden = true;
  fuEditingId = null;
  fuWhenEdited = false;
  refreshFuelWhen();
  $('fu-save').textContent = 'Salvar abastecimento';
  $('fu-cancel').hidden = true;
}

/** Preenche o formulário com o registro escolhido; salvar atualiza em vez de criar outro. */
function editFuelUp(f) {
  fuEditingId = f.id;
  fuWhenEdited = true;
  $('fu-when').value = localInput(f.timestamp);
  const val = (v, d) => (v == null ? '' : Number(v).toFixed(d));
  $('fu-odo').value = val(f.odometerKm, 0);
  $('fu-liters').value = val(f.liters, 3);
  $('fu-total').value = val(f.totalPrice, 2);
  $('fu-ppl').value = val(f.pricePerLiter, 3);
  $('fu-type').value = f.fuelType;
  $('fu-eth-wrap').hidden = f.fuelType !== 'mix';
  $('fu-eth').value = val(f.ethanolPct, 0);
  $('fu-fill-full').checked = !!f.fullTank;
  $('fu-fill-partial').checked = !f.fullTank;
  $('fu-station').value = f.station || '';
  $('fu-save').textContent = 'Salvar alterações';
  $('fu-cancel').hidden = false;
  $('fu-result').textContent = 'Editando o abastecimento de ' + dt(f.timestamp) + '. O nível do tanque não muda ao salvar.';
  $('fu-when').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

$('fu-list').addEventListener('click', (e) => {
  const b = e.target.closest('[data-fu-edit]');
  const f = b && fuItems[b.dataset.fuEdit];
  if (f) editFuelUp(f);
});
$('fu-cancel').addEventListener('click', () => {
  resetFuelForm();
  $('fu-result').textContent = '';
  toast('Edição cancelada.');
});

'use strict';
/* Abastecimentos: registro, consumo real, calibração e CSV. Os arquivos app-*.js compartilham o escopo global e são carregados em ordem (index.html). */
/* ---------------------------------------------------------------- Abastecimentos */
const FUEL_NAMES = { gasoline: 'Gasolina', gasoline_premium: 'Gasolina aditivada', ethanol: 'Etanol', mix: 'Mistura' };
const brl = (v, d = 2) => (v == null ? '--' : 'R$ ' + fmt(v, d));
const esc = (t) => String(t == null ? '' : t).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const localInput = (ms) => { const d = new Date(ms - new Date(ms).getTimezoneOffset() * 60000); return d.toISOString().slice(0, 16); };

function loadFuel() {
  const data = parse(bridge.getFuelUps(), { items: [], summary: {}, intervals: [] });
  const s = data.summary || {};
  const last = data.intervals[0];
  $('fu-kml').textContent = s.avgKmPerL != null ? fmt(s.avgKmPerL, 1) + ' km/l' : '--';
  $('fu-kml-note').textContent = last ? `último: ${fmt(last.kmPerL, 1)} km/l` : 'entre tanques cheios';
  $('fu-rkm').textContent = s.costPerKm != null ? brl(s.costPerKm) : '--';
  const months = Object.entries(s.costByMonth || {});
  const cur = months.length ? months[months.length - 1] : null;
  $('fu-month').textContent = cur ? brl(cur[1]) : '--';
  $('fu-month-note').textContent = cur ? cur[0].split('-').reverse().join('/') : '';
  $('fu-rkm-note').textContent = s.totalCost ? `${brl(s.totalCost)} no total` : '';
  $('fu-breakeven').textContent = s.ethanolBreakEven != null
    ? `Etanol compensa neste carro quando custar menos de ${fmt(s.ethanolBreakEven * 100, 0)}% do preço da gasolina (consumo medido).`
    : 'Registre tanques cheios com etanol e com gasolina para calcular quando o etanol compensa neste carro.';

  renderCalibration(data.calibration);

  const ib = $('fu-intervals');
  ib.innerHTML = data.intervals.length ? '' : '<p class="muted small">Precisa de dois tanques cheios com hodômetro.</p>';
  data.intervals.forEach((iv) => {
    const el = document.createElement('div');
    el.className = 'item';
    let est = '';
    if (iv.estimatedLiters != null) {
      const diff = (iv.estimatedLiters / iv.liters - 1) * 100;
      est = `<span class="${Math.abs(diff) <= 5 ? 'delta-ok' : 'delta-warn'}">app estimou ${fmt(iv.estimatedLiters, 1)} L (${diff > 0 ? '+' : ''}${fmt(diff, 0)}%)</span>`;
    }
    el.innerHTML = `<b>${fmt(iv.kmPerL, 1)} km/l</b> · ${fmt(iv.km, 0)} km · ${fmt(iv.liters, 2)} L · ${esc(FUEL_NAMES[iv.fuelType] || iv.fuelType)}
      <div class="kv"><span>${dt(iv.from)} → ${dt(iv.to)}</span><span>${brl(iv.costPerKm)}/km</span>${est}</div>`;
    ib.appendChild(el);
  });

  const lb = $('fu-list');
  lb.innerHTML = data.items.length ? '' : '<p class="muted small">Nenhum abastecimento registrado.</p>';
  data.items.forEach((f) => {
    const el = document.createElement('div');
    el.className = 'item';
    el.innerHTML = `<b>${dt(f.timestamp)}</b> · ${fmt(f.liters, 3)} L · ${brl(f.totalPrice)}${f.fullTank ? ' · cheio' : ' · parcial'}
      <div class="kv"><span>${f.odometerKm != null ? fmt(f.odometerKm, 0) + ' km' : 'sem hodômetro'}</span><span>${brl(f.pricePerLiter, 3)}/L</span>
      <span>${esc(FUEL_NAMES[f.fuelType] || f.fuelType)}${f.ethanolPct != null ? ' ' + fmt(f.ethanolPct, 0) + '% etanol' : ''}</span><span>${esc(f.station || '')}</span></div>
      <div class="actions"><button class="btn btn-small btn-danger" data-fu-delete="${f.id}">Apagar</button></div>`;
    lb.appendChild(el);
  });
  refreshFuelWhen();
}

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

let fuCal = null;
function renderCalibration(c) {
  fuCal = c;
  if (!c) { $('fu-calibration').hidden = true; return; }
  $('fu-calibration').hidden = false;
  const pct = (x) => (x > 0 ? '+' : '') + fmt(x * 100, 1) + '%';
  const factor = `Fator atual: ${fmt(c.factor, 3)}${c.factor !== 1 && c.since ? ' (desde ' + dt(c.since) + ')' : ' (padrão do perfil)'}.`;
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
  $('fu-cal-text').textContent = msg + ' ' + factor;
  $('fu-cal-apply').hidden = c.suggested == null;
  if (c.suggested != null) $('fu-cal-apply').textContent = `Aplicar fator ${fmt(c.suggested, 3)}`;
  $('fu-cal-reset').hidden = c.factor === 1;
}
$('fu-cal-apply').addEventListener('click', () => {
  if (!fuCal || fuCal.suggested == null || !confirm(`Aplicar o fator ${fmt(fuCal.suggested, 3)} ao consumo calculado?`)) return;
  const r = bridge.setFuelCorrection(fuCal.suggested);
  if (r !== 'ok') alert(r);
  loadFuel();
});
$('fu-cal-reset').addEventListener('click', () => {
  if (!confirm('Voltar ao consumo calculado só pelo perfil (fator 1,000)?')) return;
  const r = bridge.setFuelCorrection(1);
  if (r !== 'ok') alert(r);
  loadFuel();
});

// Preço por litro ⇄ valor total, a partir dos litros
const num = (id) => { const v = parseFloat(String($(id).value).replace(',', '.')); return Number.isFinite(v) ? v : null; };
$('fu-total').addEventListener('input', () => { const l = num('fu-liters'), t = num('fu-total'); if (l && t != null) $('fu-ppl').value = (t / l).toFixed(3); });
$('fu-ppl').addEventListener('input', () => { const l = num('fu-liters'), p = num('fu-ppl'); if (l && p != null) $('fu-total').value = (p * l).toFixed(2); });
$('fu-type').addEventListener('change', (e) => { $('fu-eth-wrap').hidden = e.target.value !== 'mix'; });
$('fu-save').addEventListener('click', () => {
  const when = fuWhenEdited && $('fu-when').value ? new Date($('fu-when').value).getTime() : Date.now();
  const res = bridge.addFuelUp(JSON.stringify({
    timestamp: when, odometerKm: num('fu-odo'), liters: num('fu-liters'), totalPrice: num('fu-total'), pricePerLiter: num('fu-ppl'),
    fuelType: $('fu-type').value, ethanolPct: $('fu-type').value === 'mix' ? num('fu-eth') : null,
    fullTank: $('fu-full').checked, station: $('fu-station').value,
  }));
  const [status, info] = String(res).split('|');
  $('fu-result').textContent = status === 'ok' ? 'Abastecimento salvo.' + (info ? ' ' + info + '.' : '') : res;
  if (status === 'ok') {
    ['fu-odo', 'fu-liters', 'fu-total', 'fu-ppl', 'fu-eth', 'fu-station'].forEach((id) => { $(id).value = ''; });
    fuWhenEdited = false;
    loadFuel();
  }
});
$('fu-list').addEventListener('click', (e) => {
  const b = e.target.closest('[data-fu-delete]');
  if (!b || !confirm('Apagar este abastecimento?')) return;
  const res = bridge.deleteFuelUp(Number(b.dataset.fuDelete));
  if (res !== 'ok') alert(res);
  loadFuel();
});
$('fu-export').addEventListener('click', () => { const r = bridge.exportFuelUps(); if (r !== 'ok') alert(r); });
$('fu-pick').addEventListener('click', () => bridge.pickFuelCsv());
window.onFuelCsvPicked = (r) => {
  if (r.ok) $('fu-csv').value = r.text;
  const lines = r.ok ? r.text.split(/\r?\n/).filter((l) => l.trim()).length - 1 : 0;
  $('fu-import-result').textContent = r.ok ? `Arquivo carregado: ${lines} linha(s). Confira e toque em Importar.` : 'Erro: ' + r.error;
  $('fu-import-result').style.color = r.ok ? '' : 'var(--red)';
};
$('fu-import').addEventListener('click', () => {
  const replace = $('fu-replace').checked;
  if (replace && !confirm('Apagar todos os abastecimentos registrados e ficar só com os do CSV?')) return;
  const r = parse(bridge.importFuelUps($('fu-csv').value, replace), { ok: false, error: 'resposta inválida' });
  $('fu-import-result').textContent = r.ok
    ? `${r.added} importado(s), ${r.skipped} já existia(m)${r.removed ? `, ${r.removed} substituído(s)` : ''}.` : 'Erro: ' + r.error;
  $('fu-import-result').style.color = r.ok ? 'var(--accent)' : 'var(--red)';
  if (r.ok) { $('fu-csv').value = ''; $('fu-replace').checked = false; loadFuel(); }
});

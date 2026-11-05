'use strict';
/* Computador de bordo (Detalhes) e resumo das viagens (Histórico). Só mostra o que os dados sustentam:
   km/l e médias aparecem com distância e combustível suficientes; o resto fica em "--".
   Os arquivos app-*.js compartilham o escopo global e são carregados em ordem (index.html). */
const PC_ECO = ['Econômico', 'Na média', 'Gastando'];

function pcDuration(seconds) {
  if (seconds == null || !Number.isFinite(seconds)) return '--';
  const m = Math.round(seconds / 60);
  return m < 60 ? `${m} min` : `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, '0')}`;
}

function pcLeg(prefix, leg) {
  $(prefix + '-kml').textContent = leg && leg.kmPerL != null ? `${fmt(leg.kmPerL, 1)} km/l` : '--';
  $(prefix + '-sub').textContent = leg
    ? `${fmt(leg.km, 1)} km · ${fmt(leg.liters, 2)} L${leg.cost != null ? ' · ' + brl(leg.cost) : ''}`
    : '--';
}

/** Chamado a cada atualização da captura (app-painel.js). */
function renderComputer(s) {
  const c = s.computer || {};
  const eco = $('pc-eco');
  eco.textContent = c.ecoBand != null ? PC_ECO[c.ecoBand] : '--';
  eco.className = 'eco-pill' + (c.ecoBand != null ? ' eco-' + c.ecoBand : '');

  // Agora: km/l andando; parado com o motor ligado, km/l não existe e vale o L/h
  const moving = c.instantKmPerL != null;
  $('pc-now-value').textContent = moving ? fmt(c.instantKmPerL, 1) : (c.instantLph != null && s.running ? fmt(c.instantLph, 2) : '--');
  $('pc-now-unit').textContent = moving ? 'km/l' : 'L/h';
  const parts = [];
  if (moving && c.instantLph != null) parts.push(`${fmt(c.instantLph, 1)} L/h`);
  if (moving && c.costPerKmNow != null) parts.push(`${brl(c.costPerKmNow)}/km`);
  if (!moving && s.running && c.instantLph != null) parts.push('parado com o motor ligado');
  $('pc-now-sub').textContent = parts.join(' · ') || (s.running ? 'aguardando leituras' : 'sem captura');

  pcLeg('pc-trip', c.trip);
  pcLeg('pc-fuel', c.sinceFuelUp);
  pcLeg('pc-a', c.tripA);
  pcLeg('pc-recent', c.recent);
  if (!c.sinceFuelUp) $('pc-fuel-sub').textContent = 'registre um abastecimento';
  if (!c.tripA) $('pc-a-sub').textContent = 'toque em Zerar para começar';

  $('pc-to-reserve').textContent = c.rangeToReserveKm != null ? `${fmt(c.rangeToReserveKm)} km` : '--';
  $('pc-to-empty').textContent = c.rangeToEmptyKm != null ? `${fmt(c.rangeToEmptyKm)} km` : '--';
  $('pc-range-basis').textContent = c.rangeKmPerL != null ? `Pela média de ${fmt(c.rangeKmPerL, 1)} km/l e o nível atual do tanque.` : 'Autonomia precisa do nível do tanque e de uma média.';

  const st = [];
  if (c.movingS) st.push(`Andando ${pcDuration(c.movingS)}${c.avgMovingKmh != null ? ' · média ' + fmt(c.avgMovingKmh) + ' km/h' : ''}`);
  if (c.idleS) st.push(`Marcha lenta ${pcDuration(c.idleS)} · ${fmt(c.idleFuelL, 2)} L${c.idleCost != null ? ' · ' + brl(c.idleCost) : ''}`);
  if (c.fuelCutKm >= 0.1) st.push(`Injeção cortada ${fmt(c.fuelCutKm, 1)} km`);
  if (c.ecoPct) st.push(`Verde ${fmt(c.ecoPct[0])}% · meio ${fmt(c.ecoPct[1])}% · vermelho ${fmt(c.ecoPct[2])}%`);
  $('pc-stats').innerHTML = '';
  st.forEach((t) => { const sp = document.createElement('span'); sp.textContent = t; $('pc-stats').appendChild(sp); });
}

$('pc-reset-a').addEventListener('click', () => {
  if (!confirm('Zerar o parcial A? As médias dele passam a contar a partir de agora.')) return;
  okOrToast(bridge.resetTripA(), 'Parcial A zerado.');
});

/** Histórico → Resumo: refeito pelas amostras gravadas da viagem. */
async function showTripSummary(btn) {
  const item = btn.closest('.item');
  let box = item.querySelector('.trip-summary');
  if (box) { box.remove(); return; }
  box = document.createElement('div');
  box.className = 'trip-summary kv small';
  box.textContent = 'Calculando…';
  item.appendChild(box);
  const r = parse(await nativeAsync((id) => bridge.getTripSummary(id, Number(btn.dataset.summary))).catch((e) => JSON.stringify({ ok: false, error: e.message })), { ok: false });
  box.innerHTML = '';
  if (!r.ok) { box.textContent = r.error || 'Falha ao calcular o resumo.'; return; }
  const lines = [
    `${fmt(r.km, 1)} km · ${fmt(r.liters, 2)} L${r.kmPerL != null ? ' · ' + fmt(r.kmPerL, 1) + ' km/l' : ''}`,
    r.cost != null ? `${brl(r.cost)}${r.costPerKm != null ? ' · ' + brl(r.costPerKm) + '/km' : ''}` : null,
    `Andando ${pcDuration(r.movingS)}${r.avgMovingKmh != null ? ' · média ' + fmt(r.avgMovingKmh) + ' km/h' : ''}`,
    r.idleS ? `Marcha lenta ${pcDuration(r.idleS)} · ${fmt(r.idleFuelL, 2)} L${r.idleCost != null ? ' · ' + brl(r.idleCost) : ''}` : null,
    r.fuelCutKm >= 0.1 ? `Injeção cortada ${fmt(r.fuelCutKm, 1)} km` : null,
    r.ecoPct ? `Verde ${fmt(r.ecoPct[0])}% · meio ${fmt(r.ecoPct[1])}% · vermelho ${fmt(r.ecoPct[2])}%` : null,
    r.samples < 30 ? 'Poucas amostras gravadas: resumo aproximado.' : null,
  ].filter(Boolean);
  lines.forEach((t) => { const sp = document.createElement('span'); sp.textContent = t; box.appendChild(sp); });
}

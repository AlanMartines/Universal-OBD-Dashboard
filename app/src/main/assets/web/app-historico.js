'use strict';
/* Histórico de viagens e falhas. Os arquivos app-*.js compartilham o escopo global e são carregados em ordem (index.html). */
/* ---------------------------------------------------------------- Histórico */
const REASONS = {
  user_stop: 'encerrada pelo usuário', bluetooth_disconnected: 'Bluetooth desconectado', ignition_off: 'ignição desligada',
  idle_timeout: 'inatividade', idle_confirmed: 'inatividade (confirmada)', adapter_unreachable: 'adaptador inacessível',
  ignition_not_detected: 'ignição não detectada',
  interrupted: 'interrompida',
};
const dt = (ms) => new Date(ms).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });

function loadHistory() {
  $('ask-ai').hidden = !aiReady();
  const trips = parse(bridge.getTrips(50), []);
  const box = $('trips');
  box.innerHTML = trips.length ? '' : '<p class="muted small">Nenhuma viagem gravada.</p>';
  trips.forEach((t) => {
    const mins = t.endTime ? Math.round((t.endTime - t.startTime) / 60000) : null;
    const el = document.createElement('div');
    el.className = 'item';
    el.innerHTML = `<b>${dt(t.startTime)}</b> · ${fmt(t.distanceKm, 1)} km${mins != null ? ` · ${mins} min` : ' · em andamento'}
      <div class="kv"><span>Vmáx ${fmt(t.maxSpeedKmh)} km/h</span><span>RPM máx ${fmt(t.maxRpm)}</span>
      <span>Temp máx ${fmt(t.maxCoolantC)} °C</span><span>Tensão mín ${fmt(t.minVoltage, 1)} V</span>
      <span>${fmt(t.fuelUsedL, 2)} L</span><span>${REASONS[t.endReason] || t.endReason || ''}</span></div>
      <div class="actions"><button class="btn btn-small" data-export="csv" data-trip="${t.id}">CSV</button>
      <button class="btn btn-small" data-export="gpx" data-trip="${t.id}">GPX</button>
      <button class="btn btn-small btn-danger" data-delete-trip="${t.id}">Apagar</button></div>`;
    if (aiReady() && t.distanceKm >= 0.5) {
      const b = document.createElement('button');
      b.className = 'btn btn-small';
      b.textContent = 'Analisar com IA';
      b.addEventListener('click', () => analyzeTrip(t));
      el.querySelector('.actions').prepend(b);
    }
    box.appendChild(el);
  });

  const dtcs = parse(bridge.getDtcHistory(100), []);
  const dbox = $('dtc-history');
  dbox.innerHTML = dtcs.length ? '' : '<p class="muted small">Nenhuma falha registrada.</p>';
  dtcs.forEach((d) => {
    const el = document.createElement('div');
    el.className = 'item';
    const geo = d.lat != null ? `<a href="https://maps.google.com/?q=${d.lat},${d.lon}">${d.lat.toFixed(5)}, ${d.lon.toFixed(5)}</a>` : 'sem GPS';
    const desc = dtcText(d.code);
    el.innerHTML = `<b>${d.code}</b> · ${d.kind === 'CONFIRMED' ? 'confirmada' : 'pendente'} · ${dt(d.detectedAt)}
      ${desc ? `<div class="small">${desc.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c])}</div>` : ''}
      <div class="kv"><span>${fmt(d.rpm)} RPM</span><span>${fmt(d.speedKmh)} km/h</span>
      <span>carga ${fmt(d.engineLoadPct)}%</span><span>${fmt(d.coolantC)} °C</span><span>${geo}</span></div>`;
    if (d.ecuFrame && Object.keys(d.ecuFrame).length) {
      const names = Object.fromEntries((meta.outputs || []).map((o) => [o.id, o]));
      const parts = Object.entries(d.ecuFrame).map(([id, v]) => {
        const o = names[id];
        return o ? `${esc(o.name)} ${fmt(v, o.decimals)} ${esc(o.unit)}` : `${esc(id)} ${fmt(v, 1)}`;
      });
      el.insertAdjacentHTML('beforeend', `<div class="small muted">Quadro gravado pela ECU: ${parts.join(' · ')}</div>`);
    }
    if (aiReady()) {
      const b = document.createElement('button');
      b.className = 'btn btn-small';
      b.textContent = 'Explicar com IA';
      // Só os campos da falha: o GPS do item não vai junto (o app também filtra do lado nativo).
      b.addEventListener('click', () => explainDtc({ code: d.code, kind: d.kind, rpm: d.rpm, speedKmh: d.speedKmh, engineLoadPct: d.engineLoadPct, coolantC: d.coolantC, ecuFrame: d.ecuFrame }));
      const actions = document.createElement('div');
      actions.className = 'actions';
      actions.appendChild(b);
      el.appendChild(actions);
    }
    dbox.appendChild(el);
  });
}

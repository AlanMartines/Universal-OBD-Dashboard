'use strict';
/* Painel de instrumentos, conta-giros, sensores e atualização em tempo real (Detalhes). Os arquivos app-*.js compartilham o escopo global e são carregados em ordem (index.html). */
/* ---------------------------------------------------------------- Painel de instrumentos (dash.js) */
const landscape = window.matchMedia('(orientation: landscape)');
let dashMode = '';

/** Paisagem com o Painel aberto → tela cheia; Painel aberto durante a captura → tela sempre ligada. */
function updateDashMode() {
  const onDash = $('tab-dash').classList.contains('active');
  const full = onDash && landscape.matches;
  const keepOn = onDash && !!(lastState && lastState.running);
  $('tab-dash').parentElement.classList.toggle('dash-active', onDash);
  document.body.classList.toggle('dash-fullscreen', full);
  const key = full + '/' + keepOn;
  if (key !== dashMode) { dashMode = key; bridge.setDashMode(full, keepOn); }
}
(landscape.addEventListener ? landscape.addEventListener.bind(landscape, 'change') : landscape.addListener.bind(landscape))(updateDashMode);

/* ---------------------------------------------------------------- Conta-giros SVG */
const ARC = { cx: 100, cy: 95, r: 70, start: 160, sweep: 220 };

function arcPath(from, to) {
  const a0 = (ARC.start + ARC.sweep * from) * Math.PI / 180;
  const a1 = (ARC.start + ARC.sweep * to) * Math.PI / 180;
  const p = (a) => `${(ARC.cx + ARC.r * Math.cos(a)).toFixed(2)} ${(ARC.cy + ARC.r * Math.sin(a)).toFixed(2)}`;
  const large = ARC.sweep * (to - from) > 180 ? 1 : 0;
  return `M ${p(a0)} A ${ARC.r} ${ARC.r} 0 ${large} 1 ${p(a1)}`;
}

function setupGauge() {
  const d = meta.dashboard || { rpmMax: 7000, rpmRedline: 6000 };
  $('rpm-track').setAttribute('d', arcPath(0, 1));
  $('rpm-red').setAttribute('d', arcPath(d.rpmRedline / d.rpmMax, 1));
  $('rpm-value').setAttribute('d', arcPath(0, 0.0001));

  const t = meta.thermal;
  const marks = $('thermo-marks');
  marks.innerHTML = '';
  if (t) {
    [t.thermostatOpenC, t.fanStage1C, t.fanStage2C, t.criticalC].forEach((c) => {
      const m = document.createElement('div');
      m.className = 'mark';
      m.style.left = thermoPct(c) + '%';
      m.title = c + ' °C';
      marks.appendChild(m);
    });
  }
  $('vehicle').textContent = meta.vehicleName || 'Universal OBD';
  buildSensorGrid();
}

const THERMO_MIN = 40, THERMO_MAX = 120;
const thermoPct = (c) => Math.max(0, Math.min(100, (c - THERMO_MIN) / (THERMO_MAX - THERMO_MIN) * 100));

/* ---------------------------------------------------------------- Sensores (agnóstico) */
function buildSensorGrid() {
  const grid = $('sensor-grid');
  grid.innerHTML = '';
  (meta.outputs || []).forEach((o) => {
    const el = document.createElement('div');
    el.className = 'sensor stale';
    el.id = 'sensor-' + o.id;
    el.innerHTML = `<div class="lane">${o.lane.replace('_', ' ')}</div><div class="name"></div><div class="val">--</div>`;
    el.querySelector('.name').textContent = o.name;
    grid.appendChild(el);
  });
}

/* ---------------------------------------------------------------- Atualização em tempo real */
const STATUS = {
  IDLE: ['Parado', 'pill'], STOPPED: ['Parado', 'pill'], CONNECTING: ['Conectando', 'pill pill-warn'],
  INITIALIZING: ['Inicializando', 'pill pill-warn'], STREAMING: ['Capturando', 'pill pill-ok'],
  RECONNECTING: ['Reconectando', 'pill pill-warn'], ERROR: ['Erro', 'pill pill-bad'],
};

/** Chamado pelo app a cada atualização (ligado em app-main.js, depois de tudo carregado). */
function onTelemetry(s) {
  if (lastState && lastState.profileId !== s.profileId && s.profileId) {
    meta = parse(bridge.getProfileMeta(), meta);
    setupGauge();
    Dash.setMeta(meta);
  }
  const wasRunning = lastState && lastState.running;
  lastState = s;
  // Ajustes: com a captura rodando, o nível acompanha a estimativa (exceto enquanto é editado).
  const fl = $('fuel-level');
  if (s.running && s.derived && s.derived.fuelRemainingL != null && document.activeElement !== fl) fl.value = s.derived.fuelRemainingL.toFixed(1);
  Dash.update(s);
  if (!!wasRunning !== !!s.running) updateDashMode();
  $('notif-warning').hidden = s.notificationsEnabled !== false;
  $('bgloc-warning').hidden = s.backgroundLocation !== false;
  const roles = meta.roles || {};
  const r = s.readings || {};
  const dash = meta.dashboard || { rpmMax: 7000, rpmRedline: 6000 };

  // Cabeçalho
  const [label, cls] = STATUS[s.connection] || ['--', 'pill'];
  const status = $('status');
  status.textContent = s.power === 'IDLE_CONFIRMATION' ? 'Parado — confirmar' : label;
  status.className = s.power === 'IDLE_CONFIRMATION' ? 'pill pill-warn' : cls;
  status.title = s.statusMessage || '';
  if (s.diagRecording && s.running) status.textContent += ' ● REC';
  const toggle = $('toggle');
  toggle.textContent = s.running ? 'Encerrar' : 'Iniciar';
  toggle.className = 'btn ' + (s.running ? 'btn-danger' : 'btn-primary');

  // RPM
  const rpm = r[roles.rpm || 'rpm'];
  $('rpm-text').textContent = fmt(rpm);
  const frac = rpm == null ? 0.0001 : Math.max(0.0001, Math.min(1, rpm / dash.rpmMax));
  const arc = $('rpm-value');
  arc.setAttribute('d', arcPath(0, frac));
  arc.classList.toggle('redline', rpm != null && rpm >= dash.rpmRedline);

  // Marcha
  const d = s.derived || {};
  const gear = $('gear');
  if (d.shiftUp && d.recommendedGear) { gear.textContent = `▲ ${d.recommendedGear}ª`; gear.className = 'gear up'; }
  else if (d.estimatedGear) { gear.textContent = `${d.estimatedGear}ª`; gear.className = 'gear'; }
  else if (d.recommendedGear) { gear.textContent = `ideal ${d.recommendedGear}ª`; gear.className = 'gear'; }
  else { gear.textContent = ''; }

  // Velocidade
  $('speed').textContent = fmt(r[roles.speed || 'speed']);
  $('gps-speed').textContent = s.gps && s.gps.ageMs < 5000 ? fmt(s.gps.speedKmh) : '--';
  $('trip-line').textContent = `${fmt(s.tripDistanceKm, 1)} km nesta viagem`;

  // Temperatura
  const ct = r[roles.coolant || 'coolant_temp'];
  $('coolant').textContent = fmt(ct);
  const fill = $('thermo-fill');
  const t = meta.thermal;
  fill.style.width = ct == null ? '0' : thermoPct(ct) + '%';
  let band = '', color = 'var(--blue)';
  if (t && ct != null) {
    if (ct > t.criticalC) { band = 'CRÍTICO'; color = 'var(--red)'; }
    else if (ct >= t.fanStage2C) { band = 'ventoinha 2ª'; color = 'var(--yellow)'; }
    else if (ct >= t.fanStage1C) { band = 'ventoinha 1ª'; color = 'var(--accent)'; }
    else if (ct >= t.thermostatOpenC) { band = 'normal'; color = 'var(--accent)'; }
    else { band = 'aquecendo'; }
  }
  fill.style.background = color;
  $('temp-band').textContent = band;

  // Consumo e elétrica
  $('kml').textContent = d.instantKmPerL != null ? fmt(d.instantKmPerL, 1) + ' km/l' : (d.fuelLph === 0 && rpm > 300 ? 'corte' : '--');
  $('lph').textContent = `${fmt(d.fuelLph, 2)} L/h`;
  $('avg-kml').textContent = d.tripKmPerL != null ? fmt(d.tripKmPerL, 1) + ' km/l' : '--';
  $('fuel-used').textContent = `${fmt(d.tripFuelUsedL, 2)} L usados`;
  $('fuel-left').textContent = fmt(d.fuelRemainingL, 1);
  $('volts').textContent = fmt(r[roles.voltage || 'battery_volts'], 1);
  $('tps').textContent = fmt(r[roles.throttle || 'throttle'], 0);
  $('map').textContent = fmt(r[roles.map || 'map'], 0);

  // Alertas
  const alerts = $('alerts');
  alerts.innerHTML = '';
  (s.alerts || []).forEach((a) => {
    const el = document.createElement('div');
    el.className = 'alert ' + a.level;
    el.textContent = a.message;
    alerts.appendChild(el);
  });

  // DTCs
  const mil = r.mil_on;
  const milEl = $('mil');
  milEl.textContent = mil == null ? 'MIL --' : (mil >= 1 ? 'MIL ACESA' : 'MIL apagada');
  milEl.className = 'pill ' + (mil >= 1 ? 'pill-bad' : mil == null ? '' : 'pill-ok');
  const dtcs = $('dtcs');
  const conf = s.confirmedDtcs || [], pend = s.pendingDtcs || [];
  const dtcKey = conf.join() + '|' + pend.join() + '|' + aiReady() + '|' + s.connection;
  if (dtcKey === lastDtcKey) {
    // nada mudou: não recria a lista (os botões continuam clicáveis)
  } else if (conf.length + pend.length === 0) {
    dtcs.className = 'dtc-list muted';
    dtcs.textContent = s.connection === 'STREAMING' ? 'Nenhuma falha ativa.' : 'Nenhuma falha lida ainda.';
  } else {
    dtcs.className = 'dtc-list';
    dtcs.innerHTML = '';
    conf.forEach((c) => dtcs.appendChild(chip(c, 'confirmed')));
    pend.forEach((c) => dtcs.appendChild(chip(c, 'pending')));
    if (aiReady()) {
      [...conf.map((c) => [c, 'confirmed']), ...pend.map((c) => [c, 'pending'])].forEach(([c, k]) => {
        const b = document.createElement('button');
        b.className = 'btn btn-small dtc-ai';
        b.textContent = 'Explicar ' + c + ' com IA';
        b.addEventListener('click', () => explainDtc({ code: c, kind: k }));
        dtcs.appendChild(b);
      });
    }
  }
  lastDtcKey = dtcKey;

  renderMonitors(s.readiness);

  // Sensores
  (meta.outputs || []).forEach((o) => {
    const el = document.getElementById('sensor-' + o.id);
    if (!el) return;
    const v = r[o.id];
    el.classList.toggle('stale', v == null);
    el.querySelector('.val').textContent = v == null ? '--' : `${fmt(v, o.decimals)} ${o.unit}`;
  });
  $('disabled-pids').textContent = (s.disabledPids || []).length
    ? 'Não suportados pela ECU: ' + s.disabledPids.join(', ')
    : (s.adapterVersion ? 'Adaptador: ' + s.adapterVersion : '');
};

/** Monitores de prontidão da ECU (0101) em Detalhes. */
let lastMonitorsKey = null;
function renderMonitors(r) {
  const key = JSON.stringify(r || null);
  if (key === lastMonitorsKey) return;
  lastMonitorsKey = key;
  const pill = $('monitors-pill');
  if (!r) { pill.textContent = '--'; pill.className = 'pill'; return; }
  const pending = r.monitors.filter((m) => !m.complete).length;
  pill.textContent = r.allComplete ? 'Todos completos' : `${pending} em teste`;
  pill.className = 'pill ' + (r.allComplete ? 'pill-ok' : '');
  const box = $('monitors');
  box.className = 'monitors';
  box.innerHTML = r.monitors.length ? r.monitors.map((m) =>
    `<span class="mon ${m.complete ? 'ok' : 'pending'}">${m.complete ? '✓' : '⏳'} ${esc(m.name)}</span>`).join('') : 'A ECU não informa monitores.';
}

const dtcText = (code) => (meta.dtcDescriptions || {})[String(code).toUpperCase()] || '';

function chip(code, kind) {
  const el = document.createElement('span');
  el.className = 'dtc ' + kind;
  const desc = dtcText(code);
  el.textContent = code + (kind === 'pending' ? ' (pend.)' : '') + (desc ? ' · ' + desc : '');
  return el;
}

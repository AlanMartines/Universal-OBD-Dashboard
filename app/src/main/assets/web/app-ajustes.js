'use strict';
/* Ajustes: perfil, combustível e arquivos de diagnóstico. Os arquivos app-*.js compartilham o escopo global e são carregados em ordem (index.html). */
/* ---------------------------------------------------------------- Ajustes */
/* ---------------------------------------------------------------- Veículo */
let vehicles = { list: [], selected: '' };

function profileLabel(p) {
  return `${p.vehicleName} (${p.ecuModel})${p.source === 'user' ? ' • importado' : ''}`;
}

function loadVehicles(profiles) {
  vehicles = parse(bridge.getVehicles(), { list: [], selected: '' });
  const sel = $('vehicle-select');
  sel.innerHTML = '';
  vehicles.list.forEach((v) => {
    const o = document.createElement('option');
    o.value = v.id;
    o.textContent = v.plate ? `${v.name} · ${v.plate}` : v.name;
    o.selected = v.id === vehicles.selected;
    sel.appendChild(o);
  });
  const cur = vehicles.list.find((v) => v.id === vehicles.selected) || {};
  $('vehicle-name').value = cur.name || '';
  $('vehicle-plate').value = cur.plate || '';
  $('vehicle-delete').disabled = vehicles.list.length < 2;
  const np = $('vehicle-new-profile');
  np.innerHTML = '';
  profiles.forEach((p) => {
    const o = document.createElement('option');
    o.value = p.id;
    o.textContent = profileLabel(p);
    np.appendChild(o);
  });
}

function vehicleMessage(text, isError) {
  $('vehicle-result').textContent = text;
  $('vehicle-result').style.color = isError ? 'var(--danger, #e5484d)' : '';
  toast(text, isError);
}

/** Tudo o que a tela mostra muda com o veículo: perfil, mostradores, ajustes e telemetria remota. */
function vehicleChanged(message) {
  meta = parse(bridge.getProfileMeta(), meta);
  setupGauge();
  Dash.setMeta(meta);
  loadSettings();
  if (typeof remoteRefresh === 'function') remoteRefresh();
  vehicleMessage(message, false);
}

$('vehicle-select').addEventListener('change', (e) => {
  const res = bridge.selectVehicle(e.target.value);
  if (res !== 'ok') { vehicleMessage(res, true); loadSettings(); return; }
  vehicleChanged('Veículo trocado.');
});
$('vehicle-save').addEventListener('click', () => {
  const res = bridge.renameVehicle($('vehicle-name').value, $('vehicle-plate').value);
  if (res !== 'ok') { vehicleMessage(res, true); return; }
  loadSettings();
  vehicleMessage('Salvo.', false);
});
$('vehicle-new').addEventListener('click', () => {
  $('vehicle-new-form').hidden = !$('vehicle-new-form').hidden;
  if (!$('vehicle-new-form').hidden) $('vehicle-new-name').focus();
});
$('vehicle-new-add').addEventListener('click', () => {
  const res = bridge.addVehicle($('vehicle-new-name').value, $('vehicle-new-profile').value, $('vehicle-new-plate').value);
  if (res !== 'ok') { vehicleMessage(res, true); return; }
  $('vehicle-new-form').hidden = true;
  $('vehicle-new-name').value = '';
  $('vehicle-new-plate').value = '';
  vehicleChanged('Veículo adicionado e em uso. Informe o hodômetro, o nível do tanque e o adaptador dele abaixo.');
});
$('vehicle-delete').addEventListener('click', async () => {
  const others = vehicles.list.filter((v) => v.id !== vehicles.selected);
  if (!others.length) return;
  const names = others.map((v, i) => `${i + 1}. ${v.name}`).join('\n');
  const pick = prompt(`Qual veículo excluir? Digite o número.\n${names}\n\nO veículo em uso não pode ser excluído.`);
  const target = others[Number(pick) - 1];
  if (!target) return;
  if (!confirm(`Excluir "${target.name}" com as viagens, falhas, abastecimentos e ajustes dele? Isso não pode ser desfeito.`)) return;
  const res = await nativeAsync((id) => bridge.deleteVehicle(id, target.id)).catch((err) => err.message);
  if (res !== 'ok') { vehicleMessage(res, true); return; }
  loadSettings();
  vehicleMessage('Veículo excluído.', false);
});

function loadSettings() {
  loadAiSettings();
  const profiles = parse(bridge.listProfiles(), []);
  loadVehicles(profiles);
  const sel = $('profile-select');
  sel.innerHTML = '';
  profiles.forEach((p) => {
    const o = document.createElement('option');
    o.value = p.id;
    o.textContent = profileLabel(p);
    o.selected = p.selected;
    sel.appendChild(o);
  });
  $('profile-info').textContent = meta.engine ? `${meta.engine} · ${meta.protocol}` : '';

  const s = parse(bridge.getSettings(), {});
  setEthanolSelect(s.ethanolPct || 0);
  $('fuel-level').value = s.fuelLevelL != null ? s.fuelLevelL.toFixed(1) : '';
  $('adapter-names').value = s.adapterAuto ? '' : (s.adapterNames || '');
  $('adapter-names').placeholder = s.profileAdapterNames || 'OBDII';
  $('extra-triggers').value = s.extraTriggers || '';
  $('idle-timeout').value = String(s.idleTimeoutMin != null ? s.idleTimeoutMin : 15);
  $('resume-window').value = String(s.resumeWindowMin != null ? s.resumeWindowMin : 60);
  $('odometer').value = s.odometerKm != null ? String(Math.round(s.odometerKm)) : '';
  renderReadiness();
  $('bt-result').textContent = '';
  loadBluetooth(s);
  loadCanCard(s);
  $('fuel-form').style.display = meta.fuel ? '' : 'none';
  $('ethanol').parentElement.style.display = meta.fuel && meta.fuel.flex ? '' : 'none';
  renderPermissions(parse(bridge.getPermissions(), {}));
  renderDiagnostics();
  loadDashboardSettings();
  loadSpeedSuggestion();
  loadAlarms();
  loadTimers();
  loadSensorCal();
}

/* ---------------------------------------------------------------- Sugestão, alarmes e tempos */
let speedSuggestionPct = null;
async function loadSpeedSuggestion() {
  const s = parse(await nativeAsync((id) => bridge.getSpeedSuggestion(id)), {});
  speedSuggestionPct = s.pct != null ? s.pct : null;
  $('dash-suggestion').hidden = speedSuggestionPct == null;
  if (speedSuggestionPct != null) {
    $('dash-suggestion-text').textContent = `Pelo GPS, nos trechos estáveis gravados: ${signedPct(speedSuggestionPct)} (${fmt(s.samples)} leituras).`;
  }
}
$('dash-suggestion-use').addEventListener('click', () => {
  $('dash-correction').value = String(speedSuggestionPct);
  $('dash-result').textContent = 'Toque em Salvar para aplicar.';
  toast('Sugestão escolhida. Toque em Salvar para aplicar.');
});

function loadAlarms() {
  const sel = $('alarm-output');
  const current = sel.value;
  sel.innerHTML = '';
  (meta.outputs || []).forEach((o) => {
    const opt = document.createElement('option');
    opt.value = o.id;
    opt.textContent = o.unit ? `${o.name} (${o.unit})` : o.name;
    sel.appendChild(opt);
  });
  if (current) sel.value = current;
  const box = $('alarm-list');
  box.innerHTML = '';
  parse(bridge.getUserAlarms(), []).forEach((a) => {
    const row = document.createElement('div');
    row.className = 'item';
    const text = document.createElement('span');
    text.textContent = `${a.name} ${a.above ? 'acima de' : 'abaixo de'} ${fmt(a.value, Number.isInteger(a.value) ? 0 : 1)} ${a.unit}${a.critical ? ' · crítico' : ''}`;
    const del = document.createElement('button');
    del.className = 'btn btn-small btn-danger';
    del.textContent = 'Apagar';
    del.addEventListener('click', () => { okOrToast(bridge.deleteUserAlarm(a.id), 'Alarme apagado.'); loadAlarms(); });
    row.append(text, del);
    box.appendChild(row);
  });
}
$('alarm-add').addEventListener('click', () => {
  const raw = $('alarm-value').value;
  const res = bridge.addUserAlarm($('alarm-output').value, $('alarm-above').value === '1', raw === '' ? NaN : Number(raw), $('alarm-critical').checked);
  $('alarm-result').textContent = res === 'ok' ? 'Adicionado.' : res;
  okOrToast(res, 'Alarme adicionado. Vale a partir da próxima captura.');
  $('alarm-result').style.color = res === 'ok' ? '' : 'var(--danger, #e5484d)';
  if (res === 'ok') { $('alarm-value').value = ''; loadAlarms(); }
});

/** Mostra se a captura em andamento carregou os alarmes e quais estão disparados agora. */
let lastAlarmStatus = '';
function renderAlarmStatus(s) {
  let text = '';
  if (s && s.running && s.userAlarmsLoaded != null) {
    const firing = (s.alerts || []).filter((a) => String(a.id).startsWith('user_')).length;
    text = `Nesta captura: ${s.userAlarmsLoaded} ${s.userAlarmsLoaded === 1 ? 'alarme carregado' : 'alarmes carregados'}` +
      (firing ? `, ${firing} ${firing === 1 ? 'disparado' : 'disparados'} agora.` : '.');
  }
  if (text === lastAlarmStatus) return;
  lastAlarmStatus = text;
  $('alarm-status').textContent = text;
}

function loadTimers() {
  const box = $('timer-list');
  box.innerHTML = '';
  parse(bridge.getTimedRuns(), []).forEach((r) => {
    const row = document.createElement('div');
    row.className = 'kv';
    const band = document.createElement('span');
    band.textContent = `${r.band.replace('-', ' a ')} km/h`;
    const time = document.createElement('span');
    time.textContent = r.best != null ? `melhor ${fmt(r.best, 1)} s · último ${fmt(r.last, 1)} s` : 'sem medição';
    row.append(band, time);
    box.appendChild(row);
  });
}
$('timer-clear').addEventListener('click', () => {
  if (confirm('Zerar os tempos deste veículo?')) { okOrToast(bridge.clearTimedRuns(), 'Tempos zerados.'); loadTimers(); }
});

/* ---------------------------------------------------------------- Mostradores */
/* Listas em vez de texto livre: a escala sempre termina numa marca do mostrador. */
const dashOptions = (id, values, label, current) => {
  const sel = $(id);
  sel.innerHTML = '';
  values.forEach((v) => {
    const o = document.createElement('option');
    o.value = String(v);
    o.textContent = label(v);
    o.selected = v === current;
    sel.appendChild(o);
  });
};
const dashRange = (from, to, step) => Array.from({ length: Math.round((to - from) / step) + 1 }, (_, i) => from + i * step);
const signedPct = (v) => (v > 0 ? '+' : '') + String(v).replace('.', ',') + '%';

function loadDashboardSettings() {
  const d = parse(bridge.getDashboardSettings(), {});
  if (d.rpmMax == null) return;
  const speedTop = Math.ceil(d.speedMax / 20) * 20;
  const rpmTop = Math.ceil(d.rpmMax / 1000) * 1000;
  const speeds = dashRange(100, 300, 20);
  const rpms = dashRange(3000, 20000, 1000);
  const corrections = dashRange(-10, 15, 0.5);
  dashOptions('dash-speed-max', speeds.includes(speedTop) ? speeds : [speedTop, ...speeds], (v) => v + ' km/h', speedTop);
  dashOptions('dash-rpm-max', rpms.includes(rpmTop) ? rpms : [rpmTop, ...rpms], (v) => v.toLocaleString('pt-BR') + ' RPM', rpmTop);
  dashOptions('dash-correction', corrections, (v) => (v === 0 ? 'Sem correção' : signedPct(v)), d.speedCorrectionPct);
  $('dash-redline').value = String(d.rpmRedline);
}

function dashboardChanged(res, message) {
  $('dash-result').textContent = res === 'ok' ? message : res;
  okOrToast(res, message === 'Salvo.' ? 'Mostradores salvos.' : message);
  $('dash-result').style.color = res === 'ok' ? '' : 'var(--danger, #e5484d)';
  if (res !== 'ok') return;
  meta = parse(bridge.getProfileMeta(), meta);
  setupGauge();
  Dash.setMeta(meta);
  loadDashboardSettings();
}

$('dash-save').addEventListener('click', () => {
  const redline = $('dash-redline').value === '' ? NaN : Number($('dash-redline').value);
  dashboardChanged(bridge.setDashboardSettings(Number($('dash-rpm-max').value), redline, Number($('dash-speed-max').value), Number($('dash-correction').value)), 'Salvo.');
});
$('dash-reset').addEventListener('click', () => dashboardChanged(bridge.resetDashboardSettings(), 'Voltou aos valores do perfil.'));

/* ---------------------------------------------------------------- Calibração dos sensores */
let sensorCal = null;
let sensorCalAt = 0;
const scRows = {};
const degSigned = (v, d = 1) => (v > 0 ? '+' : v < 0 ? '−' : '') + fmt(Math.abs(v), d) + '°';
const dpsSigned = (v) => (v > 0.05 ? '+' : v < -0.05 ? '−' : '') + fmt(Math.abs(v) < 0.05 ? 0 : Math.abs(v), 1);

/** Uma linha "nome: valor"; criada uma vez e depois só o texto muda. */
function scRow(key, name) {
  if (scRows[key]) return scRows[key];
  const row = document.createElement('div');
  row.className = 'sc-row';
  const n = document.createElement('span');
  n.textContent = name;
  const v = document.createElement('b');
  row.append(n, v);
  $('sc-values').appendChild(row);
  scRows[key] = v;
  return v;
}
const scSet = (key, name, text) => { const el = scRow(key, name); if (el.textContent !== text) el.textContent = text; };

function loadSensorCal() {
  sensorCal = parse(bridge.getSensorCalibration(), null);
  sensorCalAt = Date.now();
  if (!sensorCal) return;
  const t = sensorCal.trims || {};
  const lim = sensorCal.limits || { tiltDeg: 15, headingDeg: 45 };
  dashOptions('sc-pitch', dashRange(-lim.tiltDeg, lim.tiltDeg, 0.5), (v) => (v === 0 ? 'Sem ajuste' : degSigned(v)), Math.round((t.pitchDeg || 0) * 2) / 2);
  dashOptions('sc-roll', dashRange(-lim.tiltDeg, lim.tiltDeg, 0.5), (v) => (v === 0 ? 'Sem ajuste' : degSigned(v)), Math.round((t.rollDeg || 0) * 2) / 2);
  dashOptions('sc-heading', dashRange(-lim.headingDeg, lim.headingDeg, 1), (v) => (v === 0 ? 'Sem ajuste' : degSigned(v, 0)), Math.round(t.headingDeg || 0));
  renderSensorCal(lastState);
}

/** Valores ao vivo (desvio do giroscópio, celular, bússola) vêm do estado; os guardados, a cada 5 s durante a captura. */
function renderSensorCal(s) {
  if (!sensorCal) return;
  if (s && s.running && Date.now() - sensorCalAt > 5000) { sensorCal = parse(bridge.getSensorCalibration(), sensorCal); sensorCalAt = Date.now(); }
  const d = (s && s.derived) || {};
  scSet('gyro', 'Desvio do giroscópio', d.gyroBiasX != null
    ? `X ${dpsSigned(d.gyroBiasX)} · Y ${dpsSigned(d.gyroBiasY)} · Z ${dpsSigned(d.gyroBiasZ)} °/s`
    : 'medido parado no começo de cada captura');
  const m = sensorCal.imu;
  const off = (deg) => (deg >= 1 ? ` (${fmt(deg, 0)}° fora)` : '');
  scSet('up', 'Cima do módulo', m ? `eixo ${m.upAxis}${off(m.upOffDeg)}${m.upLocked ? ' · zerado à mão' : ''}` : 'ainda não aprendido (pare o carro)');
  scSet('fwd', 'Frente do módulo', m && m.forwardAxis
    ? `eixo ${m.forwardAxis}${off(m.forwardOffDeg)}${m.forwardLocked ? ' · calibrada à mão' : ''}`
    : 'ainda não aprendida (ande e freie em reta)');
  const c = sensorCal.compass;
  const pct = d.compassPct != null ? d.compassPct : c ? c.pct : null;
  const ready = d.compassPct != null ? !!d.compassReady : !!(c && c.ready);
  scSet('mag', 'Bússola do ESP32', pct == null || pct === 0 ? 'sem calibração (aprende andando com GPS)' : ready ? `pronta · ${pct}% da volta` : `aprendendo · ${pct}% da volta`);
  scSet('phone', 'Celular no suporte', d.phoneMountDeg != null
    ? `${fmt(d.phoneMountDeg, 0)}° em relação à frente`
    : (s && s.running ? 'aprendendo (ande em reta com GPS)' : 'aprendido a cada captura'));
  const t = sensorCal.trims || {};
  const parts = [];
  if (t.pitchDeg) parts.push('frontal ' + degSigned(t.pitchDeg));
  if (t.rollDeg) parts.push('lateral ' + degSigned(t.rollDeg));
  if (t.headingDeg) parts.push('rumo ' + degSigned(t.headingDeg, 0));
  scSet('trim', 'Ajuste em uso', parts.length ? parts.join(' · ') : 'nenhum');
}

function sensorCalDone(res, message) {
  $('sc-result').textContent = res === 'ok' ? message : res;
  $('sc-result').style.color = res === 'ok' ? '' : 'var(--danger, #e5484d)';
  okOrToast(res, message);
  if (res === 'ok') loadSensorCal();
}
$('sc-save').addEventListener('click', () => sensorCalDone(
  bridge.setSensorTrims(Number($('sc-pitch').value), Number($('sc-roll').value), Number($('sc-heading').value)), 'Ajuste fino salvo.'));
$('sc-zero').addEventListener('click', () => sensorCalDone(bridge.setSensorTrims(0, 0, 0), 'Ajuste fino zerado.'));
$('sc-forget-imu').addEventListener('click', () => {
  if (!confirm('Esquecer o nível e a frente do sensor de movimento? O app aprende de novo: pare o carro alguns segundos e depois ande, acelerando e freando em reta. Se quiser, refaça Zerar nível e Calibrar frente na aba Dinâmica.')) return;
  sensorCalDone(bridge.forgetSensorCalibration('imu'), 'Nível e frente esquecidos.');
});
$('sc-forget-compass').addEventListener('click', () => {
  if (!confirm('Zerar a bússola do ESP32? Ela aprende de novo andando com GPS, com curvas para todos os lados.')) return;
  sensorCalDone(bridge.forgetSensorCalibration('compass'), 'Bússola zerada.');
});
$('sc-forget-phone').addEventListener('click', () => {
  sensorCalDone(bridge.forgetSensorCalibration('phone'), 'O celular será reaprendido andando em reta com GPS.');
});

/* ---------------------------------------------------------------- Sobre */
const appInfo = parse(bridge.getAppInfo(), {});
const appVersion = appInfo.versionName ? `Versão ${appInfo.versionName} (build ${appInfo.versionCode}${appInfo.buildType === 'release' ? '' : ', ' + appInfo.buildType})` : '';
$('about-version').textContent = appVersion;
$('about-version-full').textContent = appVersion;
$('about-open').addEventListener('click', () => { $('about-panel').hidden = false; });
$('about-close').addEventListener('click', () => { $('about-panel').hidden = true; });

/* ---------------------------------------------------------------- Diagnóstico */
const mb = (bytes) => fmt(bytes / 1048576, bytes < 10485760 ? 1 : 0) + ' MB';

function renderDiagnostics() {
  const d = parse(bridge.getDiagnostics(), { enabled: false, files: [] });
  $('diag-enabled').checked = !!d.enabled;
  $('script-entry').hidden = !d.enabled;
  const box = $('diag-files');
  box.innerHTML = d.files.length ? '' : '<p class="muted small">Nenhum arquivo gravado.</p>';
  d.files.forEach((f) => {
    const el = document.createElement('div');
    el.className = 'item';
    const label = document.createElement('b');
    label.textContent = f.name;
    el.appendChild(label);
    const info = document.createElement('div');
    info.className = 'kv';
    info.innerHTML = `<span>${mb(f.size)}</span><span>${dt(f.modified)}</span>${f.active ? '<span class="rec">● gravando</span>' : ''}`;
    el.appendChild(info);
    const actions = document.createElement('div');
    actions.className = 'actions';
    actions.innerHTML = `<button class="btn btn-small" data-diag-export>Exportar .gz</button>` +
      (f.active ? '' : `<button class="btn btn-small btn-danger" data-diag-delete>Apagar</button>`);
    actions.querySelectorAll('button').forEach((b) => { b.dataset.name = f.name; });
    el.appendChild(actions);
    box.appendChild(el);
  });
}

$('diag-enabled').addEventListener('change', (e) => { bridge.setDiagnosticRecording(e.target.checked); $('script-entry').hidden = !e.target.checked; });
$('diag-files').addEventListener('click', (e) => {
  const exp = e.target.closest('[data-diag-export]');
  const del = e.target.closest('[data-diag-delete]');
  if (exp) {
    const res = bridge.exportDiagnostic(exp.dataset.name);
    if (res !== 'ok') alert(res);
  } else if (del && confirm('Apagar ' + del.dataset.name + '?')) {
    const res = bridge.deleteDiagnostic(del.dataset.name);
    if (res !== 'ok') alert(res);
    renderDiagnostics();
  }
});

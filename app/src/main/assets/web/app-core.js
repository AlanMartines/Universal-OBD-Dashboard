'use strict';
/* Ponte nativa, utilitários e abas. Os arquivos app-*.js compartilham o escopo global e são carregados em ordem (index.html). */
/* Ponte nativa: um objeto por assunto (pacote bridge do app). Cada chamada à `bridge` acha o método no objeto
   que o tem. Fora do app (navegador) usa um simulador para pré-visualização. */
const NATIVE_BRIDGES = ['AndroidBridge', 'AndroidHistory', 'AndroidFuel', 'AndroidDiag', 'AndroidAi', 'AndroidRemote', 'AndroidCapture', 'AndroidMaintenance']
  .map((n) => window[n]).filter(Boolean);
const bridge = NATIVE_BRIDGES.length ? new Proxy({}, {
  get: (_, name) => {
    const target = NATIVE_BRIDGES.find((o) => typeof o[name] === 'function');
    return target ? (...args) => target[name](...args) : undefined;
  },
}) : {
  getRemoteStatus: () => '{"paired":false,"installationId":"pré-visualização"}',
  remotePair: () => '{"ok":false,"error":"Pareamento disponível só no app"}',
  remoteSave: () => 'ok', remoteSendNow: () => '{"ok":true,"message":"Disponível só no app"}', remoteUnpair: () => 'ok',
  startCapture() {}, stopCapture() {}, requestPermissions() {}, imuCalibrate: () => true,
  getPermissions: () => '{}',
  getProfileMeta: () => JSON.stringify({ vehicleName: 'Pré-visualização', outputs: [], dashboard: { rpmMax: 7000, rpmRedline: 6250 },
    thermal: { thermostatOpenC: 87, fanStage1C: 97, fanStage2C: 103, criticalC: 105 }, fuel: { tankCapacityL: 48, flex: true }, roles: {} }),
  listProfiles: () => '[]', selectProfile: () => 'ok', importProfile: () => '{"ok":false,"error":"sem app"}',
  getSettings: () => '{"ethanolPct":0}', getAppInfo: () => '{"versionName":"pré-visualização","versionCode":0,"buildType":"debug"}', setEthanolPercent() {}, setFuelLevel() {}, markTankFull: () => 48,
  setAdapterNames() {}, setExtraTriggers() {}, getTrips: () => '[]', getDtcHistory: () => '[]',
  exportTrip: () => 'Exportação disponível só no app',
  deleteTrip: () => 'ok', deleteAllHistory: () => 'ok', openNotificationSettings() {},
  requestBackgroundLocation() {}, openAppSettings() {}, setIdleTimeoutMin() {}, setResumeWindowMin() {}, setDashMode() {},
  setOdometerKm: () => 'ok',
  setCanAdapter: () => 'ok', testCanListen: () => '{"ok":true,"frames":1234,"values":[{"id":"can_speed","name":"Velocidade (painel)","unit":"km/h","decimals":0,"value":0},{"id":"fuel_level_pct","name":"Nível do tanque","unit":"%","decimals":0,"value":39}]}',
  faultScanReadiness: () => '{"ready":true,"reason":"Com a ignição ligada, o app conecta, lê e desconecta."}',
  scanFaults: () => '{"ok":true,"viaCapture":false,"milOn":false,"storedCount":1,"confirmed":["P0171"],"pending":[],"permanent":null,"freezeCode":"P0171"}',
  getState: () => '{"connection":"IDLE","running":false,"readings":{},"derived":{},"alerts":[],"confirmedDtcs":[],"pendingDtcs":[]}',
  getVehicles: () => '{"selected":"v1","capturing":false,"list":[{"id":"v1","name":"Pré-visualização","plate":"","profileId":"x","profileName":"Perfil"}]}',
  selectVehicle: () => 'ok', addVehicle: () => 'ok', renameVehicle: () => 'ok', deleteVehicle: () => 'ok',
  getSpeedSuggestion: () => '{"pct":4.5,"samples":320}', getUserAlarms: () => '[]', addUserAlarm: () => 'ok', deleteUserAlarm: () => 'ok',
  getTimedRuns: () => '[{"band":"0-60","best":null,"last":null}]', clearTimedRuns: () => 'ok',
  getSensorCalibration: () => '{"running":false,"trims":{"pitchDeg":0,"rollDeg":0,"headingDeg":0},"limits":{"tiltDeg":15,"headingDeg":45},"imu":{"upAxis":"−X","upOffDeg":15,"upLocked":true,"forwardAxis":"+Z","forwardOffDeg":4,"forwardLocked":false},"compass":null}',
  setSensorTrims: () => 'ok', forgetSensorCalibration: () => 'ok',
  getDashboardSettings: () => '{"rpmMax":7000,"rpmRedline":6250,"speedMax":200,"speedCorrectionPct":0}', setDashboardSettings: () => 'ok', resetDashboardSettings: () => 'ok',
  getFuelUps: () => '{"items":[],"summary":{"count":0},"intervals":[]}', addFuelUp: () => 'ok', deleteFuelUp: () => 'ok', updateFuelUp: () => 'ok',
  getFuelSyncStatus: () => '{"paired":true,"inSync":false,"sentAt":null}', sendFuelUpsNow: () => 'ok',
  setFuelCorrection: () => 'ok',
  exportBackup: () => 'Backup disponível só no app', pickBackup() {},
  exportFuelUps: () => 'Exportação disponível só no app', importFuelUps: () => '{"ok":false,"error":"sem app"}', pickFuelCsv() {},
  getReadiness: () => JSON.stringify([
    { id: 'bluetooth', label: 'Permissão de Bluetooth', ok: true, hint: '' },
    { id: 'bgLocation', label: 'Localização "o tempo todo"', ok: false, hint: 'Mantém o GPS quando a captura começa sozinha.' }]),
  getDiagnostics: () => '{"enabled":false,"files":[]}', setDiagnosticRecording() {},
  getBondedDevices: () => JSON.stringify({ permission: true, devices: [
    { name: 'OBDII', address: '00:1D:A5:68:98:8B' }, { name: 'Multimídia do carro', address: 'A4:5E:60:11:22:33' },
    { name: 'Fone Bluetooth', address: '5C:F3:70:AA:BB:CC' }] }),
  exportDiagnostic: () => 'Exportação disponível só no app', deleteDiagnostic: () => 'ok',
  consoleStart: () => 'Console disponível só no app', consoleIdentify: () => 'Console disponível só no app', consoleStop() {},
  getAiSettings: () => JSON.stringify({ enabled: false, provider: 'OPENAI', baseUrl: 'https://api.openai.com/v1/', model: '', consents: [], ready: false, keyMasked: null, online: true,
    providers: [{ id: 'OPENAI', label: 'OpenAI', baseUrl: 'https://api.openai.com/v1/', modelHint: 'gpt-4o-mini' }, { id: 'CUSTOM', label: 'Personalizado', baseUrl: '', modelHint: '' }] }),
  saveAiSettings: () => 'ok', setAiConsent() {}, aiListModels: () => '{"ok":true,"models":["modelo-a","modelo-b"]}', aiPreviewDtc: () => '{"ok":true,"text":"(pré-visualização)"}',
  aiExplainDtc() {}, aiTest() {}, aiSavedAnswer: () => 'null', aiPreviewTrip: () => '{"ok":true,"text":"(pré-visualização)"}', aiAnalyzeTrip() {},
  aiPreviewAsk: () => '{"ok":true,"text":"(pré-visualização)"}', aiAsk() {},
  consolePoll: () => '{"running":false,"seq":0,"lines":[]}', readDiagnostic: () => '{"lines":[]}',
  getCaptureScript: () => JSON.stringify({ ok: true, diagEnabled: true, recording: true, script: { title: 'Mapeamento da rede do carro', groups: [
    { id: 'ignition', title: 'Ignição ligada, motor desligado', place: 'stopped', steps: [
      { id: 'door_driver', title: 'Porta do motorista', priority: true, engine: 'off', pattern: { on: 'Abra a porta', off: 'Feche a porta', on_s: 3, off_s: 3, repeat: 2 } }] }] } }),
  captureMark: () => 'ok', captureSpeak() {}, captureVibrate() {}, captureKeepAlive() {},
  getMaintenance: () => JSON.stringify({ totalKm: 183200, presetsFromProfile: true, items: [
    { id: 1, name: 'Troca de óleo e filtro de óleo', intervalKm: 15000, intervalMonths: 12, notes: '5W30, 2,7 L', status: { level: 'SOON', nextKm: 183900, remainingKm: 700, nextAt: Date.now() + 90 * 864e5, remainingDays: 90 }, records: [{ id: 1, timestamp: Date.now() - 275 * 864e5, odometerKm: 168900, cost: 230, notes: null }] },
    { id: 2, name: 'Fluido de freio', intervalKm: null, intervalMonths: 24, notes: null, status: { level: 'DUE', nextKm: null, remainingKm: null, nextAt: Date.now() - 10 * 864e5, remainingDays: -10 }, records: [{ id: 2, timestamp: Date.now() - 740 * 864e5, odometerKm: null, cost: null, notes: null }] },
    { id: 3, name: 'Correia dentada', intervalKm: 60000, intervalMonths: 36, notes: null, status: { level: 'UNKNOWN' }, records: [] }],
    presets: [{ name: 'Troca de óleo e filtro de óleo', intervalKm: 15000, intervalMonths: 12, notes: '5W30, 2,7 L' }, { name: 'Velas de ignição', intervalKm: 30000, intervalMonths: null, notes: 'NGK BKR6E' }, { name: 'Correia dentada', intervalKm: 60000, intervalMonths: 36 }, { name: 'Fluido de freio', intervalKm: 45000, intervalMonths: 24 }] }),
  saveMaintenanceItem: () => '{"ok":true}', deleteMaintenanceItem: () => '{"ok":true}', addMaintenanceRecord: () => '{"ok":true}',
  deleteMaintenanceRecord: () => '{"ok":true}',
  resetTripA: () => 'ok', getTripSummary: () => JSON.stringify({ ok: true, samples: 400, km: 12.3, liters: 1.1, kmPerL: 11.2, cost: 7.1, costPerKm: 0.58, movingS: 1320, idleS: 300, idleFuelL: 0.08, idleCost: 0.5, avgMovingKmh: 33, fuelCutKm: 0.9, ecoPct: [55, 20, 25], durationS: 1680, maxSpeedKmh: 74, maxCoolantC: 96, imu: { maxBrakeG: 0.38, maxAccelG: 0.21, maxLateralG: 0.29, bumps: 3 } }),
};

/* Consultas ao banco respondem depois, em window.onBridgeResult, para não prender a tela enquanto o banco trabalha.
   nativeAsync((id) => bridge.getTrips(id, 50)) devolve uma Promise com o texto da resposta. O simulador do
   navegador devolve o valor na hora, e o retorno direto também resolve a Promise. */
const bridgePending = new Map();
let bridgeSeq = 0;
function nativeAsync(call) {
  return new Promise((resolve, reject) => {
    const id = 'b' + (++bridgeSeq);
    const direct = call(id);
    if (direct !== undefined && direct !== null) resolve(direct);
    else bridgePending.set(id, { resolve, reject });
  });
}
window.onBridgeResult = (r) => {
  const p = bridgePending.get(r.id);
  if (!p) return;
  bridgePending.delete(r.id);
  if (r.ok) p.resolve(r.value); else p.reject(new Error(r.error));
};

const $ = (id) => document.getElementById(id);
const nf = (d) => new Intl.NumberFormat('pt-BR', { minimumFractionDigits: d, maximumFractionDigits: d });
const fmt = (v, d = 0) => (v === null || v === undefined || Number.isNaN(v)) ? '--' : nf(d).format(v);
const parse = (s, fallback) => { try { return JSON.parse(s); } catch (e) { return fallback; } };

/*
 * Avisos rápidos na parte de baixo da tela, empilhados (até 3; o mais novo embaixo). Cada um tem ícone
 * pelo tipo, barra do tempo que falta e some sozinho; tocar fecha, arrastar para o lado dispensa e
 * segurar o dedo pausa. O texto entra como texto, nunca como HTML.
 */
const TOAST_MAX = 3;
const TOAST_ICON = {
  ok: 'M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zm0 18a8 8 0 1 1 0-16 8 8 0 0 1 0 16zm-1.3-4.2-3.1-3.1 1.4-1.4 1.7 1.7 4.5-4.5 1.4 1.4z',
  error: 'M11 7h2v6h-2zm0 8h2v2h-2zM12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zm0 18a8 8 0 1 1 0-16 8 8 0 0 1 0 16z',
};
function toast(text, isError) {
  if (!text) return;
  const box = $('toasts');
  const kind = isError ? 'error' : 'ok';
  const ms = isError ? 5000 : 3000;
  const el = document.createElement('div');
  el.className = 'toast toast-' + kind;
  el.setAttribute('role', isError ? 'alert' : 'status');
  el.style.setProperty('--toast-ms', ms + 'ms');
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('aria-hidden', 'true');
  svg.classList.add('toast-icon');
  const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  path.setAttribute('d', TOAST_ICON[kind]);
  svg.append(path);
  const msg = document.createElement('span');
  msg.className = 'toast-text';
  msg.textContent = text;
  const bar = document.createElement('i');
  bar.className = 'toast-bar';
  el.append(svg, msg, bar);
  box.append(el);
  while (box.children.length > TOAST_MAX) box.firstElementChild.remove();
  requestAnimationFrame(() => el.classList.add('show'));

  let left = ms; let started = Date.now(); let timer = setTimeout(close, left);
  function close(dx) {
    clearTimeout(timer);
    if (el.classList.contains('leaving')) return;
    el.classList.add('leaving');
    if (dx) el.style.transform = `translateX(${dx > 0 ? 120 : -120}%)`;
    setTimeout(() => el.remove(), 220);
  }
  // Segurar pausa o tempo; arrastar mais de 70 px dispensa; um toque simples fecha.
  let x0 = null; let moved = 0;
  el.addEventListener('pointerdown', (e) => {
    x0 = e.clientX; moved = 0;
    clearTimeout(timer); left -= Date.now() - started; el.classList.add('paused');
    el.setPointerCapture(e.pointerId);
  });
  el.addEventListener('pointermove', (e) => {
    if (x0 === null) return;
    moved = e.clientX - x0;
    el.classList.add('dragging');
    el.style.transform = `translateX(${moved}px)`;
    el.style.opacity = String(Math.max(0.2, 1 - Math.abs(moved) / 200));
  });
  const release = () => {
    if (x0 === null) return;
    x0 = null;
    el.classList.remove('dragging');
    if (Math.abs(moved) > 70) return close(moved);
    if (Math.abs(moved) < 6) return close();
    el.style.transform = ''; el.style.opacity = '';
    el.classList.remove('paused');
    started = Date.now(); timer = setTimeout(close, Math.max(left, 800));
  };
  el.addEventListener('pointerup', release);
  el.addEventListener('pointercancel', release);
}
/** Mostra o resultado no cartão e no aviso. "ok" vira [okText]; qualquer outra resposta é erro. */
const okOrToast = (res, okText) => { const ok = res === 'ok'; toast(ok ? okText : res, !ok); return ok; };

let meta = parse(bridge.getProfileMeta(), {});
let lastState = null;

/* ---------------------------------------------------------------- Abas */
document.querySelectorAll('.tab').forEach((btn) => btn.addEventListener('click', () => {
  document.querySelectorAll('.tab').forEach((b) => b.classList.toggle('active', b === btn));
  btn.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  document.querySelectorAll('.tab-page').forEach((p) => p.classList.toggle('active', p.id === 'tab-' + btn.dataset.tab));
  if (btn.dataset.tab === 'history' || btn.dataset.tab === 'faults') loadHistory();
  if (btn.dataset.tab === 'settings') loadSettings();
  if (btn.dataset.tab === 'fuel') loadFuel();
  if (btn.dataset.tab === 'maint') loadMaintenance();
  updateDashMode();
}));

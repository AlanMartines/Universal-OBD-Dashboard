'use strict';
/* Ponte nativa, utilitários e abas. Os arquivos app-*.js compartilham o escopo global e são carregados em ordem (index.html). */
/* Ponte nativa: um objeto por assunto (pacote bridge do app). Cada chamada à `bridge` acha o método no objeto
   que o tem. Fora do app (navegador) usa um simulador para pré-visualização. */
const NATIVE_BRIDGES = ['AndroidBridge', 'AndroidHistory', 'AndroidFuel', 'AndroidDiag', 'AndroidAi']
  .map((n) => window[n]).filter(Boolean);
const bridge = NATIVE_BRIDGES.length ? new Proxy({}, {
  get: (_, name) => {
    const target = NATIVE_BRIDGES.find((o) => typeof o[name] === 'function');
    return target ? (...args) => target[name](...args) : undefined;
  },
}) : {
  startCapture() {}, stopCapture() {}, requestPermissions() {},
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
  getFuelUps: () => '{"items":[],"summary":{"count":0},"intervals":[]}', addFuelUp: () => 'ok', deleteFuelUp: () => 'ok',
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

let meta = parse(bridge.getProfileMeta(), {});
let lastState = null;

/* ---------------------------------------------------------------- Abas */
document.querySelectorAll('.tab').forEach((btn) => btn.addEventListener('click', () => {
  document.querySelectorAll('.tab').forEach((b) => b.classList.toggle('active', b === btn));
  document.querySelectorAll('.tab-page').forEach((p) => p.classList.toggle('active', p.id === 'tab-' + btn.dataset.tab));
  if (btn.dataset.tab === 'history') loadHistory();
  if (btn.dataset.tab === 'settings') loadSettings();
  if (btn.dataset.tab === 'fuel') loadFuel();
  updateDashMode();
}));

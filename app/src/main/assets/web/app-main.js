'use strict';
/* Ligações restantes e inicialização (carregado por último). Os arquivos app-*.js compartilham o escopo global e são carregados em ordem (index.html). */
$('import-profile').addEventListener('click', () => {
  const res = parse(bridge.importProfile($('profile-json').value), { ok: false, error: 'resposta inválida' });
  const out = $('import-result');
  out.textContent = res.ok ? `Perfil "${res.id}" importado.` : `Erro: ${res.error}`;
  out.style.color = res.ok ? 'var(--accent)' : 'var(--red)';
  if (res.ok) loadSettings();
});
$('trips').addEventListener('click', async (e) => {
  const sum = e.target.closest('[data-summary]');
  if (sum) { showTripSummary(sum); return; }
  const del = e.target.closest('[data-delete-trip]');
  if (del) {
    if (!confirm('Apagar esta viagem, com a telemetria e as falhas registradas nela?')) return;
    const res = await nativeAsync((id) => bridge.deleteTrip(id, Number(del.dataset.deleteTrip))).catch((err) => err.message);
    if (res !== 'ok') alert(res);
    loadHistory();
    return;
  }
  const btn = e.target.closest('[data-export]');
  if (!btn) return;
  btn.disabled = true;
  const res = await nativeAsync((id) => bridge.exportTrip(id, Number(btn.dataset.trip), btn.dataset.export)).catch((err) => err.message);
  btn.disabled = false;
  if (res !== 'ok') alert(res);
});
$('clear-history').addEventListener('click', async () => {
  if (!confirm('Apagar as viagens, a telemetria e as falhas deste veículo? Isso não pode ser desfeito.')) return;
  const res = await nativeAsync((id) => bridge.deleteAllHistory(id)).catch((err) => err.message);
  $('history-result').textContent = res === 'ok' ? 'Histórico apagado.'
    : res === 'ok:keep' ? 'Histórico apagado. A viagem em andamento foi mantida.' : res;
  loadHistory();
});
$('notif-fix').addEventListener('click', () => bridge.openNotificationSettings());
$('bgloc-fix').addEventListener('click', () => bridge.requestBackgroundLocation());
$('ask-bgloc').addEventListener('click', () => bridge.requestBackgroundLocation());
$('open-app-settings').addEventListener('click', () => bridge.openAppSettings());
$('ask-permissions').addEventListener('click', () => bridge.requestPermissions());
$('toggle').addEventListener('click', () => {
  if (lastState && lastState.running) bridge.stopCapture(); else bridge.startCapture();
});
$('can-dialog-go').addEventListener('click', () => $('can-dialog').close());
// Sem resposta, o aviso fecha sozinho e a captura segue só com o OBD (o app continua tentando o ESP32)
let canDialogTimer = null;
function canDialogTick(left) {
  $('can-dialog-count').textContent = `Continua só com o OBD em ${left} s`;
  if (left <= 0) { $('can-dialog').close(); return; }
  canDialogTimer = setTimeout(() => canDialogTick(left - 1), 1000);
}
new MutationObserver(() => {
  clearTimeout(canDialogTimer);
  if (!$('can-dialog').open) return;
  $('can-dialog').style.setProperty('--dialog-ms', CAN_DIALOG_AUTO_S * 1000 + 'ms');
  canDialogTick(CAN_DIALOG_AUTO_S);
}).observe($('can-dialog'), { attributes: true, attributeFilter: ['open'] });
$('can-dialog-stop').addEventListener('click', () => {
  $('can-dialog').close();
  if (lastState && lastState.running) bridge.stopCapture();
});

setupGauge();
Dash.mount($('dash-host'));
Dash.setMeta(meta);
// Dinâmica: Zerar nível e Calibrar frente mexem só na orientação guardada no app (nada vai ao ESP32 nem ao carro)
Dash.setImuAction((kind) => bridge.imuCalibrate(kind) !== false);
updateDashMode();
window.onTelemetry = onTelemetry;
// O app só envia o estado quando ele muda; com a captura parada, pede o atual ao abrir.
try { onTelemetry(JSON.parse(bridge.getState())); } catch (e) { /* pré-visualização sem estado */ }

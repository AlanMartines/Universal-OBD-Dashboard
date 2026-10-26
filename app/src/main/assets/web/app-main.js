'use strict';
/* Ligações restantes e inicialização (carregado por último). Os arquivos app-*.js compartilham o escopo global e são carregados em ordem (index.html). */
$('import-profile').addEventListener('click', () => {
  const res = parse(bridge.importProfile($('profile-json').value), { ok: false, error: 'resposta inválida' });
  const out = $('import-result');
  out.textContent = res.ok ? `Perfil "${res.id}" importado.` : `Erro: ${res.error}`;
  out.style.color = res.ok ? 'var(--accent)' : 'var(--red)';
  if (res.ok) loadSettings();
});
$('trips').addEventListener('click', (e) => {
  const del = e.target.closest('[data-delete-trip]');
  if (del) {
    if (!confirm('Apagar esta viagem, com a telemetria e as falhas registradas nela?')) return;
    const res = bridge.deleteTrip(Number(del.dataset.deleteTrip));
    if (res !== 'ok') alert(res);
    loadHistory();
    return;
  }
  const btn = e.target.closest('[data-export]');
  if (!btn) return;
  const res = bridge.exportTrip(Number(btn.dataset.trip), btn.dataset.export);
  if (res !== 'ok') alert(res);
});
$('clear-history').addEventListener('click', () => {
  if (!confirm('Apagar todas as viagens, a telemetria e as falhas registradas? Isso não pode ser desfeito.')) return;
  const res = bridge.deleteAllHistory();
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

setupGauge();
Dash.mount($('dash-host'));
Dash.setMeta(meta);
updateDashMode();
window.onTelemetry = onTelemetry;

'use strict';
/* Telemetria remota: pareamento com o servidor e envio. Textos vindos de fora só via textContent. */
async function remoteRefresh() {
  const s = parse(await nativeAsync((id) => bridge.getRemoteStatus(id)), { paired: false });
  $('remote-paired').hidden = !s.paired;
  $('remote-pair').hidden = s.paired;
  $('remote-url').value = s.baseUrl || $('remote-url').value;
  $('remote-install').textContent = s.installationId || '';
  $('remote-enabled').checked = !!s.enabled;
  $('remote-gps').checked = !!s.sendGps;
  $('remote-name').textContent = s.deviceName || 'Este celular';
  $('remote-server').textContent = s.baseUrl || '';
  $('remote-pending').textContent = fmt(s.pending || 0);
  $('remote-last').textContent = s.lastSentAt ? new Date(s.lastSentAt).toLocaleString('pt-BR') : 'ainda não';
  remoteMessage(s.lastError || '', !!s.lastError);
}

function remoteMessage(text, isError) {
  $('remote-result').textContent = text;
  $('remote-result').style.color = isError ? 'var(--danger, #e5484d)' : '';
}

$('remote-pair-btn').addEventListener('click', async () => {
  remoteMessage('Pareando…', false);
  const payload = JSON.stringify({ baseUrl: $('remote-url').value, code: $('remote-code').value });
  const r = parse(await nativeAsync((id) => bridge.remotePair(id, payload)), { ok: false, error: 'Resposta inválida' });
  if (!r.ok) { remoteMessage(r.error, true); return; }
  $('remote-code').value = '';
  await remoteRefresh();
  remoteMessage('Pareado. O envio começa na próxima captura.', false);
});

function remoteSaveOptions() {
  bridge.remoteSave(JSON.stringify({ enabled: $('remote-enabled').checked, sendGps: $('remote-gps').checked }));
}
$('remote-enabled').addEventListener('change', remoteSaveOptions);
$('remote-gps').addEventListener('change', remoteSaveOptions);

$('remote-send').addEventListener('click', async () => {
  remoteMessage('Enviando…', false);
  const r = parse(await nativeAsync((id) => bridge.remoteSendNow(id)), {});
  await remoteRefresh();
  remoteMessage(r.message || '', false);
});

$('remote-unpair').addEventListener('click', () => {
  if (!confirm('Parar de enviar e remover o pareamento deste celular?')) return;
  bridge.remoteUnpair();
  remoteRefresh();
});

remoteRefresh();

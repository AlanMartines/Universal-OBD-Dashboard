'use strict';
/* Backup completo. Os arquivos app-*.js compartilham o escopo global e são carregados em ordem (index.html). */
/* ---------------------------------------------------------------- Backup */
/** Preferências da tela (tema, visual e modo dos mostradores…), para irem junto no backup. */
function webSettingsSnapshot() {
  const out = {};
  try { for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); out[k] = localStorage.getItem(k); } } catch (e) { /* sem armazenamento */ }
  return JSON.stringify(out);
}
const BACKUP_MSG_KEY = 'backup-restored-message';
$('backup-export').addEventListener('click', () => {
  const r = bridge.exportBackup(webSettingsSnapshot());
  $('backup-result').textContent = r === 'ok' ? 'Backup gerado: escolha onde guardar.' : r;
  $('backup-result').style.color = r === 'ok' ? 'var(--accent)' : 'var(--red)';
});
$('backup-restore').addEventListener('click', () => {
  if (!confirm('Restaurar um backup substitui TODAS as viagens, abastecimentos e ajustes atuais deste celular. Continuar?')) return;
  $('backup-result').textContent = 'Escolha o arquivo de backup…';
  $('backup-result').style.color = '';
  bridge.pickBackup();
});
window.onBackupRestored = (r) => {
  $('backup-result').textContent = r.ok ? r.message : 'Erro: ' + r.error;
  $('backup-result').style.color = r.ok ? 'var(--accent)' : 'var(--red)';
  if (!r.ok) return;
  // Preferências da tela: grava e recarrega para o tema e os mostradores já abrirem como no backup.
  if (r.webSettings && Object.keys(r.webSettings).length) {
    try {
      Object.entries(r.webSettings).forEach(([k, v]) => localStorage.setItem(k, String(v)));
      sessionStorage.setItem(BACKUP_MSG_KEY, r.message);
      location.reload();
      return;
    } catch (e) { /* sem armazenamento: segue sem elas */ }
  }
  loadSettings(); loadHistory(); loadFuel();
};
// Depois do recarregamento da restauração: mostra o resumo.
try {
  const msg = sessionStorage.getItem(BACKUP_MSG_KEY);
  if (msg) { sessionStorage.removeItem(BACKUP_MSG_KEY); toast(msg); }
} catch (e) { /* sem armazenamento */ }

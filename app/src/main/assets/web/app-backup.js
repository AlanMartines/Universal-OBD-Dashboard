'use strict';
/* Backup completo. Os arquivos app-*.js compartilham o escopo global e são carregados em ordem (index.html). */
/* ---------------------------------------------------------------- Backup */
$('backup-export').addEventListener('click', () => {
  const r = bridge.exportBackup();
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
  if (r.ok) { loadSettings(); loadHistory(); loadFuel(); }
};

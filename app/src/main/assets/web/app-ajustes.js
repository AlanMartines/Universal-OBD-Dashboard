'use strict';
/* Ajustes: perfil, combustível e arquivos de diagnóstico. Os arquivos app-*.js compartilham o escopo global e são carregados em ordem (index.html). */
/* ---------------------------------------------------------------- Ajustes */
function loadSettings() {
  loadAiSettings();
  const profiles = parse(bridge.listProfiles(), []);
  const sel = $('profile-select');
  sel.innerHTML = '';
  profiles.forEach((p) => {
    const o = document.createElement('option');
    o.value = p.id;
    o.textContent = `${p.vehicleName} (${p.ecuModel})${p.source === 'user' ? ' • importado' : ''}`;
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
  $('fuel-form').style.display = meta.fuel ? '' : 'none';
  $('ethanol').parentElement.style.display = meta.fuel && meta.fuel.flex ? '' : 'none';
  renderPermissions(parse(bridge.getPermissions(), {}));
  renderDiagnostics();
}

/* ---------------------------------------------------------------- Diagnóstico */
const mb = (bytes) => fmt(bytes / 1048576, bytes < 10485760 ? 1 : 0) + ' MB';

function renderDiagnostics() {
  const d = parse(bridge.getDiagnostics(), { enabled: false, files: [] });
  $('diag-enabled').checked = !!d.enabled;
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

$('diag-enabled').addEventListener('change', (e) => bridge.setDiagnosticRecording(e.target.checked));
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

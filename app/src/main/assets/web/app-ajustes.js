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
  loadDashboardSettings();
}

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

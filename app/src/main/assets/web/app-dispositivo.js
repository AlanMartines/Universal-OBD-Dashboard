'use strict';
/* Pronto para viajar e Bluetooth. Os arquivos app-*.js compartilham o escopo global e são carregados em ordem (index.html). */
/* ---------------------------------------------------------------- Pronto para viajar */
const READY_ACTIONS = {
  bluetooth: () => bridge.requestPermissions(), location: () => bridge.requestPermissions(),
  notifications: () => bridge.openNotificationSettings(), bgLocation: () => bridge.requestBackgroundLocation(),
  battery: () => bridge.openAppSettings(),
  adapter: () => $('adapter-select').scrollIntoView({ behavior: 'smooth', block: 'center' }),
  trigger: () => $('trigger-list').scrollIntoView({ behavior: 'smooth', block: 'center' }),
};

function renderReadiness() {
  const items = parse(bridge.getReadiness(), []);
  const box = $('readiness');
  box.innerHTML = '';
  items.forEach((it) => {
    const row = document.createElement('div');
    row.className = 'ready-item';
    row.dataset.ok = String(!!it.ok);
    const mark = document.createElement('span');
    mark.textContent = it.ok ? '✅' : '⚠️';
    const label = document.createElement('span');
    label.textContent = it.label;
    row.append(mark, label);
    if (!it.ok && READY_ACTIONS[it.id]) {
      const b = document.createElement('button');
      b.className = 'btn btn-small';
      b.textContent = 'Corrigir';
      b.addEventListener('click', READY_ACTIONS[it.id]);
      row.appendChild(b);
    } else {
      row.appendChild(document.createElement('span'));
    }
    const hint = document.createElement('span');
    hint.className = 'hint';
    hint.textContent = it.hint || '';
    row.appendChild(hint);
    box.appendChild(row);
  });
  const missing = items.filter((it) => !it.ok && it.id !== 'trigger').length;
  const pill = $('ready-summary');
  pill.textContent = missing ? `${missing} pendente${missing > 1 ? 's' : ''}` : 'Tudo pronto';
  pill.className = 'pill ' + (missing ? 'pill-warn' : 'pill-ok');
}
document.addEventListener('visibilitychange', () => {
  if (!document.hidden && $('tab-settings').classList.contains('active')) renderReadiness();
});
$('idle-timeout').addEventListener('change', (e) => bridge.setIdleTimeoutMin(Number(e.target.value)));
$('resume-window').addEventListener('change', (e) => bridge.setResumeWindowMin(Number(e.target.value)));
$('save-odometer').addEventListener('click', () => {
  const v = parseFloat(String($('odometer').value).replace(',', '.'));
  bridge.setOdometerKm(Number.isFinite(v) ? v : 0);
  $('odometer-result').textContent = Number.isFinite(v) && v > 0
    ? `Salvo: o Total passa a acompanhar o hodômetro (${fmt(v)} km).`
    : 'Removido: o Total volta a somar só as viagens gravadas.';
});

/* ---------------------------------------------------------------- Bluetooth pareado */
const csvList = (v) => String(v || '').split(/[,;]/).map((x) => x.trim()).filter(Boolean);
const sameDevice = (entry, d) => entry.toLowerCase() === d.address.toLowerCase() || (d.name && entry.toLowerCase() === d.name.toLowerCase());
let bonded = [];

function loadBluetooth(s) {
  const data = parse(bridge.getBondedDevices(), { permission: false, devices: [] });
  bonded = data.devices || [];
  const sel = $('adapter-select');
  sel.innerHTML = '';
  const auto = document.createElement('option');
  auto.value = '';
  auto.textContent = `Automático (${(s && s.profileAdapterNames) || 'nomes do perfil'})`;
  sel.appendChild(auto);
  bonded.forEach((d) => {
    const o = document.createElement('option');
    o.value = d.address;
    o.textContent = `${d.name || 'Sem nome'} — ${d.address}`;
    sel.appendChild(o);
  });
  const current = csvList($('adapter-names').value);
  const match = current.length === 1 ? bonded.find((d) => sameDevice(current[0], d)) : null;
  if (match) sel.value = match.address;
  else if (current.length) {
    const o = document.createElement('option');
    o.value = '__manual';
    o.textContent = `Digitado: ${current.join(', ')}`;
    sel.appendChild(o);
    sel.value = '__manual';
  }
  sel.disabled = !data.permission;
  if (!data.permission) {
    auto.textContent = 'Permita o Bluetooth em Permissões para listar os pareados';
  }
  renderTriggers();
}

/** Gatilhos: caixas para os pareados (exceto o adaptador); o campo de texto guarda o resto. */
function renderTriggers() {
  const box = $('trigger-list');
  box.innerHTML = '';
  const adapter = $('adapter-select').value;
  const entries = csvList($('extra-triggers').value);
  bonded.filter((d) => d.address !== adapter).forEach((d) => {
    const label = document.createElement('label');
    label.className = 'check';
    const input = document.createElement('input');
    input.type = 'checkbox';
    input.id = 'trigger-' + d.address.replace(/:/g, '');
    input.checked = entries.some((e) => sameDevice(e, d));
    input.addEventListener('change', () => toggleTrigger(d, input.checked));
    const text = document.createElement('span');
    text.textContent = (d.name || 'Sem nome') + ' ';
    const mac = document.createElement('span');
    mac.className = 'mac';
    mac.textContent = d.address;
    text.appendChild(mac);
    label.append(input, text);
    box.appendChild(label);
  });
}

function toggleTrigger(d, on) {
  const rest = csvList($('extra-triggers').value).filter((e) => !sameDevice(e, d));
  if (on) rest.push(d.address);
  $('extra-triggers').value = rest.join(', ');
}

$('adapter-select').addEventListener('change', (e) => {
  const v = e.target.value;
  if (v === '__manual') return;
  $('adapter-names').value = v; // vazio = automático
  // O adaptador não pode ser também gatilho de si mesmo na lista
  const d = bonded.find((x) => x.address === v);
  if (d) toggleTrigger(d, false);
  renderTriggers();
});
$('refresh-bt').addEventListener('click', () => loadBluetooth(parse(bridge.getSettings(), {})));
$('save-bt').addEventListener('click', () => {
  bridge.setAdapterNames($('adapter-names').value);
  bridge.setExtraTriggers($('extra-triggers').value);
  $('bt-result').textContent = 'Salvo. Vale a partir da próxima captura.';
});

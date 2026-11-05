'use strict';
/* Roteiro de captura: passos guiados por voz e vibração que gravam marcas no arquivo de diagnóstico.
   Início manual, fim automático. Só marca e lê: nada vai ao carro. Os arquivos app-*.js compartilham o
   escopo global e são carregados em ordem (index.html). */
const SCRIPT_TICK_MS = 200;
const SCRIPT_PREPARE_S = 3;
const SCRIPT_MOVING_KMH = 3;
const SCRIPT_PROGRESS_KEY = 'capture-script-progress';
let scriptData = null;
let scriptStep = null;
let scriptRunState = null;
let scriptProgress = {};

/* Progresso do dia: some sozinho no dia seguinte. Só conveniência; as marcas ficam no arquivo de diagnóstico. */
function scriptToday() { return new Date().toISOString().slice(0, 10); }
function scriptLoadProgress() {
  try {
    const p = JSON.parse(localStorage.getItem(SCRIPT_PROGRESS_KEY) || '{}');
    scriptProgress = (p.day === scriptToday() && p.steps) || {};
  } catch (e) { scriptProgress = {}; }
}
function scriptSaveProgress() {
  try { localStorage.setItem(SCRIPT_PROGRESS_KEY, JSON.stringify({ day: scriptToday(), steps: scriptProgress })); } catch (e) { /* sem armazenamento */ }
}

function scriptReading(ids) {
  const r = (lastState && lastState.readings) || {};
  for (const id of ids) if (id && Number.isFinite(r[id])) return r[id];
  return null;
}
function scriptSpeed() {
  const roles = meta.roles || {};
  const v = [scriptReading([roles.speed || 'speed']), scriptReading(['can_speed'])];
  const g = lastState && lastState.gps;
  if (g && g.ageMs < 5000 && Number.isFinite(g.speedKmh)) v.push(g.speedKmh);
  const known = v.filter((x) => x !== null);
  return known.length ? Math.max(...known) : null;
}
function scriptRpm() {
  const roles = meta.roles || {};
  return scriptReading([roles.rpm || 'rpm', 'can_rpm']);
}

/** Pode começar um passo? Só com a captura gravando e o carro parado, exceto os passos do passageiro. */
function scriptReadiness() {
  const s = lastState;
  if (!s || !s.running) return { ok: false, text: 'Toque em Iniciar (topo do app) e espere conectar. As marcas vão para o arquivo da captura.' };
  if (!s.diagRecording) return { ok: false, text: 'Esta captura não está gravando o diagnóstico. Marque Gravação de diagnóstico em Ajustes, encerre e inicie a captura de novo.' };
  const v = scriptSpeed();
  const passenger = !!(scriptStep && scriptStep.passenger);
  if (passenger) return { ok: true, passenger: true, text: 'Passo do passageiro: só ele mexe no celular. O motorista só dirige.' };
  if (v !== null && v > SCRIPT_MOVING_KMH) return { ok: false, text: 'Carro em movimento: os passos só rodam com o carro parado (exceto os do passageiro).' };
  const esp = s.canStatus ? ` ${s.canStatus}.` : '';
  return { ok: true, text: `Captura gravando. Pode começar.${esp}` };
}

function scriptMark(fields) {
  return bridge.captureMark(JSON.stringify(Object.assign({ script: scriptData.profile_id || 'generic', step: scriptStep.id }, fields)));
}

function scriptStepsFlat() {
  return (scriptData.groups || []).flatMap((g) => g.steps || []);
}

function scriptRenderList() {
  const box = $('script-list');
  box.innerHTML = '';
  const legend = document.createElement('p');
  legend.className = 'muted small';
  legend.textContent = '★ = dados que quase todo carro informa (referências, motor, tanque, luzes e ar-condicionado): faça estes primeiro. Os demais variam de carro para carro. Os passos com "(passageiro)" são feitos por quem vai ao lado, com o carro andando. Pule o que o carro não tiver.';
  box.appendChild(legend);
  (scriptData.groups || []).forEach((g) => {
    const sec = document.createElement('div');
    sec.className = 'script-group';
    const h = document.createElement('h3');
    h.textContent = g.title;
    sec.appendChild(h);
    if (g.note) {
      const p = document.createElement('p');
      p.className = 'muted small';
      p.textContent = g.note;
      sec.appendChild(p);
    }
    (g.steps || []).forEach((st) => {
      const b = document.createElement('button');
      const state = scriptProgress[st.id];
      b.className = 'btn script-step' + (state ? ' ' + state : '');
      const t = document.createElement('span');
      t.className = 'st-title';
      t.textContent = (st.priority ? '★ ' : '') + st.title;
      const m = document.createElement('span');
      m.className = 'st-mark';
      m.textContent = state === 'done' ? '✓ feito' : state === 'skipped' ? 'pulado' : '';
      b.append(t, m);
      b.addEventListener('click', () => scriptOpenStep(st));
      sec.appendChild(b);
    });
    box.appendChild(sec);
  });
}

function scriptRenderReady() {
  const r = scriptReadiness();
  const el = $('script-ready');
  el.textContent = r.text;
  el.className = 'script-ready small ' + (r.ok ? 'ok' : 'bad');
  $('script-start').disabled = !r.ok || !!scriptRunState;
  if (scriptStep && !scriptRunState) {
    const rpm = scriptRpm();
    let warn = '';
    if (scriptStep.engine === 'on' && rpm !== null && rpm < 300) warn = 'Este passo pede o motor ligado.';
    if (scriptStep.engine === 'off' && rpm !== null && rpm > 300) warn = 'Este passo pede o motor desligado, com a ignição ligada.';
    $('script-step-warn').textContent = warn;
    $('script-step-warn').hidden = !warn;
  }
}

/** Passos do roteiro em fases com duração. Eventos viram uma fase só, até o limite de tempo. */
function scriptPhases(st) {
  if (st.pattern) {
    const p = st.pattern;
    const out = [];
    for (let i = 1; i <= p.repeat; i++) {
      out.push({ kind: 'on', say: p.on, s: p.on_s, n: i });
      out.push({ kind: 'off', say: p.off, s: p.off_s, n: i });
    }
    return out;
  }
  if (st.phases) return st.phases.map((ph, i) => ({ kind: 'phase', say: ph.say, s: ph.s, n: i + 1 }));
  if (st.zones) return [{ kind: 'events', say: 'Toque na posição do ponteiro', s: st.max_s, n: 1 }];
  return [{ kind: 'events', say: 'Toque no botão quando acontecer', s: st.max_s, n: 1 }];
}

/** Passos com botões que a pessoa toca (eventos ou grupos): terminam com "Finalizar teste". */
function scriptTapStep(st) { return !!(st.events || st.zones); }

function scriptOpenStep(st) {
  if (scriptRunState) return;
  scriptStep = st;
  $('script-list').hidden = true;
  $('script-run').hidden = false;
  $('script-step-title').textContent = (st.priority ? '★ ' : '') + st.title;
  const total = scriptPhases(st).reduce((a, p) => a + p.s, 0);
  const how = st.pattern ? `${st.pattern.on} ${st.pattern.on_s} s → ${st.pattern.off} ${st.pattern.off_s} s, ${st.pattern.repeat} vezes.` : '';
  const length = st.zones ? 'Sem tempo fixo: no fim, toque em Finalizar teste.'
    : st.events ? `Até ${Math.round(st.max_s / 60)} min; no fim, toque em Finalizar teste.` : `Cerca de ${Math.ceil((total + SCRIPT_PREPARE_S) / 60)} min.`;
  $('script-step-before').textContent = [st.before, how, length].filter(Boolean).join(' ');
  $('script-live').hidden = true;
  $('script-summary').hidden = true;
  $('script-start').hidden = false;
  $('script-start').textContent = 'Iniciar passo';
  $('script-stop').hidden = true;
  $('script-skip').hidden = false;
  $('script-back').disabled = false;
  scriptRenderReady();
}

function scriptBackToList() {
  if (scriptRunState) return;
  scriptStep = null;
  $('script-run').hidden = true;
  $('script-list').hidden = false;
  scriptRenderList();
  scriptRenderReady();
}

function scriptButtons(box, labels, onClick) {
  box.innerHTML = '';
  labels.forEach((l) => {
    const b = document.createElement('button');
    b.className = 'btn';
    b.textContent = l;
    b.addEventListener('click', () => onClick(l, b));
    box.appendChild(b);
  });
}

function scriptStart() {
  const ready = scriptReadiness();
  if (!ready.ok) { toast(ready.text, true); return; }
  const res = scriptMark({ phase: 'step_start', label: scriptStep.title });
  if (res !== 'ok') { toast(res, true); return; }
  const st = scriptStep;
  scriptRunState = { phases: scriptPhases(st), index: -1, phaseAt: 0, startedAt: Date.now(), timer: null, events: [] };
  $('script-start').hidden = true;
  $('script-skip').hidden = true;
  $('script-stop').hidden = false;
  $('script-stop').textContent = scriptTapStep(st) ? 'Finalizar teste' : 'Parar passo';
  $('script-stop').className = scriptTapStep(st) ? 'btn btn-primary' : 'btn btn-danger';
  $('script-back').disabled = true;
  $('script-live').hidden = false;
  $('script-live').className = 'script-live';
  $('script-step-warn').hidden = true;
  $('script-event-log').textContent = '';
  $('script-say').textContent = 'Prepare-se';
  $('script-phase').textContent = st.title;
  bridge.captureSpeak('Prepare-se. ' + st.title);
  bridge.captureVibrate(80);
  const choices = $('script-choices');
  choices.hidden = !st.choices;
  if (st.choices) {
    scriptButtons(choices, st.choices.options, (opt) => {
      const ph = scriptRunState && scriptRunState.phases[scriptRunState.index];
      scriptMark({ phase: 'choice', label: st.choices.label + (ph ? ' · ' + ph.say : ''), value: opt });
      toast(`${st.choices.label}: ${opt}`);
    });
    const label = document.createElement('div');
    label.className = 'label small muted';
    label.textContent = st.choices.label + ':';
    choices.prepend(label);
  }
  const events = $('script-events');
  events.hidden = !scriptTapStep(st);
  events.className = st.zones ? 'script-zones' : 'script-buttons';
  const tap = (ev, btn) => {
    const roles = meta.roles || {};
    const temp = scriptReading([roles.coolant || 'coolant_temp', 'can_coolant_temp']);
    const speed = scriptSpeed();
    const value = [speed === null ? '' : `${fmt(speed)} km/h`, temp === null ? '' : `${fmt(temp)} °C`].filter(Boolean).join(' · ');
    if (scriptMark({ phase: 'event', label: ev, value }) !== 'ok') return;
    bridge.captureVibrate(150);
    events.querySelectorAll('.btn').forEach((b) => b.classList.toggle('picked', b === btn));
    scriptRunState.events.push(`${new Date().toLocaleTimeString('pt-BR')} · ${ev}${value ? ' · ' + value : ''}`);
    $('script-event-log').textContent = scriptRunState.events.slice(-4).join('\n');
  };
  if (st.events) scriptButtons(events, st.events, tap);
  if (st.zones) {
    events.innerHTML = '';
    st.zones.forEach((z) => {
      const card = document.createElement('div');
      card.className = 'script-zone zone-' + z.color;
      const one = z.options.length === 1 && z.options[0] === z.label;
      if (!one) {
        const title = document.createElement('div');
        title.className = 'zone-title';
        title.textContent = z.label;
        card.appendChild(title);
      }
      z.options.forEach((opt) => {
        const b = document.createElement('button');
        b.className = 'btn';
        b.textContent = opt;
        const label = one ? opt : `${z.label} ${opt.toLowerCase()}`;
        b.addEventListener('click', () => tap(label, b));
        card.appendChild(b);
      });
      events.appendChild(card);
    });
  }
  scriptRunState.phaseAt = Date.now() + SCRIPT_PREPARE_S * 1000;
  scriptRunState.timer = setInterval(scriptTick, SCRIPT_TICK_MS);
  scriptTick();
}

function scriptEnterPhase(i) {
  const run = scriptRunState;
  run.index = i;
  const ph = run.phases[i];
  run.phaseAt = Date.now();
  scriptMark({ phase: ph.kind === 'events' ? 'phase' : ph.kind, n: ph.n, label: ph.say });
  $('script-say').textContent = ph.say;
  $('script-live').className = 'script-live ' + (ph.kind === 'on' ? 'on' : ph.kind === 'off' ? 'off' : '');
  const total = run.phases.length;
  $('script-phase').textContent = scriptStep.zones ? 'Toque de novo sempre que o ponteiro mudar de posição.' : scriptStep.pattern ? `${ph.kind === 'on' ? 'Aciona' : 'Solta'} · vez ${ph.n} de ${scriptStep.pattern.repeat}` : `Fase ${i + 1} de ${total}`;
  if (ph.kind !== 'events') bridge.captureSpeak(ph.say);
  bridge.captureVibrate(ph.kind === 'on' ? 400 : ph.kind === 'off' ? 150 : 250);
}

function scriptTick() {
  const run = scriptRunState;
  if (!run) return;
  const v = scriptSpeed();
  if (!scriptStep.passenger && v !== null && v > SCRIPT_MOVING_KMH) { scriptFinish('moving'); return; }
  if (!lastState || !lastState.running) { scriptFinish('capture_stopped'); return; }
  const now = Date.now();
  if (run.index < 0) {
    const left = Math.ceil((run.phaseAt - now) / 1000);
    $('script-count').textContent = String(Math.max(0, left));
    if (now >= run.phaseAt) scriptEnterPhase(0);
    return;
  }
  const ph = run.phases[run.index];
  const end = run.phaseAt + ph.s * 1000;
  if (now >= end) {
    if (run.index + 1 < run.phases.length) scriptEnterPhase(run.index + 1);
    else scriptFinish('done');
    return;
  }
  const left = Math.ceil((end - now) / 1000);
  $('script-count').textContent = scriptStep.zones ? '' : ph.kind === 'events' ? `${Math.floor((now - run.phaseAt) / 60000)}:${String(Math.floor(((now - run.phaseAt) / 1000) % 60)).padStart(2, '0')}` : String(left);
}

const SCRIPT_RESULTS = {
  done: 'Passo concluído.', cancelled: 'Passo interrompido.', moving: 'Passo interrompido: o carro andou.',
  capture_stopped: 'Passo interrompido: a captura parou.',
};

function scriptFinish(result) {
  const run = scriptRunState;
  if (!run) return;
  clearInterval(run.timer);
  scriptRunState = null;
  // Eventos terminam quando a pessoa encerra: isso conta como concluído
  const ok = result === 'done' || (result === 'cancelled' && scriptTapStep(scriptStep));
  scriptMark({ phase: 'step_end', result: ok ? 'done' : result });
  bridge.captureSpeak(ok ? 'Fim do passo.' : SCRIPT_RESULTS[result]);
  bridge.captureVibrate(ok ? 600 : 300);
  if (ok) { scriptProgress[scriptStep.id] = 'done'; scriptSaveProgress(); }
  $('script-stop').hidden = true;
  $('script-start').hidden = false;
  $('script-start').textContent = ok ? 'Refazer passo' : 'Tentar de novo';
  $('script-skip').hidden = false;
  $('script-back').disabled = false;
  $('script-say').textContent = ok ? 'Fim do passo' : 'Interrompido';
  $('script-count').textContent = '';
  $('script-phase').textContent = '';
  $('script-live').className = 'script-live';
  $('script-summary').hidden = false;
  const fmtTime = (t) => new Date(t).toLocaleTimeString('pt-BR');
  $('script-result').textContent = `${ok ? 'Passo concluído.' : SCRIPT_RESULTS[result]} ${fmtTime(run.startedAt)} → ${fmtTime(Date.now())}`;
  $('script-step-after').textContent = scriptStep.after || '';
  $('script-step-after').hidden = !scriptStep.after;
  $('script-note').value = '';
  scriptRenderReadings();
  scriptRenderReady();
}

/** Leituras no fim do passo: o que a captura tem agora de rotação, temperaturas, tensão, tanque e hodômetro. */
function scriptRenderReadings() {
  const box = $('script-readings');
  box.innerHTML = '';
  const r = (lastState && lastState.readings) || {};
  const roles = meta.roles || {};
  const ids = [roles.rpm || 'rpm', 'can_rpm', roles.coolant || 'coolant_temp', 'can_coolant_temp', roles.voltage || 'battery_volts', 'can_voltage',
    'fuel_level_pct', 'odometer_km'];
  const outputs = Object.fromEntries((meta.outputs || []).map((o) => [o.id, o]));
  [...new Set(ids)].filter((id) => Number.isFinite(r[id])).forEach((id) => {
    const o = outputs[id] || { name: id, unit: '' };
    const row = document.createElement('div');
    row.className = 'kv';
    const name = document.createElement('span');
    name.textContent = o.name;
    const val = document.createElement('b');
    val.textContent = `${fmt(r[id], o.decimals || 0)} ${o.unit || ''}`.trim();
    row.append(name, val);
    box.appendChild(row);
  });
  if (!box.childElementCount) box.textContent = 'Sem leituras no momento.';
}

function scriptNextStep() {
  const all = scriptStepsFlat();
  const i = all.findIndex((s) => s.id === scriptStep.id);
  const next = all.slice(i + 1).find((s) => !scriptProgress[s.id]) || all[i + 1];
  if (next) scriptOpenStep(next); else scriptBackToList();
}

function scriptOpenPanel() {
  const r = parse(bridge.getCaptureScript(), { ok: false, error: 'resposta inválida' });
  if (!r.ok) { toast(r.error || 'Roteiro indisponível.', true); return; }
  scriptData = r.script;
  scriptLoadProgress();
  $('script-title').textContent = scriptData.title || 'Roteiro de captura';
  $('script-panel').hidden = false;
  window.scriptPanelOpen = true;
  updateDashMode();
  scriptBackToList();
}

function scriptClosePanel() {
  if (scriptRunState) {
    if (!confirm('Interromper o passo em andamento?')) return;
    scriptFinish('cancelled');
  }
  $('script-panel').hidden = true;
  window.scriptPanelOpen = false;
  updateDashMode();
}

$('script-open').addEventListener('click', scriptOpenPanel);
$('script-close').addEventListener('click', scriptClosePanel);
$('script-back').addEventListener('click', scriptBackToList);
$('script-start').addEventListener('click', scriptStart);
$('script-stop').addEventListener('click', () => scriptFinish('cancelled'));
$('script-skip').addEventListener('click', () => {
  if (scriptRunState) return;
  if (lastState && lastState.running && lastState.diagRecording) scriptMark({ phase: 'skip' });
  scriptProgress[scriptStep.id] = 'skipped';
  scriptSaveProgress();
  scriptNextStep();
});
$('script-next').addEventListener('click', scriptNextStep);
// Confere antes de começar: a voz fala em português e o celular vibra forte no "liga" e curto no "desliga"
$('script-test').addEventListener('click', () => {
  bridge.captureSpeak('Teste de voz. Liga.');
  bridge.captureVibrate(400);
  setTimeout(() => { bridge.captureSpeak('Desliga.'); bridge.captureVibrate(150); }, 2000);
  toast('Você deve ouvir "liga" com vibração forte e, 2 s depois, "desliga" com vibração curta.');
});
$('script-note-save').addEventListener('click', () => {
  const note = $('script-note').value.trim();
  if (!note) return;
  if (okOrToast(scriptMark({ phase: 'note', note }), 'Observação gravada no arquivo de diagnóstico.')) $('script-note').value = '';
});
let scriptKeptAt = 0;
setInterval(() => {
  if (!window.scriptPanelOpen) return;
  if (!scriptRunState) scriptRenderReady();
  // Parado por muito tempo entre um passo e outro, a captura não pode encerrar
  if (lastState && lastState.running && Date.now() - scriptKeptAt > 60000) { scriptKeptAt = Date.now(); bridge.captureKeepAlive(); }
}, 1000);

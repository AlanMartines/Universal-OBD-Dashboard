/* Liga os mostradores do APK (dash.js) aos dados do servidor. Só números chegam a eles. */
(function () {
  'use strict';

  var picker = document.getElementById('vehicle-device');
  if (picker) {
    picker.addEventListener('change', function () { picker.form.submit(); });
  }
  var root = document.getElementById('vehicle-root');
  if (!root) return;

  var STALE_MS = 15000;
  var ROLES = {
    rpm: 'rpm', speed: 'speed', coolant: 'coolant_temp', voltage: 'battery_volts', throttle: 'throttle', map: 'map',
    intake: 'intake_temp', engineLoad: 'engine_load', timing: 'timing_advance', stft: 'stft_b1', ltft: 'ltft_b1', lambda: 'lambda_v',
    milOn: null, dtcCount: null,
  };
  var DERIVED = ['fuelLph', 'shiftUp', 'instantKmPerL', 'tripKmPerL', 'tripFuelUsedL', 'fuelRemainingL', 'realKmPerL', 'recommendedGear', 'estimatedGear', 'estimatedLoadPct', 'tripCost'];
  var DEFAULT_DASH = { rpmMax: 8000, rpmRedline: 6500, speedMax: 220, voltageMin: 11, voltageMax: 15 };

  var status = document.getElementById('vehicle-status');
  var readings = {};
  var derived = {};
  var lastTs = 0;
  var lastDtcs = [];
  var lastAlerts = [];
  var lastGps = null;
  var metaKey = '';
  var saved = {};
  try { saved = JSON.parse(root.dataset.limits) || {}; } catch (e) { /* ainda sem escalas salvas */ }

  function metaFrom() {
    var metrics = saved;
    var get = function (id, fallback) { return typeof metrics[id] === 'number' ? metrics[id] : fallback; };
    var meta = {
      roles: ROLES,
      dashboard: {
        rpmMax: get('dash.rpmMax', DEFAULT_DASH.rpmMax),
        rpmRedline: get('dash.rpmRedline', DEFAULT_DASH.rpmRedline),
        speedMax: get('dash.speedMax', DEFAULT_DASH.speedMax),
        speedCorrectionPct: get('dash.speedCorrectionPct', 0),
        voltageMin: get('dash.voltageMin', DEFAULT_DASH.voltageMin),
        voltageMax: get('dash.voltageMax', DEFAULT_DASH.voltageMax),
      },
      thermal: typeof metrics['dash.fan1C'] === 'number' ? {
        thermostatOpenC: get('dash.thermostatC', 87), fanStage1C: metrics['dash.fan1C'], fanStage2C: get('dash.fan2C', 103), criticalC: get('dash.criticalC', 105),
      } : null,
      fuel: typeof metrics['dash.tankL'] === 'number' ? { tankCapacityL: metrics['dash.tankL'], reserveMaxL: get('dash.reserveL', 0) } : null,
    };
    return meta;
  }

  function setStatus(text, cls) {
    status.textContent = text;
    status.className = 'badge ' + cls;
  }

  // Na simulação, o "agora" é a hora da gravação e a leitura reproduzida vale como atual.
  var replay = null;
  function isFresh() { return replay ? replay.ready : lastTs > 0 && Date.now() - lastTs <= STALE_MS; }

  function push() {
    var fresh = isFresh();
    window.Dash.update({
      running: fresh,
      connection: fresh ? 'STREAMING' : 'STOPPED',
      statusMessage: '',
      power: 'ACTIVE',
      readings: fresh ? readings : {},
      derived: fresh ? derived : {},
      alerts: fresh ? lastAlerts : [],
      confirmedDtcs: fresh ? lastDtcs : [],
      pendingDtcs: [],
      gps: fresh ? lastGps : null,
      tripDistanceKm: replay ? replay.km : readings.trip_distance_km,
      tripStartedAt: replay ? replay.t0 : typeof readings['trip.startedAt'] === 'number' ? readings['trip.startedAt'] : null,
      now: replay ? replay.t : undefined,
      // Total: o do app (hodômetro informado + viagens); na gravação, o odômetro lido do carro
      totalKm: typeof readings['app.odometer_km'] === 'number' ? readings['app.odometer_km'] : typeof readings.odometer_km === 'number' ? readings.odometer_km : null,
      // Indicador de economia (folha): só com o carro enviando
      computer: { ecoBand: fresh && typeof readings['pc.ecoBand'] === 'number' ? readings['pc.ecoBand'] : null },
    });
  }

  function apply(sample) {
    if (!sample || !sample.metrics) return;
    var ts = new Date(sample.ts).getTime();
    if (!Number.isFinite(ts) || ts < lastTs) return;
    lastTs = ts;
    Object.keys(sample.metrics).forEach(function (id) {
      var value = sample.metrics[id];
      if (typeof value !== 'number') return;
      // A leitura mais nova vale: as gravadas no histórico não trazem escalas e não podem desfazê-las.
      if (id.indexOf('dash.') === 0) saved[id] = value;
      if (id.indexOf('derived.') === 0) {
        if (DERIVED.indexOf(id.slice(8)) >= 0) derived[id.slice(8)] = value;
      } else {
        readings[id] = value;
      }
    });
    lastDtcs = Array.isArray(sample.dtcs) ? sample.dtcs : [];
    // Só a leitura ao vivo traz alertas; as do histórico não apagam um aviso ainda ativo
    if (Array.isArray(sample.alerts)) {
      lastAlerts = sample.alerts.filter(function (a) { return a && (a.level === 'WARNING' || a.level === 'CRITICAL') && typeof a.message === 'string'; });
    }
    lastGps = sample.gps && typeof sample.gps.speedKmh === 'number' ? { speedKmh: sample.gps.speedKmh, accuracyM: 5, ageMs: 0 } : null;
    var meta = metaFrom();
    var key = JSON.stringify(meta);
    if (key !== metaKey) {
      metaKey = key;
      window.Dash.setMeta(meta);
    }
    push();
  }

  window.Dash.mount(document.getElementById('dash-host'));
  window.Dash.setMeta(metaFrom());
  metaKey = JSON.stringify(metaFrom());

  var fullscreen = document.getElementById('vehicle-fullscreen');
  if (fullscreen && root.requestFullscreen) {
    fullscreen.addEventListener('click', function () { root.requestFullscreen().catch(function () {}); });
  } else if (fullscreen) {
    fullscreen.hidden = true;
  }

  if (root.dataset.replayTrip) {
    startReplay(root.dataset.replayTrip);
    return;
  }

  var initial = null;
  try { initial = JSON.parse(root.dataset.sample); } catch (e) { /* sem dados */ }
  apply(initial);
  push();

  // Sem leitura recente, o painel avisa em vez de mostrar valor antigo como se fosse atual.
  function tick() {
    if (isFresh()) {
      setStatus('Ao vivo', 'text-bg-success');
    } else {
      push();
      if (!lastTs) {
        setStatus('Sem dados', 'text-bg-secondary');
      } else {
        var seconds = Math.round((Date.now() - lastTs) / 1000);
        var text = seconds < 3600 ? 'Sem dados há ' + Math.max(1, Math.round(seconds / 60)) + ' min' : 'Sem dados há ' + Math.round(seconds / 3600) + ' h';
        setStatus(seconds < 60 ? 'Sem dados há ' + seconds + ' s' : text, 'text-bg-warning');
      }
    }
  }
  setInterval(tick, 1000);
  tick();

  var source = new EventSource('/dispositivos/' + encodeURIComponent(root.dataset.deviceId) + '/ao-vivo');
  source.addEventListener('sample', function (event) {
    try { apply(JSON.parse(event.data)); } catch (e) { /* quadro inválido é ignorado */ }
    tick();
  });

  /* ---------------------------------------------------------------- Simulação de uma viagem gravada */
  // Reproduz as leituras guardadas no tempo da gravação (1×, 5×, 16×). Entre duas leituras próximas os
  // números andam em linha reta; num buraco maior que GAP_MS fica a última leitura.
  function startReplay(tripId) {
    var GAP_MS = 30000;
    var TICK_MS = 100;
    var playBtn = document.getElementById('replay-play');
    var seek = document.getElementById('replay-seek');
    var timeText = document.getElementById('replay-time');
    var speedBtns = Array.prototype.slice.call(document.querySelectorAll('[data-replay-speed]'));
    replay = { ready: false, t: 0, t0: 0, t1: 0, km: 0, speed: 1, playing: false, frames: [] };
    setStatus('Carregando viagem…', 'text-bg-secondary');

    function clock(ms) {
      return new Date(ms).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    }
    function span(ms) {
      var s = Math.max(0, Math.round(ms / 1000));
      var h = Math.floor(s / 3600);
      var m = Math.floor((s % 3600) / 60);
      var pad = function (n) { return String(n).padStart(2, '0'); };
      return (h ? h + ':' + pad(m) : String(m)) + ':' + pad(s % 60);
    }
    /** Última leitura com hora <= t (busca binária). */
    function indexAt(t) {
      var f = replay.frames;
      var lo = 0;
      var hi = f.length - 1;
      while (lo < hi) {
        var mid = (lo + hi + 1) >> 1;
        if (f[mid].ms <= t) lo = mid; else hi = mid - 1;
      }
      return lo;
    }
    function show() {
      var f = replay.frames;
      var i = indexAt(replay.t);
      var a = f[i];
      var b = f[i + 1];
      var k = b && b.ms - a.ms <= GAP_MS ? Math.min(1, Math.max(0, (replay.t - a.ms) / (b.ms - a.ms))) : 0;
      readings = {};
      derived = {};
      Object.keys(a.metrics).forEach(function (id) {
        var v = a.metrics[id];
        if (typeof v !== 'number') return;
        var w = k > 0 && typeof b.metrics[id] === 'number' ? v + (b.metrics[id] - v) * k : v;
        if (id.indexOf('dash.') === 0) saved[id] = v;
        if (id.indexOf('derived.') === 0) {
          if (DERIVED.indexOf(id.slice(8)) >= 0) derived[id.slice(8)] = w;
        } else {
          readings[id] = w;
        }
      });
      lastDtcs = Array.isArray(a.dtcs) ? a.dtcs : [];
      lastAlerts = [];
      var speedNow = typeof readings.speed === 'number' ? readings.speed : 0;
      var lphNow = typeof derived.fuelLph === 'number' ? derived.fuelLph : 0;
      var dtH = k > 0 ? (replay.t - a.ms) / 3600000 : 0;
      replay.km = a.km + speedNow * dtH;
      fillDerived(replay.km, a.liters + lphNow * dtH, speedNow);
      lastGps = a.gps && typeof a.gps.speedKmh === 'number' ? { speedKmh: a.gps.speedKmh, accuracyM: a.gps.accuracyM || 5, ageMs: 0 } : null;
      push();
      if (document.activeElement !== seek) seek.value = String(Math.round(1000 * (replay.t - replay.t0) / Math.max(1, replay.t1 - replay.t0)));
      timeText.textContent = clock(replay.t) + ' · ' + span(replay.t - replay.t0) + ' / ' + span(replay.t1 - replay.t0);
    }
    /**
     * Viagens gravadas antes da versão do app que guarda os cálculos: refaz aqui o que dá para refazer
     * com as leituras (km/l, combustível e média da viagem, litros no tanque). Marcha e folha não.
     */
    function fillDerived(km, liters, speed) {
      var lph = derived.fuelLph;
      if (derived.instantKmPerL === undefined && typeof lph === 'number' && lph > 0.05 && speed > 3) derived.instantKmPerL = speed / lph;
      if (derived.tripFuelUsedL === undefined) derived.tripFuelUsedL = liters;
      if (derived.tripKmPerL === undefined && liters > 0.05 && km > 0.5) derived.tripKmPerL = km / liters;
      var tank = saved['dash.tankL'];
      if (derived.fuelRemainingL === undefined && typeof readings.fuel_level_pct === 'number' && typeof tank === 'number') {
        derived.fuelRemainingL = tank * Math.min(100, Math.max(0, readings.fuel_level_pct)) / 100;
      }
    }
    function setPlaying(on) {
      if (on && replay.t >= replay.t1) replay.t = replay.t0;
      replay.playing = on;
      var icon = document.createElement('i');
      icon.className = 'fa-solid ' + (on ? 'fa-pause' : 'fa-play');
      icon.setAttribute('aria-hidden', 'true');
      playBtn.replaceChildren(icon);
      playBtn.title = on ? 'Pausar' : 'Reproduzir';
      playBtn.setAttribute('aria-label', playBtn.title);
      setStatus((on ? 'Simulação ' : 'Pausado ') + replay.speed + '×', on ? 'text-bg-info' : 'text-bg-secondary');
    }
    var last = 0;
    function step() {
      var now = performance.now();
      if (replay.playing) {
        replay.t = Math.min(replay.t1, replay.t + (now - last) * replay.speed);
        show();
        if (replay.t >= replay.t1) setPlaying(false);
      }
      last = now;
    }

    fetch('/dispositivos/' + encodeURIComponent(root.dataset.deviceId) + '/viagens/' + encodeURIComponent(tripId) + '/leituras', { headers: { accept: 'application/json' } })
      .then(function (r) { if (!r.ok) throw new Error(String(r.status)); return r.json(); })
      .then(function (data) {
        var km = 0;
        var liters = 0;
        var prev = null;
        replay.frames = (data.samples || []).map(function (s) {
          var ms = new Date(s.ts).getTime();
          var metrics = s.metrics || {};
          // Distância e combustível da viagem somados no tempo, como na aba Viagens
          if (prev && ms - prev.ms <= GAP_MS) {
            if (typeof prev.metrics.speed === 'number') km += prev.metrics.speed * (ms - prev.ms) / 3600000;
            if (typeof prev.metrics['derived.fuelLph'] === 'number') liters += prev.metrics['derived.fuelLph'] * (ms - prev.ms) / 3600000;
          }
          prev = { ms: ms, metrics: metrics, dtcs: s.dtcs, gps: s.gps, km: km, liters: liters };
          return prev;
        }).filter(function (f) { return Number.isFinite(f.ms); });
        if (!replay.frames.length) throw new Error('vazia');
        replay.t0 = replay.frames[0].ms;
        replay.t1 = replay.frames[replay.frames.length - 1].ms;
        replay.t = replay.t0;
        replay.ready = true;
        var meta = metaFrom();
        metaKey = JSON.stringify(meta);
        window.Dash.setMeta(meta);
        playBtn.disabled = false;
        seek.disabled = false;
        show();
        last = performance.now();
        setPlaying(true);
        setInterval(step, TICK_MS);
      })
      .catch(function () {
        setStatus('Viagem não encontrada', 'text-bg-warning');
        timeText.textContent = '--:--';
      });

    playBtn.addEventListener('click', function () { setPlaying(!replay.playing); });
    speedBtns.forEach(function (b) {
      b.addEventListener('click', function () {
        replay.speed = Number(b.dataset.replaySpeed) || 1;
        speedBtns.forEach(function (x) {
          var on = x === b;
          x.classList.toggle('active', on);
          x.setAttribute('aria-pressed', on ? 'true' : 'false');
        });
        setPlaying(replay.playing);
      });
    });
    seek.addEventListener('input', function () {
      if (!replay.ready) return;
      replay.t = replay.t0 + (replay.t1 - replay.t0) * Number(seek.value) / 1000;
      show();
    });
  }
}());

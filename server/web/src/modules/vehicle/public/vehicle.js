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
  var DERIVED = ['fuelLph', 'instantKmPerL', 'tripKmPerL', 'tripFuelUsedL', 'fuelRemainingL', 'realKmPerL', 'recommendedGear', 'estimatedGear', 'estimatedLoadPct', 'tripCost'];
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

  function isFresh() { return lastTs > 0 && Date.now() - lastTs <= STALE_MS; }

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
      tripDistanceKm: readings.trip_distance_km,
      tripStartedAt: typeof readings['trip.startedAt'] === 'number' ? readings['trip.startedAt'] : null,
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

  var fullscreen = document.getElementById('vehicle-fullscreen');
  if (fullscreen && root.requestFullscreen) {
    fullscreen.addEventListener('click', function () { root.requestFullscreen().catch(function () {}); });
  } else if (fullscreen) {
    fullscreen.hidden = true;
  }
}());

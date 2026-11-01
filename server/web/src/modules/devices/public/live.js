/* Painel ao vivo. Os dados entram na página só por textContent, nunca como HTML. */
(function () {
  'use strict';

  var LABELS = {
    rpm: ['Rotação', 'RPM', 0], speed: ['Velocidade', 'km/h', 0], coolant_temp: ['Arrefecimento', '°C', 0],
    intake_temp: ['Ar admitido', '°C', 0], battery_volts: ['Tensão', 'V', 1], throttle: ['Borboleta', '%', 1],
    map: ['MAP', 'kPa', 0], maf: ['MAF', 'g/s', 1], engine_load: ['Carga', '%', 0],
    timing_advance: ['Avanço', '°', 1], stft_b1: ['STFT', '%', 1], ltft_b1: ['LTFT', '%', 1],
    odometer_km: ['Hodômetro', 'km', 0], trip_km: ['Parcial', 'km', 1], fuel_raw: ['Tanque (bruto)', '', 0],
    'derived.fuelLph': ['Consumo', 'L/h', 1], 'derived.instantKmPerL': ['Consumo inst.', 'km/L', 1],
    'derived.tripKmPerL': ['Consumo viagem', 'km/L', 1], 'derived.tripFuelUsedL': ['Combustível usado', 'L', 2],
    'derived.fuelRemainingL': ['Tanque', 'L', 1], 'derived.tripDistanceKm': ['Distância', 'km', 1],
    'derived.estimatedGear': ['Marcha', '', 0],
  };

  var root = document.getElementById('live-root');
  if (!root) return;
  var deviceId = root.dataset.deviceId;
  var status = document.getElementById('live-status');
  var metricsEl = document.getElementById('metrics');
  var select = document.getElementById('chart-metric');
  var hoursEl = document.getElementById('chart-hours');
  var cards = {};
  var chart = null;

  function info(id) {
    return LABELS[id] || [id.replace(/^derived\./, '').replace(/_/g, ' '), '', 2];
  }

  function card(id) {
    if (cards[id]) return cards[id];
    var meta = info(id);
    var col = document.createElement('div');
    col.className = 'col';
    var box = document.createElement('div');
    box.className = 'card h-100';
    var body = document.createElement('div');
    body.className = 'card-body py-3';
    var label = document.createElement('div');
    label.className = 'small text-body-secondary text-truncate';
    label.textContent = meta[0];
    var value = document.createElement('div');
    value.className = 'metric-value';
    var unit = document.createElement('div');
    unit.className = 'small text-body-secondary';
    unit.textContent = meta[1];
    body.append(label, value, unit);
    box.append(body);
    col.append(box);
    metricsEl.append(col);
    var option = document.createElement('option');
    option.value = id;
    option.textContent = meta[0];
    select.append(option);
    cards[id] = value;
    return value;
  }

  function render(sample) {
    if (!sample) {
      document.getElementById('no-data').classList.remove('d-none');
      return;
    }
    document.getElementById('no-data').classList.add('d-none');
    document.getElementById('last-update').textContent = new Date(sample.ts).toLocaleString('pt-BR');
    Object.keys(sample.metrics || {}).sort().forEach(function (id) {
      var v = sample.metrics[id];
      if (typeof v === 'number') card(id).textContent = v.toLocaleString('pt-BR', { maximumFractionDigits: info(id)[2] });
    });
    var dtcs = sample.dtcs || [];
    document.getElementById('dtc-box').classList.toggle('d-none', dtcs.length === 0);
    document.getElementById('dtc-list').textContent = dtcs.join(', ');
    document.getElementById('gps-box').classList.toggle('d-none', !sample.gps);
    if (sample.gps) document.getElementById('gps-text').textContent = sample.gps.lat.toFixed(5) + ', ' + sample.gps.lon.toFixed(5);
  }

  function setStatus(text, cls) {
    status.textContent = text;
    status.className = 'badge ' + cls;
  }

  function loadChart() {
    var metric = select.value;
    if (!metric || typeof Chart === 'undefined') return;
    var query = new URLSearchParams({ metric: metric, hours: hoursEl.value });
    fetch('/dispositivos/' + encodeURIComponent(deviceId) + '/historico?' + query, { credentials: 'same-origin' })
      .then(function (r) { if (!r.ok) throw new Error('historico'); return r.json(); })
      .then(function (data) {
        var points = data.points.map(function (p) { return { x: new Date(p.t).getTime(), y: p.v }; });
        if (chart) chart.destroy();
        chart = new Chart(document.getElementById('history-chart'), {
          type: 'line',
          data: { datasets: [{ label: info(metric)[0], data: points, borderColor: '#6ea8fe', pointRadius: 0, borderWidth: 2, spanGaps: false }] },
          options: {
            responsive: true,
            maintainAspectRatio: false,
            animation: false,
            parsing: false,
            plugins: { legend: { display: false } },
            scales: {
              x: { type: 'linear', ticks: { color: '#495057', maxTicksLimit: 8, callback: function (v) {
                return new Date(v).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
              } }, grid: { color: 'rgba(73,80,87,.15)' } },
              y: { ticks: { color: '#495057' }, grid: { color: 'rgba(73,80,87,.15)' } },
            },
          },
        });
      })
      .catch(function () { /* o painel ao vivo continua funcionando sem o gráfico */ });
  }

  var initial = null;
  try { initial = JSON.parse(document.getElementById('latest-data').dataset.sample); } catch (e) { /* sem dados */ }
  render(initial);
  if (cards.speed) select.value = 'speed';
  loadChart();
  select.addEventListener('change', loadChart);
  hoursEl.addEventListener('change', loadChart);

  // O selo mostra se o carro está enviando, não se o navegador está ligado ao servidor.
  var STALE_MS = 20000;
  var lastTs = initial && initial.ts ? new Date(initial.ts).getTime() : 0;

  function ago(ms) {
    var seconds = Math.max(1, Math.round(ms / 1000));
    if (seconds < 60) return seconds + ' s';
    if (seconds < 3600) return Math.round(seconds / 60) + ' min';
    if (seconds < 86400) return Math.round(seconds / 3600) + ' h';
    return Math.round(seconds / 86400) + ' dias';
  }

  function tick() {
    if (!lastTs) {
      setStatus('Sem dados', 'text-bg-secondary');
    } else if (Date.now() - lastTs <= STALE_MS) {
      setStatus('Ao vivo', 'text-bg-success');
    } else {
      setStatus('Sem dados há ' + ago(Date.now() - lastTs), 'text-bg-warning');
    }
  }
  tick();
  setInterval(tick, 1000);

  var source = new EventSource('/dispositivos/' + encodeURIComponent(deviceId) + '/ao-vivo');
  source.addEventListener('sample', function (event) {
    var hadChart = select.value;
    var sample = JSON.parse(event.data);
    render(sample);
    var ts = new Date(sample.ts).getTime();
    if (ts > lastTs) lastTs = ts;
    tick();
    if (!hadChart && select.value) loadChart();
  });
}());

/* Tela do dispositivo. Os dados entram na página só por textContent, nunca como HTML. */
(function () {
  'use strict';

  var root = document.getElementById('live-root');
  if (!root) return;

  var SVGNS = 'http://www.w3.org/2000/svg';
  var STALE_MS = 20000;
  var SPARK_MINUTES = 15;
  var SPARK_POINTS = 60;
  var COLORS = ['#0d6efd', '#fd7e14'];
  // Texto e grade do gráfico acompanham o tema do painel.
  function dark() { return document.documentElement.getAttribute('data-bs-theme') === 'dark'; }
  function ink() { return dark() ? '#adb5bd' : '#495057'; }
  function grid() { return dark() ? 'rgba(173,181,189,.12)' : 'rgba(73,80,87,.1)'; }

  var LABELS = {
    rpm: ['Rotação', 'RPM', 0], speed: ['Velocidade', 'km/h', 0], coolant_temp: ['Arrefecimento', '°C', 0],
    battery_volts: ['Tensão', 'V', 1], intake_temp: ['Ar admitido', '°C', 0], throttle: ['Borboleta', '%', 1],
    map: ['MAP', 'kPa', 0], maf: ['MAF', 'g/s', 1], engine_load: ['Carga', '%', 0], timing_advance: ['Avanço', '°', 1],
    stft_b1: ['STFT', '%', 1], ltft_b1: ['LTFT', '%', 1], lambda_v: ['Sonda lambda', 'V', 2],
    odometer_km: ['Hodômetro', 'km', 0], trip_km: ['Parcial', 'km', 1], trip_distance_km: ['Distância da viagem', 'km', 1], fuel_raw: ['Tanque (bruto)', '', 0],
    'derived.fuelLph': ['Consumo', 'L/h', 1], 'derived.instantKmPerL': ['Consumo instantâneo', 'km/L', 1],
    'derived.tripKmPerL': ['Média da viagem', 'km/L', 1], 'derived.tripFuelUsedL': ['Combustível usado', 'L', 2],
    'derived.fuelRemainingL': ['No tanque', 'L', 1], 'derived.tripDistanceKm': ['Distância', 'km', 1], 'derived.estimatedGear': ['Marcha', '', 0],
    'derived.recommendedGear': ['Marcha sugerida', '', 0],
    'derived.estimatedLoadPct': ['Carga estimada', '%', 0], 'derived.tripCost': ['Custo da viagem', 'R$', 2],
    fuel_level_pct: ['Nível do tanque', '%', 0],
    // Sinais da escuta CAN (ESP32), lidos da rede do painel do carro
    can_speed: ['Velocidade (painel)', 'km/h', 0], can_rpm: ['Rotação (painel)', 'RPM', 0],
    can_coolant_temp: ['Temperatura do motor (painel)', '°C', 0], can_voltage: ['Tensão da bateria (painel)', 'V', 1],
  };
  var HIGHLIGHTS = ['speed', 'rpm', 'coolant_temp', 'battery_volts'];
  var GROUPS = [
    ['Motor', ['derived.estimatedLoadPct', 'engine_load', 'map', 'maf', 'throttle', 'timing_advance', 'derived.estimatedGear', 'derived.recommendedGear', 'can_rpm', 'can_coolant_temp']],
    ['Combustível', ['fuel_level_pct', 'derived.tripCost', 'derived.fuelLph', 'derived.instantKmPerL', 'derived.tripKmPerL', 'derived.tripFuelUsedL', 'derived.fuelRemainingL', 'fuel_raw', 'stft_b1', 'ltft_b1', 'lambda_v']],
    ['Viagem', ['can_speed', 'trip_distance_km', 'derived.tripDistanceKm', 'trip_km', 'odometer_km']],
    ['Elétrica', ['can_voltage']],
    ['Ambiente', ['intake_temp']],
    ['Outros', []],
  ];

  var deviceId = root.dataset.deviceId;
  var select = document.getElementById('chart-metric');
  var compare = document.getElementById('chart-compare');
  var rangeBox = document.getElementById('chart-range');
  var status = document.getElementById('live-status');
  var overview = document.getElementById('pane-overview');
  var staleNote = document.getElementById('stale-note');
  var lastUpdate = document.getElementById('last-update');
  var limits = {};
  try { limits = JSON.parse(document.getElementById('latest-data').dataset.limits) || {}; } catch (e) { /* ainda sem escalas salvas */ }
  var cards = {};
  var rows = {};
  var groupBoxes = {};
  var known = {};
  var sparkData = {};
  var chart = null;
  var minutes = 15;
  var lastTs = 0;
  var chartRequest = 0;

  // Limites dos mostradores e dados internos da viagem não são sinais para exibir.
  function isInternal(id) { return id.indexOf('dash.') === 0 || id.indexOf('trip.') === 0 || id.indexOf('app.') === 0; }

  function info(id) {
    if (LABELS[id]) return LABELS[id];
    var lambda = /^lambda_b(\d)s(\d)(_v)?$/.exec(id);
    if (lambda) return ['Sonda lambda (B' + lambda[1] + 'S' + lambda[2] + ')', 'V', 2];
    var text = id.replace(/^derived\./, '').replace(/_/g, ' ');
    return [text.charAt(0).toUpperCase() + text.slice(1), '', 2];
  }

  function format(id, value) {
    return value.toLocaleString('pt-BR', { maximumFractionDigits: info(id)[2] });
  }

  function node(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text !== undefined) e.textContent = text;
    return e;
  }

  function buildHighlights() {
    var box = document.getElementById('highlights');
    HIGHLIGHTS.forEach(function (id) {
      var meta = info(id);
      var col = node('div', 'col');
      var card = node('button', 'stat-card w-100');
      card.type = 'button';
      card.title = 'Ver ' + meta[0] + ' no histórico';
      var value = node('span', 'stat-value', '--');
      var unit = node('span', 'stat-unit', meta[1]);
      var line = node('span', 'stat-line');
      line.append(value, unit);
      var spark = document.createElementNS(SVGNS, 'svg');
      spark.setAttribute('class', 'stat-spark');
      spark.setAttribute('viewBox', '0 0 100 24');
      spark.setAttribute('preserveAspectRatio', 'none');
      spark.setAttribute('aria-hidden', 'true');
      var poly = document.createElementNS(SVGNS, 'polyline');
      spark.append(poly);
      card.append(node('span', 'stat-label', meta[0]), line, spark);
      card.addEventListener('click', function () {
        addOption(id);
        select.value = id;
        loadChart();
        if (window.showTab) window.showTab('historico');
      });
      col.append(card);
      box.append(col);
      cards[id] = { value: value, poly: poly, card: card };
    });
  }

  function groupOf(id) {
    for (var i = 0; i < GROUPS.length; i += 1) {
      if (GROUPS[i][1].indexOf(id) >= 0 || (GROUPS[i][0] === 'Combustível' && /^lambda_/.test(id))) return GROUPS[i][0];
    }
    return 'Outros';
  }

  function groupBox(name) {
    if (groupBoxes[name]) return groupBoxes[name];
    var col = node('div', 'col');
    col.dataset.order = String(GROUPS.findIndex(function (g) { return g[0] === name; }));
    var panel = node('section', 'stat-panel h-100');
    panel.append(node('h2', 'stat-group-title', name));
    var list = node('dl', 'stat-list mb-0');
    panel.append(list);
    col.append(panel);
    var parent = document.getElementById('groups');
    var after = Array.prototype.find.call(parent.children, function (c) { return Number(c.dataset.order) > Number(col.dataset.order); });
    parent.insertBefore(col, after || null);
    groupBoxes[name] = list;
    return list;
  }

  function row(id) {
    if (rows[id]) return rows[id];
    var meta = info(id);
    var name = groupOf(id);
    var list = groupBox(name);
    var wrap = node('div', 'stat-row');
    var value = node('dd', 'mb-0');
    wrap.append(node('dt', '', meta[0]), value);
    // Mesma ordem da lista do grupo, qualquer que seja a ordem de chegada; os sem posição vão ao fim.
    var order = (GROUPS.find(function (g) { return g[0] === name; }) || [name, []])[1];
    var pos = order.indexOf(id);
    wrap.dataset.order = String(pos < 0 ? 999 : pos);
    var after = Array.prototype.find.call(list.children, function (c) { return Number(c.dataset.order) > Number(wrap.dataset.order); });
    list.insertBefore(wrap, after || null);
    rows[id] = value;
    return value;
  }

  function addOption(id) {
    if (known[id]) return;
    known[id] = true;
    var label = info(id)[0];
    [select, compare].forEach(function (el) {
      var option = document.createElement('option');
      option.value = id;
      option.textContent = label;
      el.append(option);
    });
  }

  /** Só marca quando há limite vindo do app. Sem limite, fica neutro. */
  function level(id, value) {
    if (id === 'coolant_temp') {
      if (limits['dash.criticalC'] !== undefined && value >= limits['dash.criticalC']) return 'danger';
      if (limits['dash.fan2C'] !== undefined && value >= limits['dash.fan2C']) return 'warning';
    }
    if (id === 'battery_volts' && limits['dash.voltageMin'] !== undefined && value < limits['dash.voltageMin']) return 'warning';
    if (id === 'rpm' && limits['dash.rpmRedline'] !== undefined && value >= limits['dash.rpmRedline']) return 'danger';
    return '';
  }

  function drawSpark(id) {
    var card = cards[id];
    var points = sparkData[id] || [];
    if (!card) return;
    if (points.length < 2) {
      card.poly.setAttribute('points', '');
      return;
    }
    var now = Date.now();
    var from = now - SPARK_MINUTES * 60000;
    var values = points.map(function (p) { return p.v; });
    var lo = Math.min.apply(null, values);
    var hi = Math.max.apply(null, values);
    var span = hi - lo || 1;
    card.poly.setAttribute('points', points.map(function (p) {
      var x = ((p.t - from) / (now - from)) * 100;
      var y = 22 - ((p.v - lo) / span) * 20;
      return x.toFixed(1) + ',' + y.toFixed(1);
    }).join(' '));
  }

  function pushSpark(id, ts, value) {
    if (!cards[id]) return;
    var list = sparkData[id] || (sparkData[id] = []);
    var last = list[list.length - 1];
    if (last && ts <= last.t) return;
    list.push({ t: ts, v: value });
    var limit = Date.now() - SPARK_MINUTES * 60000;
    while (list.length > SPARK_POINTS * 4 || (list.length && list[0].t < limit)) list.shift();
    drawSpark(id);
  }

  function render(sample) {
    if (!sample) {
      document.getElementById('no-data').classList.remove('d-none');
      return;
    }
    document.getElementById('no-data').classList.add('d-none');
    var ts = new Date(sample.ts).getTime();
    var metrics = sample.metrics || {};
    Object.keys(metrics).forEach(function (id) {
      if (id.indexOf('dash.') === 0 && typeof metrics[id] === 'number') limits[id] = metrics[id];
    });
    Object.keys(metrics).forEach(function (id) {
      var value = metrics[id];
      if (typeof value !== 'number' || isInternal(id)) return;
      addOption(id);
      if (cards[id]) {
        cards[id].value.textContent = format(id, value);
        cards[id].card.dataset.level = level(id, value);
        pushSpark(id, ts, value);
      } else {
        var unit = info(id)[1];
        row(id).textContent = format(id, value) + (unit ? ' ' + unit : '');
      }
      appendToChart(id, ts, value);
    });
    var dtcs = sample.dtcs || [];
    document.getElementById('dtc-box').classList.toggle('d-none', dtcs.length === 0);
    document.getElementById('dtc-list').textContent = dtcs.join(', ');
    if (sample.gps) {
      document.getElementById('gps-box').classList.remove('d-none');
      document.getElementById('gps-text').textContent = sample.gps.lat.toFixed(5) + ', ' + sample.gps.lon.toFixed(5);
    }
  }

  function tickLabel(value) {
    var options = { hour: '2-digit', minute: '2-digit' };
    if (minutes <= 15) options.second = '2-digit';
    if (minutes > 1440) return new Date(value).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' }) + ' ' + new Date(value).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
    return new Date(value).toLocaleTimeString('pt-BR', options);
  }

  // Período sem dados vira intervalo no gráfico, sem uma reta ligando as pontas.
  function withGaps(points, bucketSeconds) {
    var out = [];
    var limit = Math.max(bucketSeconds * 3, 30) * 1000;
    points.forEach(function (p) {
      var x = new Date(p.t).getTime();
      if (out.length && x - out[out.length - 1].x > limit) out.push({ x: x - 1, y: null });
      out.push({ x: x, y: p.v });
    });
    return out;
  }

  function fetchHistory(metric, range) {
    var query = new URLSearchParams({ metric: metric, minutes: String(range) });
    return fetch('/dispositivos/' + encodeURIComponent(deviceId) + '/historico?' + query, { credentials: 'same-origin' })
      .then(function (r) { if (!r.ok) throw new Error('historico'); return r.json(); });
  }

  function dataset(metric, data, index) {
    var color = COLORS[index];
    return {
      label: info(metric)[0],
      metric: metric,
      data: data,
      yAxisID: index ? 'y2' : 'y',
      borderColor: color,
      backgroundColor: color + '1a',
      fill: index === 0,
      tension: 0.25,
      pointRadius: 0,
      pointHoverRadius: 3,
      borderWidth: 2,
      spanGaps: false,
    };
  }

  // Trocar o tema redesenha o gráfico com as cores novas.
  document.addEventListener('app-theme', function () { if (chart) loadChart(); });

  function loadChart() {
    var metric = select.value;
    var second = compare.value && compare.value !== metric ? compare.value : '';
    if (!metric || typeof Chart === 'undefined') return;
    var request = ++chartRequest;
    var list = second ? [metric, second] : [metric];
    Promise.all(list.map(function (m) { return fetchHistory(m, minutes); })).then(function (results) {
      if (request !== chartRequest) return;
      var sets = results.map(function (r, i) { return dataset(list[i], withGaps(r.points, r.bucketSeconds), i); });
      var now = Date.now();
      if (chart) chart.destroy();
      chart = new Chart(document.getElementById('history-chart'), {
        type: 'line',
        data: { datasets: sets },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          animation: false,
          parsing: false,
          normalized: true,
          interaction: { mode: 'nearest', axis: 'x', intersect: false },
          plugins: {
            legend: { display: !!second, position: 'top', align: 'end', labels: { boxWidth: 12, boxHeight: 2, color: ink() } },
            tooltip: {
              callbacks: {
                title: function (items) { return items.length ? new Date(items[0].parsed.x).toLocaleString('pt-BR') : ''; },
                label: function (item) {
                  var id = item.dataset.metric;
                  var unit = info(id)[1];
                  return info(id)[0] + ': ' + format(id, item.parsed.y) + (unit ? ' ' + unit : '');
                },
              },
            },
          },
          scales: {
            x: {
              type: 'linear',
              min: now - minutes * 60000,
              max: now,
              grid: { display: false },
              border: { color: grid() },
              ticks: { color: ink(), maxTicksLimit: 6, maxRotation: 0, callback: tickLabel },
            },
            y: {
              grid: { color: grid() },
              border: { display: false },
              ticks: { color: ink(), maxTicksLimit: 5, callback: function (v) { return v.toLocaleString('pt-BR'); } },
            },
            y2: {
              display: !!second,
              position: 'right',
              grid: { display: false },
              border: { display: false },
              ticks: { color: COLORS[1], maxTicksLimit: 5, callback: function (v) { return v.toLocaleString('pt-BR'); } },
            },
          },
        },
      });
    }).catch(function () { /* o restante da tela continua funcionando sem o gráfico */ });
  }

  function appendToChart(id, ts, value) {
    if (!chart) return;
    var changed = false;
    chart.data.datasets.forEach(function (set) {
      if (set.metric !== id) return;
      var last = set.data[set.data.length - 1];
      if (last && ts <= last.x) return;
      if (last && ts - last.x > Math.max(minutes * 60000 / 100, 30000)) set.data.push({ x: ts - 1, y: null });
      set.data.push({ x: ts, y: value });
      changed = true;
    });
    if (changed) {
      chart.options.scales.x.max = Date.now();
      chart.options.scales.x.min = Date.now() - minutes * 60000;
      chart.update('none');
    }
  }

  function loadSparks() {
    HIGHLIGHTS.forEach(function (id) {
      fetchHistory(id, SPARK_MINUTES).then(function (r) {
        sparkData[id] = r.points.map(function (p) { return { t: new Date(p.t).getTime(), v: p.v }; });
        drawSpark(id);
      }).catch(function () { /* sem minigráfico, o valor continua visível */ });
    });
  }

  function ago(ms) {
    var seconds = Math.max(1, Math.round(ms / 1000));
    if (seconds < 60) return seconds + ' s';
    if (seconds < 3600) return Math.round(seconds / 60) + ' min';
    if (seconds < 86400) return Math.round(seconds / 3600) + ' h';
    return Math.round(seconds / 86400) + ' dias';
  }

  // O selo mostra se o carro está enviando, não se o navegador está ligado ao servidor.
  function tick() {
    if (!lastTs) {
      status.textContent = 'Sem dados';
      status.className = 'badge text-bg-secondary';
      lastUpdate.textContent = '';
      return;
    }
    var age = Date.now() - lastTs;
    var stale = age > STALE_MS;
    if (!stale) {
      status.textContent = 'Ao vivo';
      status.className = 'badge text-bg-success';
    } else {
      status.textContent = 'Sem dados';
      status.className = 'badge text-bg-warning';
    }
    // Sem transmissão, os cartões mostram a última leitura que chegou, não o momento atual.
    overview.classList.toggle('is-stale', stale);
    staleNote.classList.toggle('d-none', !stale);
    if (stale) {
      var when = new Date(lastTs);
      staleNote.lastChild.textContent = 'Valores da última leitura, em ' + when.toLocaleDateString('pt-BR') + ' às ' +
        when.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }) + '. O veículo não está enviando dados agora.';
    }
    lastUpdate.textContent = 'Última leitura há ' + ago(age);
    lastUpdate.title = new Date(lastTs).toLocaleString('pt-BR');
  }

  buildHighlights();
  var initial = null;
  try { initial = JSON.parse(document.getElementById('latest-data').dataset.sample); } catch (e) { /* sem dados */ }
  HIGHLIGHTS.forEach(addOption);
  render(initial);
  if (initial && initial.ts) lastTs = new Date(initial.ts).getTime();
  select.value = 'speed';
  loadChart();
  loadSparks();
  tick();
  setInterval(tick, 1000);
  setInterval(function () { HIGHLIGHTS.forEach(drawSpark); }, 30000);

  select.addEventListener('change', loadChart);
  compare.addEventListener('change', loadChart);
  rangeBox.addEventListener('click', function (event) {
    var button = event.target.closest('button[data-minutes]');
    if (!button) return;
    rangeBox.querySelectorAll('button').forEach(function (b) { b.classList.toggle('active', b === button); });
    minutes = Number(button.dataset.minutes);
    loadChart();
  });

  var gpsButton = document.getElementById('gps-toggle');
  gpsButton.addEventListener('click', function () {
    var text = document.getElementById('gps-text');
    text.hidden = !text.hidden;
    gpsButton.setAttribute('aria-expanded', String(!text.hidden));
  });

  var source = new EventSource('/dispositivos/' + encodeURIComponent(deviceId) + '/ao-vivo');
  source.addEventListener('sample', function (event) {
    var sample = JSON.parse(event.data);
    var ts = new Date(sample.ts).getTime();
    // Leitura atrasada entra no histórico, mas não substitui a mais nova na tela.
    if (ts < lastTs) return;
    render(sample);
    lastTs = ts;
    tick();
  });
}());

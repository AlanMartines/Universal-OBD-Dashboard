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
    'derived.vacuumKpa': ['Vácuo do coletor', 'kPa', 0], 'derived.mapOffsetKpa': ['Desvio do sensor MAP', 'kPa', 1],
    fuel_level_pct: ['Nível do tanque', '%', 0],
    // Sinais da escuta CAN (ESP32), lidos da rede do painel do carro
    can_speed: ['Velocidade (painel)', 'km/h', 0], can_rpm: ['Rotação (painel)', 'RPM', 0],
    can_coolant_temp: ['Temperatura do motor (painel)', '°C', 0], can_voltage: ['Tensão da bateria (painel)', 'V', 1],
    can_fuel_lph: ['Consumo da injeção (painel)', 'L/h', 1],
    // Sensor BMP180 no ESP32 (no módulo, não na rede do carro)
    cabin_temp: ['Temperatura interna', '°C', 1], cabin_pressure: ['Pressão do ar', 'hPa', 1],
  };
  var HIGHLIGHTS = ['speed', 'rpm', 'coolant_temp', 'battery_volts'];
  // Valores que só valem com o motor rodando: sem transmissão, a última leitura (em geral, motor já
  // desligado) mostraria zeros enganosos. Tanque, hodômetro, temperaturas e tensão continuam valendo parado.
  var MOMENTARY = ['speed', 'rpm', 'can_speed', 'can_rpm', 'map', 'maf', 'throttle', 'engine_load', 'timing_advance',
    'stft_b1', 'ltft_b1', 'lambda_v', 'can_fuel_lph', 'derived.fuelLph', 'derived.instantKmPerL', 'derived.estimatedLoadPct',
    'derived.estimatedGear', 'derived.recommendedGear', 'derived.vacuumKpa'];
  function momentary(id) { return MOMENTARY.indexOf(id) >= 0 || /^lambda_/.test(id); }
  var shown = {};
  var isStale = false;

  // Último valor válido (diferente de zero) de cada sinal, com o horário: vem da página e se atualiza
  // a cada leitura. Sem transmissão, os valores do momento mostram este, com a nota no rodapé do cartão.
  var lastValid = {};
  function noteValid(id, value, ts) {
    if (typeof value === 'number' && value !== 0) lastValid[id] = { v: value, t: ts };
  }
  /** O que mostrar: o valor atual ou, sem transmissão, o último válido. null = nada a mostrar. */
  function display(id) {
    var v = shown[id];
    var fallback = isStale && (momentary(id) || typeof v !== 'number' || v === 0) && lastValid[id];
    if (fallback) return { v: fallback.v, t: fallback.t };
    if (typeof v !== 'number') return null;
    return { v: v, t: null };
  }
  function paint(id) {
    var d = display(id);
    if (!d) return;
    var gone = isStale && momentary(id) && !d.t;
    if (cards[id]) {
      cards[id].value.textContent = gone ? '—' : format(id, d.v);
      cards[id].unit.textContent = gone ? 'sem leitura' : info(id)[1];
      cards[id].note.textContent = d.t ? 'Último valor válido · ' + hhmm(d.t) : '';
    } else {
      var unit = info(id)[1];
      var cell = row(id);
      cell.textContent = gone ? '—' : format(id, d.v) + (unit ? ' ' + unit : '');
      cell.dataset.validAt = d.t ? String(d.t) : '';
    }
  }
  function hhmm(t) { return new Date(t).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }); }
  /** Rodapé de cada grupo: "Últimos valores válidos antes de desligar · 12:03" quando algum veio de lá. */
  function paintGroupNotes() {
    Object.keys(groupBoxes).forEach(function (name) {
      var list = groupBoxes[name];
      var latest = 0;
      list.querySelectorAll('dd[data-valid-at]').forEach(function (dd) { latest = Math.max(latest, Number(dd.dataset.validAt) || 0); });
      var note = list.parentNode.querySelector('.stat-note');
      note.textContent = latest ? 'Últimos valores válidos antes de desligar · ' + hhmm(latest) : '';
    });
  }
  var GROUPS = [
    ['Motor', ['derived.estimatedLoadPct', 'derived.vacuumKpa', 'derived.mapOffsetKpa', 'engine_load', 'map', 'maf', 'throttle', 'timing_advance', 'derived.estimatedGear', 'derived.recommendedGear', 'can_rpm', 'can_coolant_temp']],
    ['Combustível', ['fuel_level_pct', 'can_fuel_lph', 'derived.tripCost', 'derived.fuelLph', 'derived.instantKmPerL', 'derived.tripKmPerL', 'derived.tripFuelUsedL', 'derived.fuelRemainingL', 'fuel_raw', 'stft_b1', 'ltft_b1', 'lambda_v']],
    ['Viagem', ['can_speed', 'trip_distance_km', 'derived.tripDistanceKm', 'trip_km', 'odometer_km']],
    ['Elétrica', ['can_voltage']],
    ['Ambiente', ['cabin_temp', 'cabin_pressure', 'intake_temp']],
    ['Outros', []],
  ];

  var deviceId = root.dataset.deviceId;
  var select = document.getElementById('chart-metric');
  var compare = document.getElementById('chart-compare');
  var rangeBox = document.getElementById('chart-range');
  var status = document.getElementById('live-status');
  var overview = document.getElementById('pane-overview');
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
  function isInternal(id) { return id.indexOf('dash.') === 0 || id.indexOf('trip.') === 0 || id.indexOf('app.') === 0 || id.indexOf('pc.') === 0; }

  /* ---------------- Computador de bordo (métricas "pc.*" enviadas pelo app) */
  var pc = {};
  var PC_ECO = ['Econômico', 'Na média', 'Gastando'];
  function pcNum(v, d) { return typeof v === 'number' ? v.toLocaleString('pt-BR', { minimumFractionDigits: d, maximumFractionDigits: d }) : null; }
  function pcBrl(v) { return typeof v === 'number' ? v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }) : null; }
  function pcTime(s) {
    if (typeof s !== 'number') return null;
    var m = Math.round(s / 60);
    return m < 60 ? m + ' min' : Math.floor(m / 60) + ' h ' + String(m % 60).padStart(2, '0');
  }
  function pcLeg(id, km, liters, kml, cost) {
    document.getElementById(id).textContent = pcNum(kml, 1) ? pcNum(kml, 1) + ' km/l' : '—';
    document.getElementById(id + '-sub').textContent = typeof km === 'number'
      ? pcNum(km, 1) + ' km · ' + pcNum(liters || 0, 2) + ' L' + (pcBrl(cost) ? ' · ' + pcBrl(cost) : '') : '—';
  }
  function renderPc() {
    var panel = document.getElementById('pc-panel');
    if (!Object.keys(pc).length) { panel.hidden = true; return; }
    panel.hidden = false;
    // O momento (consumo agora, eficiência) só vale com o carro enviando
    var band = isStale ? null : pc['pc.ecoBand'];
    var eco = document.getElementById('pc-eco');
    eco.dataset.band = typeof band === 'number' ? String(band) : '';
    document.getElementById('pc-eco-text').textContent = typeof band === 'number' ? PC_ECO[band] : 'sem leitura';
    var kml = isStale ? null : pc['pc.instantKmPerL'];
    var lph = isStale ? null : pc['pc.instantLph'];
    document.getElementById('pc-now').textContent = pcNum(kml, 1) || pcNum(lph, 2) || '—';
    document.getElementById('pc-now-unit').textContent = pcNum(kml, 1) || !pcNum(lph, 2) ? 'km/l' : 'L/h';
    var sub = [];
    if (pcNum(kml, 1) && pcNum(lph, 1)) sub.push(pcNum(lph, 1) + ' L/h');
    if (pcNum(kml, 1) && pcBrl(pc['pc.costPerKmNow'])) sub.push(pcBrl(pc['pc.costPerKmNow']) + '/km');
    if (!pcNum(kml, 1) && pcNum(lph, 2)) sub.push('parado com o motor ligado');
    document.getElementById('pc-now-sub').textContent = isStale ? 'sem leitura agora' : (sub.join(' · ') || '—');
    var price = pc['pc.pricePerL'];
    pcLeg('pc-trip', pc['pc.tripKm'], pc['pc.tripL'], pc['pc.tripKmPerL'], pc['pc.tripCost']);
    pcLeg('pc-fuel', pc['pc.fuelUpKm'], pc['pc.fuelUpL'], pc['pc.fuelUpKmPerL'], typeof price === 'number' && typeof pc['pc.fuelUpL'] === 'number' ? price * pc['pc.fuelUpL'] : null);
    pcLeg('pc-a', pc['pc.tripAKm'], pc['pc.tripAL'], pc['pc.tripAKmPerL'], typeof price === 'number' && typeof pc['pc.tripAL'] === 'number' ? price * pc['pc.tripAL'] : null);
    pcLeg('pc-recent', pc['pc.recentKm'], pc['pc.recentL'], pc['pc.recentKmPerL'], null);
    document.getElementById('pc-reserve').textContent = pcNum(pc['pc.rangeReserveKm'], 0) ? pcNum(pc['pc.rangeReserveKm'], 0) + ' km' : '—';
    document.getElementById('pc-empty').textContent = pcNum(pc['pc.rangeEmptyKm'], 0) ? pcNum(pc['pc.rangeEmptyKm'], 0) + ' km' : '—';
    document.getElementById('pc-range-basis').textContent = pcNum(pc['pc.rangeKmPerL'], 1) ? 'Pela média de ' + pcNum(pc['pc.rangeKmPerL'], 1) + ' km/l e o nível do tanque.' : '';
    var st = [];
    if (pc['pc.movingS']) st.push('Andando ' + pcTime(pc['pc.movingS']) + (pcNum(pc['pc.avgMovingKmh'], 0) ? ' · média ' + pcNum(pc['pc.avgMovingKmh'], 0) + ' km/h' : ''));
    if (pc['pc.idleS']) st.push('Marcha lenta ' + pcTime(pc['pc.idleS']) + ' · ' + pcNum(pc['pc.idleFuelL'] || 0, 2) + ' L' + (typeof price === 'number' ? ' · ' + pcBrl(price * (pc['pc.idleFuelL'] || 0)) : ''));
    if (pc['pc.fuelCutKm'] >= 0.1) st.push('Injeção cortada ' + pcNum(pc['pc.fuelCutKm'], 1) + ' km');
    if (typeof pc['pc.ecoGreenPct'] === 'number') st.push('Verde ' + pcNum(pc['pc.ecoGreenPct'], 0) + '% · meio ' + pcNum(pc['pc.ecoMidPct'], 0) + '% · vermelho ' + pcNum(pc['pc.ecoRedPct'], 0) + '%');
    var box = document.getElementById('pc-stats');
    box.replaceChildren.apply(box, st.map(function (t) { var sp = document.createElement('span'); sp.textContent = t; return sp; }));
  }

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
    box.replaceChildren(); // tira os blocos de carregamento
    box.removeAttribute('aria-busy');
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
      var note = node('em', 'stat-note');
      card.append(node('span', 'stat-label', meta[0]), line, spark, note);
      card.addEventListener('click', function () {
        addOption(id);
        select.value = id;
        loadChart();
        if (window.showTab) window.showTab('historico');
      });
      col.append(card);
      box.append(col);
      cards[id] = { value: value, unit: unit, poly: poly, card: card, note: note };
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
    panel.append(list, node('em', 'stat-note'));
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
    // Sem transmissão, o minigráfico mostra os últimos 15 min COM dados, não os 15 min até agora.
    var now = isStale && lastTs ? lastTs : Date.now();
    var from = now - SPARK_MINUTES * 60000;
    points = points.filter(function (p) { return p.t >= from && p.t <= now; });
    if (points.length < 2) {
      card.poly.setAttribute('points', '');
      return;
    }
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
    var limit = (isStale && lastTs ? lastTs : Date.now()) - SPARK_MINUTES * 60000;
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
    // A cada leitura o app manda o computador de bordo inteiro: o que não veio deixou de existir
    var nextPc = {};
    Object.keys(metrics).forEach(function (id) { if (id.indexOf('pc.') === 0 && typeof metrics[id] === 'number') nextPc[id] = metrics[id]; });
    if (Object.keys(nextPc).length) { pc = nextPc; renderPc(); }
    Object.keys(metrics).forEach(function (id) {
      var value = metrics[id];
      if (typeof value !== 'number' || isInternal(id)) return;
      addOption(id);
      shown[id] = value;
      noteValid(id, value, ts);
      paint(id);
      if (cards[id]) {
        cards[id].card.dataset.level = level(id, value);
        pushSpark(id, ts, value);
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

  // Primeira série no verde da marca (com degradê embaixo); a de comparação em laranja.
  function seriesColor(index) {
    var brand = window.chartTheme ? window.chartTheme.css('--app-brand', COLORS[0]) : COLORS[0];
    return index ? COLORS[1] : brand;
  }
  function fade(color) {
    return function (ctx) {
      var area = ctx.chart.chartArea;
      if (!area) return color + '1a';
      var g = ctx.chart.ctx.createLinearGradient(0, area.top, 0, area.bottom);
      g.addColorStop(0, color + '40');
      g.addColorStop(1, color + '00');
      return g;
    };
  }
  function dataset(metric, data, index) {
    var color = seriesColor(index);
    return {
      label: info(metric)[0],
      metric: metric,
      data: data,
      yAxisID: index ? 'y2' : 'y',
      borderColor: color,
      backgroundColor: index ? color + '1a' : fade(color),
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

  /** Menor período do histórico que ainda alcança os 15 min antes da última leitura. */
  function sparkRange() {
    var need = (Date.now() - (lastTs || Date.now())) / 60000 + SPARK_MINUTES;
    return [15, 60, 360, 1440, 10080].find(function (m) { return m >= need; }) || 10080;
  }
  function loadSparks() {
    var range = sparkRange();
    HIGHLIGHTS.forEach(function (id) {
      fetchHistory(id, range).then(function (r) {
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
    if (stale !== isStale) {
      isStale = stale;
      Object.keys(shown).concat(Object.keys(lastValid)).forEach(paint);
      paintGroupNotes();
      HIGHLIGHTS.forEach(drawSpark);
      renderPc();
    }
    // Sem transmissão, o selo do topo diz de quando é a última leitura (os cartões têm a nota no rodapé).
    lastUpdate.textContent = 'Última leitura há ' + ago(age);
    lastUpdate.title = new Date(lastTs).toLocaleString('pt-BR');
  }

  buildHighlights();
  var initial = null;
  try { initial = JSON.parse(document.getElementById('latest-data').dataset.sample); } catch (e) { /* sem dados */ }
  try {
    var lv = JSON.parse(document.getElementById('latest-data').dataset.lastValid || '{}');
    Object.keys(lv).forEach(function (id) {
      if (isInternal(id) || typeof lv[id].v !== 'number') return;
      lastValid[id] = { v: lv[id].v, t: new Date(lv[id].t).getTime() };
    });
  } catch (e) { /* sem últimos valores */ }
  HIGHLIGHTS.forEach(addOption);
  render(initial);
  if (initial && initial.ts) lastTs = new Date(initial.ts).getTime();
  // Sinais que não vieram na última leitura (ELM327 já desconectado) mas têm último valor válido
  Object.keys(lastValid).forEach(function (id) { if (!(id in shown)) addOption(id); });
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
    // O Percurso (route.js) usa a mesma conexão para andar com o carro no mapa.
    document.dispatchEvent(new CustomEvent('live-sample', { detail: sample }));
  });
}());

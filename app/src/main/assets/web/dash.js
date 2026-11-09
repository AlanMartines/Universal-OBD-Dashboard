'use strict';

/*
 * Painel de instrumentos com seis temas sobre a mesma base de dados:
 *   minimal  barra de RPM segmentada no topo, marcha + velocidade ao centro
 *   capsule  dois mostradores de arco preenchido e uma cápsula central com barras e células
 *   hud      moldura neon com escalas na borda e estrada em perspectiva animada pela velocidade
 *   sport    conta-giros grande em setores com a marcha ao centro, luzes de troca e células com barras
 *   classic  dois mostradores redondos com ponteiro e coluna central de dados
 *   horizon  arco largo de RPM em ciano com a velocidade ao centro, réguas curvas e painéis laterais
 *
 * Todos mostram as mesmas três telas de seis campos (Estrada, Motor, Viagem), a troca automática
 * de tela, as luzes-espia, o alerta em camada própria e o modo dia/noite. Recebe o mesmo estado
 * que window.onTelemetry (MainActivity.stateJson) e os metadados do perfil (profileMetaJson).
 *
 *   Dash.mount(hostElement)  ·  Dash.setMeta(meta)  ·  Dash.update(state)
 *   Dash.setLook('minimal'|'capsule'|'hud'|'sport'|'classic'|'horizon'), Dash.setMode('auto'|'day'|'night'),
 *   Dash.setPage('road'|'engine'|'trip'), Dash.setAutoPage(bool)
 */
window.Dash = (function () {
  const SVGNS = 'http://www.w3.org/2000/svg';
  const LOOKS = [['minimal', 'Minimal'], ['capsule', 'Cápsula'], ['hud', 'HUD'], ['sport', 'Pista'], ['classic', 'Clássico'], ['horizon', 'Horizonte']];
  const MODES = ['auto', 'day', 'night'];
  // Rótulos distintos: o rodapé também tem o botão "Telas auto" (troca automática de tela).
  const MODE_LABEL = { auto: 'Luz auto', day: 'Luz dia', night: 'Luz noite' };
  const PAGES = [['road', 'Estrada'], ['engine', 'Motor'], ['trip', 'Viagem']];
  const TAU_MS = 120;            // suavização de RPM e velocidade entre leituras
  const STOP_TO_TRIP_MS = 6000;  // parado há tanto tempo → tela Viagem (com troca automática)

  /* ================================================================ Utilidades */
  const nf = {};
  const num = (v, d = 0) => {
    if (v === null || v === undefined || !Number.isFinite(v)) return '--';
    nf[d] = nf[d] || new Intl.NumberFormat('pt-BR', { minimumFractionDigits: d, maximumFractionDigits: d });
    return nf[d].format(v);
  };
  const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
  const el = (tag, cls, html) => {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (html !== undefined) e.innerHTML = html;
    return e;
  };
  const svg = (tag, attrs, parent) => {
    const e = document.createElementNS(SVGNS, tag);
    for (const k in attrs) e.setAttribute(k, attrs[k]);
    if (parent) parent.appendChild(e);
    return e;
  };
  const store = {
    get(k, d) { try { const v = localStorage.getItem('dash.' + k); return v === null ? d : v; } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem('dash.' + k, String(v)); } catch (e) { /* sem armazenamento */ } },
  };
  let uid = 0;

  /*
   * Números grandes sem dado: "--" na fonte de 200+ px vira dois retângulos (prints do Xiaomi,
   * viagem de teste). O atributo data-empty deixa o traço fino, menor e esmaecido via CSS.
   */
  const isEmpty = (t) => t === '--' || t === '–';
  function big(node, text) {
    if (node.textContent !== text) node.textContent = text;
    if (isEmpty(text)) node.dataset.empty = ''; else delete node.dataset.empty;
  }

  /* ================================================================ Luzes-espia (24×24) */
  const ICONS = {
    link: '<path d="M7 4v4M17 4v4M5 8h14v4a7 7 0 0 1-14 0zM12 19v2" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"/>',
    fan: '<circle cx="12" cy="12" r="1.8" fill="currentColor"/><path d="M12 10.2C10.6 6.4 11.4 3.6 14 3.3c2.2.9 1.5 4.6-2 6.9zM13.6 13c4 .4 6.2 2.4 5.7 5-1.8 1.5-4.8-.8-5.7-5zM10.4 13.2c-2.4 3.2-5.2 4-6.8 2-.3-2.4 3.2-3.6 6.8-2z" fill="currentColor"/>',
    temp: '<path d="M12 3.5a2 2 0 0 1 2 2v8.6a3.6 3.6 0 1 1-4 0V5.5a2 2 0 0 1 2-2zM12 9v7.5M16.5 6.5h3M16.5 9.5h3M3.5 20.5c1.4-1 2.8-1 4.2 0M16.3 20.5c1.4-1 2.8-1 4.2 0" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>',
    battery: '<path d="M3 8h18v11H3zM6.5 5.5h3V8M14.5 5.5h3V8M6 13.5h3.5M14.5 13.5H18M16.25 11.75v3.5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round" stroke-linecap="round"/>',
    engine: '<path d="M2.5 11v5M2.5 13.5h2.5M5 9.5h3V7.5h5v2h2.5l2 2H20V10h1.5v7H20v-2h-1.5l-3 3H8l-3-3z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round" stroke-linecap="round"/>',
    // Folha aberta do indicador de economia (desenho próprio do projeto); preenchida com a cor do estado
    leaf: '<path d="M17.4 2C20.2 4.8 20.6 10.4 16.6 13.3C14.3 15 10.7 15.2 7.8 16.2C5.4 17 3.5 19.4 2.4 22.6C2.7 18.6 4.6 15.8 7.9 14.4C10.9 13.3 14 13.5 15.9 11.8C18.2 9.7 18.4 5.9 16.6 3.1Z"/><path d="M17.4 2C13.6 3.3 10 3.4 7.6 5.5C6.1 6.8 4.9 8.6 4.4 10.6C5.5 9 7 7.8 8.7 7C11.4 5.7 14.5 5.4 16.6 3.1Z"/><path d="M15.2 7.4C14 10 11.7 10.9 9.3 12C6.9 13.1 5 14.9 3.8 17.6C5.5 15.9 7.4 14.8 9.8 13.9C12.6 12.8 14.8 10.6 15.2 7.4Z"/>',
    fuel: '<path d="M4.5 20V5.5a1 1 0 0 1 1-1h7a1 1 0 0 1 1 1V20M3 20h12M7 8.5h4M13.5 10.5h2a1 1 0 0 1 1 1v5a1.5 1.5 0 0 0 3 0V9l-3-3" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round" stroke-linecap="round"/>',
  };
  const icon = (id) => `<svg viewBox="0 0 24 24" aria-hidden="true">${ICONS[id]}</svg>`;
  /** Indicador de economia: folha verde (econômico), só o contorno (na média), vermelha (gastando), apagada (sem leitura). */
  const ECO_TITLES = ['Econômico', 'Consumo na média', 'Consumo alto'];
  const ecoLeaf = () => `<span class="eco-leaf" data-ui="eco" title="Economia: sem leitura">${icon('leaf')}</span>`;
  const LIGHTS = [
    ['link', 'OBD desconectado'], ['engine', 'Injeção (MIL)'], ['temp', 'Temperatura do motor'],
    ['battery', 'Carga da bateria'], ['fuel', 'Reserva'], ['fan', 'Eletroventilador ligado'],
  ];

  /* ================================================================ Estado */
  let host = null;
  let root = null;
  let theme = null;
  const ui = {};
  let meta = {};
  let state = null;
  let look = LOOKS.some((l) => l[0] === store.get('look', 'minimal')) ? store.get('look', 'minimal') : 'minimal';
  let mode = MODES.includes(store.get('mode', 'auto')) ? store.get('mode', 'auto') : 'auto';
  let userPage = PAGES.some((p) => p[0] === store.get('page', 'road')) ? store.get('page', 'road') : 'road';
  let autoPage = store.get('autoPage', '1') === '1';
  /** Cor dos mostradores da Cápsula: verde ou vermelho. */
  const TINTS = [['green', 'Verde'], ['red', 'Vermelho']];
  let tint = TINTS.some((t) => t[0] === store.get('tint', 'green')) ? store.get('tint', 'green') : 'green';
  let page = userPage;
  let stoppedSince = null;
  const target = { rpm: null, speed: null };
  const shown = { rpm: null, speed: null };
  let raf = 0;
  let lastFrame = 0;
  const reduceMotion = !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);

  const roles = () => Object.assign({
    rpm: 'rpm', speed: 'speed', coolant: 'coolant_temp', voltage: 'battery_volts', throttle: 'throttle', map: 'map',
    intake: 'intake_temp', engineLoad: 'engine_load', timing: 'timing_advance', stft: 'stft_b1', ltft: 'ltft_b1',
    lambda: 'lambda_b1s1_v', milOn: 'mil_on', dtcCount: 'dtc_count', cabinTemp: 'cabin_temp', carTrip: 'trip_km',
  }, meta.roles || {});
  const reading = (key) => {
    const id = roles()[key];
    const v = id && state && state.readings ? state.readings[id] : undefined;
    if (!Number.isFinite(v)) return null;
    return key === 'speed' ? v * (1 + dashCfg().speedCorrectionPct / 100) : v;
  };
  const dashCfg = () => Object.assign({ rpmMax: 7000, rpmRedline: 6000, speedMax: 200, speedCorrectionPct: 0 }, meta.dashboard || {});
  const rpmTop = () => Math.ceil(dashCfg().rpmMax / 1000) * 1000;
  const speedTop = () => Math.ceil(dashCfg().speedMax / 20) * 20;
  const thermal = () => meta.thermal || null;

  /* ================================================================ Campos */
  // value(s, d) → [texto, unidade]; note → texto pequeno; state → ok|warn|bad|info;
  // bar → { frac } (da esquerda) ou { zero: -1..1, ends: [esq, dir] } (centrada no zero).
  const fuelCut = (d) => d.fuelLph === 0 && (reading('rpm') || 0) > 300;
  // Autonomia: consumo real medido nos abastecimentos; sem ele, o da viagem ou o instantâneo
  const rangeKmPerL = (d) => d.realKmPerL || d.tripKmPerL || d.instantKmPerL;
  const reserve = (d) => d.fuelRemainingL != null && meta.fuel && d.fuelRemainingL <= meta.fuel.reserveMaxL;
  const tankFrac = (d) => d.fuelRemainingL != null && meta.fuel && meta.fuel.tankCapacityL ? d.fuelRemainingL / meta.fuel.tankCapacityL : null;
  const pct = (key) => { const v = reading(key); return v == null ? null : { frac: v / 100 }; };
  const trimTotal = () => { const a = reading('stft'); const b = reading('ltft'); return a == null && b == null ? null : (a || 0) + (b || 0); };
  const coolantFrac = (c) => { const t = thermal(); return c == null ? null : (c - 40) / ((t ? t.criticalC + 10 : 120) - 40); };

  const FIELDS = {
    kml: {
      label: 'Consumo',
      value: (s, d) => d.instantKmPerL != null ? [num(d.instantKmPerL, 1), 'km/l'] : d.fuelLph != null ? [num(d.fuelLph, 2), 'L/h'] : ['--', ''],
      note: (s, d) => fuelCut(d) ? 'corte de injeção' : d.instantKmPerL != null ? num(d.fuelLph, 2) + ' L/h' : d.fuelLph != null ? 'parado' : '',
      state: (s, d) => fuelCut(d) ? 'ok' : null,
    },
    avg: { label: 'Média', value: (s, d) => [num(d.tripKmPerL, 1), 'km/l'], note: (s, d) => num(d.tripFuelUsedL, 2) + ' L na viagem' },
    range: {
      label: 'Autonomia',
      value: (s, d) => { const kml = rangeKmPerL(d); return [d.fuelRemainingL != null && kml ? num(d.fuelRemainingL * kml, 0) : '--', 'km']; },
      note: (s, d) => d.fuelRemainingL != null ? num(d.fuelRemainingL, 1) + ' L no tanque' : 'registre um abastecimento',
      state: (s, d) => reserve(d) ? 'warn' : null,
      bar: (s, d) => { const f = tankFrac(d); return f == null ? null : { frac: f }; },
    },
    coolant: {
      label: 'Motor', value: () => [num(reading('coolant')), '°C'], note: () => tempBand(reading('coolant'))[1], state: () => tempBand(reading('coolant'))[0],
      bar: () => { const f = coolantFrac(reading('coolant')); return f == null ? null : { frac: f }; },
    },
    iat: { label: 'Ar admitido', value: () => [num(reading('intake')), '°C'], state: () => { const v = reading('intake'); return v != null && v > 60 ? 'warn' : null; } },
    volts: { label: 'Bateria', value: () => [num(reading('voltage'), 1), 'V'], note: () => voltNote()[1], state: () => voltNote()[0] },
    tps: { label: 'Acelerador', value: () => [num(reading('throttle')), '%'], bar: () => pct('throttle') },
    // Com a pressão atmosférica (sensor do ESP32 ou referência do motor parado), a faixa é relativa a ela:
    // na serra, pé no fundo também é carga plena. Sem referência, vale o MAP em kPa.
    map: {
      label: 'Coletor', value: () => [num(reading('map')), 'kPa'],
      note: (s, d) => {
        const m = reading('map');
        if (m == null) return '';
        const r = d.estimatedLoadPct != null ? d.estimatedLoadPct / 100 : m / 100;
        const faixa = r < 0.4 ? 'vácuo alto' : r > 0.85 ? 'carga plena' : 'carga parcial';
        return d.vacuumKpa != null ? faixa + ' · vácuo ' + num(d.vacuumKpa) : faixa;
      },
      bar: (s, d) => { const m = reading('map'); return m == null ? null : { frac: d.estimatedLoadPct != null ? d.estimatedLoadPct / 100 : m / 105 }; },
    },
    load: {
      label: 'Carga',
      value: (s, d) => [num(d.estimatedLoadPct != null ? d.estimatedLoadPct : reading('engineLoad')), '%'],
      note: (s, d) => (d.estimatedLoadPct != null ? 'estimada pelo coletor' : ''),
      bar: (s, d) => (d.estimatedLoadPct != null ? { frac: d.estimatedLoadPct / 100 } : pct('engineLoad')),
    },
    timing: { label: 'Avanço', value: () => [num(reading('timing'), 1), '°'] },
    lambda: {
      label: 'Sonda', value: () => [num(reading('lambda'), 2), 'V'],
      note: () => { const v = reading('lambda'); return v == null ? '' : v > 0.6 ? 'rica' : v < 0.3 ? 'pobre' : 'estequiométrica'; },
      state: () => { const v = reading('lambda'); return v == null ? null : v > 0.6 ? 'warn' : v < 0.3 ? 'info' : 'ok'; },
      bar: () => { const v = reading('lambda'); return v == null ? null : { zero: clamp((v - 0.45) / 0.45, -1, 1), ends: ['pobre', 'rica'] }; },
    },
    trim: {
      label: 'Correção',
      value: () => { const t = trimTotal(); return [t == null ? '--' : (t > 0 ? '+' : '') + num(t, 1), '%']; },
      note: () => { const b = reading('ltft'); return b == null ? '' : 'longo prazo ' + num(b, 1) + '%'; },
      state: () => { const t = trimTotal(); return t != null && Math.abs(t) > 25 ? 'warn' : null; },
      bar: () => { const t = trimTotal(); return t == null ? null : { zero: clamp(t / 25, -1, 1), ends: ['−25%', '+25%'] }; },
    },
    dist: { label: 'Distância', value: (s) => [num(s.tripDistanceKm, 1), 'km'] },
    time: { label: 'Tempo', value: (s) => [elapsed(s), 'h'] },
    used: { label: 'Combustível', value: (s, d) => [num(d.tripFuelUsedL, 2), 'L'], note: (s, d) => (d.tripCost != null ? 'custo estimado R$ ' + num(d.tripCost, 2) : 'usado na viagem') },
    tank: {
      label: 'Tanque', value: (s, d) => [num(d.fuelRemainingL, 1), 'L'], state: (s, d) => reserve(d) ? 'warn' : null,
      note: (s, d) => reserve(d) ? 'reserva' : meta.fuel ? 'de ' + num(meta.fuel.tankCapacityL) + ' L' : '',
      bar: (s, d) => { const f = tankFrac(d); return f == null ? null : { frac: f }; },
    },
    gps: {
      label: 'Vel. GPS', value: (s) => [s.gps && s.gps.ageMs < 5000 ? num(s.gps.speedKmh) : '--', 'km/h'],
      note: (s) => s.gps && s.gps.ageMs < 5000 ? '±' + num(s.gps.accuracyM) + ' m' : 'sem sinal',
    },
  };
  /** Seis campos por tela, na ordem dos espaços de cada tema (três "esquerda", três "direita"). */
  const LAYOUT = {
    road: ['kml', 'avg', 'range', 'coolant', 'iat', 'volts'],
    engine: ['tps', 'map', 'load', 'timing', 'lambda', 'trim'],
    trip: ['dist', 'time', 'used', 'avg', 'tank', 'gps'],
  };

  function tempBand(c) {
    const t = thermal();
    if (c == null || !t) return [null, ''];
    if (c > t.criticalC) return ['bad', 'crítico'];
    if (c >= t.fanStage2C) return ['warn', 'ventoinha 2ª'];
    if (c >= t.fanStage1C) return [null, 'ventoinha 1ª'];
    if (c >= t.thermostatOpenC - 5) return [null, 'normal'];
    return ['info', 'aquecendo'];
  }
  function voltNote() {
    const v = reading('voltage');
    const rpm = reading('rpm') || 0;
    if (v == null) return [null, ''];
    if (v > 15.0) return ['bad', 'sobretensão'];
    if (rpm > 600 && v < 12.8) return ['bad', 'sem carga'];
    if (rpm < 100 && v < 11.8) return ['warn', 'bateria fraca'];
    return [null, rpm > 600 ? 'carregando' : 'motor desligado'];
  }
  /** Hora do quadro: a da gravação quando o painel reproduz uma viagem (state.now), senão a do relógio. */
  const nowOf = (s) => (s && typeof s.now === 'number' ? s.now : Date.now());
  /** Duração da viagem; sem captura em andamento não há relógio correndo (antes seguia contando). */
  function elapsed(s) {
    if (!s.tripStartedAt || !s.running) return '--';
    const m = Math.max(0, Math.floor((nowOf(s) - s.tripStartedAt) / 60000));
    return Math.floor(m / 60) + ':' + String(m % 60).padStart(2, '0');
  }

  /* ================================================================ Peças comuns */
  const FIELD = '<div class="cl-field"><span class="cl-field-label"></span><span class="cl-field-value">--</span>' +
    '<span class="cl-fbar" hidden><i></i></span><span class="cl-fbar-ends" hidden><span></span><span></span></span>' +
    '<span class="cl-field-note"></span></div>';
  const fields = (n) => FIELD.repeat(n);
  const bar = (ui, iconId, ends, valueFirst) => {
    const ic = `<span class="bar-icon">${icon(iconId)}</span>`;
    const track = `<span class="bar-end">${ends[0]}</span><span class="bar-track"><i class="bar-fill"></i></span><span class="bar-end">${ends[1]}</span>`;
    const val = '<b>--</b>';
    return `<div class="dash-bar" data-ui="${ui}">${valueFirst ? val + track + ic : ic + track + val}</div>`;
  };
  function foot(opts) {
    return `<div class="cl-foot">
      <span class="cl-status" data-ui="status"><span class="cl-dot"></span><span data-ui="statusText">--</span></span>
      <span class="cl-rec" data-ui="rec" hidden>● REC</span>
      ${opts.lights ? '<span class="cl-lights" data-ui="lights"></span>' : ''}
      <span class="cl-spacer"></span>
      <span class="cl-pages" data-ui="pages" role="tablist"></span>
      <button type="button" class="cl-chip" id="dash-autopage" data-ui="autoBtn" title="Trocar de tela sozinho: Viagem quando parado">Telas auto</button>
      <span class="cl-spacer"></span>
      ${opts.tint ? '<button type="button" class="cl-chip" id="dash-tint" data-ui="tintBtn" title="Cor dos mostradores"></button>' : ''}
      <button type="button" class="cl-chip" id="dash-look" data-ui="lookBtn" title="Trocar tema"></button>
      <button type="button" class="cl-chip" id="dash-mode" data-ui="modeBtn" title="Dia / noite"></button>
    </div>`;
  }

  /* ================================================================ Tema: Minimal */
  const minimal = {
    segments: 48,
    markup() {
      return `
        <div class="cl-rpm" data-ui="rpm"><div class="cl-rpm-bar"><svg data-ui="rpmSvg" viewBox="0 0 1000 48" preserveAspectRatio="none" role="img" aria-label="Conta-giros"></svg>
          <div class="cl-rpm-scale" data-ui="rpmScale" aria-hidden="true"></div></div>
          <div class="cl-rpm-num"><span data-ui="rpmNum">--</span><small>RPM</small></div></div>
        <div class="cl-side cl-left">${fields(3)}</div>
        <div class="cl-center">
          <div class="cl-gear" data-ui="gear"><b data-ui="gearNum">–</b><small data-ui="gearSub">marcha</small></div>
          <span class="cl-divider"></span>
          <div class="cl-speed"><b data-ui="speedNum">--</b><small>km/h</small></div>
          <div class="cl-eco"><span class="in-trip">Viagem <b data-ui="tripKm">--</b><em>km</em></span>${ecoLeaf()}<span class="in-trip">Tempo <b data-ui="tripTime">--</b></span></div>
        </div>
        <div class="cl-side cl-right">${fields(3)}</div>
        ${foot({ lights: true })}`;
    },
    build() {
      const d = dashCfg();
      const max = rpmTop();
      const amberFrom = d.rpmRedline - 1250;
      const gap = 5;
      const w = (1000 - gap * (this.segments - 1)) / this.segments;
      this.segs = [];
      this.lit = -1;
      for (let i = 0; i < this.segments; i++) {
        const rpmAt = (i + 1) / this.segments * max;
        const cls = rpmAt > d.rpmRedline ? 'seg red' : rpmAt > amberFrom ? 'seg amber' : 'seg';
        this.segs.push(svg('rect', { class: cls, x: (i * (w + gap)).toFixed(2), y: 0, width: w.toFixed(2), height: 40 }, ui.rpmSvg));
      }
      const xr = 1000 * d.rpmRedline / max;
      svg('rect', { class: 'rz', x: xr.toFixed(1), y: 44, width: (1000 - xr).toFixed(1), height: 3 }, ui.rpmSvg);
      // Escala em HTML (o SVG é esticado na largura e deformaria o texto)
      for (let v = 0; v <= max; v += 1000) {
        const t = el('span', v >= d.rpmRedline ? 'red' : '');
        t.style.left = (100 * v / max) + '%';
        t.textContent = String(v / 1000);
        ui.rpmScale.appendChild(t);
      }
    },
    paint(sh) {
      const n = sh.rpm === null ? 0 : Math.round(clamp(sh.rpm / rpmTop(), 0, 1) * this.segments);
      if (n === this.lit) return;
      this.lit = n;
      for (let i = 0; i < this.segments; i++) this.segs[i].classList.toggle('on', i < n);
    },
    render(c) {
      big(ui.rpmNum, c.rpm == null ? '--' : String(Math.round(c.rpm)));
      ui.rpm.dataset.state = c.redline ? 'redline' : c.shift ? 'shift' : '';
    },
  };

  /* ================================================================ Faixa de arco esmaecida */
  /**
   * Faixa de arco de cor única (definida no CSS pela classe), revelada até o valor por uma máscara
   * (traço com stroke-dashoffset) que também esmaece de fora (forte) para dentro (fraco).
   * Com o.ramp, a cor vai de fraca no início da escala a forte no fim.
   * Atualizar o valor mexe só num atributo da máscara.
   */
  function heatArc(parent, defs, id, o) {
    const g = svg('g', { mask: `url(#${id}m)`, class: o.cls || '' }, parent);
    const n = o.ramp ? 48 : 1;
    for (let i = 0; i < n; i++) {
      const a0 = o.start + o.sweep * i / n;
      const a1 = o.start + o.sweep * Math.min(1, (i + 1.6) / n); // leve sobreposição: sem frestas
      const seg = svg('path', { class: 'heat-seg', d: o.arc(o.r, a0, a1), 'stroke-width': o.w }, g);
      // Cor opaca misturada ao fundo da faixa (não soma nas emendas como a transparência)
      if (o.ramp) seg.style.setProperty('--k', (100 * (o.ramp + (1 - o.ramp) * ((i + 0.5) / n) ** 1.3)).toFixed(1) + '%');
    }
    const cx = o.cx == null ? 100 : o.cx;
    const cy = o.cy == null ? 100 : o.cy;
    const fade = svg('radialGradient', { id: id + 'r', gradientUnits: 'userSpaceOnUse', cx, cy, r: o.r + o.w / 2 }, defs);
    const inner = (o.r - o.w / 2) / (o.r + o.w / 2);
    svg('stop', { offset: inner.toFixed(3), 'stop-color': '#fff', 'stop-opacity': o.innerOpacity == null ? '.28' : String(o.innerOpacity) }, fade);
    svg('stop', { offset: '1', 'stop-color': '#fff', 'stop-opacity': '1' }, fade);
    const mask = svg('mask', { id: id + 'm', maskUnits: 'userSpaceOnUse', x: 0, y: 0, width: o.box ? o.box[0] : 200, height: o.box ? o.box[1] : 200 }, defs);
    const reveal = svg('path', {
      d: o.arc(o.r, o.start, o.start + o.sweep), fill: 'none', stroke: `url(#${id}r)`, 'stroke-width': o.w,
      pathLength: 1000, 'stroke-dasharray': '1000 1000', 'stroke-dashoffset': 1000,
    }, mask);
    return { el: g, set(frac) { reveal.setAttribute('stroke-dashoffset', (1000 * (1 - clamp(frac, 0, 1))).toFixed(1)); } };
  }

  /** Arco em qualquer centro. Ângulos em graus, 0 = 3 h, sentido horário; a1 < a0 = anti-horário. */
  function arcD(cx, cy, r, a0, a1) {
    const p = (a) => [cx + r * Math.cos(a * Math.PI / 180), cy + r * Math.sin(a * Math.PI / 180)];
    const [x0, y0] = p(a0);
    const [x1, y1] = p(a1);
    return `M ${x0.toFixed(2)} ${y0.toFixed(2)} A ${r} ${r} 0 ${Math.abs(a1 - a0) > 180 ? 1 : 0} ${a1 > a0 ? 1 : 0} ${x1.toFixed(2)} ${y1.toFixed(2)}`;
  }
  const polar = (cx, cy, r, a) => [cx + r * Math.cos(a * Math.PI / 180), cy + r * Math.sin(a * Math.PI / 180)];
  /** Escala com marcas e números ao longo de um arco (classes iguais às da Cápsula). */
  function arcScale(parent, o) {
    for (let v = o.min; v <= o.max + 1e-9; v += o.minor) {
      const major = Math.abs((v - o.min) / o.major - Math.round((v - o.min) / o.major)) < 1e-6;
      const a = o.start + o.sweep * (v - o.min) / (o.max - o.min);
      const red = o.red != null && v >= o.red;
      const [x0, y0] = polar(o.cx, o.cy, o.r, a);
      const [x1, y1] = polar(o.cx, o.cy, o.r - (major ? o.tick : o.tick * 0.5), a);
      svg('line', { class: 'cap-tick' + (major ? ' major' : '') + (red ? ' red' : ''), x1: x0, y1: y0, x2: x1, y2: y1 }, parent);
      if (major && o.labelR) {
        const [lx, ly] = polar(o.cx, o.cy, o.labelR, a);
        const t = svg('text', { class: (o.labelClass || 'cap-label') + (red ? ' red' : ''), x: lx.toFixed(1), y: ly.toFixed(1) }, parent);
        t.textContent = String(Math.round(v / o.div));
      }
    }
  }

  /* ================================================================ Tema: Cápsula */
  // Mostrador de arco preenchido. Ângulos em graus, 0 = 3 h, sentido horário; sweep negativo = anti-horário.
  function arcGauge(hostEl, o) {
    hostEl.innerHTML = '';
    const id = 'g' + (++uid);
    const root = svg('svg', { viewBox: '0 0 200 200', role: 'img', 'aria-label': o.aria }, hostEl);
    const defs = svg('defs', {}, root);
    const pt = (r, a) => { const rad = a * Math.PI / 180; return [100 + r * Math.cos(rad), 100 + r * Math.sin(rad)]; };
    const arc = (r, a0, a1) => {
      const [x0, y0] = pt(r, a0);
      const [x1, y1] = pt(r, a1);
      return `M ${x0.toFixed(2)} ${y0.toFixed(2)} A ${r} ${r} 0 ${Math.abs(a1 - a0) > 180 ? 1 : 0} ${a1 > a0 ? 1 : 0} ${x1.toFixed(2)} ${y1.toFixed(2)}`;
    };
    const ang = (v) => o.start + o.sweep * (clamp(v, o.min, o.max) - o.min) / (o.max - o.min);
    const end = o.start + o.sweep;
    const R = 80;
    svg('path', { class: 'cap-track', d: arc(R, o.start, end) }, root);
    // Faixa até o valor na cor escolhida (verde ou vermelho): fraca no início da escala, forte no fim
    const fill = heatArc(root, defs, id, { arc, r: R, w: 22, start: o.start, sweep: o.sweep, cls: 'cap-fill', innerOpacity: 0.12, ramp: 0.18 });
    svg('path', { class: 'cap-rim', d: arc(99, o.start, end) }, root);
    for (let v = o.min; v <= o.max + 1e-9; v += o.minor) {
      const major = Math.abs((v - o.min) / o.major - Math.round((v - o.min) / o.major)) < 1e-6;
      const a = ang(v);
      const [x0, y0] = pt(99, a);
      const [x1, y1] = pt(major ? 92 : 95.5, a);
      svg('line', { class: 'cap-tick' + (major ? ' major' : '') + (o.red !== null && v >= o.red ? ' red' : ''), x1: x0, y1: y0, x2: x1, y2: y1 }, root);
      if (major) {
        const [lx, ly] = pt(R, a);
        const t = svg('text', { class: 'cap-label' + (o.red !== null && v >= o.red ? ' red' : ''), x: lx.toFixed(1), y: ly.toFixed(1) }, root);
        t.textContent = String(Math.round(v / o.labelDiv));
      }
    }
    // Traço claro no valor atual, de dentro da faixa até o aro
    const needle = svg('line', { class: 'cap-needle', x1: 100 + R - 12, y1: 100, x2: 100 + 99, y2: 100 }, root);
    const main = svg('text', { class: 'cap-main', x: 100, y: 100 }, root);
    svg('line', { class: 'cap-underline', x1: 58, y1: 124, x2: 142, y2: 124 }, root);
    const sub = svg('text', { class: 'cap-sub', x: 100, y: 140 }, root);
    return {
      set(v) {
        fill.set(v === null ? 0 : (clamp(v, o.min, o.max) - o.min) / (o.max - o.min));
        needle.classList.toggle('off', v === null);
        if (v !== null) needle.setAttribute('transform', `rotate(${ang(v).toFixed(2)} 100 100)`);
      },
      text(m, s, hint) {
        if (main.textContent !== m) main.textContent = m;
        main.classList.toggle('empty', isEmpty(m));
        if (sub.textContent !== s) sub.textContent = s;
        sub.classList.toggle('hint', !!hint);
      },
    };
  }

  const capsule = {
    dimLights: true,
    markup() {
      return `
        <div class="cap-g cap-speed" data-ui="speedHost"></div>
        <div class="cap-box">
          <svg class="cap-outline" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true"><path d="M8 1.5 H92 L98.5 22 V78 L92 98.5 H8 L1.5 78 V22 Z" vector-effect="non-scaling-stroke"/></svg>
          <div class="cap-lights" data-ui="lights"></div>
          <div class="cap-bars">${ecoLeaf()}${bar('fuelBar', 'fuel', ['E', 'F'])}<span class="cap-sep"></span>${bar('tempBar', 'temp', ['C', 'H'])}</div>
          <div class="cap-cells">${fields(6)}</div>
          <div class="cap-trip"><span>Viagem <b data-ui="tripKm">--</b> km</span><span>Tempo <b data-ui="tripTime">--</b></span><span>Total <b data-ui="totalKm">--</b> km</span></div>
        </div>
        <div class="cap-g cap-rpm" data-ui="rpmHost"></div>
        ${foot({ tint: true })}`;
    },
    build() {
      const d = dashCfg();
      this.sg = arcGauge(ui.speedHost, { aria: 'Velocímetro', min: 0, max: speedTop(), major: 20, minor: 10, labelDiv: 1, red: null, start: 60, sweep: 240 });
      this.rg = arcGauge(ui.rpmHost, { aria: 'Conta-giros', min: 0, max: rpmTop(), major: 1000, minor: 500, labelDiv: 1000, red: d.rpmRedline, start: 120, sweep: -240 });
    },
    paint(sh) { this.sg.set(sh.speed); this.rg.set(sh.rpm); },
    render(c) {
      this.sg.text(num(c.speed), 'KM/H');
      const gear = c.shift ? '▲ ' + c.recommended + 'ª' : c.gear ? c.gear + 'ª' : '';
      this.rg.text(c.rpm == null ? '--' : String(Math.round(c.rpm)), gear ? 'RPM · ' + gear : 'RPM', c.shift);
    },
  };

  /* ================================================================ Tema: HUD */
  // Geometria em pixels do espaço disponível; refeita a cada redimensionamento.
  function polyLength(p) {
    let L = 0;
    const seg = [];
    for (let i = 1; i < p.length; i++) { const l = Math.hypot(p[i][0] - p[i - 1][0], p[i][1] - p[i - 1][1]); seg.push(l); L += l; }
    return { L, seg };
  }
  function polyAt(p, len, t, cx, cy) {
    let d = clamp(t, 0, 1) * len.L;
    for (let i = 0; i < len.seg.length; i++) {
      if (d <= len.seg[i] || i === len.seg.length - 1) {
        const k = len.seg[i] ? clamp(d / len.seg[i], 0, 1) : 0;
        const [ax, ay] = p[i];
        const [bx, by] = p[i + 1];
        const x = ax + (bx - ax) * k;
        const y = ay + (by - ay) * k;
        let nx = -(by - ay) / len.seg[i];
        let ny = (bx - ax) / len.seg[i];
        if ((cx - x) * nx + (cy - y) * ny < 0) { nx = -nx; ny = -ny; }
        return { x, y, nx, ny, i };
      }
      d -= len.seg[i];
    }
    return { x: p[0][0], y: p[0][1], nx: 0, ny: 0, i: 0 };
  }
  function polyPart(p, len, t, cx, cy) {
    const q = polyAt(p, len, t, cx, cy);
    const pts = p.slice(0, q.i + 1).concat([[q.x, q.y]]);
    return 'M ' + pts.map((a) => a[0].toFixed(1) + ' ' + a[1].toFixed(1)).join(' L ');
  }
  const pathOf = (pts, close) => 'M ' + pts.map((a) => a[0].toFixed(1) + ' ' + a[1].toFixed(1)).join(' L ') + (close ? ' Z' : '');

  const hud = {
    lightSlot: (id) => (['engine', 'battery', 'temp'].includes(id) ? 'lightsL' : 'lightsR'),
    markup() {
      return `
        <div class="hud-stage" data-ui="stage">
          <svg class="hud-road" data-ui="road" aria-hidden="true"></svg>
          <svg class="hud-frame" data-ui="frame" aria-hidden="true"></svg>
          <div class="hud-tab-top" data-ui="tabTop"><span><small>Viagem</small><b data-ui="tripKm">--</b><em>km</em></span>
            <span><small>Total</small><b data-ui="totalKm">--</b><em>km</em></span><span><small>Tempo</small><b data-ui="tripTime">--</b></span></div>
          <div class="hud-num" data-ui="rpmBox"><b data-ui="rpmNum">--</b><i></i><small>×1000 rpm</small></div>
          <div class="hud-num" data-ui="speedBox"><b data-ui="speedNum">--</b><i></i><small>km/h</small></div>
          <div class="hud-fields" data-ui="fieldsL">${fields(3)}</div>
          <div class="hud-fields hud-fields-r" data-ui="fieldsR">${fields(3)}</div>
          <div class="hud-lights" data-ui="lightsL"></div>
          <div class="hud-lights hud-lights-r" data-ui="lightsR"></div>
          <div class="hud-tab-bot" data-ui="tabBot">${bar('tempBar', 'temp', ['', ''])}
            <div class="hud-gear" data-ui="gear"><b data-ui="gearNum">N</b><small data-ui="gearSub"></small></div>
            ${bar('fuelBar', 'fuel', ['', ''], true)}${ecoLeaf()}</div>
        </div>
        ${foot({})}`;
    },
    build() {
      this.ro = new ResizeObserver(() => this.layout());
      this.ro.observe(ui.stage);
      this.layout();
    },
    destroy() { if (this.ro) this.ro.disconnect(); },
    layout() {
      const W = ui.stage.clientWidth;
      const H = ui.stage.clientHeight;
      if (W < 40 || H < 40) return;
      const tall = H > W * 1.1;
      const m = Math.max(4, Math.min(W, H) * 0.02);
      const c = W * (tall ? 0.09 : 0.11);
      const x0 = m, x1 = W - m, y0 = m, y1 = H - m, ym = H / 2;
      const tw = W * (tall ? 0.36 : 0.2), th = H * (tall ? 0.07 : 0.115);
      const bw = W * (tall ? 0.42 : 0.3), bh = H * (tall ? 0.085 : 0.135);
      const cx = W / 2, cy = H / 2;
      const fs = clamp(Math.min(W, H) * 0.045, 9, 22);
      const g = { W, H, m, c, x0, x1, y0, y1, ym, tw, th, bw, bh, cx, cy, tall };
      this.g = g;
      const f = ui.frame;
      f.setAttribute('viewBox', `0 0 ${W} ${H}`);
      f.setAttribute('width', W);
      f.setAttribute('height', H);
      f.innerHTML = '';
      // Moldura, abas e entalhe da marcha
      svg('path', { class: 'hud-line', d: pathOf([[x0 + c, y0], [x1 - c, y0], [x1, ym], [x1 - c, y1], [x0 + c, y1], [x0, ym]], true) }, f);
      svg('path', { class: 'hud-line', d: pathOf([[cx - tw, y0], [cx - tw + th * 0.9, y0 + th], [cx + tw - th * 0.9, y0 + th], [cx + tw, y0]]) }, f);
      svg('path', { class: 'hud-line', d: pathOf([[cx - bw, y1], [cx - bw + bh * 0.9, y1 - bh], [cx + bw - bh * 0.9, y1 - bh], [cx + bw, y1]]) }, f);
      const gw = Math.min(W, H) * 0.08;
      svg('path', { class: 'hud-line thin', d: pathOf([[cx - gw, y1 - bh], [cx - gw + 8, y1 - bh - 9], [cx + gw - 8, y1 - bh - 9], [cx + gw, y1 - bh]]) }, f);
      // Escalas na borda: RPM à esquerda, velocidade à direita, crescendo de baixo para cima
      const dx = W * (tall ? 0.05 : 0.07);
      const leftPoly = [[x0 + c + dx, y1], [x0 + c, y1], [x0, ym], [x0 + c, y0]];
      const rightPoly = [[x1 - c - dx, y1], [x1 - c, y1], [x1, ym], [x1 - c, y0]];
      const d = dashCfg();
      this.scales = {
        rpm: this.scale(f, leftPoly, { max: rpmTop(), major: 1000, minor: 500, div: 1000, red: d.rpmRedline }, fs),
        speed: this.scale(f, rightPoly, { max: speedTop(), major: speedTop() % 40 ? 20 : 40, minor: 10, div: 1, red: null }, fs),
      };
      // Posição dos blocos de texto
      const box = (e, left, top, width, height) => {
        e.style.left = left + 'px';
        e.style.top = top + 'px';
        e.style.width = width + 'px';
        if (height !== undefined) e.style.height = height + 'px';
      };
      const sideW = tall ? W * 0.34 : W * 0.23;
      const sideL = tall ? W * 0.14 : W * 0.1;
      box(ui.rpmBox, sideL, tall ? y0 + th + H * 0.02 : H * 0.2, sideW);
      box(ui.speedBox, W - sideL - sideW, tall ? y0 + th + H * 0.02 : H * 0.2, sideW);
      box(ui.fieldsL, sideL, tall ? H * 0.27 : H * 0.54, sideW);
      box(ui.fieldsR, W - sideL - sideW, tall ? H * 0.27 : H * 0.54, sideW);
      box(ui.tabTop, cx - tw + th * 0.9, y0, 2 * (tw - th * 0.9), th);
      box(ui.tabBot, cx - bw + bh * 0.9, y1 - bh, 2 * (bw - bh * 0.9), bh);
      box(ui.lightsL, x0 + c + 6, y0 + 6, Math.max(40, cx - tw - x0 - c - 12));
      box(ui.lightsR, cx + tw + 6, y0 + 6, Math.max(40, x1 - c - cx - tw - 12));
      this.road(g);
      this.paint(shown);
      this.render(ctxNow());
    },
    scale(f, poly, o, fs) {
      const g = this.g;
      const len = polyLength(poly);
      for (let v = 0; v <= o.max + 1e-9; v += o.minor) {
        const major = v % o.major === 0;
        const red = o.red !== null && v >= o.red;
        const p = polyAt(poly, len, v / o.max, g.cx, g.cy);
        const a = 5;
        const b = a + (major ? fs * 0.75 : fs * 0.4);
        svg('line', { class: 'hud-tick' + (major ? ' major' : '') + (red ? ' red' : ''), x1: p.x + p.nx * a, y1: p.y + p.ny * a, x2: p.x + p.nx * b, y2: p.y + p.ny * b }, f);
        if (major) {
          const t = svg('text', { class: 'hud-label' + (red ? ' red' : ''), x: (p.x + p.nx * (b + fs * 0.95)).toFixed(1), y: (p.y + p.ny * (b + fs * 0.95)).toFixed(1), 'font-size': fs.toFixed(1) }, f);
          t.textContent = String(v / o.div);
        }
      }
      const lit = svg('path', { class: 'hud-lit' }, f);
      return { poly, len, max: o.max, red: o.red, lit };
    },
    road(g) {
      const r = ui.road;
      r.setAttribute('viewBox', `0 0 ${g.W} ${g.H}`);
      r.setAttribute('width', g.W);
      r.setAttribute('height', g.H);
      r.innerHTML = '';
      const vpY = g.H * (g.tall ? 0.5 : 0.3);
      const base = g.y1 - g.bh;
      const half = g.bw * 0.58;
      const ringBase = g.tall ? g.W * 0.9 : g.H;
      [0.17, 0.28, 0.4].forEach((k) => svg('circle', { class: 'hud-ring', cx: g.cx, cy: vpY, r: ringBase * k }, r));
      svg('line', { class: 'hud-edge', x1: g.cx - g.W * 0.012, y1: vpY, x2: g.cx - half, y2: base }, r);
      svg('line', { class: 'hud-edge', x1: g.cx + g.W * 0.012, y1: vpY, x2: g.cx + half, y2: base }, r);
      svg('line', { class: 'hud-lane', x1: g.cx - g.W * 0.004, y1: vpY + g.H * 0.03, x2: g.cx - half * 0.36, y2: base }, r);
      svg('line', { class: 'hud-lane', x1: g.cx + g.W * 0.004, y1: vpY + g.H * 0.03, x2: g.cx + half * 0.36, y2: base }, r);
      const w = Math.min(g.W, g.H) * 0.09;
      const h = w * 0.62;
      const ccx = g.cx;
      const ccy = base - h * 1.15;
      svg('ellipse', { class: 'hud-glow', cx: ccx, cy: ccy + h * 0.55, rx: w * 1.1, ry: h * 0.35 }, r);
      this.chevron = svg('path', { class: 'hud-car', d: pathOf([[ccx, ccy - h], [ccx + w, ccy + h * 0.45], [ccx, ccy + h * 0.1], [ccx - w, ccy + h * 0.45]], true) }, r);
    },
    paint(sh) {
      if (!this.scales) return;
      const g = this.g;
      for (const key of ['rpm', 'speed']) {
        const s = this.scales[key];
        const v = sh[key];
        if (v === null) { s.lit.setAttribute('d', ''); continue; }
        s.lit.setAttribute('d', polyPart(s.poly, s.len, clamp(v / s.max, 0.0001, 1), g.cx, g.cy));
        s.lit.classList.toggle('hot', s.red !== null && v >= s.red);
      }
    },
    render(c) {
      if (!ui.rpmNum) return;
      big(ui.rpmNum, c.rpm == null ? '--' : num(c.rpm / 1000, 1));
      big(ui.speedNum, num(c.speed));
      // Estrada anda na velocidade real; para com o carro parado
      const moving = c.speed != null && c.speed >= 1 && !reduceMotion;
      ui.road.classList.toggle('moving', moving);
      if (moving) ui.road.style.setProperty('--road-dur', clamp(14 / c.speed, 0.12, 2.5).toFixed(2) + 's');
      if (this.chevron) this.chevron.dataset.state = c.critical ? 'bad' : c.shift ? 'ok' : '';
    },
  };

  /* ================================================================ Tema: Pista */
  // Conta-giros em setores (cada 250 rpm), marcha no miolo, luzes de troca e células com barra.
  const sport = {
    dimLights: true,
    markup() {
      return `
        <div class="sp-tach" data-ui="tachHost"></div>
        <div class="sp-side">
          <div class="sp-top">
            <div class="sp-rpm"><b data-ui="rpmNum">--</b><small>rpm</small></div>
            <div class="sp-shift" data-ui="shift" aria-hidden="true"></div>
            <div class="sp-speed"><b data-ui="speedNum">--</b><small>km/h</small></div>
          </div>
          <div class="sp-lights" data-ui="lights"></div>
          <div class="sp-cells">${fields(6)}</div>
          <div class="sp-bars">${ecoLeaf()}${bar('fuelBar', 'fuel', ['E', 'F'])}${bar('tempBar', 'temp', ['C', 'H'])}</div>
          <div class="sp-trip"><span class="in-trip">Viagem <b data-ui="tripKm">--</b><em>km</em></span><span class="in-trip">Tempo <b data-ui="tripTime">--</b></span></div>
        </div>
        ${foot({})}`;
    },
    build() {
      const d = dashCfg();
      const max = rpmTop();
      const host = ui.tachHost;
      host.innerHTML = '';
      const root = svg('svg', { viewBox: '0 0 200 200', role: 'img', 'aria-label': 'Conta-giros' }, host);
      const start = 135;
      const sweep = 270;
      const step = 250;
      const n = Math.round(max / step);
      this.wedges = [];
      for (let i = 0; i < n; i++) {
        const a0 = start + sweep * i / n + 0.6;
        const a1 = start + sweep * (i + 1) / n - 0.6;
        const [ox0, oy0] = polar(100, 100, 95, a0);
        const [ox1, oy1] = polar(100, 100, 95, a1);
        const [ix1, iy1] = polar(100, 100, 58, a1);
        const [ix0, iy0] = polar(100, 100, 58, a0);
        const rpmAt = (i + 1) * step;
        const cls = rpmAt > d.rpmRedline ? 'sp-w red' : rpmAt > d.rpmRedline - 1500 ? 'sp-w warm' : 'sp-w';
        this.wedges.push(svg('path', {
          class: cls,
          d: `M ${ox0.toFixed(2)} ${oy0.toFixed(2)} A 95 95 0 0 1 ${ox1.toFixed(2)} ${oy1.toFixed(2)} L ${ix1.toFixed(2)} ${iy1.toFixed(2)} A 58 58 0 0 0 ${ix0.toFixed(2)} ${iy0.toFixed(2)} Z`,
        }, root));
      }
      arcScale(root, { cx: 100, cy: 100, r: 99.5, min: 0, max, major: 1000, minor: 500, tick: 7, labelR: 76, div: 1000, red: d.rpmRedline, start, sweep, labelClass: 'sp-label' });
      svg('circle', { class: 'sp-hub', cx: 100, cy: 100, r: 50 }, root);
      this.gear = svg('text', { class: 'sp-gear', x: 100, y: 98 }, root);
      this.gearSub = svg('text', { class: 'sp-gear-sub', x: 100, y: 134 }, root);
      this.lit = -1;
      // Luzes de troca: 10 pontos de (faixa vermelha − 2.500) até a faixa vermelha
      ui.shift.innerHTML = '';
      this.dots = [];
      for (let i = 0; i < 10; i++) this.dots.push(ui.shift.appendChild(el('i', i < 4 ? 'g' : i < 7 ? 'y' : 'r')));
    },
    paint(sh) {
      const n = sh.rpm === null ? 0 : Math.round(clamp(sh.rpm / rpmTop(), 0, 1) * this.wedges.length);
      if (n === this.lit) return;
      this.lit = n;
      this.wedges.forEach((w, i) => w.classList.toggle('on', i < n));
    },
    render(c) {
      big(ui.rpmNum, c.rpm == null ? '--' : num(c.rpm));
      big(ui.speedNum, num(c.speed));
      const g = c.gear ? String(c.gear) : c.rpm != null && (c.speed || 0) < 3 ? 'N' : '–';
      if (this.gear.textContent !== g) this.gear.textContent = g;
      this.gearSub.textContent = c.shift ? '▲ ' + c.recommended + 'ª' : 'marcha';
      this.gearSub.classList.toggle('hint', c.shift);
      const red = dashCfg().rpmRedline;
      const from = red - 2500;
      const lit = c.rpm == null ? 0 : clamp(Math.floor((c.rpm - from) / 250) + 1, 0, 10);
      ui.shift.dataset.state = c.redline ? 'redline' : c.shift ? 'shift' : '';
      this.dots.forEach((d, i) => d.classList.toggle('on', c.shift || c.redline || i < lit));
    },
  };

  /* ================================================================ Tema: Clássico */
  // Dois mostradores redondos: aro metálico, marcas densas, ponteiro curto junto à borda, número fino no
  // miolo com a legenda num colchete, arco de progresso à esquerda e faixa vermelha em degradê.
  function needleGauge(hostEl, o) {
    hostEl.innerHTML = '';
    const id = 'n' + (++uid);
    const root = svg('svg', { viewBox: '0 0 200 200', role: 'img', 'aria-label': o.aria }, hostEl);
    const defs = svg('defs', {}, root);
    const metal = svg('linearGradient', { id: id + 'm', x1: 0, y1: 0, x2: 0, y2: 1 }, defs);
    svg('stop', { offset: '0', class: 'cl2-metal-a' }, metal);
    svg('stop', { offset: '.5', class: 'cl2-metal-b' }, metal);
    svg('stop', { offset: '1', class: 'cl2-metal-c' }, metal);
    const red = svg('radialGradient', { id: id + 'r', gradientUnits: 'userSpaceOnUse', cx: 100, cy: 100, r: 92 }, defs);
    svg('stop', { offset: '.6', class: 'cl2-red-a' }, red);
    svg('stop', { offset: '1', class: 'cl2-red-b' }, red);
    // Arcos de moldura por fora
    svg('path', { class: 'cl2-frame', d: arcD(100, 100, 106, 200, 250) }, root);
    svg('path', { class: 'cl2-frame', d: arcD(100, 100, 106, 110, 160) }, root);
    svg('path', { class: 'cl2-frame', d: arcD(100, 100, 106, 290, 340) }, root);
    svg('path', { class: 'cl2-frame', d: arcD(100, 100, 106, 20, 70) }, root);
    svg('circle', { class: 'cl2-face', cx: 100, cy: 100, r: 96 }, root);
    svg('circle', { class: 'cl2-ring', cx: 100, cy: 100, r: 96, stroke: `url(#${id}m)` }, root);
    const start = 135;
    const sweep = 270;
    const ang = (v) => start + sweep * (clamp(v, o.min, o.max) - o.min) / (o.max - o.min);
    if (o.red != null) {
      const a0 = ang(o.red);
      const a1 = start + sweep;
      const [ox0, oy0] = polar(100, 100, 92, a0);
      const [ox1, oy1] = polar(100, 100, 92, a1);
      const [ix1, iy1] = polar(100, 100, 50, a1);
      const [ix0, iy0] = polar(100, 100, 50, a0);
      svg('path', { class: 'cl2-red', fill: `url(#${id}r)`, d: `M ${ox0} ${oy0} A 92 92 0 0 1 ${ox1} ${oy1} L ${ix1} ${iy1} A 50 50 0 0 0 ${ix0} ${iy0} Z` }, root);
    }
    arcScale(root, { cx: 100, cy: 100, r: 92, min: o.min, max: o.max, major: o.major, minor: o.minor, tick: 8, labelR: o.max / o.div >= 100 ? 70 : 72, div: o.div, red: o.red, start, sweep, labelClass: o.max / o.div >= 100 ? 'cl2-label wide' : 'cl2-label' });
    svg('circle', { class: 'cl2-inner', cx: 100, cy: 100, r: 48 }, root);
    // Progresso à esquerda do círculo interno: de baixo para cima
    const ps = 125;
    const pw = 120;
    svg('path', { class: 'cl2-prog-track', d: arcD(100, 100, 44, ps, ps + pw) }, root);
    const prog = svg('path', { class: 'cl2-prog', d: arcD(100, 100, 44, ps, ps + pw), pathLength: 1000, 'stroke-dasharray': '1000 1000', 'stroke-dashoffset': 1000 }, root);
    const main = svg('text', { class: 'cl2-main', x: 100, y: 96 }, root);
    const subLabel = svg('text', { class: 'cl2-sub', x: 100, y: 133 }, root);
    const subValue = svg('text', { class: 'cl2-subval', x: 100, y: 146 }, root);
    const unit = svg('text', { class: 'cl2-unit', x: 100, y: 178 }, root);
    unit.textContent = o.unit;
    const needle = svg('line', { class: 'cl2-needle', x1: 100 + 52, y1: 100, x2: 100 + 92, y2: 100 }, root);
    return {
      set(v) { needle.setAttribute('transform', `rotate(${ang(v == null ? o.min : v).toFixed(2)} 100 100)`); },
      progress(f) { prog.setAttribute('stroke-dashoffset', (1000 * (1 - clamp(f == null ? 0 : f, 0, 1))).toFixed(1)); },
      text(m, label, value, hint) {
        if (main.textContent !== m) main.textContent = m;
        main.classList.toggle('empty', isEmpty(m));
        subLabel.textContent = label;
        subValue.textContent = value;
        subValue.classList.toggle('hint', !!hint);
      },
    };
  }
  /** Barra curva dos lados da coluna central (tanque à esquerda, temperatura à direita), enche de baixo. */
  function curvedBar(hostEl, side, o) {
    hostEl.innerHTML = '';
    const root = svg('svg', { viewBox: '0 0 44 160', preserveAspectRatio: 'xMidYMid meet', 'aria-hidden': 'true' }, hostEl);
    const d = side === 'left' ? 'M 34 148 Q 8 80 34 12' : 'M 10 148 Q 36 80 10 12';
    svg('path', { class: 'cl2-cbar-edge', d: side === 'left' ? 'M 26 152 Q -4 80 26 8' : 'M 18 152 Q 48 80 18 8' }, root);
    svg('path', { class: 'cl2-cbar-track', d }, root);
    const fill = svg('path', { class: 'cl2-cbar-fill', d, pathLength: 1000, 'stroke-dasharray': '1000 1000', 'stroke-dashoffset': 1000 }, root);
    const top = svg('text', { class: 'cl2-cbar-end', x: side === 'left' ? 40 : 4, y: 8 }, root);
    top.textContent = o.top;
    const bot = svg('text', { class: 'cl2-cbar-end', x: side === 'left' ? 40 : 4, y: 156 }, root);
    bot.textContent = o.bottom;
    return {
      set(frac, st) {
        fill.setAttribute('stroke-dashoffset', (1000 * (1 - clamp(frac == null ? 0 : frac, 0, 1))).toFixed(1));
        fill.dataset.state = st || '';
      },
    };
  }
  const classic = {
    dimLights: true,
    markup() {
      return `
        <div class="cl2-g" data-ui="rpmHost"></div>
        <div class="cl2-mid">
          <div class="cl2-lights" data-ui="lights"></div>
          <div class="cl2-body">
            <div class="cl2-side"><div class="cl2-cbar" data-ui="fuelArc"></div><div class="cl2-cinfo"><em>${icon('fuel')}</em><b data-ui="fuelPct">--</b></div></div>
            <div class="cl2-list">${fields(6)}</div>
            <div class="cl2-side cl2-side-r"><div class="cl2-cinfo"><em>${icon('temp')}</em><b data-ui="tempVal">--</b></div><div class="cl2-cbar" data-ui="tempArc"></div></div>
          </div>
          <div class="cl2-trip"><span><span data-ui="carTripLabel">Trip</span> <b data-ui="carTrip">--</b> km</span>${ecoLeaf()}<span>Total <b data-ui="totalKm">--</b> km</span></div>
        </div>
        <div class="cl2-g" data-ui="speedHost"></div>
        ${foot({})}`;
    },
    build() {
      const d = dashCfg();
      this.rg = needleGauge(ui.rpmHost, { aria: 'Conta-giros', min: 0, max: rpmTop(), major: 1000, minor: 100, div: 1000, red: d.rpmRedline, unit: '1/min × 1000 RPM' });
      const top = speedTop();
      this.sg = needleGauge(ui.speedHost, { aria: 'Velocímetro', min: 0, max: top, major: 20, minor: 5, div: 1, red: null, unit: 'km/h' });
      const t = thermal();
      this.fuel = curvedBar(ui.fuelArc, 'left', { top: '100', bottom: '0' });
      this.temp = curvedBar(ui.tempArc, 'right', { top: String(t ? t.criticalC + 10 : 120), bottom: '40' });
    },
    paint(sh) { this.rg.set(sh.rpm); this.sg.set(sh.speed); },
    render(c) {
      const d = (state && state.derived) || {};
      const tps = reading('throttle');
      this.rg.text(c.rpm == null ? '--' : num(c.rpm), c.shift ? 'trocar' : 'acelerador',
        c.shift ? '▲ ' + c.recommended + 'ª' : tps == null ? '--' : num(tps, 1) + ' %', c.shift);
      this.rg.progress(tps == null ? null : tps / 100);
      const tf = tankFrac(d);
      this.sg.text(num(c.speed), c.gear ? 'marcha' : 'tanque', c.gear ? c.gear + 'ª' : tf == null ? '--' : num(tf * 100) + ' %');
      this.sg.progress(tf);
      const cool = reading('coolant');
      const band = tempBand(cool)[0];
      this.fuel.set(tf, reserve(d) ? 'warn' : '');
      ui.fuelPct.textContent = tf == null ? '--' : num(tf * 100) + '%';
      this.temp.set(coolantFrac(cool), band === 'bad' || band === 'warn' ? band : '');
      ui.tempVal.textContent = cool == null ? '--' : num(cool) + '°C';
    },
  };

  /* ================================================================ Tema: Horizonte */
  // Arco largo de RPM em ciano com brilho e números dentro da faixa; faixa vermelha em escada pela borda;
  // velocidade grande no centro; réguas curvas de tanque e temperatura abraçando o arco; painéis dos lados.
  const horizon = {
    dimLights: true,
    markup() {
      return `
        <div class="hz-lights" data-ui="lights"></div>
        <div class="hz-panel hz-left">${fields(3)}<div class="hz-foot"><small data-ui="carTripLabel">Trip</small> <b data-ui="carTrip">--</b> km <span class="hz-eco">${ecoLeaf()}</span></div></div>
        <div class="hz-arc"><div class="hz-svg" data-ui="arcHost"></div></div>
        <div class="hz-panel hz-right">${fields(3)}<div class="hz-foot"><b data-ui="totalKm">--</b> km</div></div>
        ${foot({})}`;
    },
    build() {
      const d = dashCfg();
      const host = ui.arcHost;
      host.innerHTML = '';
      const W = 400;
      const H = 236;
      const cx = 200;
      const cy = 218;
      const R = 150;
      const BW = 40;
      const root = svg('svg', { viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-label': 'Conta-giros e velocímetro' }, host);
      const defs = svg('defs', {}, root);
      const start = 196;
      const sweep = 148;
      const id = 'hz' + (++uid);
      const arc = (r, a0, a1) => arcD(cx, cy, r, a0, a1);
      const top = rpmTop();
      const ang = (v) => start + sweep * clamp(v / top, 0, 1);
      // Faixa, brilho ciano até o valor e bordas finas
      svg('path', { class: 'hz-band', d: arc(R, start, start + sweep), 'stroke-width': BW }, root);
      this.fill = heatArc(root, defs, id, { arc, r: R, w: BW, start, sweep, cx, cy, box: [W, H], cls: 'hz-glow', innerOpacity: 0.35 });
      svg('path', { class: 'hz-edge', d: arc(R + BW / 2 + 1, start - 2, start + sweep + 2) }, root);
      svg('path', { class: 'hz-edge thin', d: arc(R - BW / 2 - 4, start - 6, start + sweep + 6) }, root);
      // Marcas na borda de fora e números dentro da faixa
      for (let v = 0; v <= top + 1e-9; v += 250) {
        const a = ang(v);
        const major = v % 1000 === 0;
        const [x0, y0] = polar(cx, cy, R + BW / 2 - 1, a);
        const [x1, y1] = polar(cx, cy, R + BW / 2 - (major ? 9 : 4), a);
        svg('line', { class: 'hz-tick' + (major ? ' major' : ''), x1: x0, y1: y0, x2: x1, y2: y1 }, root);
        if (major) {
          const [lx, ly] = polar(cx, cy, R - 3, a);
          const t = svg('text', { class: 'hz-label', x: lx.toFixed(1), y: ly.toFixed(1) }, root);
          t.textContent = String(v / 1000);
        }
      }
      // Faixa vermelha em escada pela borda de fora
      this.ladder = [];
      const steps = Math.max(4, Math.round((top - d.rpmRedline) / 125));
      for (let i = 0; i < steps; i++) {
        const v0 = d.rpmRedline + (top - d.rpmRedline) * i / steps;
        const v1 = d.rpmRedline + (top - d.rpmRedline) * (i + 0.8) / steps;
        this.ladder.push({ v: v0, el: svg('path', { class: 'hz-ladder', d: arc(R + BW / 2 + 8, ang(v0), ang(v1)) }, root) });
      }
      // Réguas curvas: tanque (esquerda, de baixo para cima) e temperatura (direita)
      const tape = (a0, a1, ends, cls) => {
        const r = R + BW / 2 + 22;
        svg('path', { class: 'hz-bracket', d: arc(r + 8, a0, a1) }, root);
        const segs = [];
        const n = 14;
        for (let i = 0; i < n; i++) {
          const b0 = a0 + (a1 - a0) * i / n;
          const b1 = a0 + (a1 - a0) * (i + 0.6) / n;
          segs.push(svg('path', { class: 'hz-tape ' + cls, d: arc(r, b0, b1) }, root));
        }
        const [ex, ey] = polar(cx, cy, r + 22, a0);
        const [fx, fy] = polar(cx, cy, r + 22, a1);
        svg('text', { class: 'hz-tape-end', x: ex.toFixed(1), y: ey.toFixed(1) }, root).textContent = ends[0];
        svg('text', { class: 'hz-tape-end', x: fx.toFixed(1), y: fy.toFixed(1) }, root).textContent = ends[1];
        return segs;
      };
      this.fuelTape = tape(186, 222, ['E', 'F'], 'fuel');
      this.tempTape = tape(354, 318, ['C', 'H'], 'temp');
      this.fuelTxt = svg('text', { class: 'hz-tape-val', x: 34, y: 228 }, root);
      this.tempTxt = svg('text', { class: 'hz-tape-val', x: 366, y: 228 }, root);
      // Centro: km/h, velocidade, linha, RPM
      svg('text', { class: 'hz-unit', x: cx, y: 112 }, root).textContent = 'km/h';
      this.main = svg('text', { class: 'hz-main', x: cx, y: 150 }, root);
      svg('line', { class: 'hz-div', x1: cx - 64, y1: 174, x2: cx + 64, y2: 174 }, root);
      this.rpm = svg('text', { class: 'hz-rpmnum', x: cx, y: 192 }, root);
      this.rpmSub = svg('text', { class: 'hz-unit', x: cx, y: 222 }, root);
      this.rpmSub.textContent = 'RPM';
      // Linha do "capô" embaixo
      svg('path', { class: 'hz-hood', d: `M -40 ${H} C 90 ${H} 120 ${H - 8} ${cx} ${H - 8} C 280 ${H - 8} 310 ${H} 440 ${H}` }, root);
    },
    paint(sh) {
      const f = sh.rpm == null ? 0 : sh.rpm / rpmTop();
      this.fill.set(f);
      this.ladder.forEach((s) => s.el.classList.toggle('on', sh.rpm != null && sh.rpm >= s.v));
    },
    render(c) {
      const m = num(c.speed);
      if (this.main.textContent !== m) this.main.textContent = m;
      this.main.classList.toggle('empty', isEmpty(m));
      this.rpm.textContent = c.rpm == null ? '--' : num(c.rpm);
      this.rpmSub.textContent = c.shift ? '▲ ' + c.recommended + 'ª' : c.gear ? 'RPM · ' + c.gear + 'ª' : 'RPM';
      this.rpmSub.classList.toggle('hint', c.shift);
      const d = (state && state.derived) || {};
      const tf = tankFrac(d);
      const nf = tf == null ? 0 : Math.round(clamp(tf, 0, 1) * this.fuelTape.length);
      this.fuelTape.forEach((s, i) => s.classList.toggle('on', i < nf));
      this.fuelTxt.textContent = tf == null ? '--' : num(tf * 100) + '%';
      this.fuelTxt.classList.toggle('warn', reserve(d));
      const cool = reading('coolant');
      const cf = coolantFrac(cool);
      const nt = cf == null ? 0 : Math.round(clamp(cf, 0, 1) * this.tempTape.length);
      const hot = ['bad', 'warn'].includes(tempBand(cool)[0]);
      this.tempTape.forEach((s, i) => { s.classList.toggle('on', i < nt); s.classList.toggle('hot', hot); });
      this.tempTxt.textContent = cool == null ? '--' : num(cool) + '°C';
    },
  };

  const THEMES = { minimal, capsule, hud, sport, classic, horizon };

  /* ================================================================ Montagem e controle */
  function mount(hostEl) {
    host = hostEl;
    host.classList.add('cluster-host');
    root = el('div', 'cluster');
    host.appendChild(root);
    // Deslizar para os lados troca de tela
    let x0 = null;
    root.addEventListener('pointerdown', (e) => { x0 = e.clientX; });
    root.addEventListener('pointerup', (e) => {
      if (x0 === null) return;
      const dx = e.clientX - x0;
      x0 = null;
      if (Math.abs(dx) < 60) return;
      const i = PAGES.findIndex((p) => p[0] === page);
      setPage(PAGES[(i + (dx < 0 ? 1 : PAGES.length - 1)) % PAGES.length][0]);
    });
    if (window.matchMedia) {
      const mq = window.matchMedia('(prefers-color-scheme: dark)');
      (mq.addEventListener ? mq.addEventListener.bind(mq, 'change') : mq.addListener.bind(mq))(applyScheme);
    }
    new MutationObserver(applyScheme).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    setInterval(() => { if (mode === 'auto') applyScheme(); }, 60000);
    applyLook();
  }

  function applyLook() {
    if (theme && theme.destroy) theme.destroy();
    theme = THEMES[look];
    root.dataset.look = look;
    root.innerHTML = theme.markup() + '<div class="cl-alert" data-ui="alert" role="status" hidden></div>';
    for (const k in ui) delete ui[k];
    root.querySelectorAll('[data-ui]').forEach((e) => { ui[e.dataset.ui] = e; });
    ui.fields = [...root.querySelectorAll('.cl-field')];

    PAGES.forEach(([id, label]) => {
      const b = el('button', 'cl-tab');
      b.type = 'button';
      b.id = 'dash-page-' + id;
      b.textContent = label;
      b.setAttribute('role', 'tab');
      b.addEventListener('click', () => setPage(id));
      ui['tab_' + id] = b;
      ui.pages.appendChild(b);
    });
    LIGHTS.forEach(([id, label]) => {
      const slot = ui[theme.lightSlot ? theme.lightSlot(id) : 'lights'];
      if (!slot) return;
      const l = el('span', 'cl-light', icon(id));
      l.title = label;
      l.setAttribute('aria-label', label);
      l.hidden = !theme.dimLights;
      ui['light_' + id] = l;
      slot.appendChild(l);
    });
    ui.modeBtn.addEventListener('click', () => setMode(MODES[(MODES.indexOf(mode) + 1) % MODES.length]));
    ui.autoBtn.addEventListener('click', () => setAutoPage(!autoPage));
    ui.lookBtn.addEventListener('click', () => {
      const i = LOOKS.findIndex((l) => l[0] === look);
      setLook(LOOKS[(i + 1) % LOOKS.length][0]);
    });
    ui.lookBtn.textContent = LOOKS.find((l) => l[0] === look)[1];
    if (ui.tintBtn) ui.tintBtn.addEventListener('click', () => setTint(tint === 'green' ? 'red' : 'green'));
    applyTint();

    theme.build();
    applyScheme();
    applyPage();
    paint();
  }

  /** Auto: tema escolhido no visualizador/sistema; sem preferência, noite entre 18 h e 6 h. */
  function resolveScheme() {
    if (mode !== 'auto') return mode;
    const forced = document.documentElement.dataset.theme;
    if (forced === 'dark') return 'night';
    if (forced === 'light') return 'day';
    if (window.matchMedia) {
      if (window.matchMedia('(prefers-color-scheme: dark)').matches) return 'night';
      if (window.matchMedia('(prefers-color-scheme: light)').matches && !window.AndroidBridge) return 'day';
    }
    const h = new Date().getHours();
    return h >= 18 || h < 6 ? 'night' : 'day';
  }
  function applyScheme() {
    if (!root || !ui.modeBtn) return;
    root.dataset.scheme = resolveScheme();
    ui.modeBtn.textContent = MODE_LABEL[mode];
  }

  function setLook(l) { if (THEMES[l] && root) { look = l; store.set('look', l); applyLook(); } }
  function applyTint() {
    if (!root) return;
    root.dataset.tint = tint;
    if (ui.tintBtn) ui.tintBtn.textContent = TINTS.find((t) => t[0] === tint)[1];
  }
  function setTint(t) { if (TINTS.some((x) => x[0] === t)) { tint = t; store.set('tint', t); applyTint(); } }
  function setMode(m) { if (MODES.includes(m)) { mode = m; store.set('mode', m); applyScheme(); } }
  /** Escolha manual: vira a tela "de casa" e vale até a próxima parada. */
  function setPage(p) {
    if (!LAYOUT[p]) return;
    userPage = p;
    page = p;
    stoppedSince = null;
    store.set('page', p);
    applyPage();
  }
  function setAutoPage(on) { autoPage = !!on; store.set('autoPage', on ? '1' : '0'); applyPage(); }

  function applyPage() {
    if (!root || !ui.fields) return;
    PAGES.forEach(([id]) => {
      if (id === page) ui['tab_' + id].setAttribute('aria-current', 'page'); else ui['tab_' + id].removeAttribute('aria-current');
    });
    ui.autoBtn.setAttribute('aria-pressed', String(autoPage));
    LAYOUT[page].forEach((key, i) => {
      const node = ui.fields[i];
      if (!node) return;
      node.dataset.field = key;
      node.querySelector('.cl-field-label').textContent = FIELDS[key].label;
    });
    render();
  }

  /* ================================================================ Atualização */
  function setMeta(m) {
    meta = m || {};
    if (root) applyLook();
  }

  function update(s) {
    state = s;
    target.rpm = reading('rpm');
    target.speed = reading('speed');
    autoSwitch();
    render();
    animate();
  }

  function autoSwitch() {
    const speed = reading('speed');
    const now = nowOf(state);
    if (speed !== null && speed < 1) {
      if (stoppedSince === null) stoppedSince = now;
      if (autoPage && page !== 'trip' && now - stoppedSince > STOP_TO_TRIP_MS) { page = 'trip'; applyPage(); }
    } else if (speed !== null && speed > 5) {
      stoppedSince = null;
      if (autoPage && page !== userPage) { page = userPage; applyPage(); }
    }
  }

  function ctxNow() {
    const d = (state && state.derived) || {};
    const rpm = reading('rpm');
    const speed = reading('speed');
    const top = ((state && state.alerts) || []).find((a) => a.level !== 'INFO');
    return {
      rpm, speed, gear: d.estimatedGear || null, recommended: d.recommendedGear,
      shift: !!(d.shiftUp && d.recommendedGear), redline: rpm != null && rpm >= dashCfg().rpmRedline,
      alert: top || null, critical: !!(top && top.level === 'CRITICAL'),
    };
  }

  function render() {
    if (!root || !state || !ui.fields) return;
    const s = state;
    const d = s.derived || {};
    const c = ctxNow();

    // Marcha (Minimal e HUD) e velocidade (Minimal)
    if (ui.gearNum) {
      big(ui.gearNum, c.gear ? String(c.gear) : c.rpm != null && (c.speed || 0) < 3 ? 'N' : '–');
      ui.gearSub.textContent = c.shift ? '▲ ' + c.recommended + 'ª' : look === 'minimal' ? 'marcha' : '';
      ui.gear.dataset.state = c.shift ? 'shift' : '';
    }
    if (ui.speedNum && look === 'minimal') big(ui.speedNum, num(c.speed));

    // Campos da tela atual
    ui.fields.forEach((node) => {
      const f = FIELDS[node.dataset.field];
      if (!f) return;
      const [v, unit] = f.value(s, d);
      const valueEl = node.querySelector('.cl-field-value');
      const html = unit ? `${v}<small>${unit}</small>` : v;
      if (valueEl.innerHTML !== html) valueEl.innerHTML = html;
      node.querySelector('.cl-field-note').textContent = f.note ? f.note(s, d) : '';
      const st = f.state ? f.state(s, d) : null;
      if (st) node.dataset.state = st; else delete node.dataset.state;
      drawFieldBar(node, f.bar ? f.bar(s, d) : null);
    });

    // Indicador de economia (os três temas): pelo computador de bordo
    if (ui.eco) {
      const band = s.computer && s.computer.ecoBand != null ? s.computer.ecoBand : null;
      const v = band == null ? '' : String(band);
      if (ui.eco.dataset.band !== v) {
        ui.eco.dataset.band = v;
        ui.eco.title = 'Economia: ' + (band == null ? 'sem leitura' : ECO_TITLES[band]);
      }
    }

    // Barras de combustível e temperatura (Cápsula e HUD)
    const cool = reading('coolant');
    const tf = tankFrac(d);
    if (ui.fuelBar) setBar(ui.fuelBar, tf, tf == null ? '--' : num(tf * 100) + '%', reserve(d) ? 'warn' : tf != null ? 'ok' : '');
    if (ui.tempBar) {
      const band = tempBand(cool)[0];
      setBar(ui.tempBar, coolantFrac(cool), cool == null ? '--' : num(cool) + '°C', band === 'bad' || band === 'warn' ? band : cool != null ? 'ok' : '');
    }

    // Rodapé e viagem
    const streaming = s.connection === 'STREAMING';
    ui.status.dataset.state = streaming ? 'ok' : s.connection === 'ERROR' ? 'bad' : s.running ? 'warn' : '';
    // Relógio e, com o sensor do ESP32 (BMP180), a temperatura interna ao lado, como no painel de um carro
    const cabin = reading('cabinTemp');
    const clock = new Date(nowOf(s)).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }) + (cabin == null ? '' : ' · ' + num(cabin) + '°C');
    ui.statusText.textContent = streaming
      ? (s.power === 'IDLE_CONFIRMATION' ? 'Parado: encerrar captura?' : clock)
      : (s.statusMessage || 'Desconectado');
    ui.rec.hidden = !(s.diagRecording && s.running);
    if (ui.tripKm) ui.tripKm.textContent = num(s.tripDistanceKm, 1);
    // Trip (Clássico e Horizonte) é o parcial do painel do carro, lido pela escuta CAN. Sem ele, o
    // rótulo vira Viagem e mostra a distância desta captura, como nos outros temas.
    if (ui.carTrip) {
      const parcial = reading('carTrip');
      ui.carTrip.textContent = num(parcial != null ? parcial : s.tripDistanceKm, 1);
      if (ui.carTripLabel) ui.carTripLabel.textContent = parcial != null ? 'Trip' : 'Viagem';
    }
    if (ui.tripTime) ui.tripTime.textContent = elapsed(s);
    if (ui.totalKm) ui.totalKm.textContent = num(s.totalKm, 0);

    // Luzes-espia (Minimal e HUD: só acesas; Cápsula: apagadas esmaecidas)
    const t = thermal();
    const mil = reading('milOn');
    const hot = cool != null && t && cool > t.criticalC;
    setLight('link', !streaming && s.running ? 'warn' : null);
    setLight('engine', mil != null && mil >= 1 ? 'warn' : null);
    setLight('temp', hot ? 'bad' : cool != null && t && cool >= t.fanStage2C ? 'warn' : null, hot);
    setLight('battery', voltNote()[0] === 'bad' ? 'bad' : null);
    setLight('fuel', reserve(d) ? 'warn' : null);
    setLight('fan', cool != null && t && cool >= t.fanStage1C ? 'info' : null);

    // Alerta mais grave, por cima de qualquer tela
    ui.alert.hidden = !c.alert;
    if (c.alert) { ui.alert.textContent = c.alert.message; ui.alert.dataset.level = c.alert.level; }

    theme.render(c);
  }

  function setBar(node, frac, text, st) {
    node.querySelector('.bar-fill').style.width = frac == null ? '0' : clamp(frac, 0, 1) * 100 + '%';
    node.querySelector('b').textContent = text;
    node.dataset.state = st;
  }

  function drawFieldBar(node, b) {
    const track = node.querySelector('.cl-fbar');
    const ends = node.querySelector('.cl-fbar-ends');
    track.hidden = !b;
    ends.hidden = !(b && b.ends);
    if (!b) return;
    const fill = track.querySelector('i');
    if (b.zero !== undefined) {
      track.dataset.zero = '';
      fill.style.left = (b.zero < 0 ? 50 + b.zero * 50 : 50) + '%';
      fill.style.width = Math.abs(b.zero) * 50 + '%';
      ends.children[0].textContent = b.ends[0];
      ends.children[1].textContent = b.ends[1];
    } else {
      delete track.dataset.zero;
      fill.style.left = '0';
      fill.style.width = clamp(b.frac, 0, 1) * 100 + '%';
    }
  }

  function setLight(id, on, blink) {
    const l = ui['light_' + id];
    if (!l) return;
    l.hidden = !on && !theme.dimLights;
    if (on) l.dataset.on = on; else delete l.dataset.on;
    if (blink) l.dataset.blink = ''; else delete l.dataset.blink;
  }

  /* ================================================================ Animação */
  function animate() {
    if (reduceMotion) { shown.rpm = target.rpm; shown.speed = target.speed; paint(); return; }
    if (!raf) { lastFrame = performance.now(); raf = requestAnimationFrame(frame); }
  }
  function frame(now) {
    const dt = Math.min(200, now - lastFrame);
    lastFrame = now;
    const k = 1 - Math.exp(-dt / TAU_MS);
    let moving = false;
    for (const key of ['rpm', 'speed']) {
      const t = target[key];
      if (t === null) { shown[key] = null; continue; }
      if (shown[key] === null) shown[key] = t;
      shown[key] += (t - shown[key]) * k;
      if (Math.abs(t - shown[key]) > (key === 'rpm' ? 5 : 0.1)) moving = true; else shown[key] = t;
    }
    paint();
    raf = moving && !document.hidden ? requestAnimationFrame(frame) : 0;
  }
  function paint() { if (theme && theme.paint) theme.paint(shown); }

  return {
    mount, setMeta, update, setLook, setMode, setPage, setAutoPage,
    get look() { return look; }, get mode() { return mode; }, get page() { return page; }, get autoPage() { return autoPage; },
  };
})();

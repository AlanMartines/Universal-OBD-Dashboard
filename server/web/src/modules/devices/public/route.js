/* Cartão Percurso. Mapa servido pelo próprio painel: nenhuma posição sai para serviço externo. */
import { addProtocol, LngLatBounds, Map as GlMap, Marker, setWorkerUrl } from '/vendor/maplibre/maplibre-gl.mjs';

const card = document.getElementById('route-card');
if (card) {
  const deviceId = card.dataset.deviceId;
  const hasMap = card.dataset.hasMap === 'true';
  const range = document.getElementById('route-range');
  const tripSelect = document.getElementById('route-trip');
  const summary = document.getElementById('route-summary');
  const notice = document.getElementById('route-notice');
  const box = document.getElementById('route-map');
  const SPEED_COLORS = [[30, '#198754'], [60, '#0d6efd'], [90, '#fd7e14'], [Infinity, '#dc3545']];
  const EMPTY = { type: 'FeatureCollection', features: [] };
  let map = null;
  let minutes = 1440;
  let shownOnce = false;
  let lastBounds = null;
  let pendingTrip = null;
  // Ao vivo: pontos do último carregamento + os que chegam pela conexão /ao-vivo (live.js).
  const liveBadge = document.getElementById('route-live');
  const liveText = document.getElementById('route-live-text');
  const followButton = document.getElementById('route-follow');
  const LIVE_STALE_MS = 15000;
  const RECENT_MS = 10 * 60 * 1000;
  const SVG = 'http://www.w3.org/2000/svg';
  let points = [];
  let liveLastAt = 0;
  let car = null;
  let carAt = null;
  let bearing = 0;
  let follow = true;
  let refillTimer = null;
  // A lista de viagens com GPS chega com o primeiro carregamento; a escolha espera por ela.
  function selectPendingTrip() {
    if (!pendingTrip || !started) return;
    const option = [...tripSelect.options].find((o) => o.value === pendingTrip);
    if (!option) return;
    pendingTrip = null;
    tripSelect.value = option.value;
    load();
  }

  // O mapa acompanha o tema do painel (claro ou escuro).
  const theme = () => (typeof window.appTheme === 'function' ? window.appTheme() : 'light');
  let protocolReady = false;
  let routeData = EMPTY;
  let endsData = EMPTY;

  function addRouteLayers() {
    map.addSource('route', { type: 'geojson', data: routeData });
    map.addSource('route-ends', { type: 'geojson', data: endsData });
    map.addLayer({ id: 'route-line', type: 'line', source: 'route', layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': ['get', 'color'], 'line-width': 4 } });
    map.addLayer({ id: 'route-points', type: 'circle', source: 'route-ends', paint: { 'circle-radius': 6, 'circle-color': ['get', 'color'], 'circle-stroke-color': '#fff', 'circle-stroke-width': 2 } });
  }

  document.addEventListener('app-theme', () => {
    if (!map) return;
    // Sem diff: o estilo novo vem inteiro e o "style.load" sempre dispara para recolocar o trajeto.
    map.once('style.load', addRouteLayers);
    map.setStyle(baseStyle(), { diff: false });
  });

  function baseStyle() {
    if (!hasMap) {
      return { version: 8, sources: {}, layers: [{ id: 'fundo', type: 'background', paint: { 'background-color': theme() === 'dark' ? '#1b2229' : '#eef1f4' } }] };
    }
    if (!protocolReady) {
      addProtocol('pmtiles', new window.pmtiles.Protocol().tile);
      protocolReady = true;
    }
    return {
      version: 8,
      glyphs: '/mapa/assets/fonts/{fontstack}/{range}.pbf',
      sprite: `${window.location.origin}/mapa/assets/sprites/v4/${theme()}`,
      sources: {
        protomaps: {
          type: 'vector',
          url: `pmtiles://${window.location.origin}/mapa/brasil.pmtiles`,
          attribution: '© OpenStreetMap · Protomaps',
        },
      },
      layers: window.basemaps.layers('protomaps', window.basemaps.namedFlavor(theme()), { lang: 'pt' }),
    };
  }

  const colorFor = (speed) => SPEED_COLORS.find(([limit]) => (speed ?? 0) < limit)[1];

  function toFeatures(points) {
    const features = [];
    for (let i = 1; i < points.length; i += 1) {
      const a = points[i - 1];
      const b = points[i];
      // Salto longo no tempo não é trajeto: não liga os dois pontos.
      if (new Date(b.t) - new Date(a.t) <= points.gapMs) {
        features.push({
          type: 'Feature',
          properties: { color: colorFor(b.speed) },
          geometry: { type: 'LineString', coordinates: [[a.lon, a.lat], [b.lon, b.lat]] },
        });
      }
    }
    return { type: 'FeatureCollection', features };
  }

  function markers(points) {
    const first = points[0];
    const last = points[points.length - 1];
    return {
      type: 'FeatureCollection',
      features: [[first, '#198754'], [last, '#dc3545']].map(([p, color]) => ({
        type: 'Feature', properties: { color }, geometry: { type: 'Point', coordinates: [p.lon, p.lat] },
      })),
    };
  }

  function ensureMap() {
    if (map) return Promise.resolve();
    setWorkerUrl('/vendor/maplibre/maplibre-gl-worker.mjs');
    box.hidden = false;
    map = new GlMap({ container: box, style: baseStyle(), center: [-54, -15], zoom: 3, attributionControl: { compact: true } });
    return new Promise((resolve) => {
      map.on('load', () => {
        addRouteLayers();
        resolve();
      });
      // Mexer no mapa com a mão para de seguir o carro, até tocar em "Seguir" de novo.
      map.on('dragstart', (e) => { if (e.originalEvent && car) setFollow(false); });
    });
  }

  function say(text) {
    notice.textContent = text;
    notice.hidden = !text;
  }

  async function load(keepView = false) {
    const query = new URLSearchParams({ minutes: String(minutes) });
    if (tripSelect.value) query.set('viagem', tripSelect.value);
    let data;
    try {
      const response = await fetch(`/dispositivos/${encodeURIComponent(deviceId)}/percurso?${query}`, { credentials: 'same-origin' });
      if (!response.ok) throw new Error('percurso');
      data = await response.json();
    } catch {
      say('Não foi possível carregar o percurso.');
      return;
    }
    const selected = tripSelect.value;
    tripSelect.replaceChildren(new Option('Todas as viagens do período', ''));
    data.trips.forEach((trip) => {
      const start = new Date(trip.start).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
      tripSelect.add(new Option(`Viagem ${trip.id} · ${start}`, String(trip.id)));
    });
    tripSelect.value = selected;
    if (pendingTrip) {
      if ([...tripSelect.options].some((o) => o.value === pendingTrip)) {
        selectPendingTrip();
        return;
      }
      if (minutes < 10080) {
        // A viagem é mais antiga que o período: amplia para 7 dias e procura de novo.
        minutes = 10080;
        range.querySelectorAll('button').forEach((b) => b.classList.toggle('active', b.dataset.minutes === '10080'));
        load();
        return;
      }
      pendingTrip = null;
      say('Esta viagem não tem posições de GPS no servidor.');
    }
    if (!data.points.length) {
      points = [];
      removeCar();
      summary.textContent = '';
      if (map) {
        routeData = EMPTY;
        endsData = EMPTY;
        map.getSource('route')?.setData(EMPTY);
        map.getSource('route-ends')?.setData(EMPTY);
      }
      box.hidden = true;
      say('Sem localização neste período. Para registrar o percurso, ligue "Incluir localização GPS" em Ajustes → Telemetria remota, no app.');
      return;
    }
    say(hasMap ? '' : 'O mapa de ruas ainda não foi instalado neste servidor. O traçado aparece sem as ruas.');
    box.hidden = false;
    await ensureMap();
    map.resize();
    // Posições ao vivo mais novas que as gravadas (ainda vindo nos lotes do app) continuam no traço.
    const serverLast = new Date(data.points[data.points.length - 1].t).getTime();
    const liveTail = isLive() ? points.filter((p) => new Date(p.t).getTime() > serverLast) : [];
    points = data.points.concat(liveTail);
    points.gapMs = Math.max(data.gapSeconds, 60) * 1000;
    draw();
    const bounds = points.reduce((b, p) => b.extend([p.lon, p.lat]), new LngLatBounds([points[0].lon, points[0].lat], [points[0].lon, points[0].lat]));
    lastBounds = bounds;
    // Seguindo o carro ao vivo, a câmera fica nele; senão mostra o trajeto inteiro.
    if (!(keepView && follow && carAt)) map.fitBounds(bounds, { padding: 40, maxZoom: 16, animate: shownOnce });
    shownOnce = true;
    summary.textContent = `${data.total.toLocaleString('pt-BR')} posições`;
    // O carro aparece na ponta se a última posição é recente; parado (cinza) até chegar leitura ao vivo.
    const last = points[points.length - 1];
    if (isLive() && Date.now() - new Date(last.t).getTime() < RECENT_MS) placeCar(last, false);
    else removeCar();
    liveTick();
  }

  /** Redesenha a linha e as pontas; ao vivo, a ponta final é o carro. */
  function draw() {
    routeData = toFeatures(points);
    endsData = markers(points);
    if (isLive() && car) endsData = { type: 'FeatureCollection', features: endsData.features.slice(0, 1) };
    map.getSource('route')?.setData(routeData);
    map.getSource('route-ends')?.setData(endsData);
  }

  /* ---------------------------------------------------------------- Ao vivo */
  /** Ao vivo só no período até agora; uma viagem escolhida é histórico. */
  const isLive = () => !tripSelect.value;

  function carElement() {
    const el = document.createElement('div');
    el.className = 'route-car';
    const svg = document.createElementNS(SVG, 'svg');
    svg.setAttribute('viewBox', '0 0 34 34');
    svg.setAttribute('aria-hidden', 'true');
    const halo = document.createElementNS(SVG, 'circle');
    halo.setAttribute('class', 'car-halo');
    halo.setAttribute('cx', '17'); halo.setAttribute('cy', '17'); halo.setAttribute('r', '17');
    const body = document.createElementNS(SVG, 'circle');
    body.setAttribute('class', 'car-body');
    body.setAttribute('cx', '17'); body.setAttribute('cy', '17'); body.setAttribute('r', '10');
    const arrow = document.createElementNS(SVG, 'path');
    arrow.setAttribute('class', 'car-arrow');
    arrow.setAttribute('d', 'M17 8.5 23.5 24 17 20.6 10.5 24z');
    svg.append(halo, body, arrow);
    el.append(svg);
    return el;
  }

  function removeCar() {
    if (car) car.remove();
    car = null;
    carAt = null;
    liveBadge.hidden = true;
    followButton.hidden = true;
  }

  /** Direção de a para b, em graus a partir do norte. */
  function bearingOf(a, b) {
    const rad = Math.PI / 180;
    const y = Math.sin((b.lon - a.lon) * rad) * Math.cos(b.lat * rad);
    const x = Math.cos(a.lat * rad) * Math.sin(b.lat * rad) - Math.sin(a.lat * rad) * Math.cos(b.lat * rad) * Math.cos((b.lon - a.lon) * rad);
    return (Math.atan2(y, x) / rad + 360) % 360;
  }
  /** Distância aproximada em metros (suficiente para trechos de segundos). */
  function metersBetween(a, b) {
    const rad = Math.PI / 180;
    const dx = (b.lon - a.lon) * rad * Math.cos(((a.lat + b.lat) / 2) * rad);
    const dy = (b.lat - a.lat) * rad;
    return Math.hypot(dx, dy) * 6371000;
  }

  /** Põe (ou desliza) o carro até p. O deslize dura o intervalo entre leituras, para não parar e pular. */
  let glide = 0;
  function placeCar(p, animate) {
    if (!map || !p) return;
    if (!car) {
      car = new Marker({ element: carElement(), rotationAlignment: 'map', pitchAlignment: 'map' }).setLngLat([p.lon, p.lat]).addTo(map);
      carAt = { lat: p.lat, lon: p.lon };
      followButton.hidden = false;
      draw();
    }
    if (carAt && metersBetween(carAt, p) > 3) bearing = bearingOf(carAt, p);
    car.setRotation(bearing);
    const from = { ...carAt };
    const to = { lat: p.lat, lon: p.lon };
    carAt = to;
    cancelAnimationFrame(glide);
    const ms = animate ? 900 : 0;
    // A câmera só segue com leitura ao vivo chegando; ao abrir, mostra o trajeto inteiro.
    if (follow && animate) map.easeTo({ center: [to.lon, to.lat], zoom: Math.max(map.getZoom(), 15), duration: ms, essential: false });
    if (!ms) { car.setLngLat([to.lon, to.lat]); return; }
    const t0 = performance.now();
    const step = (now) => {
      const k = Math.min(1, (now - t0) / ms);
      car.setLngLat([from.lon + (to.lon - from.lon) * k, from.lat + (to.lat - from.lat) * k]);
      if (k < 1) glide = requestAnimationFrame(step);
    };
    glide = requestAnimationFrame(step);
  }

  function setFollow(on) {
    follow = on;
    followButton.setAttribute('aria-pressed', String(on));
    if (on && carAt && map) map.easeTo({ center: [carAt.lon, carAt.lat], zoom: Math.max(map.getZoom(), 15), duration: 600 });
  }
  followButton.addEventListener('click', () => setFollow(!follow));

  /** Selo: "Ao vivo · 14:32:05" ou, sem leitura há mais de 15 s, "Sem sinal desde 14:32". */
  function liveTick() {
    if (car) car.getElement().classList.toggle('stale', !liveLastAt || Date.now() - liveLastAt > LIVE_STALE_MS);
    if (!isLive() || !liveLastAt) { liveBadge.hidden = true; return; }
    liveBadge.hidden = false;
    const stale = Date.now() - liveLastAt > LIVE_STALE_MS;
    const at = new Date(liveLastAt);
    liveBadge.dataset.state = stale ? 'stale' : 'live';
    liveText.textContent = stale
      ? `Sem sinal desde ${at.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}`
      : `Ao vivo · ${at.toLocaleTimeString('pt-BR')}`;
  }
  setInterval(liveTick, 1000);

  document.addEventListener('live-sample', async (event) => {
    const sample = event.detail;
    const gps = sample && sample.gps;
    if (!gps || !Number.isFinite(gps.lat) || !Number.isFinite(gps.lon) || !started || !isLive()) return;
    const at = new Date(sample.ts).getTime();
    const p = { t: sample.ts, lat: gps.lat, lon: gps.lon, speed: sample.metrics?.speed ?? gps.speedKmh ?? null };
    const prev = points[points.length - 1];
    if (prev && at <= new Date(prev.t).getTime()) return;
    // Sinal voltou depois de um buraco: as posições gravadas no meio chegam pelos lotes do app
    // em alguns segundos; recarrega o trecho sem mexer na câmera.
    if (liveLastAt && at - liveLastAt > LIVE_STALE_MS) {
      clearTimeout(refillTimer);
      refillTimer = setTimeout(() => load(true), 8000);
    }
    liveLastAt = at;
    if (!points.length) {
      points = [p];
      points.gapMs = 60000;
      say(hasMap ? '' : 'O mapa de ruas ainda não foi instalado neste servidor. O traçado aparece sem as ruas.');
      box.hidden = false;
      await ensureMap();
      map.resize();
    } else {
      points.push(p);
    }
    summary.textContent = '';
    draw();
    placeCar(p, true);
    liveTick();
  });

  range.addEventListener('click', (event) => {
    const button = event.target.closest('button[data-minutes]');
    if (!button) return;
    range.querySelectorAll('button').forEach((b) => b.classList.toggle('active', b === button));
    minutes = Number(button.dataset.minutes);
    tripSelect.value = '';
    load();
  });
  tripSelect.addEventListener('change', () => load());

  // Na aba Percurso o mapa só existe de verdade quando ela aparece: antes disso não tem tamanho.
  const tab = document.querySelector('[data-bs-target="#pane-route"]');
  let started = false;
  const start = () => {
    if (!started) {
      started = true;
      load();
    } else if (map) {
      map.resize();
      if (lastBounds) map.fitBounds(lastBounds, { padding: 40, maxZoom: 16, animate: false });
    }
  };
  if (tab) tab.addEventListener('shown.bs.tab', start);
  // "Ver no mapa" na aba Viagens: abre o Percurso já na viagem escolhida.
  document.addEventListener('click', (event) => {
    const b = event.target.closest('[data-show-trip]');
    if (!b) return;
    pendingTrip = b.dataset.showTrip;
    if (window.showTab) window.showTab('percurso');
    selectPendingTrip();
  });
  if (!tab || card.offsetParent !== null) start();
}

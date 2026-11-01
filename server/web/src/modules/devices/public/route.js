/* Cartão Percurso. Mapa servido pelo próprio painel: nenhuma posição sai para serviço externo. */
import { addProtocol, LngLatBounds, Map as GlMap, setWorkerUrl } from '/vendor/maplibre/maplibre-gl.mjs';

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

  function baseStyle() {
    if (!hasMap) {
      return { version: 8, sources: {}, layers: [{ id: 'fundo', type: 'background', paint: { 'background-color': '#eef1f4' } }] };
    }
    const protocol = new window.pmtiles.Protocol();
    addProtocol('pmtiles', protocol.tile);
    return {
      version: 8,
      glyphs: '/mapa/assets/fonts/{fontstack}/{range}.pbf',
      sprite: `${window.location.origin}/mapa/assets/sprites/v4/light`,
      sources: {
        protomaps: {
          type: 'vector',
          url: `pmtiles://${window.location.origin}/mapa/brasil.pmtiles`,
          attribution: '© OpenStreetMap · Protomaps',
        },
      },
      layers: window.basemaps.layers('protomaps', window.basemaps.namedFlavor('light'), { lang: 'pt' }),
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
        map.addSource('route', { type: 'geojson', data: EMPTY });
        map.addSource('route-ends', { type: 'geojson', data: EMPTY });
        map.addLayer({ id: 'route-line', type: 'line', source: 'route', layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': ['get', 'color'], 'line-width': 4 } });
        map.addLayer({ id: 'route-points', type: 'circle', source: 'route-ends', paint: { 'circle-radius': 6, 'circle-color': ['get', 'color'], 'circle-stroke-color': '#fff', 'circle-stroke-width': 2 } });
        resolve();
      });
    });
  }

  function say(text) {
    notice.textContent = text;
    notice.hidden = !text;
  }

  async function load() {
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
    if (!data.points.length) {
      summary.textContent = '';
      if (map) {
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
    const points = data.points;
    points.gapMs = Math.max(data.gapSeconds, 60) * 1000;
    map.getSource('route').setData(toFeatures(points));
    map.getSource('route-ends').setData(markers(points));
    const bounds = points.reduce((b, p) => b.extend([p.lon, p.lat]), new LngLatBounds([points[0].lon, points[0].lat], [points[0].lon, points[0].lat]));
    map.fitBounds(bounds, { padding: 40, maxZoom: 16, animate: shownOnce });
    shownOnce = true;
    summary.textContent = `${data.total.toLocaleString('pt-BR')} posições`;
  }

  range.addEventListener('click', (event) => {
    const button = event.target.closest('button[data-minutes]');
    if (!button) return;
    range.querySelectorAll('button').forEach((b) => b.classList.toggle('active', b === button));
    minutes = Number(button.dataset.minutes);
    tripSelect.value = '';
    load();
  });
  tripSelect.addEventListener('change', load);
  load();
}

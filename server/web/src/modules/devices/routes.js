import { Readable } from 'node:stream';
import { ApiError, message } from '../../shared/errors.js';
import { pageParam, pagerFor } from '../../shared/pagination.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function requireUuid(request) {
  if (!UUID.test(request.params.id)) throw new ApiError(404, 'not_found');
  return request.params.id;
}

export default function devicesRoutes(app, {
  config, api, cookieName, requireUser, context, hasMapData,
}) {
  const DEVICE_ASSETS = { pageCss: ['/modules/devices/devices.css'] };

  // "Ao vivo" com leitura há menos de 1 minuto; depois, há quanto tempo chegou a última.
  const freshness = (ts, now = Date.now()) => {
    if (!ts) return { label: 'Sem dados ainda', tone: 'secondary' };
    const s = Math.max(0, Math.round((now - new Date(ts).getTime()) / 1000));
    if (s < 60) return { label: 'Ao vivo', tone: 'success', live: true };
    if (s < 3600) return { label: `Há ${Math.round(s / 60)} min`, tone: 'warning' };
    if (s < 86400) return { label: `Há ${Math.round(s / 3600)} h`, tone: 'secondary' };
    return { label: `Há ${Math.round(s / 86400)} dias`, tone: 'secondary' };
  };

  const panelView = async (request, reply, status = 200, error = null) => {
    const query = new URLSearchParams({ page: pageParam(request) });
    const [{ devices, pagination }, overview] = await Promise.all([
      api(request, 'GET', `/internal/devices?${query}`),
      api(request, 'GET', '/internal/devices/overview'),
    ]);
    const vehicles = overview.vehicles.map((v) => ({ ...v, status: freshness(v.latestTs ?? v.lastSeenAt), dtcCount: v.dtcs.length }));
    return reply.code(status).view('modules/devices/views/devices.hbs', context(request, {
      title: 'Dispositivos', devices, error, vehicles, monthLabel: overview.month.split('-').reverse().join('/'), serverUrl: config.publicOrigin, pager: pagerFor(pagination, request, { path: '/painel' }), pageScripts: ['/modules/devices/devices.js'], ...DEVICE_ASSETS,
    }));
  };

  app.get('/painel', { preHandler: requireUser }, async (request, reply) => panelView(request, reply));

  app.post('/dispositivos', { preHandler: requireUser }, async (request, reply) => {
    // O modal pede JSON. Sem JavaScript, o formulário cai na página de pareamento.
    const wantsJson = String(request.headers.accept ?? '').includes('application/json');
    try {
      const created = await api(request, 'POST', '/internal/devices', { body: { name: String(request.body?.name ?? '').trim() } });
      if (wantsJson) return created;
      return reply.view('modules/devices/views/pairing.hbs', context(request, { title: 'Parear dispositivo', ...created, ...DEVICE_ASSETS }));
    } catch (error) {
      if (!(error instanceof ApiError) || error.status >= 500 || error.status === 401) throw error;
      if (wantsJson) return reply.code(error.status).send({ error: message(error.code) });
      return panelView(request, reply, error.status, message(error.code));
    }
  });

  app.get('/dispositivos/:id/estado', { preHandler: requireUser }, async (request) => {
    const { device } = await api(request, 'GET', `/internal/devices/${requireUuid(request)}`);
    return { paired: Boolean(device.pairedAt) };
  });

  app.get('/dispositivos/:id', { preHandler: requireUser }, async (request, reply) => {
    const data = await api(request, 'GET', `/internal/devices/${requireUuid(request)}`);
    const [fuel, { trips }, { faults }] = await Promise.all([
      api(request, 'GET', `/internal/devices/${data.device.id}/fuel-ups`),
      api(request, 'GET', `/internal/devices/${data.device.id}/trips`),
      api(request, 'GET', `/internal/devices/${data.device.id}/faults`),
    ]);
    const months = Object.entries(fuel.summary.costByMonth);
    const lastMonth = months.length ? months[months.length - 1] : null;
    return reply.view('modules/devices/views/device.hbs', context(request, {
      fuel: {
        ...fuel,
        recent: fuel.items.slice(0, 10),
        intervals: fuel.summary.intervals.slice(0, 5),
        month: lastMonth ? { label: lastMonth[0].split('-').reverse().join('/'), total: lastMonth[1] } : null,
      },
      trips,
      faults,
      faultsActive: faults.filter((f) => f.active).length,
      title: data.device.name,
      device: data.device,
      latestJson: JSON.stringify(data.latest),
      limitsJson: JSON.stringify(data.device.dashLimits),
      ...DEVICE_ASSETS,
      pageScripts: ['/vendor/chartjs/chart.umd.min.js', '/static/js/tabs.js', '/static/js/dtc-sae.js', '/modules/devices/live.js', '/modules/devices/faults.js', ...(data.locationAllowed ? ['/vendor/pmtiles/pmtiles.js', '/vendor/basemaps/basemaps.js'] : [])],
      pageModules: data.locationAllowed ? ['/modules/devices/route.js'] : [],
      pageCss: ['/modules/devices/devices.css', ...(data.locationAllowed ? ['/vendor/maplibre/maplibre-gl.css'] : [])],
      locationAllowed: data.locationAllowed,
      hasMap: hasMapData(),
    }));
  });

  app.get('/dispositivos/:id/percurso', { preHandler: requireUser }, async (request) => {
    const params = new URLSearchParams({ minutes: String(request.query.minutes ?? '') });
    if (request.query.viagem) params.set('tripId', String(request.query.viagem));
    if (request.query.ruas !== undefined) params.set('snap', String(request.query.ruas));
    return api(request, 'GET', `/internal/devices/${requireUuid(request)}/route?${params}`);
  });

  app.get('/dispositivos/:id/historico', { preHandler: requireUser }, async (request) => {
    const params = new URLSearchParams({ metric: String(request.query.metric ?? '') });
    if (request.query.minutes !== undefined) params.set('minutes', String(request.query.minutes));
    else params.set('hours', String(request.query.hours ?? ''));
    return api(request, 'GET', `/internal/devices/${requireUuid(request)}/history?${params}`);
  });

  // Encaminha o SSE: o navegador nunca fala direto com a API.
  app.get('/dispositivos/:id/ao-vivo', { preHandler: requireUser }, async (request, reply) => {
    const id = requireUuid(request);
    const abort = new AbortController();
    // Antes do fetch: quem sai da página durante a conexão não pode deixá-la presa na API.
    reply.raw.once('close', () => abort.abort());
    const upstream = await fetch(`${config.apiUrl}/internal/devices/${id}/live`, {
      headers: {
        'x-internal-key': config.internalKey,
        'x-client-ip': request.ip,
        'x-session-token': request.cookies[cookieName],
      },
      signal: abort.signal,
    });
    if (!upstream.ok) {
      const data = await upstream.json().catch(() => ({}));
      throw new ApiError(upstream.status, data.error ?? 'internal_error');
    }
    reply.hijack();
    reply.raw.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
      'X-Accel-Buffering': 'no',
    });
    const stream = Readable.fromWeb(upstream.body);
    stream.on('error', () => reply.raw.destroy());
    stream.on('end', () => reply.raw.end());
    stream.pipe(reply.raw);
  });

  const deviceAction = (action, notice) => async (request, reply) => {
    await api(request, 'POST', `/internal/devices/${requireUuid(request)}/${action}`);
    return reply.redirect(`/painel?ok=${notice}`, 303);
  };
  app.post('/dispositivos/:id/novo-codigo', { preHandler: requireUser }, async (request, reply) => {
    try {
      const created = await api(request, 'POST', `/internal/devices/${requireUuid(request)}/pairing-code`);
      return reply.view('modules/devices/views/pairing.hbs', context(request, { title: 'Novo código de pareamento', ...created, ...DEVICE_ASSETS }));
    } catch (error) {
      if (!(error instanceof ApiError) || error.status >= 500 || error.status === 401) throw error;
      return panelView(request, reply, error.status, message(error.code));
    }
  });
  app.post('/dispositivos/:id/revogar', { preHandler: requireUser }, deviceAction('revoke', 'device_revoked'));
  app.post('/dispositivos/:id/excluir', { preHandler: requireUser }, deviceAction('delete', 'device_deleted'));
}

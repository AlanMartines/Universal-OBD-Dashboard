import { Readable } from 'node:stream';
import { ApiError, message } from '../../shared/errors.js';
import { pageParam, pagerFor } from '../../shared/pagination.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function requireUuid(request) {
  if (!UUID.test(request.params.id)) throw new ApiError(404, 'not_found');
  return request.params.id;
}

export default function devicesRoutes(app, { config, api, cookieName, requireUser, context }) {
  const DEVICE_ASSETS = { pageCss: ['/modules/devices/devices.css'] };

  const panelView = async (request, reply, status = 200, error = null) => {
    const query = new URLSearchParams({ page: pageParam(request) });
    const { devices, pagination } = await api(request, 'GET', `/internal/devices?${query}`);
    return reply.code(status).view('modules/devices/views/devices.hbs', context(request, {
      title: 'Dispositivos', devices, error, serverUrl: config.publicOrigin, pager: pagerFor(pagination, request, { path: '/painel' }), pageScripts: ['/modules/devices/devices.js'], ...DEVICE_ASSETS,
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
    return reply.view('modules/devices/views/device.hbs', context(request, {
      title: data.device.name,
      device: data.device,
      latestJson: JSON.stringify(data.latest),
      ...DEVICE_ASSETS,
      pageScripts: ['/vendor/chartjs/chart.umd.min.js', '/modules/devices/live.js'],
    }));
  });

  app.get('/dispositivos/:id/historico', { preHandler: requireUser }, async (request) => {
    const params = new URLSearchParams({ metric: String(request.query.metric ?? ''), hours: String(request.query.hours ?? '') });
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
  app.post('/dispositivos/:id/revogar', { preHandler: requireUser }, deviceAction('revoke', 'device_revoked'));
  app.post('/dispositivos/:id/excluir', { preHandler: requireUser }, deviceAction('delete', 'device_deleted'));
}

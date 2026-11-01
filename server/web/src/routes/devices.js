import { Readable } from 'node:stream';
import { ApiError, message } from '../errors.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function requireUuid(request) {
  if (!UUID.test(request.params.id)) throw new ApiError(404, 'not_found');
  return request.params.id;
}

export default function devicesRoutes(app, { config, api, cookieName, requireUser, context }) {
  const panelView = async (request, reply, status = 200, error = null) => {
    const { devices } = await api(request, 'GET', '/internal/devices');
    return reply.code(status).view('devices.hbs', context(request, { title: 'Dispositivos', devices, error }));
  };

  app.get('/painel', { preHandler: requireUser }, async (request, reply) => panelView(request, reply));

  app.post('/dispositivos', { preHandler: requireUser }, async (request, reply) => {
    try {
      const created = await api(request, 'POST', '/internal/devices', { body: { name: String(request.body?.name ?? '').trim() } });
      return reply.view('pairing.hbs', context(request, { title: 'Parear dispositivo', ...created }));
    } catch (error) {
      if (!(error instanceof ApiError) || error.status >= 500 || error.status === 401) throw error;
      return panelView(request, reply, error.status, message(error.code));
    }
  });

  app.get('/dispositivos/:id', { preHandler: requireUser }, async (request, reply) => {
    const data = await api(request, 'GET', `/internal/devices/${requireUuid(request)}`);
    return reply.view('device.hbs', context(request, {
      title: data.device.name,
      device: data.device,
      latestJson: JSON.stringify(data.latest),
      scripts: true,
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
    reply.raw.on('close', () => abort.abort());
    stream.pipe(reply.raw);
  });

  const deviceAction = (action) => async (request, reply) => {
    await api(request, 'POST', `/internal/devices/${requireUuid(request)}/${action}`);
    return reply.redirect('/painel', 303);
  };
  app.post('/dispositivos/:id/revogar', { preHandler: requireUser }, deviceAction('revoke'));
  app.post('/dispositivos/:id/excluir', { preHandler: requireUser }, deviceAction('delete'));
}

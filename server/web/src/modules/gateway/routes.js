export const DEVICE_ROUTES = ['/api/v1/devices/register', '/api/v1/telemetry', '/api/v1/live', '/api/v1/fuel-ups'];

export default function gatewayRoutes(app, { config }) {
  // Só estas rotas da API são públicas. Nada mais é encaminhado.
  for (const route of DEVICE_ROUTES) {
    app.post(route, { bodyLimit: 512 * 1024 }, async (request, reply) => {
      const headers = { 'content-type': 'application/json', 'x-forwarded-for': request.ip };
      if (request.headers.authorization) headers.authorization = request.headers.authorization;
      const response = await fetch(`${config.apiUrl}${route}`, {
        method: 'POST',
        headers,
        body: JSON.stringify(request.body ?? null),
        signal: AbortSignal.timeout(20000),
      });
      const data = await response.json().catch(() => ({ error: 'unavailable' }));
      return reply.code(response.status).send(data);
    });
  }
}

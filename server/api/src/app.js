import { EventEmitter } from 'node:events';
import Fastify from 'fastify';
import rateLimit from '@fastify/rate-limit';
import { HttpError, fail } from './errors.js';
import { safeEqual } from './security.js';
import { createAccess } from './session.js';
import adminRoutes from './routes/admin.js';
import authRoutes from './routes/auth.js';
import deviceRoutes from './routes/device.js';
import devicesRoutes from './routes/devices.js';

export async function buildApp({ config, pool, logger }) {
  const app = Fastify({
    logger: logger ?? {
      level: config.logLevel,
      redact: ['req.headers.authorization', 'req.headers.cookie', 'req.headers["x-internal-key"]', 'req.headers["x-session-token"]'],
    },
    bodyLimit: 512 * 1024,
    trustProxy: config.trustProxy,
    requestTimeout: 30000,
    forceCloseConnections: true,
    ajv: {
      // Sem conversão nem remoção silenciosa: o que está fora do contrato é recusado.
      customOptions: { coerceTypes: false, removeAdditional: false, useDefaults: false, allErrors: false },
    },
  });

  const live = new EventEmitter();
  live.setMaxListeners(0);
  app.decorate('liveBus', live);

  app.setErrorHandler((error, request, reply) => {
    if (error instanceof HttpError) return reply.code(error.statusCode).send({ error: error.code });
    if (error.statusCode === 429) return reply.code(429).send({ error: 'too_many_requests' });
    if (error.validation) return reply.code(400).send({ error: 'invalid_request' });
    if (error.statusCode && error.statusCode < 500) return reply.code(error.statusCode).send({ error: 'invalid_request' });
    request.log.error({ err: error }, 'erro interno');
    return reply.code(500).send({ error: 'internal_error' });
  });
  app.setNotFoundHandler((_request, reply) => reply.code(404).send({ error: 'not_found' }));

  // O IP do cliente nas rotas internas só é aceito depois de validar a chave do serviço web.
  app.decorateRequest('clientIp', null);
  app.addHook('onRequest', async (request) => {
    request.clientIp = request.ip;
    if (!request.url.startsWith('/internal/')) return;
    if (!safeEqual(request.headers['x-internal-key'], config.internalKey)) throw fail(404, 'not_found');
    const forwarded = request.headers['x-client-ip'];
    if (typeof forwarded === 'string' && forwarded.length <= 64) request.clientIp = forwarded;
  });
  app.addHook('onSend', async (_request, reply) => {
    reply.header('Cache-Control', 'no-store');
    reply.header('X-Content-Type-Options', 'nosniff');
  });

  await app.register(rateLimit, {
    global: true,
    max: 600 * config.rateLimitMax,
    timeWindow: '1 minute',
    hook: 'preHandler',
    keyGenerator: (request) => request.clientIp,
    errorResponseBuilder: (_request, context) => {
      const error = new Error('too_many_requests');
      error.statusCode = context.statusCode;
      return error;
    },
  });

  const limit = (max, timeWindow, keyGenerator) => ({
    config: { rateLimit: { max: max * config.rateLimitMax, timeWindow, ...(keyGenerator ? { keyGenerator } : {}) } },
  });

  // ---------- Público: saúde ----------

  app.get('/healthz', { config: { rateLimit: false } }, async () => {
    await pool.query('SELECT 1');
    return { status: 'ok' };
  });

  const context = { config, pool, live, limit, ...createAccess({ config, pool }) };
  deviceRoutes(app, context);
  authRoutes(app, context);
  devicesRoutes(app, context);
  adminRoutes(app, context);

  return app;
}

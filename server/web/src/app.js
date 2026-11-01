import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import cookie from '@fastify/cookie';
import formbody from '@fastify/formbody';
import multipart from '@fastify/multipart';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import fastifyStatic from '@fastify/static';
import view from '@fastify/view';
import Fastify from 'fastify';
import Handlebars from 'handlebars';
import { ApiError, message } from './errors.js';
import { isSameOriginRequest, safeEqualText } from './protection.js';
import accountRoutes from './routes/account.js';
import adminRoutes from './routes/admin.js';
import devicesRoutes from './routes/devices.js';
import gatewayRoutes, { DEVICE_ROUTES } from './routes/gateway.js';
import loginRoutes from './routes/login.js';

export { checkFormToken, isSameOriginRequest, issueFormToken } from './protection.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

const dateFormat = new Intl.DateTimeFormat('pt-BR', {
  dateStyle: 'short',
  timeStyle: 'short',
  timeZone: 'America/Sao_Paulo',
});

export function createHandlebars() {
  const hbs = Handlebars.create();
  hbs.registerHelper('eq', (a, b) => a === b);
  hbs.registerHelper('initials', (name, fallback) => {
    const text = String((typeof name === 'string' && name) || fallback || '').trim();
    const parts = text.split(/\s+/).filter(Boolean);
    const letters = parts.length > 1 ? [parts[0], parts[parts.length - 1]] : parts;
    return letters.map((p) => [...p][0]).join('').toUpperCase() || '?';
  });
  hbs.registerHelper('roleLabel', (role) => ({ superadmin: 'Super Admin', admin: 'Admin', user: 'Usuário' }[role] ?? ''));
  hbs.registerHelper('canManage', (user) => Boolean(user) && user.role !== 'user');
  hbs.registerHelper('date', (value) => (value ? dateFormat.format(new Date(value)) : '—'));
  return hbs;
}

/** Item do menu destacado em cada página. */
function activePageOf(url) {
  if (url.startsWith('/admin')) return 'admin';
  if (url.startsWith('/conta')) return 'conta';
  return 'painel';
}

export async function buildApp({ config, logger }) {
  const app = Fastify({
    logger: logger ?? {
      level: config.logLevel,
      redact: ['req.headers.cookie', 'req.headers.authorization'],
    },
    bodyLimit: 16 * 1024,
    trustProxy: config.trustProxy,
    requestTimeout: 30000,
    forceCloseConnections: true,
  });

  const cookieName = config.cookieSecure ? '__Host-obd_session' : 'obd_session';
  const cookieOptions = {
    path: '/',
    httpOnly: true,
    secure: config.cookieSecure,
    sameSite: 'lax',
    maxAge: config.sessionMaxDays * 86400,
  };

  await app.register(helmet, {
    contentSecurityPolicy: {
      useDefaults: false,
      directives: {
        defaultSrc: ["'none'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'"],
        imgSrc: ["'self'", 'data:'],
        fontSrc: ["'self'"],
        connectSrc: ["'self'"],
        formAction: ["'self'"],
        baseUri: ["'none'"],
        frameAncestors: ["'none'"],
        objectSrc: ["'none'"],
        ...(config.cookieSecure ? { upgradeInsecureRequests: [] } : {}),
      },
    },
    strictTransportSecurity: config.cookieSecure ? { maxAge: 31536000, includeSubDomains: false } : false,
    referrerPolicy: { policy: 'same-origin' },
    crossOriginEmbedderPolicy: false,
  });
  await app.register(cookie);
  await app.register(formbody);
  await app.register(multipart, {
    attachFieldsToBody: 'keyValues',
    limits: { fileSize: 5 * 1024 * 1024, files: 1, fields: 4, parts: 5 },
  });
  await app.register(rateLimit, {
    global: true,
    max: 300 * config.rateLimitFactor,
    timeWindow: '1 minute',
  });

  const pageLimit = (max, timeWindow) => ({ config: { rateLimit: { max: max * config.rateLimitFactor, timeWindow } } });

  await app.register(view, {
    engine: { handlebars: createHandlebars() },
    root: join(ROOT, 'views'),
    layout: 'layout.hbs',
    viewExt: 'hbs',
    options: {
      partials: {
        formError: 'partials/form-error.hbs',
        sidebar: 'partials/sidebar.hbs',
        passwordStrength: 'partials/password-strength.hbs',
      },
    },
  });

  // Tudo servido daqui: nenhum CDN.
  await app.register(fastifyStatic, { root: join(ROOT, 'public'), prefix: '/static/', maxAge: '1h' });
  await app.register(fastifyStatic, {
    root: join(ROOT, 'public/assets'),
    prefix: '/assets/',
    decorateReply: false,
    maxAge: '7d',
  });
  await app.register(fastifyStatic, {
    root: join(ROOT, 'node_modules/bootstrap/dist'),
    prefix: '/vendor/bootstrap/',
    decorateReply: false,
    maxAge: '7d',
    allowedPath: (path) => path === '/css/bootstrap.min.css' || path === '/js/bootstrap.bundle.min.js',
  });
  await app.register(fastifyStatic, {
    root: join(ROOT, 'node_modules/chart.js/dist'),
    prefix: '/vendor/chartjs/',
    decorateReply: false,
    maxAge: '7d',
    allowedPath: (path) => path === '/chart.umd.min.js',
  });

  await app.register(fastifyStatic, {
    root: join(ROOT, 'node_modules/@fortawesome/fontawesome-free'),
    prefix: '/vendor/fontawesome/',
    decorateReply: false,
    maxAge: '7d',
    allowedPath: (path) => path === '/css/all.min.css' || /^\/webfonts\/fa-[a-z0-9-]+\.woff2$/.test(path),
  });

  await app.register(fastifyStatic, {
    root: join(ROOT, 'node_modules/jquery/dist'),
    prefix: '/vendor/jquery/',
    decorateReply: false,
    maxAge: '7d',
    allowedPath: (path) => path === '/jquery.min.js',
  });
  await app.register(fastifyStatic, {
    root: join(ROOT, 'node_modules/jquery-validation/dist'),
    prefix: '/vendor/jquery-validation/',
    decorateReply: false,
    maxAge: '7d',
    allowedPath: (path) => path === '/jquery.validate.min.js',
  });

  app.addHook('onSend', async (request, reply) => {
    reply.header('X-Robots-Tag', 'noindex, nofollow');
    reply.header('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=(), usb=()');
    if (!request.url.startsWith('/static/') && !request.url.startsWith('/vendor/') && !request.url.startsWith('/assets/') && !request.url.startsWith('/conta/foto')) {
      reply.header('Cache-Control', 'no-store');
    }
  });

  // ---------- Cliente da API ----------

  async function api(request, method, path, { body, token } = {}) {
    const headers = {
      'x-internal-key': config.internalKey,
      'x-client-ip': request.ip,
    };
    const sessionToken = token ?? request.cookies[cookieName];
    if (sessionToken) headers['x-session-token'] = sessionToken;
    if (body !== undefined) headers['content-type'] = 'application/json';
    const response = await fetch(`${config.apiUrl}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(20000),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new ApiError(response.status, data.error ?? 'internal_error');
    return data;
  }

  async function apiBinary(request, path) {
    const response = await fetch(`${config.apiUrl}${path}`, {
      headers: {
        'x-internal-key': config.internalKey,
        'x-client-ip': request.ip,
        'x-session-token': request.cookies[cookieName],
      },
      signal: AbortSignal.timeout(20000),
    });
    if (!response.ok) throw new ApiError(response.status, response.status === 404 ? 'not_found' : 'internal_error');
    return Buffer.from(await response.arrayBuffer());
  }

  const clearSession = (reply) => reply.clearCookie(cookieName, { path: '/', secure: config.cookieSecure, sameSite: 'lax', httpOnly: true });

  function renderError(reply, status, code) {
    return reply.code(status).view('error.hbs', {
      title: 'Erro', status, message: message(code), user: reply.request.user, csrf: reply.request.csrf, activePage: activePageOf(reply.request.url),
    });
  }

  app.setErrorHandler((error, request, reply) => {
    if (request.url.startsWith('/api/')) {
      if ((error.statusCode ?? 500) >= 500) request.log.error({ err: error }, 'erro ao encaminhar');
      const status = error.statusCode ?? 502;
      const code = status === 429 ? 'too_many_requests' : status < 500 ? 'invalid_request' : 'unavailable';
      return reply.code(status).send({ error: code });
    }
    // Foto grande demais: volta à tela com uma mensagem clara, em vez da página de erro.
    if (error.code === 'FST_REQ_FILE_TOO_LARGE') return reply.redirect('/conta?erro=image_too_large', 303);
    if (error instanceof ApiError) {
      if (error.status === 401) {
        clearSession(reply);
        return reply.redirect('/login');
      }
      if (error.code === 'password_change_required') return reply.redirect('/conta/senha');
      return renderError(reply, error.status, error.code);
    }
    if (error.statusCode === 429) return renderError(reply, 429, 'too_many_requests');
    if (error.statusCode && error.statusCode < 500) return renderError(reply, error.statusCode, 'invalid_request');
    request.log.error({ err: error }, 'erro interno');
    return renderError(reply, 500, 'internal_error');
  });
  app.setNotFoundHandler((request, reply) => {
    if (request.url.startsWith('/api/')) return reply.code(404).send({ error: 'not_found' });
    return renderError(reply, 404, 'not_found');
  });

  // ---------- Proteções de requisição ----------

  app.decorateRequest('user', null);
  app.decorateRequest('csrf', null);

  app.addHook('preHandler', async (request) => {
    if (request.method === 'GET' || request.method === 'HEAD') return;
    // O aparelho se autentica por token, sem cookie: CSRF não se aplica.
    if (DEVICE_ROUTES.includes(request.routeOptions.url)) return;
    if (!isSameOriginRequest(request.headers, config.publicOrigin)) throw new ApiError(403, 'forbidden');
  });

  const requireUser = async (request, reply) => {
    if (!request.cookies[cookieName]) return reply.redirect('/login');
    const session = await api(request, 'GET', '/internal/auth/session');
    request.user = session.user;
    request.csrf = session.csrf;
    if (request.method === 'POST' && !safeEqualText(request.body?._csrf, session.csrf)) {
      throw new ApiError(403, 'bad_form');
    }
    if (session.user.mustChangePassword && !['/conta/senha', '/logout', '/conta/foto'].includes(request.routeOptions.url)) {
      return reply.redirect('/conta/senha');
    }
    return undefined;
  };
  const requireAdmin = async (request, reply) => {
    const result = await requireUser(request, reply);
    if (reply.sent || result) return result;
    if (request.user.role === 'user') throw new ApiError(403, 'forbidden');
    return undefined;
  };

  const context = (request, extra = {}) => ({
    user: request.user,
    csrf: request.csrf,
    activePage: activePageOf(request.url),
    ...extra,
  });

  // ---------- Geral ----------

  app.get('/healthz', { config: { rateLimit: false } }, async () => ({ status: 'ok' }));
  app.get('/robots.txt', async (_request, reply) => reply.type('text/plain').send('User-agent: *\nDisallow: /\n'));
  app.get('/', async (request, reply) => reply.redirect(request.cookies[cookieName] ? '/painel' : '/login'));

  const shared = {
    config, api, apiBinary, cookieName, cookieOptions, clearSession, renderError, pageLimit, requireUser, requireAdmin, context,
  };
  gatewayRoutes(app, shared);
  loginRoutes(app, shared);
  accountRoutes(app, shared);
  devicesRoutes(app, shared);
  adminRoutes(app, shared);

  return app;
}

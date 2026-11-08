import { existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
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
import { ApiError, message, NOTICES } from './shared/errors.js';
import { isSameOriginRequest, safeEqualText } from './shared/protection.js';
import accountRoutes from './modules/account/routes.js';
import adminRoutes from './modules/admin/routes.js';
import devicesRoutes from './modules/devices/routes.js';
import gatewayRoutes, { DEVICE_ROUTES } from './modules/gateway/routes.js';
import loginRoutes from './modules/login/routes.js';
import projetoRoutes from './modules/projeto/routes.js';
import vehicleRoutes from './modules/vehicle/routes.js';

export { checkFormToken, isSameOriginRequest, issueFormToken } from './shared/protection.js';

const SRC = dirname(fileURLToPath(import.meta.url));
const ROOT = join(SRC, '..');
// Cada módulo publica seus próprios arquivos em /modules/<nome>/.
const MODULES_WITH_ASSETS = ['account', 'admin', 'devices', 'projeto', 'vehicle'];

const dateFormat = new Intl.DateTimeFormat('pt-BR', {
  dateStyle: 'short',
  timeStyle: 'short',
  timeZone: 'America/Sao_Paulo',
});

/**
 * Versão dos arquivos do próprio painel (CSS e JS), mudada a cada subida do serviço: o endereço muda
 * e o navegador busca o arquivo novo, sem precisar de Ctrl+F5 depois de uma atualização.
 */
export const ASSET_VERSION = Date.now().toString(36);

export function createHandlebars() {
  const hbs = Handlebars.create();
  hbs.registerHelper('asset', (url) => {
    const text = String(url ?? '');
    // Só os arquivos do painel; as bibliotecas em /vendor/ já mudam de endereço com a versão do pacote.
    if (!text.startsWith('/static/') && !text.startsWith('/modules/')) return text;
    // O endereço vem do código, não de quem usa; mesmo assim é escapado, e só a versão é acrescentada.
    return new hbs.SafeString(`${Handlebars.escapeExpression(text)}${text.includes('?') ? '&amp;' : '?'}v=${ASSET_VERSION}`);
  });
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
  // Números e valores no formato brasileiro; vazio vira travessão.
  hbs.registerHelper('num', (value, digits) => (typeof value === 'number'
    ? value.toLocaleString('pt-BR', { minimumFractionDigits: digits, maximumFractionDigits: digits }) : '—'));
  hbs.registerHelper('brl', (value) => (typeof value === 'number'
    ? value.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }) : '—'));
  hbs.registerHelper('fuelName', (type) => ({
    gasoline: 'Gasolina', gasoline_premium: 'Gasolina aditivada', ethanol: 'Etanol', mix: 'Mistura',
  }[type] ?? '—'));
  return hbs;
}

/** Item do menu destacado em cada página. */
function activePageOf(url) {
  if (url.startsWith('/painel-veiculo')) return 'vehicle';
  if (url.startsWith('/admin')) return 'admin';
  if (url.startsWith('/meus-dados/sessoes')) return 'sessoes';
  if (url.startsWith('/meus-dados')) return 'conta';
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
        imgSrc: ["'self'", 'data:', 'blob:'],
        fontSrc: ["'self'"],
        connectSrc: ["'self'"],
        manifestSrc: ["'self'"],
        workerSrc: ["'self'", 'blob:'],
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
    // O mapa pede dezenas de trechos por tela e já exige sessão válida.
    allowList: (request) => request.url.startsWith('/mapa/') || request.url.startsWith('/vendor/'),
  });

  const pageLimit = (max, timeWindow) => ({ config: { rateLimit: { max: max * config.rateLimitFactor, timeWindow } } });

  await app.register(view, {
    engine: { handlebars: createHandlebars() },
    root: SRC,
    layout: 'shared/views/layout.hbs',
    viewExt: 'hbs',
    options: {
      partials: {
        formError: 'shared/views/components/form-error.hbs',
        sidebar: 'shared/views/components/sidebar.hbs',
        pageHeader: 'shared/views/components/page-header.hbs',
        dataTable: 'shared/views/components/data-table.hbs',
        pagination: 'shared/views/components/pagination.hbs',
        confirmModal: 'shared/views/components/confirm-modal.hbs',
        passwordStrength: 'shared/views/components/password-strength.hbs',
        emptyState: 'shared/views/components/empty-state.hbs',
      },
    },
  });

  // Tudo servido daqui: nenhum CDN.
  await app.register(fastifyStatic, { root: join(SRC, 'shared/public'), prefix: '/static/', maxAge: '1h' });
  await app.register(fastifyStatic, {
    root: join(SRC, 'shared/public/assets'),
    prefix: '/assets/',
    decorateReply: false,
    maxAge: '7d',
  });
  for (const [prefix, dir, allowed] of [
    ['/vendor/maplibre/', 'node_modules/maplibre-gl/dist', ['/maplibre-gl.mjs', '/maplibre-gl-worker.mjs', '/maplibre-gl.css']],
    ['/vendor/pmtiles/', 'node_modules/pmtiles/dist', ['/pmtiles.js']],
    ['/vendor/basemaps/', 'node_modules/@protomaps/basemaps/dist', ['/basemaps.js']],
    ['/vendor/inter/', 'node_modules/@fontsource-variable/inter/files', ['/inter-latin-wght-normal.woff2', '/inter-latin-ext-wght-normal.woff2']],
  ]) {
    await app.register(fastifyStatic, {
      root: join(ROOT, dir), prefix, decorateReply: false, maxAge: '7d', allowedPath: (path) => allowed.includes(path),
    });
  }

  // Mapa próprio: só para quem tem sessão válida. A validação fica em cache curto,
  // porque cada tela pede dezenas de trechos do arquivo.
  const mapFile = join(config.mapDir, 'brasil.pmtiles');
  const hasMapData = () => existsSync(mapFile);
  const validSessions = new Map();
  if (existsSync(config.mapDir)) {
    await app.register(async (scope) => {
      scope.addHook('onRequest', async (request, reply) => {
        const token = request.cookies[cookieName];
        if (!token) return reply.code(401).send({ error: 'unauthenticated' });
        const key = createHash('sha256').update(token).digest('base64');
        if ((validSessions.get(key) ?? 0) > Date.now()) return undefined;
        try {
          await api(request, 'GET', '/internal/auth/session');
        } catch {
          return reply.code(401).send({ error: 'unauthenticated' });
        }
        if (validSessions.size > 1000) validSessions.clear();
        validSessions.set(key, Date.now() + 60000);
        return undefined;
      });
      await scope.register(fastifyStatic, {
        root: config.mapDir, prefix: '/mapa/', decorateReply: false, maxAge: '7d', acceptRanges: true, dotfiles: 'deny',
      });
    });
  }

  for (const name of MODULES_WITH_ASSETS) {
    await app.register(fastifyStatic, {
      root: join(SRC, 'modules', name, 'public'),
      prefix: `/modules/${name}/`,
      decorateReply: false,
      maxAge: '1h',
    });
  }
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
    if (!request.url.startsWith('/static/') && !request.url.startsWith('/vendor/') && !request.url.startsWith('/assets/') && !request.url.startsWith('/modules/') && !request.url.startsWith('/mapa/') && !request.url.startsWith('/meus-dados/foto')
      && !reply.hasHeader('Cache-Control')) {
      reply.header('Cache-Control', 'no-store');
    }
    if (String(reply.getHeader('content-type') ?? '').startsWith('text/html')) reply.header('Speculation-Rules', '"/speculation-rules.json"');
  });

  // ---------- Cliente da API ----------

  async function api(request, method, path, { body, token } = {}) {
    const headers = {
      'x-internal-key': config.internalKey,
      'x-client-ip': request.ip,
      'x-client-ua': String(request.headers['user-agent'] ?? '').slice(0, 200),
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
    return reply.code(status).view('shared/views/error.hbs', {
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
    if (error.code === 'FST_REQ_FILE_TOO_LARGE') return reply.redirect('/meus-dados?erro=image_too_large', 303);
    if (error instanceof ApiError) {
      if (error.status === 401) {
        clearSession(reply);
        return reply.redirect('/login');
      }
      if (error.code === 'password_change_required') return reply.redirect('/meus-dados/senha');
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
    if (session.user.mustChangePassword && !['/meus-dados/senha', '/logout', '/meus-dados/foto', '/meus-dados/personificacao/sair'].includes(request.routeOptions.url)) {
      return reply.redirect('/meus-dados/senha');
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
    flash: NOTICES[request.query?.ok],
    ...extra,
  });

  // ---------- Geral ----------

  app.get('/healthz', { config: { rateLimit: false } }, async () => ({ status: 'ok' }));
  // ---------- PWA: instalar o painel no celular ----------
  const PWA_DIR = join(SRC, 'shared/pwa');
  const MANIFEST = JSON.stringify({
    name: 'Telemetria OBD',
    short_name: 'Telemetria',
    description: 'Telemetria do seu veículo, em tempo real',
    lang: 'pt-BR',
    start_url: '/painel',
    scope: '/',
    display: 'standalone',
    background_color: '#0b0f14',
    theme_color: '#0b0f14',
    icons: [
      { src: '/assets/favicons/icon-192.png', sizes: '192x192', type: 'image/png' },
      { src: '/assets/favicons/icon-512.png', sizes: '512x512', type: 'image/png' },
      { src: '/assets/favicons/icon-512-maskable.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  });
  app.get('/manifest.webmanifest', async (_request, reply) => reply.type('application/manifest+json').header('Cache-Control', 'public, max-age=3600').send(MANIFEST));
  app.get('/sw.js', async (_request, reply) => reply.type('text/javascript; charset=utf-8').header('Cache-Control', 'no-cache').send(await readFile(join(PWA_DIR, 'sw.js'), 'utf8')));
  app.get('/offline', async (_request, reply) => reply.type('text/html; charset=utf-8').send(await readFile(join(PWA_DIR, 'offline.html'), 'utf8')));
  // Carrega a próxima página quando o mouse para no link (Chrome/Edge); os outros navegadores ignoram.
  const SPECULATION = JSON.stringify({
    prefetch: [{ where: { and: [{ href_matches: '/*' }, { not: { href_matches: ['/logout', '/mapa/*', '/*?*erro*'] } }] }, eagerness: 'moderate' }],
  });
  app.get('/speculation-rules.json', async (_request, reply) => reply.type('application/speculationrules+json').header('Cache-Control', 'public, max-age=3600').send(SPECULATION));

  app.get('/robots.txt', async (_request, reply) => reply.type('text/plain').send('User-agent: *\nDisallow: /\n'));
  app.get('/', async (request, reply) => reply.redirect(request.cookies[cookieName] ? '/painel' : '/login'));

  const shared = {
    config, api, apiBinary, hasMapData, cookieName, cookieOptions, clearSession, renderError, pageLimit, requireUser, requireAdmin, context,
  };
  gatewayRoutes(app, shared);
  loginRoutes(app, shared);
  accountRoutes(app, shared);
  devicesRoutes(app, shared);
  vehicleRoutes(app, shared);
  adminRoutes(app, shared);
  projetoRoutes(app, shared);

  return app;
}

import { ago } from '../account/user-agent.js';
import { buildHealth } from './health.js';
import { Readable } from 'node:stream';
import { ApiError, message } from '../../shared/errors.js';
import { pageParam, pagerFor } from '../../shared/pagination.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function requireUuid(request) {
  if (!UUID.test(request.params.id)) throw new ApiError(404, 'not_found');
  return request.params.id;
}

const MONTH = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit' });
const DAY = new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit' });

/**
 * Relatórios da tela do dispositivo: km/l de cada tanque (entre tanques cheios) para o gráfico e o resumo
 * dos últimos 6 meses (km das viagens enviadas, litros e gasto dos abastecimentos, km/l dos tanques fechados no mês).
 */
const MT_LABEL = { DUE: ['Vencido', 'bad', 'fa-circle-exclamation'], SOON: ['Perto de vencer', 'warn', 'fa-triangle-exclamation'], OK: ['Em dia', 'ok', 'fa-circle-check'], UNKNOWN: ['Sem registro', 'info', 'fa-circle-info'] };
const ptDate = (ms) => new Date(ms).toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' });
const ptNum = (v) => Math.round(v).toLocaleString('pt-BR');

/** Manutenção espelhada do app, pronta para a aba: texto do vencimento, selo e histórico. */
export function buildMaintenance(m) {
  return {
    ...m,
    items: m.items.map((it) => {
      const s = it.status;
      const parts = [];
      if (s.remainingKm != null) parts.push(s.remainingKm <= 0 ? `vencido há ${ptNum(-s.remainingKm)} km (era aos ${ptNum(s.nextKm)} km)` : `faltam ${ptNum(s.remainingKm)} km (aos ${ptNum(s.nextKm)} km)`);
      else if (s.nextKm != null) parts.push(`aos ${ptNum(s.nextKm)} km`);
      if (s.remainingDays != null) parts.push(s.remainingDays < 0 ? `vencido há ${-s.remainingDays} dias` : `até ${ptDate(s.nextAt)} (${s.remainingDays} dias)`);
      const [label, tone, icon] = MT_LABEL[s.level] ?? MT_LABEL.UNKNOWN;
      const last = it.records[0];
      return {
        ...it, label, tone, icon,
        when: parts.join(' · ') || 'Sem próxima troca anotada.',
        last: last ? `${ptDate(last.ts)}${last.odometerKm != null ? ' · ' + ptNum(last.odometerKm) + ' km' : ''}` : null,
        history: it.records.map((r) => ({ ...r, dateText: ptDate(r.ts) })),
        spent: it.records.reduce((sum, r) => sum + (r.cost ?? 0), 0),
      };
    }),
  };
}

export function buildReport(fuel, trips) {
  const active = fuel.items.filter((f) => !f.removedAt);
  const intervals = [...fuel.summary.intervals].reverse().slice(-12);
  const chart = {
    labels: intervals.map((i) => `${DAY.format(new Date(i.from))}–${DAY.format(new Date(i.to))}`),
    kmPerL: intervals.map((i) => Math.round(i.kmPerL * 10) / 10),
    fuel: intervals.map((i) => i.fuelType),
    avg: fuel.summary.avgKmPerL ? Math.round(fuel.summary.avgKmPerL * 10) / 10 : null,
  };
  const rows = new Map();
  const row = (key) => {
    if (!rows.has(key)) rows.set(key, { key, km: 0, liters: 0, cost: 0, tankKm: 0, tankLiters: 0, trips: 0 });
    return rows.get(key);
  };
  for (const t of trips) { const r = row(MONTH.format(new Date(t.start))); r.km += t.km; r.trips += 1; }
  for (const f of active) { const r = row(MONTH.format(new Date(f.ts))); r.liters += f.liters; r.cost += f.totalPrice ?? 0; }
  for (const i of fuel.summary.intervals) { const r = row(MONTH.format(new Date(i.to))); r.tankKm += i.km; r.tankLiters += i.liters; }
  const monthly = [...rows.values()].sort((a, b) => b.key.localeCompare(a.key)).slice(0, 6).map((r) => ({
    label: r.key.split('-').reverse().join('/'),
    km: r.km, trips: r.trips, liters: r.liters, cost: r.cost,
    kmPerL: r.tankLiters > 0 ? r.tankKm / r.tankLiters : null,
    costPerKm: r.km > 0 && r.cost > 0 ? r.cost / r.km : null,
  }));
  const priced = active.find((f) => f.totalPrice && f.liters > 0);
  return { chart, monthly, hasChart: intervals.length > 0, lastPrice: priced ? priced.totalPrice / priced.liters : null };
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

  // Indicador global "Ao vivo" (menu e barra de cima): veículos com leitura no último minuto.
  app.get('/painel/ao-vivo', { preHandler: requireUser }, async (request) => {
    const overview = await api(request, 'GET', '/internal/devices/overview');
    const live = overview.vehicles
      .filter((v) => freshness(v.latestTs ?? v.lastSeenAt).live)
      .map((v) => ({ id: v.id, name: v.name }));
    return { live };
  });

  const panelView = async (request, reply, status = 200, error = null) => {
    const query = new URLSearchParams({ page: pageParam(request) });
    const [{ devices, pagination }, overview] = await Promise.all([
      api(request, 'GET', `/internal/devices?${query}`),
      api(request, 'GET', '/internal/devices/overview'),
    ]);
    const vehicles = overview.vehicles.map((v) => ({
      ...v, status: freshness(v.latestTs ?? v.lastSeenAt), dtcCount: v.dtcs.length,
      maintenanceLabel: v.maintenanceDue ? `Manutenção: ${v.maintenanceDue} vencido${v.maintenanceDue > 1 ? 's' : ''}`
        : v.maintenanceSoon ? `Manutenção: ${v.maintenanceSoon} perto de vencer` : null,
      computerAgo: v.computer?.at ? `atualizado ${ago(v.computer.at)}` : '',
    }));
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
    const [fuel, { trips }, { faults }, healthData] = await Promise.all([
      api(request, 'GET', `/internal/devices/${data.device.id}/fuel-ups`),
      api(request, 'GET', `/internal/devices/${data.device.id}/trips`),
      api(request, 'GET', `/internal/devices/${data.device.id}/faults`),
      // A saúde é um extra: se a API ainda não a tiver (atualização em andamento), a página abre sem ela.
      api(request, 'GET', `/internal/devices/${data.device.id}/health`).catch(() => ({ days: [] })),
    ]);
    const maintenance = await api(request, 'GET', `/internal/devices/${data.device.id}/maintenance`)
      .catch(() => ({ items: [], totalCost: 0, due: 0, soon: 0, odometerKm: null }));
    const health = buildHealth(healthData.days);
    const months = Object.entries(fuel.summary.costByMonth);
    const lastMonth = months.length ? months[months.length - 1] : null;
    const report = buildReport(fuel, trips);
    // Custo da viagem pelo último preço por litro registrado (estimativa, como no app).
    const price = report.lastPrice;
    const tripsShown = trips.map((t) => ({
      ...t,
      avgSpeed: t.minutes >= 1 && t.km > 0.2 ? t.km / (t.minutes / 60) : null,
      cost: price && t.liters > 0 ? t.liters * price : null,
    }));
    return reply.view('modules/devices/views/device.hbs', context(request, {
      fuel: {
        ...fuel,
        recent: fuel.items.slice(0, 10),
        intervals: fuel.summary.intervals.slice(0, 5),
        month: lastMonth ? { label: lastMonth[0].split('-').reverse().join('/'), total: lastMonth[1] } : null,
      },
      trips: tripsShown,
      report,
      reportJson: JSON.stringify(report.chart),
      health,
      healthJson: JSON.stringify(health.chart),
      maintenance: buildMaintenance(maintenance),
      faults,
      faultsActive: faults.filter((f) => f.active).length,
      title: data.device.name,
      device: data.device,
      latestJson: JSON.stringify(data.latest),
      lastValidJson: JSON.stringify(data.lastValid ?? {}),
      limitsJson: JSON.stringify(data.device.dashLimits),
      ...DEVICE_ASSETS,
      pageScripts: ['/vendor/chartjs/chart.umd.min.js', '/static/js/chart-theme.js', '/static/js/tabs.js', '/static/js/dtc-sae.js', '/modules/devices/live.js', '/modules/devices/faults.js', '/modules/devices/reports.js', '/modules/devices/health.js', ...(data.locationAllowed ? ['/vendor/pmtiles/pmtiles.js', '/vendor/basemaps/basemaps.js'] : [])],
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

  // Leituras de uma viagem para a simulação no Painel do veículo.
  app.get('/dispositivos/:id/viagens/:viagem/leituras', { preHandler: requireUser }, async (request) => {
    const trip = String(request.params.viagem ?? '');
    if (!/^[0-9]{1,15}$/.test(trip)) throw new ApiError(400, 'invalid_request');
    return api(request, 'GET', `/internal/devices/${requireUuid(request)}/trips/${trip}/samples`);
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

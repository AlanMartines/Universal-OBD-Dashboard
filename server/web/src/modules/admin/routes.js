import { ApiError, message } from '../../shared/errors.js';
import { pageParam, pagerFor } from '../../shared/pagination.js';
import { requireUuid } from '../devices/routes.js';

/** Ações da auditoria em português claro, com ícone e cor (tom do Bootstrap). Código desconhecido aparece como veio. */
const AUDIT = {
  login: ['Login', 'fa-right-to-bracket', 'success'],
  login_recusado: ['Login recusado', 'fa-ban', 'danger'],
  codigo_2fa_recusado: ['Código 2FA recusado', 'fa-ban', 'danger'],
  '2fa_ativado': ['2FA ativada', 'fa-shield-halved', 'success'],
  '2fa_trocado': ['Aplicativo autenticador trocado', 'fa-mobile-screen-button', 'info'],
  reautenticacao: ['Senha confirmada para ação sensível', 'fa-user-shield', 'info'],
  reautenticacao_recusada: ['Confirmação de senha recusada', 'fa-user-shield', 'danger'],
  '2fa_desativado': ['2FA desativada', 'fa-shield', 'warning'],
  '2fa_admins_obrigatorio': ['2FA obrigatória para os donos de conta', 'fa-shield-halved', 'success'],
  '2fa_admins_opcional': ['2FA opcional para os donos de conta', 'fa-shield', 'warning'],
  senha_alterada: ['Senha alterada', 'fa-key', 'primary'],
  senha_redefinida: ['Senha redefinida', 'fa-key', 'primary'],
  redefinicao_pedida: ['Redefinição de senha pedida', 'fa-envelope', 'secondary'],
  troca_email_pedida: ['Troca de e-mail pedida', 'fa-envelope', 'secondary'],
  email_confirmado: ['E-mail confirmado', 'fa-envelope-circle-check', 'success'],
  sessao_encerrada: ['Sessão encerrada', 'fa-right-from-bracket', 'secondary'],
  sessoes_encerradas: ['Outras sessões encerradas', 'fa-right-from-bracket', 'secondary'],
  cadastro: ['Cadastro pelo site', 'fa-user-plus', 'primary'],
  cadastro_aberto: ['Cadastro público aberto', 'fa-lock-open', 'warning'],
  cadastro_fechado: ['Cadastro público fechado', 'fa-lock', 'secondary'],
  admin_inicial_criado: ['Super Admin inicial criado', 'fa-user-shield', 'primary'],
  usuario_criado: ['Usuário criado', 'fa-user-plus', 'primary'],
  usuario_ativado: ['Usuário ativado', 'fa-user-check', 'success'],
  usuario_desativado: ['Usuário desativado', 'fa-user-slash', 'warning'],
  usuario_excluido: ['Usuário excluído', 'fa-user-xmark', 'danger'],
  conta_excluida: ['Conta excluída', 'fa-user-xmark', 'danger'],
  personificacao_iniciada: ['Modo suporte iniciado', 'fa-user-secret', 'warning'],
  personificacao_encerrada: ['Modo suporte encerrado', 'fa-user-secret', 'secondary'],
  dispositivo_criado: ['Dispositivo criado', 'fa-mobile-screen', 'primary'],
  dispositivo_pareado: ['Dispositivo pareado', 'fa-link', 'success'],
  codigo_pareamento_gerado: ['Novo código de pareamento', 'fa-qrcode', 'primary'],
  pareamento_recusado: ['Pareamento recusado', 'fa-ban', 'danger'],
  dispositivo_revogado: ['Dispositivo revogado', 'fa-link-slash', 'warning'],
  dispositivo_excluido: ['Dispositivo excluído', 'fa-trash', 'danger'],
  mapa_pedido: ['Mapa pedido', 'fa-map', 'primary'],
  mecanico_alterado: ['Mecânico alterado', 'fa-screwdriver-wrench', 'primary'],
  link_oficina_criado: ['Link da oficina criado', 'fa-link', 'warning'],
  link_oficina_cancelado: ['Link da oficina cancelado', 'fa-link-slash', 'secondary'],
  link_oficina_aberto: ['Link da oficina aberto', 'fa-screwdriver-wrench', 'info'],
  mapa_excluido: ['Mapa excluído', 'fa-map', 'warning'],
};
const auditView = (row) => {
  const [label, icon, tone] = AUDIT[row.action] ?? [row.action, 'fa-circle-info', 'secondary'];
  return { ...row, label, icon, tone };
};

/** Tamanho legível (1,2 GB; 840 MB). */
export function tamanho(bytes) {
  if (!Number.isFinite(bytes) || bytes <= 0) return null;
  const un = ['B', 'KB', 'MB', 'GB', 'TB'];
  let v = bytes;
  let i = 0;
  while (v >= 1024 && i < un.length - 1) { v /= 1024; i += 1; }
  return `${v.toLocaleString('pt-BR', { maximumFractionDigits: v < 10 && i > 0 ? 1 : 0 })} ${un[i]}`;
}

const MAPAS = ['base', 'encaixe'];

/**
 * Campos do mecânico vindos do formulário: veículos marcados (um ou vários) e prazo em dias.
 * Na edição, "manter" não muda o prazo e vazio tira o prazo; na criação, vazio é sem prazo.
 */
export function mechanicFields(body, editing) {
  const raw = body.deviceIds;
  const deviceIds = (Array.isArray(raw) ? raw : raw ? [raw] : []).map(String);
  const out = { deviceIds };
  const days = String(body.accessDays ?? '');
  if (/^\d{1,3}$/.test(days)) out.accessDays = Number(days);
  else if (editing && days === '') out.accessDays = null;
  return out;
}

export default function adminRoutes(app, {
  api, cookieName, cookieOptions, requireAdmin, context,
}) {
  const adminView = async (request, reply, status = 200, extra = {}) => {
    const query = new URLSearchParams({ usersPage: pageParam(request, 'usuarios'), auditPage: pageParam(request, 'auditoria') });
    const data = await api(request, 'GET', `/internal/admin/overview?${query}`);
    const isSuper = request.user.role === 'superadmin';
    // Dono da conta: os veículos pareados e ativos, para marcar no mecânico.
    const ownDevices = isSuper ? [] : (await api(request, 'GET', '/internal/devices?pageSize=100')).devices
      .filter((d) => d.pairedAt && !d.revokedAt).map((d) => ({ id: d.id, name: d.name }));
    const mechanics = isSuper ? [] : (data.users ?? []).filter((u) => u.role === 'mechanic').map((u) => {
      const marked = new Set((u.mechanic_devices ?? []).map((d) => d.id));
      return {
        id: u.id, username: u.username, access_until: u.access_until,
        expired: Boolean(u.access_until) && new Date(u.access_until).getTime() <= Date.now(),
        devices: ownDevices.map((d) => ({ ...d, checked: marked.has(d.id) })),
      };
    });
    return reply.code(status).view('modules/admin/views/admin.hbs', context(request, {
      title: isSuper ? 'Configurações' : 'Usuários', isSuper, ownDevices, mechanics,
      pageScripts: ['/modules/admin/admin.js'],
      pageCss: ['/modules/admin/admin.css'],
      usersPager: pagerFor(data.usersPagination, request, { path: '/admin', param: 'usuarios' }),
      auditPager: pagerFor(data.auditPagination, request, { path: '/admin', param: 'auditoria' }),
      ...data,
      audit: (data.audit ?? []).map(auditView),
      ...extra,
    }));
  };

  app.get('/admin', { preHandler: requireAdmin }, async (request, reply) => adminView(request, reply));

  app.post('/admin/cadastro', { preHandler: requireAdmin }, async (request, reply) => {
    await api(request, 'POST', '/internal/admin/signup', { body: { open: request.body?.open === 'true' } });
    return reply.redirect('/admin?ok=signup_updated', 303);
  });

  app.post('/admin/2fa-donos', { preHandler: requireAdmin }, async (request, reply) => {
    await api(request, 'POST', '/internal/admin/mfa-admins', { body: { required: request.body?.required === 'true' } });
    return reply.redirect('/admin?ok=mfa_admins_updated', 303);
  });

  app.post('/admin/usuarios', { preHandler: requireAdmin }, async (request, reply) => {
    try {
      const created = await api(request, 'POST', '/internal/admin/users', {
        body: {
          username: String(request.body?.username ?? ''),
          role: ['superadmin', 'admin', 'mechanic'].includes(request.body?.role) ? request.body.role : 'user',
          ...(request.body?.accountId ? { accountId: String(request.body.accountId) } : {}),
          ...(request.body?.role === 'mechanic' ? mechanicFields(request.body, false) : {}),
        },
      });
      return adminView(request, reply, 200, { created });
    } catch (error) {
      if (!(error instanceof ApiError) || error.status >= 500 || error.status === 401 || error.code === 'reauth_required') throw error;
      return adminView(request, reply, error.status, { error: message(error.code) });
    }
  });

  app.post('/admin/usuarios/:id/mecanico', { preHandler: requireAdmin }, async (request, reply) => {
    try {
      await api(request, 'POST', `/internal/admin/users/${requireUuid(request)}/mechanic`, { body: mechanicFields(request.body ?? {}, true) });
      return reply.redirect('/admin?ok=mechanic_updated', 303);
    } catch (error) {
      if (!(error instanceof ApiError) || error.status >= 500 || error.status === 401 || error.code === 'reauth_required') throw error;
      return adminView(request, reply, error.status, { error: message(error.code) });
    }
  });

  app.post('/admin/usuarios/:id/status', { preHandler: requireAdmin }, async (request, reply) => {
    await api(request, 'POST', `/internal/admin/users/${requireUuid(request)}/disabled`, { body: { disabled: request.body?.disabled === 'true' } });
    return reply.redirect('/admin?ok=user_updated', 303);
  });

  app.post('/admin/usuarios/:id/personificar', { preHandler: requireAdmin }, async (request, reply) => {
    const { token } = await api(request, 'POST', `/internal/admin/users/${requireUuid(request)}/impersonate`);
    reply.setCookie(cookieName, token, cookieOptions);
    return reply.redirect('/painel', 303);
  });

  // ---------- Mapas (só Super Admin: a API recusa os demais) ----------
  const mapasView = async (request, reply, status = 200, extra = {}) => {
    let estado = null;
    let indisponivel = null;
    try {
      estado = await api(request, 'GET', '/internal/admin/maps');
    } catch (error) {
      if (!(error instanceof ApiError) || error.status === 401 || error.status === 403 || error.code === 'reauth_required') throw error;
      indisponivel = message(error.code);
    }
    const mapa = (m) => (m?.instalado ? { ...m, tamanho: tamanho(m.bytes), memoriaTxt: tamanho(m.memoria) } : m);
    return reply.code(status).view('modules/admin/views/mapas.hbs', context(request, {
      title: 'Mapas',
      pageScripts: ['/modules/admin/mapas.js'],
      pageCss: ['/modules/admin/admin.css'],
      estado: estado ? {
        ...estado,
        base: mapa(estado.base),
        encaixe: mapa(estado.encaixe),
        discoMapas: tamanho(estado.disco?.mapas),
        discoEncaixe: tamanho(estado.disco?.encaixe),
      } : null,
      indisponivel,
      ...extra,
    }));
  };

  app.get('/admin/mapas', { preHandler: requireAdmin }, async (request, reply) => mapasView(request, reply));
  app.get('/admin/mapas/estado.json', { preHandler: requireAdmin }, async (request) => api(request, 'GET', '/internal/admin/maps'));
  app.get('/admin/mapas/catalogo.json', { preHandler: requireAdmin }, async (request) => api(request, 'GET', '/internal/admin/maps/catalog'));
  app.get('/admin/mapas/tamanho.json', { preHandler: requireAdmin }, async (request) => {
    const area = String(request.query?.area ?? '');
    const dados = await api(request, 'GET', `/internal/admin/maps/size?${new URLSearchParams({ area })}`);
    return {
      ...dados, pbfTxt: tamanho(dados.bytesPbf), memoriaTxt: tamanho(dados.memoriaEncaixe), discoTxt: tamanho(dados.discoEncaixe),
      baseTxt: tamanho(dados.bytesBase), estadoTxt: tamanho(dados.bytesEstado),
    };
  });

  app.post('/admin/mapas/baixar', { preHandler: requireAdmin }, async (request, reply) => {
    const map = MAPAS.includes(request.body?.map) ? request.body.map : 'base';
    try {
      await api(request, 'POST', '/internal/admin/maps', { body: { map, area: String(request.body?.area ?? '') } });
      return reply.redirect('/admin/mapas?ok=map_started', 303);
    } catch (error) {
      if (!(error instanceof ApiError) || error.status === 401 || error.code === 'reauth_required') throw error;
      return mapasView(request, reply, error.status >= 500 ? 503 : error.status, { error: message(error.code) });
    }
  });

  app.post('/admin/mapas/excluir', { preHandler: requireAdmin }, async (request, reply) => {
    const map = MAPAS.includes(request.body?.map) ? request.body.map : null;
    if (!map) return mapasView(request, reply, 400, { error: message('invalid_request') });
    try {
      await api(request, 'DELETE', `/internal/admin/maps/${map}`);
      return reply.redirect('/admin/mapas?ok=map_deleted', 303);
    } catch (error) {
      if (!(error instanceof ApiError) || error.status === 401 || error.code === 'reauth_required') throw error;
      return mapasView(request, reply, error.status >= 500 ? 503 : error.status, { error: message(error.code) });
    }
  });

  app.post('/admin/usuarios/:id/excluir', { preHandler: requireAdmin }, async (request, reply) => {
    await api(request, 'POST', `/internal/admin/users/${requireUuid(request)}/delete`);
    return reply.redirect('/admin?ok=user_deleted', 303);
  });
}

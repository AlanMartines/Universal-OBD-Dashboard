import { ApiError, message } from '../errors.js';
import { requireUuid } from './devices.js';

export default function adminRoutes(app, { api, requireAdmin, context }) {
  const adminView = async (request, reply, status = 200, extra = {}) => {
    const data = await api(request, 'GET', '/internal/admin/overview');
    const isSuper = request.user.role === 'superadmin';
    return reply.code(status).view('admin.hbs', context(request, {
      title: isSuper ? 'Administração' : 'Usuários', isSuper, adminScript: isSuper, ...data, ...extra,
    }));
  };

  app.get('/admin', { preHandler: requireAdmin }, async (request, reply) => adminView(request, reply));

  app.post('/admin/cadastro', { preHandler: requireAdmin }, async (request, reply) => {
    await api(request, 'POST', '/internal/admin/signup', { body: { open: request.body?.open === 'true' } });
    return reply.redirect('/admin', 303);
  });

  app.post('/admin/usuarios', { preHandler: requireAdmin }, async (request, reply) => {
    try {
      const created = await api(request, 'POST', '/internal/admin/users', {
        body: {
          username: String(request.body?.username ?? ''),
          role: ['superadmin', 'admin'].includes(request.body?.role) ? request.body.role : 'user',
          ...(request.body?.accountId ? { accountId: String(request.body.accountId) } : {}),
        },
      });
      return adminView(request, reply, 200, { created });
    } catch (error) {
      if (!(error instanceof ApiError) || error.status >= 500 || error.status === 401) throw error;
      return adminView(request, reply, error.status, { error: message(error.code) });
    }
  });

  app.post('/admin/usuarios/:id/status', { preHandler: requireAdmin }, async (request, reply) => {
    await api(request, 'POST', `/internal/admin/users/${requireUuid(request)}/disabled`, { body: { disabled: request.body?.disabled === 'true' } });
    return reply.redirect('/admin', 303);
  });

  app.post('/admin/usuarios/:id/excluir', { preHandler: requireAdmin }, async (request, reply) => {
    await api(request, 'POST', `/internal/admin/users/${requireUuid(request)}/delete`);
    return reply.redirect('/admin', 303);
  });
}

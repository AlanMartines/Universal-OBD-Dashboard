import { ApiError, message } from '../errors.js';

export default function accountRoutes(app, { api, clearSession, requireUser, context }) {
  const passwordView = (request, reply, status = 200, error = null) => reply.code(status).view('password.hbs', context(request, {
    title: 'Trocar senha',
    error,
    required: request.user.mustChangePassword,
  }));

  app.get('/conta/senha', { preHandler: requireUser }, async (request, reply) => passwordView(request, reply));

  app.post('/conta/senha', { preHandler: requireUser }, async (request, reply) => {
    const { currentPassword, newPassword, confirm } = request.body ?? {};
    if (newPassword !== confirm) return passwordView(request, reply, 400, message('password_mismatch'));
    try {
      await api(request, 'POST', '/internal/auth/password', {
        body: { currentPassword: String(currentPassword ?? ''), newPassword: String(newPassword ?? '') },
      });
      return reply.redirect('/painel', 303);
    } catch (error) {
      if (!(error instanceof ApiError) || error.status >= 500) throw error;
      return passwordView(request, reply, error.status, message(error.code));
    }
  });

  app.get('/conta', { preHandler: requireUser }, async (request, reply) => reply.view('account.hbs', context(request, { title: 'Minha conta' })));

  app.post('/conta/excluir', { preHandler: requireUser }, async (request, reply) => {
    try {
      await api(request, 'POST', '/internal/account/delete', { body: { password: String(request.body?.password ?? '') } });
      clearSession(reply);
      return reply.redirect('/login', 303);
    } catch (error) {
      if (!(error instanceof ApiError) || error.status >= 500 || error.status === 401) throw error;
      return reply.code(error.status).view('account.hbs', context(request, { title: 'Minha conta', error: message(error.code) }));
    }
  });
}

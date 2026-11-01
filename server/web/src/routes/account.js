import { ApiError, message } from '../errors.js';

export default function accountRoutes(app, { api, apiBinary, clearSession, requireUser, context }) {
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

  const accountView = async (request, reply, status = 200, extra = {}) => {
    const account = await api(request, 'GET', '/internal/account');
    return reply.code(status).view('account.hbs', context(request, {
      title: 'Meus Dados', account, accountScript: true, ...extra,
    }));
  };
  const clientError = (error) => error instanceof ApiError && error.status < 500 && error.status !== 401 && error.code !== 'password_change_required';

  // Avisos só de uma lista fechada: o texto nunca vem da URL.
  const NOTICES = { email: 'Se o endereço puder ser usado, enviamos um link de confirmação para ele.' };
  const REDIRECT_ERRORS = ['image_too_large'];

  app.get('/conta', { preHandler: requireUser }, async (request, reply) => accountView(request, reply, 200, {
    notice: NOTICES[request.query.aviso],
    error: REDIRECT_ERRORS.includes(request.query.erro) ? message(request.query.erro) : undefined,
  }));

  app.post('/conta/perfil', { preHandler: requireUser }, async (request, reply) => {
    try {
      await api(request, 'POST', '/internal/account/profile', { body: { displayName: String(request.body?.displayName ?? '') } });
      return reply.redirect('/conta', 303);
    } catch (error) {
      if (!clientError(error)) throw error;
      return accountView(request, reply, error.status, { error: message(error.code) });
    }
  });

  app.post('/conta/email', { preHandler: requireUser }, async (request, reply) => {
    const { newEmail, confirmEmail, currentPassword } = request.body ?? {};
    if (String(newEmail ?? '').trim().toLowerCase() !== String(confirmEmail ?? '').trim().toLowerCase()) {
      return accountView(request, reply, 400, { error: message('email_mismatch') });
    }
    try {
      await api(request, 'POST', '/internal/account/email', {
        body: { newEmail: String(newEmail ?? ''), currentPassword: String(currentPassword ?? '') },
      });
      return reply.redirect('/conta?aviso=email', 303);
    } catch (error) {
      if (!clientError(error) && error.code !== 'mail_unavailable') throw error;
      return accountView(request, reply, error.status, { error: message(error.code) });
    }
  });

  // Abrir o link não altera nada: leitores de e-mail costumam abrir links sozinhos.
  app.get('/conta/email/confirmar', { logLevel: 'warn' }, async (request, reply) => {
    const token = String(request.query.token ?? '');
    return reply.view('confirm-email.hbs', {
      title: 'Confirmar e-mail',
      token,
      error: token ? null : message('email_link_invalid'),
    });
  });

  app.post('/conta/email/confirmar', { logLevel: 'warn' }, async (request, reply) => {
    try {
      await api(request, 'POST', '/internal/account/email/confirm', { body: { token: String(request.body?.token ?? '') } });
      return reply.view('confirm-email.hbs', { title: 'E-mail confirmado', confirmed: true });
    } catch (error) {
      if (!(error instanceof ApiError) || error.status >= 500) throw error;
      const code = error.status === 429 ? 'too_many_requests' : 'email_link_invalid';
      return reply.code(error.status).view('confirm-email.hbs', { title: 'Confirmar e-mail', error: message(code) });
    }
  });

  app.get('/conta/foto', { preHandler: requireUser }, async (request, reply) => {
    const image = await apiBinary(request, '/internal/account/avatar');
    reply.header('Cache-Control', 'private, max-age=86400');
    return reply.type('image/webp').send(image);
  });

  app.post('/conta/foto', { preHandler: requireUser, bodyLimit: 6 * 1024 * 1024 }, async (request, reply) => {
    const file = request.body?.avatar;
    if (!Buffer.isBuffer(file) || !file.length) {
      return accountView(request, reply, 400, { error: message('image_invalid') });
    }
    try {
      await api(request, 'POST', '/internal/account/avatar', { body: { imageBase64: file.toString('base64') } });
      return reply.redirect('/conta', 303);
    } catch (error) {
      if (!clientError(error)) throw error;
      return accountView(request, reply, error.status, { error: message(error.code) });
    }
  });

  app.post('/conta/foto/remover', { preHandler: requireUser }, async (request, reply) => {
    await api(request, 'POST', '/internal/account/avatar/delete');
    return reply.redirect('/conta', 303);
  });

  app.post('/conta/excluir', { preHandler: requireUser }, async (request, reply) => {
    try {
      await api(request, 'POST', '/internal/account/delete', { body: { password: String(request.body?.password ?? '') } });
      clearSession(reply);
      return reply.redirect('/login', 303);
    } catch (error) {
      if (!(error instanceof ApiError) || error.status >= 500 || error.status === 401) throw error;
      return accountView(request, reply, error.status, { error: message(error.code) });
    }
  });
}

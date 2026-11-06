import { ago, describeAgent } from './user-agent.js';
import QRCode from 'qrcode';
import { ApiError, message } from '../../shared/errors.js';
import { requireUuid } from '../devices/routes.js';

export default function accountRoutes(app, {
  api, apiBinary, cookieName, cookieOptions, clearSession, requireUser, context,
}) {
  const passwordView = (request, reply, status = 200, error = null) => reply.code(status).view('modules/account/views/password.hbs', context(request, {
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
      return reply.redirect('/painel?ok=password_saved', 303);
    } catch (error) {
      if (!(error instanceof ApiError) || error.status >= 500) throw error;
      return passwordView(request, reply, error.status, message(error.code));
    }
  });

  const accountView = async (request, reply, status = 200, extra = {}) => {
    const account = await api(request, 'GET', '/internal/account');
    return reply.code(status).view('modules/account/views/account.hbs', context(request, {
      title: 'Meus Dados', account, pageCss: ['/modules/account/account.css'], pageScripts: ['/modules/account/account.js'], ...extra,
    }));
  };
  const clientError = (error) => error instanceof ApiError && error.status < 500 && error.status !== 401 && error.code !== 'password_change_required';

  const REDIRECT_ERRORS = ['image_too_large'];

  app.get('/conta', { preHandler: requireUser }, async (request, reply) => accountView(request, reply, 200, {
    error: REDIRECT_ERRORS.includes(request.query.erro) ? message(request.query.erro) : undefined,
  }));

  app.post('/conta/perfil', { preHandler: requireUser }, async (request, reply) => {
    try {
      await api(request, 'POST', '/internal/account/profile', { body: { displayName: String(request.body?.displayName ?? '') } });
      return reply.redirect('/conta?ok=profile_saved', 303);
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
      return reply.redirect('/conta?ok=email_sent', 303);
    } catch (error) {
      if (!clientError(error) && error.code !== 'mail_unavailable') throw error;
      return accountView(request, reply, error.status, { error: message(error.code) });
    }
  });

  // Abrir o link não altera nada: leitores de e-mail costumam abrir links sozinhos.
  app.get('/conta/email/confirmar', { logLevel: 'warn' }, async (request, reply) => {
    const token = String(request.query.token ?? '');
    return reply.view('modules/account/views/confirm-email.hbs', {
      title: 'Confirmar e-mail',
      token,
      error: token ? null : message('email_link_invalid'),
    });
  });

  app.post('/conta/email/confirmar', { logLevel: 'warn' }, async (request, reply) => {
    try {
      await api(request, 'POST', '/internal/account/email/confirm', { body: { token: String(request.body?.token ?? '') } });
      return reply.view('modules/account/views/confirm-email.hbs', { title: 'E-mail confirmado', confirmed: true });
    } catch (error) {
      if (!(error instanceof ApiError) || error.status >= 500) throw error;
      const code = error.status === 429 ? 'too_many_requests' : 'email_link_invalid';
      return reply.code(error.status).view('modules/account/views/confirm-email.hbs', { title: 'Confirmar e-mail', error: message(code) });
    }
  });

  // ---------- Dois fatores ----------

  const setupView = async (request, reply, status = 200, error = null) => {
    const { secret, uri } = await api(request, 'GET', '/internal/account/mfa/pending');
    return reply.code(status).view('modules/account/views/mfa-setup.hbs', context(request, {
      title: 'Verificação em duas etapas', secret, qr: await QRCode.toDataURL(uri, { width: 220, margin: 1 }), error, pageCss: ['/modules/account/account.css'],
    }));
  };

  app.get('/conta/2fa', { preHandler: requireUser }, async (request, reply) => setupView(request, reply));

  app.post('/conta/2fa/iniciar', { preHandler: requireUser }, async (request, reply) => {
    try {
      await api(request, 'POST', '/internal/account/mfa/setup', { body: { currentPassword: String(request.body?.currentPassword ?? '') } });
      return reply.redirect('/conta/2fa', 303);
    } catch (error) {
      if (!clientError(error)) throw error;
      return accountView(request, reply, error.status, { error: message(error.code) });
    }
  });

  app.post('/conta/2fa/ativar', { preHandler: requireUser }, async (request, reply) => {
    try {
      const { recoveryCodes } = await api(request, 'POST', '/internal/account/mfa/enable', { body: { code: String(request.body?.code ?? '').trim() } });
      return reply.view('modules/account/views/mfa-codes.hbs', context(request, { title: 'Códigos de recuperação', codes: recoveryCodes, pageCss: ['/modules/account/account.css'] }));
    } catch (error) {
      if (!clientError(error)) throw error;
      return setupView(request, reply, error.status, message(error.code === 'invalid_request' ? 'mfa_code_invalid' : error.code));
    }
  });

  app.post('/conta/2fa/desativar', { preHandler: requireUser }, async (request, reply) => {
    try {
      await api(request, 'POST', '/internal/account/mfa/disable', {
        body: { currentPassword: String(request.body?.currentPassword ?? ''), code: String(request.body?.code ?? '').trim() },
      });
      return reply.redirect('/conta?ok=mfa_disabled', 303);
    } catch (error) {
      if (!clientError(error)) throw error;
      return accountView(request, reply, error.status, { error: message(error.code === 'invalid_request' ? 'mfa_code_invalid' : error.code) });
    }
  });

  // ---------- Sessões ativas ----------

  app.get('/conta/sessoes', { preHandler: requireUser }, async (request, reply) => {
    const { sessions } = await api(request, 'GET', '/internal/account/sessions');
    const shown = sessions.map((sess) => ({ ...sess, device: describeAgent(sess.user_agent), activeAgo: ago(sess.last_seen_at) }));
    return reply.view('modules/account/views/sessions.hbs', context(request, { title: 'Sessões ativas', sessions: shown, hasOthers: shown.some((x) => !x.current), pageCss: ['/modules/account/account.css'] }));
  });

  app.post('/conta/sessoes/encerrar-outras', { preHandler: requireUser }, async (request, reply) => {
    await api(request, 'POST', '/internal/account/sessions/revoke-others');
    return reply.redirect('/conta/sessoes?ok=sessions_revoked', 303);
  });

  app.post('/conta/sessoes/:id/encerrar', { preHandler: requireUser }, async (request, reply) => {
    await api(request, 'POST', `/internal/account/sessions/${requireUuid(request)}/revoke`);
    return reply.redirect('/conta/sessoes?ok=session_revoked', 303);
  });

  // ---------- Fim da personificação ----------

  app.post('/conta/personificacao/sair', { preHandler: requireUser }, async (request, reply) => {
    const { token } = await api(request, 'POST', '/internal/auth/impersonate/stop');
    reply.setCookie(cookieName, token, cookieOptions);
    return reply.redirect('/admin', 303);
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
      return reply.redirect('/conta?ok=photo_saved', 303);
    } catch (error) {
      if (!clientError(error)) throw error;
      return accountView(request, reply, error.status, { error: message(error.code) });
    }
  });

  app.post('/conta/foto/remover', { preHandler: requireUser }, async (request, reply) => {
    await api(request, 'POST', '/internal/account/avatar/delete');
    return reply.redirect('/conta?ok=photo_removed', 303);
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

import { ApiError, message, NOTICES } from '../../shared/errors.js';
import { checkFormToken, issueFormToken } from '../../shared/protection.js';

const SIGNUP_MIN_MS = 3000;

export default function loginRoutes(app, { config, api, cookieName, cookieOptions, clearSession, renderError, pageLimit, requireUser }) {
  const MFA_COOKIE = 'obd_mfa';
  const mfaCookieOptions = { path: '/login', httpOnly: true, secure: config.cookieSecure, sameSite: 'lax', maxAge: 300 };

  // Campo invisível para pessoas: quem preenche é robô.
  const isBot = (body) => Boolean(body?.website);

  const loginView = async (request, reply, status = 200, error = null) => {
    const { open } = await api(request, 'GET', '/internal/signup');
    return reply.code(status).view('modules/login/views/login.hbs', {
      title: 'Entrar',
      error,
      flash: NOTICES[request.query?.ok],
      signupOpen: open,
      formToken: issueFormToken(config.formSecret, 'login'),
    });
  };

  app.get('/login', async (request, reply) => {
    if (request.cookies[cookieName]) return reply.redirect('/painel');
    return loginView(request, reply);
  });

  app.post('/login', pageLimit(20, '1 minute'), async (request, reply) => {
    const { username, password, formToken } = request.body ?? {};
    if (isBot(request.body) || !checkFormToken(config.formSecret, 'login', formToken)) {
      return loginView(request, reply, 400, message('invalid_credentials'));
    }
    try {
      const result = await api(request, 'POST', '/internal/auth/login', {
        body: { username: String(username ?? ''), password: String(password ?? '') },
      });
      if (result.mfaRequired) {
        reply.setCookie(MFA_COOKIE, result.mfaToken, mfaCookieOptions);
        return reply.redirect('/login/verificacao', 303);
      }
      reply.setCookie(cookieName, result.token, cookieOptions);
      return reply.redirect('/painel', 303);
    } catch (error) {
      if (!(error instanceof ApiError) || error.status >= 500) throw error;
      const code = error.status === 429 ? 'too_many_requests' : 'invalid_credentials';
      return loginView(request, reply, error.status === 429 ? 429 : 401, message(code));
    }
  });

  const mfaView = (reply, status = 200, error = null) => reply.code(status).view('modules/login/views/mfa.hbs', { title: 'Verificação', error });

  app.get('/login/verificacao', async (request, reply) => {
    if (!request.cookies[MFA_COOKIE]) return reply.redirect('/login');
    return mfaView(reply);
  });

  app.post('/login/verificacao', pageLimit(20, '1 minute'), async (request, reply) => {
    const mfaToken = request.cookies[MFA_COOKIE];
    if (!mfaToken) return reply.redirect('/login', 303);
    try {
      const { token } = await api(request, 'POST', '/internal/auth/mfa', {
        body: { mfaToken, code: String(request.body?.code ?? '').trim() },
      });
      reply.clearCookie(MFA_COOKIE, mfaCookieOptions);
      reply.setCookie(cookieName, token, cookieOptions);
      return reply.redirect('/painel', 303);
    } catch (error) {
      if (!(error instanceof ApiError) || error.status >= 500) throw error;
      if (error.code === 'mfa_expired') {
        reply.clearCookie(MFA_COOKIE, mfaCookieOptions);
        return loginView(request, reply, 401, message('mfa_expired'));
      }
      return mfaView(reply, error.status === 429 ? 429 : 401, message(error.status === 429 ? 'too_many_requests' : 'invalid_request' === error.code ? 'mfa_code_invalid' : error.code));
    }
  });

  // ---------- Esqueci a senha ----------

  const forgotView = (reply, extra = {}) => reply.view('modules/login/views/forgot.hbs', {
    title: 'Esqueci minha senha',
    formToken: issueFormToken(config.formSecret, 'forgot'),
    ...extra,
  });

  app.get('/esqueci-senha', async (_request, reply) => forgotView(reply));

  app.post('/esqueci-senha', pageLimit(10, '1 hour'), async (request, reply) => {
    const { email, formToken } = request.body ?? {};
    // Robô recebe a mesma tela de sucesso, sem saber o que falhou.
    if (isBot(request.body)) return forgotView(reply, { sent: true });
    if (!checkFormToken(config.formSecret, 'forgot', formToken)) return forgotView(reply, { error: message('bad_form') });
    try {
      await api(request, 'POST', '/internal/auth/forgot', { body: { email: String(email ?? '') } });
    } catch (error) {
      if (!(error instanceof ApiError) || error.status >= 500) throw error;
      if (error.status === 429) return forgotView(reply, { error: message('too_many_requests') });
    }
    return forgotView(reply, { sent: true });
  });

  const resetView = (reply, token, status = 200, error = null) => reply.code(status).view('modules/login/views/reset.hbs', {
    title: 'Criar nova senha', token, error,
  });

  // O token vem na URL: esta rota fica fora dos logs comuns.
  app.get('/redefinir-senha', { logLevel: 'warn' }, async (request, reply) => {
    const token = String(request.query.token ?? '');
    return resetView(reply, token, 200, token ? null : message('reset_link_invalid'));
  });

  app.post('/redefinir-senha', { logLevel: 'warn', ...pageLimit(20, '1 hour') }, async (request, reply) => {
    const { token, newPassword, confirm } = request.body ?? {};
    if (newPassword !== confirm) return resetView(reply, String(token ?? ''), 400, message('password_mismatch'));
    try {
      await api(request, 'POST', '/internal/auth/reset', { body: { token: String(token ?? ''), newPassword: String(newPassword ?? '') } });
      clearSession(reply);
      return reply.redirect('/login?ok=password_reset', 303);
    } catch (error) {
      if (!(error instanceof ApiError) || error.status >= 500) throw error;
      const dead = error.code === 'reset_link_invalid' || error.code === 'invalid_request';
      return resetView(reply, dead ? '' : String(token ?? ''), error.status, message(dead ? 'reset_link_invalid' : error.code));
    }
  });

  const registerView = (reply, status = 200, error = null) => reply.code(status).view('modules/login/views/register.hbs', {
    title: 'Criar conta',
    error,
    formToken: issueFormToken(config.formSecret, 'register'),
  });

  app.get('/cadastro', async (request, reply) => {
    const { open } = await api(request, 'GET', '/internal/signup');
    if (!open) return renderError(reply, 403, 'signup_closed');
    return registerView(reply);
  });

  app.post('/cadastro', pageLimit(10, '1 hour'), async (request, reply) => {
    const { username, password, confirm, formToken } = request.body ?? {};
    // Robô recebe a mesma tela de sempre, sem saber qual verificação falhou.
    if (isBot(request.body) || !checkFormToken(config.formSecret, 'register', formToken, SIGNUP_MIN_MS)) {
      return registerView(reply, 400, message('bad_form'));
    }
    if (password !== confirm) return registerView(reply, 400, message('password_mismatch'));
    try {
      const { token } = await api(request, 'POST', '/internal/auth/register', {
        body: { username: String(username ?? ''), password: String(password ?? '') },
      });
      reply.setCookie(cookieName, token, cookieOptions);
      return reply.redirect('/painel', 303);
    } catch (error) {
      if (!(error instanceof ApiError) || error.status >= 500) throw error;
      return registerView(reply, error.status, message(error.code));
    }
  });

  app.post('/logout', { preHandler: requireUser }, async (request, reply) => {
    await api(request, 'POST', '/internal/auth/logout');
    clearSession(reply);
    return reply.redirect('/login', 303);
  });
}

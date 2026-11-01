import { ApiError, message } from '../../shared/errors.js';
import { checkFormToken, issueFormToken } from '../../shared/protection.js';

const SIGNUP_MIN_MS = 3000;

export default function loginRoutes(app, { config, api, cookieName, cookieOptions, clearSession, renderError, pageLimit, requireUser }) {
  // Campo invisível para pessoas: quem preenche é robô.
  const isBot = (body) => Boolean(body?.website);

  const loginView = async (request, reply, status = 200, error = null) => {
    const { open } = await api(request, 'GET', '/internal/signup');
    return reply.code(status).view('modules/login/views/login.hbs', {
      title: 'Entrar',
      error,
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
      const { token } = await api(request, 'POST', '/internal/auth/login', {
        body: { username: String(username ?? ''), password: String(password ?? '') },
      });
      reply.setCookie(cookieName, token, cookieOptions);
      return reply.redirect('/painel', 303);
    } catch (error) {
      if (!(error instanceof ApiError) || error.status >= 500) throw error;
      const code = error.status === 429 ? 'too_many_requests' : 'invalid_credentials';
      return loginView(request, reply, error.status === 429 ? 429 : 401, message(code));
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

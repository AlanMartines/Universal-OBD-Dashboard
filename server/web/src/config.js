const PLACEHOLDER = /troque|change.?me|exemplo|example/i;

function secret(env, name) {
  const value = env[name];
  if (!value || value.length < 32 || PLACEHOLDER.test(value)) {
    throw new Error(`${name} precisa ser um segredo próprio, com pelo menos 32 caracteres`);
  }
  return value;
}

export function loadConfig(env = process.env) {
  if (!env.APP_URL) throw new Error('Variável obrigatória ausente: APP_URL');
  const publicOrigin = new URL(env.APP_URL).origin;
  const insecureAllowed = env.ALLOW_INSECURE_COOKIE === 'true';
  if (!publicOrigin.startsWith('https://') && !insecureAllowed) {
    throw new Error('APP_URL precisa usar https://');
  }
  return {
    port: Number(env.WEB_PORT || 28471),
    host: env.WEB_HOST || '0.0.0.0',
    apiUrl: env.API_URL || 'http://api:28472',
    publicOrigin,
    cookieSecure: !insecureAllowed,
    internalKey: secret(env, 'INTERNAL_API_KEY'),
    formSecret: secret(env, 'FORM_SECRET'),
    trustProxy: env.TRUST_PROXY || '10.0.0.0/8,172.16.0.0/12,192.168.0.0/16,127.0.0.1/32',
    logLevel: env.LOG_LEVEL || 'info',
    sessionMaxDays: Number(env.SESSION_MAX_DAYS || 7),
    rateLimitFactor: Number(env.RATE_LIMIT_FACTOR || 1),
  };
}

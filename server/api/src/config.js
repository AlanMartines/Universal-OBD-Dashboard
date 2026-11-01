const PLACEHOLDER = /troque|change.?me|exemplo|example/i;

function required(env, name) {
  const value = env[name];
  if (!value) throw new Error(`Variável obrigatória ausente: ${name}`);
  return value;
}

function secret(env, name) {
  const value = required(env, name);
  if (value.length < 32 || PLACEHOLDER.test(value)) {
    throw new Error(`${name} precisa ser um segredo próprio, com pelo menos 32 caracteres`);
  }
  return value;
}

function integer(env, name, fallback, min, max) {
  const raw = env[name];
  if (raw === undefined || raw === '') return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new Error(`${name} precisa ser um inteiro entre ${min} e ${max}`);
  }
  return value;
}

/** Lê e valida o ambiente. Falta de segredo interrompe a subida, sem valor padrão inseguro. */
export function loadConfig(env = process.env) {
  return {
    appUrl: (env.APP_URL || '').replace(/\/+$/, ''),
    port: integer(env, 'API_PORT', 28472, 1, 65535),
    host: env.API_HOST || '0.0.0.0',
    databaseUrl: required(env, 'DATABASE_URL'),
    internalKey: secret(env, 'INTERNAL_API_KEY'),
    totpKey: secret(env, 'TOTP_ENCRYPTION_KEY'),
    trustProxy: env.TRUST_PROXY || '10.0.0.0/8,172.16.0.0/12,192.168.0.0/16,127.0.0.1/32',
    logLevel: env.LOG_LEVEL || 'info',
    signupDefaultOpen: env.SIGNUP_DEFAULT === 'open',
    adminUsername: env.ADMIN_USERNAME || '',
    adminPassword: env.ADMIN_PASSWORD || '',
    retentionDays: integer(env, 'RETENTION_DAYS', 90, 1, 3650),
    maxDevicesPerUser: integer(env, 'MAX_DEVICES_PER_USER', 10, 1, 1000),
    sessionIdleHours: integer(env, 'SESSION_IDLE_HOURS', 12, 1, 720),
    sessionMaxDays: integer(env, 'SESSION_MAX_DAYS', 7, 1, 90),
    // Só para os testes automatizados: desliga os limites por IP, não as outras proteções.
    rateLimitMax: integer(env, 'RATE_LIMIT_FACTOR', 1, 1, 100000),
  };
}

import { createHash, randomBytes, randomInt, timingSafeEqual } from 'node:crypto';
import argon2 from 'argon2';

// Mínimo recomendado pelo OWASP Password Storage Cheat Sheet para Argon2id.
const ARGON2_OPTIONS = { type: argon2.argon2id, memoryCost: 19456, timeCost: 2, parallelism: 1 };

// OWASP Authentication Cheat Sheet: 15 caracteres sem MFA, sem regras de composição.
export const PASSWORD_MIN = 15;
export const PASSWORD_MAX = 256;
export const USERNAME_PATTERN = '^[a-z0-9][a-z0-9._-]{2,31}$';
const USERNAME_RE = new RegExp(USERNAME_PATTERN);
const EMAIL_RE = /^[^\s@<>"'(),:;\\[\]]+@[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+$/;

const COMMON_PASSWORDS = new Set([
  '123456789012345', '1234567890123456', '111111111111111', '000000000000000',
  'aaaaaaaaaaaaaaa', 'passwordpassword', 'senhasenhasenha', 'qwertyuiopasdfg',
  'qwertyuiopasdfgh', 'administrador123', 'adminadminadmin', 'password1234567',
  'senha1234567890', 'iloveyouiloveyou', 'correcthorsebatterystaple',
]);

export function normalizeUsername(value) {
  return String(value ?? '').trim().toLowerCase();
}

export function normalizeEmail(value) {
  return String(value ?? '').trim().toLowerCase();
}

export function isValidEmail(value) {
  return value.length <= 254 && EMAIL_RE.test(value);
}

export function isValidUsername(value) {
  return USERNAME_RE.test(value);
}

/** Retorna o motivo da recusa, ou null se a senha é aceitável. */
export function passwordProblem(password, username = '') {
  if (typeof password !== 'string') return 'password_invalid';
  const length = [...password].length;
  if (length < PASSWORD_MIN) return 'password_too_short';
  if (length > PASSWORD_MAX) return 'password_too_long';
  const lower = password.toLowerCase();
  if (COMMON_PASSWORDS.has(lower)) return 'password_common';
  if (new Set(lower).size < 5) return 'password_common';
  if (username && lower.includes(username.toLowerCase())) return 'password_contains_username';
  return null;
}

export const hashPassword = (password) => argon2.hash(password, ARGON2_OPTIONS);

export async function verifyPassword(hash, password) {
  try {
    return await argon2.verify(hash, password);
  } catch {
    return false;
  }
}

// Usado com usuário inexistente: o tempo de resposta não revela quais contas existem.
const dummyHash = hashPassword(randomBytes(32).toString('hex'));

export async function burnPasswordCheck(password) {
  await verifyPassword(await dummyHash, typeof password === 'string' ? password : '');
}

export const sha256 = (value) => createHash('sha256').update(value).digest();

export const randomToken = (bytes = 32) => randomBytes(bytes).toString('base64url');

export function safeEqual(a, b) {
  const left = sha256(String(a ?? ''));
  const right = sha256(String(b ?? ''));
  return timingSafeEqual(left, right);
}

const PASSWORD_ALPHABET = 'abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789-_.';

export function generatePassword(length = 24) {
  let out = '';
  for (let i = 0; i < length; i += 1) out += PASSWORD_ALPHABET[randomInt(PASSWORD_ALPHABET.length)];
  return out;
}

// Sem 0/O/1/I: o código é digitado à mão no celular.
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

export function generatePairingCode() {
  let out = '';
  for (let i = 0; i < 12; i += 1) out += CODE_ALPHABET[randomInt(CODE_ALPHABET.length)];
  return out;
}

export function normalizePairingCode(value) {
  return String(value ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');
}

export const formatPairingCode = (code) => code.match(/.{1,4}/g).join('-');

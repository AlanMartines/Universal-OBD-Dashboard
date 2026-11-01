import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

const FORM_MAX_AGE_MS = 2 * 60 * 60 * 1000;

function signForm(secret, purpose, issuedAt, nonce) {
  return createHmac('sha256', secret).update(`${purpose}:${issuedAt}:${nonce}`).digest('base64url');
}

export function issueFormToken(secret, purpose, now = Date.now()) {
  const nonce = randomBytes(12).toString('base64url');
  return `${now}.${nonce}.${signForm(secret, purpose, now, nonce)}`;
}

export function checkFormToken(secret, purpose, token, minAgeMs = 0, now = Date.now()) {
  const parts = String(token ?? '').split('.');
  if (parts.length !== 3) return false;
  const issuedAt = Number(parts[0]);
  if (!Number.isSafeInteger(issuedAt)) return false;
  const expected = Buffer.from(signForm(secret, purpose, parts[0], parts[1]));
  const given = Buffer.from(parts[2]);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return false;
  const age = now - issuedAt;
  return age >= minAgeMs && age <= FORM_MAX_AGE_MS;
}

export function safeEqualText(a, b) {
  const left = Buffer.from(String(a ?? ''));
  const right = Buffer.from(String(b ?? ''));
  return left.length === right.length && left.length > 0 && timingSafeEqual(left, right);
}

/** CSRF por Fetch Metadata, com origem como alternativa (OWASP CSRF Prevention Cheat Sheet). */
export function isSameOriginRequest(headers, publicOrigin) {
  const site = headers['sec-fetch-site'];
  if (site !== undefined) {
    if (site !== 'same-origin') return false;
  }
  const origin = headers.origin;
  if (origin !== undefined) return origin === publicOrigin;
  return site === 'same-origin';
}

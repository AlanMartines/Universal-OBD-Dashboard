import {
  createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, randomInt,
} from 'node:crypto';

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
const PERIOD_S = 30;
const DIGITS = 6;

export function base32Encode(buffer) {
  let bits = 0;
  let value = 0;
  let out = '';
  for (const byte of buffer) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
    value &= (1 << bits) - 1;
  }
  if (bits > 0) out += ALPHABET[(value << (5 - bits)) & 31];
  return out;
}

export function base32Decode(text) {
  let bits = 0;
  let value = 0;
  const out = [];
  for (const char of text) {
    const index = ALPHABET.indexOf(char);
    if (index < 0) throw new Error('base32');
    value = (value << 5) | index;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
    value &= (1 << bits) - 1;
  }
  return Buffer.from(out);
}

export const generateSecret = () => base32Encode(randomBytes(20));

/** Código RFC 6238 de um passo de tempo. */
export function codeForStep(secret, step) {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(step));
  const digest = createHmac('sha1', base32Decode(secret)).update(counter).digest();
  const offset = digest[digest.length - 1] & 15;
  const number = digest.readUInt32BE(offset) & 0x7fffffff;
  return String(number % 10 ** DIGITS).padStart(DIGITS, '0');
}

export const stepAt = (ms) => Math.floor(ms / 1000 / PERIOD_S);

/** Aceita um passo de tolerância para relógios fora de hora. Devolve o passo usado, ou null. */
export function verifyTotp(secret, code, now = Date.now()) {
  if (!/^[0-9]{6}$/.test(String(code))) return null;
  const current = stepAt(now);
  for (const step of [current, current - 1, current + 1]) {
    if (codeForStep(secret, step) === code) return step;
  }
  return null;
}

export function otpauthUri(secret, username) {
  const issuer = 'Telemetria OBD';
  const label = encodeURIComponent(`${issuer}:${username}`);
  return `otpauth://totp/${label}?secret=${secret}&issuer=${encodeURIComponent(issuer)}&digits=${DIGITS}&period=${PERIOD_S}`;
}

const keyOf = (material) => createHash('sha256').update(material).digest();

/** O segredo fica cifrado no banco: um vazamento só do banco não revela os códigos. */
export function sealSecret(secret, material) {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', keyOf(material), iv);
  const data = Buffer.concat([cipher.update(secret, 'utf8'), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), data]).toString('base64');
}

export function openSecret(sealed, material) {
  const raw = Buffer.from(sealed, 'base64');
  const decipher = createDecipheriv('aes-256-gcm', keyOf(material), raw.subarray(0, 12));
  decipher.setAuthTag(raw.subarray(12, 28));
  return Buffer.concat([decipher.update(raw.subarray(28)), decipher.final()]).toString('utf8');
}

const RECOVERY_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

export function generateRecoveryCodes(count = 10) {
  return Array.from({ length: count }, () => {
    let code = '';
    for (let i = 0; i < 10; i += 1) code += RECOVERY_ALPHABET[randomInt(RECOVERY_ALPHABET.length)];
    return `${code.slice(0, 5)}-${code.slice(5)}`;
  });
}

export const normalizeRecoveryCode = (value) => String(value ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');

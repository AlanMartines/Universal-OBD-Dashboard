// Senhas vazadas (Have I Been Pwned, "k-anonimato"): só os 5 primeiros caracteres do SHA-1 da senha saem do
// servidor; o serviço devolve centenas de finais de hash daquele prefixo, e a comparação é feita aqui.
// A senha, e mesmo o hash inteiro, nunca deixam o servidor. Se o serviço não responder, a senha passa
// (não trava cadastro nem troca de senha por causa de um serviço de fora).
import { createHash } from 'node:crypto';

const URL_BASE = 'https://api.pwnedpasswords.com/range/';

/**
 * Devolve uma função async (senha) => true quando a senha aparece em vazamentos públicos.
 * enabled=false devolve sempre false (testes, ambiente sem internet).
 */
export function createPwnedCheck({ enabled = true, fetchImpl = globalThis.fetch, timeoutMs = 3000, log = console } = {}) {
  if (!enabled) return async () => false;
  return async (password) => {
    const sha1 = createHash('sha1').update(String(password ?? ''), 'utf8').digest('hex').toUpperCase();
    const prefix = sha1.slice(0, 5);
    const suffix = sha1.slice(5);
    try {
      const res = await fetchImpl(URL_BASE + prefix, {
        headers: { 'Add-Padding': 'true', 'User-Agent': 'telemetria-obd' },
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const body = await res.text();
      // linhas "SUFIXO:QUANTIDADE"; as de preenchimento (Add-Padding) vêm com quantidade 0
      return body.split('\n').some((line) => {
        const [s, n] = line.trim().split(':');
        return s === suffix && Number(n) > 0;
      });
    } catch (error) {
      log.warn?.({ err: String(error?.message ?? error) }, 'consulta de senhas vazadas indisponível; senha aceita');
      return false;
    }
  };
}

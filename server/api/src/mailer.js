// Serviço à parte: é o único com saída para o SMTP. Se parar, a API e o painel seguem no ar.
import { pathToFileURL } from 'node:url';
import nodemailer from 'nodemailer';
import { createPool } from './db.js';

const POLL_MS = 5000;
const VERIFY_MS = 5 * 60000;
const MAX_ATTEMPTS = 5;
const PLACEHOLDER = /seuemail|sua_senha|exemplo|example/i;

/** Aceita 500ms, 10s, 1m ou um número em segundos. Valor inválido usa 10 s. */
export function parseTimeout(value) {
  const match = /^(\d+)\s*(ms|s|m)?$/.exec(String(value ?? '').trim());
  if (!match || Number(match[1]) === 0) return 10000;
  return Number(match[1]) * { ms: 1, s: 1000, m: 60000 }[match[2] ?? 's'];
}

export function mailConfig(env = process.env) {
  const { SMTP_HOST: host, SMTP_USER: user, SMTP_PASSWORD: pass, SMTP_FROM: from } = env;
  if (!host || !user || !pass || !from || [host, user, pass, from].some((v) => PLACEHOLDER.test(v))) return null;
  const secure = env.SMTP_SECURE === 'true';
  const timeout = parseTimeout(env.SMTP_TIMEOUT);
  return {
    transport: {
      host,
      port: Number(env.SMTP_PORT || 587),
      secure,
      requireTLS: !secure,
      auth: { user, pass },
      connectionTimeout: timeout,
      greetingTimeout: timeout,
      socketTimeout: timeout,
    },
    from: { name: env.SMTP_FROM_NAME || 'Telemetria OBD', address: from },
  };
}

export async function setMailReady(pool, ready) {
  await pool.query(
    `INSERT INTO settings (key, value) VALUES ('mail_ready', $1::jsonb)
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
    [JSON.stringify({ at: ready ? Date.now() : 0 })],
  );
}

/** Envia o que está na fila. Logs não levam endereço nem conteúdo, porque o corpo traz o link. */
export async function sendPending(pool, transporter, from, log = console) {
  const client = await pool.connect();
  let sent = 0;
  try {
    for (;;) {
      await client.query('BEGIN');
      const { rows } = await client.query(
        `SELECT id, recipient, subject, body, attempts FROM mail_outbox
          WHERE next_try <= now() ORDER BY id LIMIT 1 FOR UPDATE SKIP LOCKED`,
      );
      if (!rows.length) {
        await client.query('COMMIT');
        return sent;
      }
      const mail = rows[0];
      try {
        await transporter.sendMail({ from, to: mail.recipient, subject: mail.subject, text: mail.body });
        await client.query('DELETE FROM mail_outbox WHERE id = $1', [mail.id]);
        sent += 1;
      } catch (error) {
        log.error?.(JSON.stringify({ msg: 'falha ao enviar e-mail', code: error.code ?? 'desconhecido', attempt: mail.attempts + 1 }));
        if (mail.attempts + 1 >= MAX_ATTEMPTS) {
          await client.query('DELETE FROM mail_outbox WHERE id = $1', [mail.id]);
        } else {
          await client.query(
            `UPDATE mail_outbox SET attempts = attempts + 1, next_try = now() + make_interval(mins => $2) WHERE id = $1`,
            [mail.id, 2 ** mail.attempts],
          );
        }
      }
      await client.query('COMMIT');
    }
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

async function main() {
  const pool = createPool(process.env.DATABASE_URL);
  const config = mailConfig();
  if (!config) {
    console.warn(JSON.stringify({ msg: 'SMTP não configurado: defina SMTP_* no .env. A troca de e-mail fica indisponível.' }));
    await setMailReady(pool, false).catch(() => {});
  }
  const transporter = config ? nodemailer.createTransport(config.transport) : null;

  const verify = async () => {
    if (!transporter) return;
    try {
      await transporter.verify();
      await setMailReady(pool, true);
    } catch (error) {
      console.error(JSON.stringify({ msg: 'SMTP indisponível', code: error.code ?? 'desconhecido' }));
      await setMailReady(pool, false).catch(() => {});
    }
  };
  let busy = false;
  const tick = async () => {
    if (!transporter || busy) return;
    busy = true;
    try {
      await sendPending(pool, transporter, config.from);
    } catch (error) {
      console.error(JSON.stringify({ msg: 'falha na fila', code: error.code ?? 'desconhecido' }));
    } finally {
      busy = false;
    }
  };

  await verify();
  const timers = [setInterval(tick, POLL_MS), setInterval(verify, VERIFY_MS)];
  const shutdown = async () => {
    timers.forEach(clearInterval);
    await pool.end();
    process.exit(0);
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();

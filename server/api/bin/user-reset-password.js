#!/usr/bin/env node
// Reset de senha por quem tem acesso ao servidor.
//   --user NOME                 gera uma senha aleatória e mostra uma única vez
//   --user NOME --prompt        pede a senha sem mostrar na tela (recomendado)
//   --user NOME --password X    usa a senha informada (fica no histórico do terminal)
//   --disable-2fa               também desativa os dois fatores, se o autenticador foi perdido
import { createInterface } from 'node:readline';
import { parseArgs } from 'node:util';
import { audit, createPool } from '../src/db.js';
import { generatePassword, hashPassword, normalizeUsername, passwordProblem } from '../src/security.js';

const MESSAGES = {
  password_too_short: 'a senha precisa ter pelo menos 15 caracteres',
  password_too_long: 'a senha passa de 256 caracteres',
  password_common: 'a senha é fácil demais de adivinhar',
  password_contains_username: 'a senha não pode conter o nome do usuário',
  password_invalid: 'senha inválida',
};

function askHidden(question) {
  return new Promise((resolve) => {
    const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    rl._writeToOutput = (text) => {
      if (text.includes(question)) process.stdout.write(text);
    };
    rl.question(question, (answer) => {
      rl.close();
      process.stdout.write('\n');
      resolve(answer);
    });
  });
}

export async function resetPassword(pool, username, password, { disableMfa = false } = {}) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query(
      `UPDATE users SET password_hash = $2, must_change_password = true, failed_logins = 0, locked_until = NULL
        WHERE username = $1 RETURNING id`,
      [username, await hashPassword(password)],
    );
    if (!rows.length) {
      await client.query('ROLLBACK');
      return false;
    }
    await client.query('DELETE FROM sessions WHERE user_id = $1', [rows[0].id]);
    if (disableMfa) {
      await client.query(
        'UPDATE users SET totp_secret = NULL, totp_pending = NULL, totp_enabled_at = NULL, totp_last_step = NULL WHERE id = $1',
        [rows[0].id],
      );
      await client.query('DELETE FROM recovery_codes WHERE user_id = $1', [rows[0].id]);
      await audit(client, { actor: 'linha-de-comando', action: '2fa_desativado', target: username });
    }
    await audit(client, { actor: 'linha-de-comando', action: 'senha_resetada', target: username });
    await client.query('COMMIT');
    return true;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

async function main() {
  const { values } = parseArgs({
    options: { user: { type: 'string' }, password: { type: 'string' }, prompt: { type: 'boolean', default: false }, 'disable-2fa': { type: 'boolean', default: false } },
  });
  const username = normalizeUsername(values.user);
  if (!username || (values.password !== undefined && values.prompt)) {
    console.error('Uso: npm run user:reset-password -- --user NOME [--prompt | --password SENHA] [--disable-2fa]');
    return 2;
  }
  let password = values.password;
  if (values.prompt) {
    password = await askHidden('Nova senha: ');
    if (password !== await askHidden('Repita a senha: ')) {
      console.error('As senhas não conferem. Nada foi alterado.');
      return 1;
    }
  }
  const generated = password === undefined;
  if (generated) password = generatePassword();
  const problem = passwordProblem(password, username);
  if (problem) {
    console.error(`Senha recusada: ${MESSAGES[problem]}. Nada foi alterado.`);
    return 1;
  }
  if (!process.env.DATABASE_URL) {
    console.error('DATABASE_URL não definida.');
    return 2;
  }
  const pool = createPool(process.env.DATABASE_URL);
  try {
    if (!(await resetPassword(pool, username, password, { disableMfa: values['disable-2fa'] }))) {
      console.error(`Usuário não encontrado: ${username}. Nada foi alterado.`);
      return 1;
    }
  } finally {
    await pool.end();
  }
  console.log(`Senha de ${username} alterada. As sessões abertas foram encerradas e a troca será exigida no próximo login.`);
  if (generated) console.log(`Senha gerada (mostrada só agora): ${password}`);
  return 0;
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  process.exitCode = await main();
}

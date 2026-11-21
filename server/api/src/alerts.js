// Alertas de segurança por e-mail: entram na mesma fila do mailer (mail_outbox), na mesma transação do
// evento quando houver. Vão para o e-mail da própria conta; o Usuário (atendimento) sem e-mail avisa o dono
// da conta. Sem e-mail cadastrado, nada é enviado. O texto nunca leva senha, código ou token.
import { isIPv4, isIPv6 } from 'node:net';
import { knownNetworks, plainIp } from './networks.js';

const TZ = 'America/Sao_Paulo';
const quando = () => new Date().toLocaleString('pt-BR', { timeZone: TZ, dateStyle: 'short', timeStyle: 'short' });
const deOnde = (ip) => (ip ? `Endereço de origem: ${ip}` : 'Endereço de origem: não informado');
const RODAPE = '\n\nEste é um aviso automático de segurança da Telemetria OBD. Se foi você, não precisa fazer nada.';

/** Assunto e corpo de cada alerta. */
export const ALERTS = {
  conta_bloqueada: ({ username, ip, at, minutes }) => [
    `Conta "${username}" bloqueada por tentativas de senha`,
    `Em ${at}, a conta "${username}" recebeu várias senhas erradas seguidas a partir de uma mesma rede, que ficou `
      + `bloqueada por ${minutes} min. Das outras redes o login continua funcionando.\n`
      + `${deOnde(ip)}\n\nSe não foi você, alguém pode estar tentando adivinhar a senha. Use uma senha longa e única `
      + 'e ative a verificação em duas etapas em Meus Dados.',
  ],
  conta_fechada_redes_novas: ({ username, ip, at, minutes }) => [
    `Conta "${username}" fechada para redes novas`,
    `Em ${at}, a conta "${username}" somou muitas senhas erradas vindas de vários endereços e ficou fechada por `
      + `${minutes} min para redes que ela nunca usou. Das redes de onde você já entrou, o login continua funcionando.\n`
      + `Última tentativa: ${ip || 'endereço não informado'}\n\nParece um ataque espalhado: use uma senha longa e única `
      + 'e mantenha a verificação em duas etapas ligada.',
  ],
  codigo_2fa_esgotado: ({ username, ip, at }) => [
    `Senha da conta "${username}" usada com código errado`,
    `Em ${at}, alguém entrou com a senha certa da conta "${username}", mas errou o código do aplicativo autenticador `
      + `várias vezes, e o login foi recusado.\n${deOnde(ip)}\n\nSe não foi você, troque a senha agora em Meus Dados: `
      + 'ela pode ter vazado. A verificação em duas etapas segurou a entrada.',
  ],
  login_ip_novo: ({ username, ip, at }) => [
    `Entrada na conta "${username}" de um endereço novo`,
    `Em ${at}, a conta "${username}" (perfil de administração) entrou no painel a partir de um endereço que ela `
      + `ainda não tinha usado.\n${deOnde(ip)}\n\nSe não foi você, troque a senha em Meus Dados e encerre as `
      + 'outras sessões em Meus Dados → Sessões ativas.',
  ],
  dispositivo_pareado: ({ username, ip, at, device }) => [
    `Novo aparelho pareado na conta "${username}"`,
    `Em ${at}, o dispositivo "${device}" da conta "${username}" foi pareado com um aparelho, que passa a enviar `
      + `telemetria ao painel.\n${deOnde(ip)}\n\nSe não foi você, revogue o dispositivo em Dispositivos.`,
  ],
  mfa_trocado: ({ username, ip, at }) => [
    `Aplicativo autenticador trocado na conta "${username}"`,
    `Em ${at}, a conta "${username}" passou a usar outro aplicativo autenticador. O anterior deixou de valer, os `
      + `códigos de recuperação foram trocados e as outras sessões foram encerradas.\n${deOnde(ip)}\n\n`
      + 'Se não foi você, troque a senha agora em Meus Dados e fale com o administrador.',
  ],
  mfa_desativado: ({ username, ip, at, byServer }) => [
    `Verificação em duas etapas desligada na conta "${username}"`,
    `Em ${at}, a verificação em duas etapas da conta "${username}" foi desligada`
      + `${byServer ? ' pelo administrador do servidor (redefinição pela linha de comando)' : ''}. `
      + `A conta fica protegida só pela senha.\n${byServer ? '' : `${deOnde(ip)}\n`}\n`
      + 'Se não foi você, troque a senha e ative de novo a verificação em Meus Dados.',
  ],
};

/** Põe o alerta [kind] na fila para a conta [userId]. Devolve false quando não há e-mail para avisar. */
export async function alertUser(db, userId, kind, info = {}) {
  const { rows } = await db.query(
    `SELECT u.username, COALESCE(u.email, owner.email) AS email
       FROM users u LEFT JOIN users owner ON owner.id = u.account_id
      WHERE u.id = $1`,
    [userId],
  );
  const row = rows[0];
  if (!row?.email) return false;
  const [subject, body] = ALERTS[kind]({ ...info, username: row.username, at: quando() });
  await db.query('INSERT INTO mail_outbox (recipient, subject, body) VALUES ($1, $2, $3)', [row.email, subject, body + RODAPE]);
  return true;
}

/**
 * Login de Super Admin ou Admin de uma rede que a conta nunca usou (pelos logins do último ano na auditoria).
 * Chame antes de gravar o login atual. O primeiro login da conta não avisa: não há com o que comparar.
 */
export async function alertIfNewNetwork(db, user, rawIp) {
  const ip = plainIp(rawIp);
  if (!['superadmin', 'admin'].includes(user.role) || !(isIPv4(ip) || isIPv6(ip))) return false;
  const known = await knownNetworks(db, user.username);
  if (!known.count || known.has(ip)) return false;
  return alertUser(db, user.id, 'login_ip_novo', { ip });
}

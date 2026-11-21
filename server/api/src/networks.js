// Redes de origem: /24 no IPv4 e /48 no IPv6. Trocar de IP dentro do mesmo provedor continua sendo a mesma rede.
// Usado pelos alertas (login de rede nova) e pelo bloqueio por tentativas, que conta por conta e por rede.
import { BlockList, isIPv4, isIPv6 } from 'node:net';

/** IPv4 escrito como IPv6 (::ffff:1.2.3.4) volta a ser IPv4; senão a faixa /48 juntaria todos os IPv4. */
export const plainIp = (ip) => {
  const s = String(ip ?? '').trim();
  const m = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(s);
  return m ? m[1] : s;
};

const validIp = (ip) => isIPv4(ip) || isIPv6(ip);

function groups6(ip) {
  const [head, tail] = ip.split('::');
  const h = head ? head.split(':') : [];
  const t = tail ? tail.split(':') : [];
  const fill = ip.includes('::') ? Array(Math.max(0, 8 - h.length - t.length)).fill('0') : [];
  return [...h, ...fill, ...t].map((g) => parseInt(g || '0', 16));
}

/** Rede do endereço em texto ("203.0.113.0/24", "2001:db8:1::/48"); endereço ausente ou inválido vira "desconhecida". */
export function networkOf(rawIp) {
  const ip = plainIp(rawIp);
  if (isIPv4(ip)) return `${ip.split('.').slice(0, 3).join('.')}.0/24`;
  if (isIPv6(ip)) return `${groups6(ip).slice(0, 3).map((g) => g.toString(16)).join(':')}::/48`;
  return 'desconhecida';
}

/** Redes de onde a conta entrou no último ano (logins na auditoria), para conferir um endereço. */
export async function knownNetworks(db, username) {
  const { rows } = await db.query(
    `SELECT DISTINCT ip FROM audit_log WHERE actor = $1 AND action = 'login' AND ip IS NOT NULL`,
    [username],
  );
  const list = new BlockList();
  let count = 0;
  for (const r of rows) {
    const ip = plainIp(r.ip);
    if (isIPv4(ip)) list.addSubnet(ip, 24, 'ipv4');
    else if (isIPv6(ip)) list.addSubnet(ip, 48, 'ipv6');
    else continue;
    count += 1;
  }
  return {
    count,
    has(rawIp) {
      const ip = plainIp(rawIp);
      return validIp(ip) && list.check(ip, isIPv4(ip) ? 'ipv4' : 'ipv6');
    },
  };
}

/**
 * Linha de progresso do pmtiles (barra em texto, reescrita com \r), por exemplo:
 *   fetching chunks  96% |██████████  | (1.4/1.4 GB, 1.2 MB/s) [3m48s:47s]
 * Vira { pct, feito, velocidade, falta } para a barra do painel; o resto da saída segue no registro.
 */
const LINHA = /^\s*(.*?)\s+(\d{1,3})%\s*\|[^|]*\|\s*\(([^,)]+)(?:,\s*([^)]+))?\)\s*(?:\[([^\]:]*):?([^\]]*)\])?/;

export function lerProgresso(linha) {
  const m = LINHA.exec(String(linha));
  if (!m) return null;
  const pct = Math.min(100, Number(m[2]));
  return {
    etapa: m[1].trim(),
    pct,
    feito: m[3].trim(),
    velocidade: m[4]?.trim() || null,
    falta: m[6]?.trim() || null,
  };
}

/** Texto curto para a fase: "1.4/1.4 GB · 1.2 MB/s · falta 47s". */
export function textoProgresso(p) {
  return [p.feito, p.velocidade, p.falta ? `falta ${p.falta}` : null].filter(Boolean).join(' · ');
}

/*
 * Nome legível do aparelho a partir do User-Agent ("Firefox — Windows", "Chrome — Android"), para a
 * lista de sessões. Só reconhece os casos comuns; o resto fica "Navegador" e o texto original vai no title.
 */
const BROWSERS = [
  [/Edg(e|A|iOS)?\//, 'Edge'],
  [/OPR\/|Opera/, 'Opera'],
  [/SamsungBrowser\//, 'Samsung Internet'],
  [/Firefox\/|FxiOS\//, 'Firefox'],
  [/Chrome\/|CriOS\//, 'Chrome'],
  [/Safari\//, 'Safari'],
];
const SYSTEMS = [
  [/Android/, 'Android', true],
  [/iPhone|iPod/, 'iPhone', true],
  [/iPad/, 'iPad', true],
  [/Windows/, 'Windows', false],
  [/Mac OS X|Macintosh/, 'macOS', false],
  [/CrOS/, 'ChromeOS', false],
  [/Linux/, 'Linux', false],
];

export function describeAgent(ua) {
  const text = typeof ua === 'string' ? ua : '';
  const browser = BROWSERS.find(([re]) => re.test(text))?.[1] ?? null;
  const system = SYSTEMS.find(([re]) => re.test(text));
  const mobile = system ? system[2] || /Mobile/.test(text) : /Mobile/.test(text);
  if (!text) return { label: 'Aparelho não identificado', mobile: false };
  const label = [browser ?? 'Navegador', system?.[1]].filter(Boolean).join(' — ');
  return { label, mobile };
}

/** "agora", "há 5 minutos", "há 3 horas", "há 2 dias". */
export function ago(date, now = Date.now()) {
  const s = Math.max(0, (now - new Date(date).getTime()) / 1000);
  if (s < 60) return 'agora';
  const plural = (n, one, many) => `há ${n} ${n === 1 ? one : many}`;
  if (s < 3600) return plural(Math.floor(s / 60), 'minuto', 'minutos');
  if (s < 86400) return plural(Math.floor(s / 3600), 'hora', 'horas');
  return plural(Math.floor(s / 86400), 'dia', 'dias');
}

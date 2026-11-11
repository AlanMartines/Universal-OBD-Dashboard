// Saúde do carro ao longo do tempo: leitura em texto e dados dos gráficos a partir do resumo diário da API.
// As faixas são as usuais para carro a gasolina/flex; cada achado diz o que olhar, sem dar diagnóstico fechado.

const RECENT_DAYS = 14;
const MIN_DAYS = 3;

const avg = (list) => (list.length ? list.reduce((a, b) => a + b, 0) / list.length : null);

/** Média de um campo nos dias que o têm, entre os índices [from, to). */
function mean(days, key, from = 0, to = days.length) {
  return avg(days.slice(from, to).map((d) => d[key]).filter((v) => v != null && Number.isFinite(v)));
}
function count(days, key, from = 0, to = days.length) {
  return days.slice(from, to).filter((d) => d[key] != null).length;
}

/**
 * Achados dos últimos 14 dias com dados. level: ok | warn | bad | info (o selo usa ícone + texto, nunca só cor).
 * [days] em ordem de data, como a API devolve.
 */
export function healthFindings(days) {
  const recentFrom = Math.max(0, days.length - RECENT_DAYS);
  const out = [];
  const add = (topic, level, text) => out.push({ topic, level, text });
  const enough = (key) => count(days, key, recentFrom) >= MIN_DAYS;
  const fmt = (v, d = 1) => v.toLocaleString('pt-BR', { minimumFractionDigits: d, maximumFractionDigits: d });

  if (enough('stftWarmAvg')) {
    const s = mean(days, 'stftWarmAvg', recentFrom);
    const before = count(days, 'stftWarmAvg', 0, recentFrom) >= MIN_DAYS ? mean(days, 'stftWarmAvg', 0, recentFrom) : null;
    if (s > 8) add('Mistura', 'warn', `A injeção está acrescentando ${fmt(s)}% de combustível em média (mistura pobre). Vale olhar entrada de ar falso, bicos e filtro de combustível.`);
    else if (s < -8) add('Mistura', 'warn', `A injeção está tirando ${fmt(-s)}% de combustível em média (mistura rica). Vale olhar filtro de ar, sonda lambda e pressão de combustível.`);
    else add('Mistura', 'ok', `Correção de combustível em ${fmt(s)}%, dentro do normal (±8%).`);
    if (before != null && Math.abs(s - before) >= 4) {
      add('Mistura', 'info', `A correção mudou de ${fmt(before)}% para ${fmt(s)}% em relação às semanas anteriores. Troca de combustível (etanol × gasolina) também mexe nisso.`);
    }
  }

  if (enough('voltsOffAvg')) {
    const v = mean(days, 'voltsOffAvg', recentFrom);
    const low = Math.min(...days.slice(recentFrom).map((d) => d.voltsOffMin).filter((x) => x != null));
    if (v < 12.2 || low < 11.8) add('Bateria', 'bad', `Bateria com o motor desligado em ${fmt(v, 2)} V (mínima ${fmt(low, 2)} V): carga baixa. Teste a bateria.`);
    else if (v < 12.4) add('Bateria', 'warn', `Bateria com o motor desligado em ${fmt(v, 2)} V, um pouco abaixo do ideal (12,4 V ou mais).`);
    else add('Bateria', 'ok', `Bateria com o motor desligado em ${fmt(v, 2)} V.`);
  }

  if (enough('voltsRunningAvg')) {
    const v = mean(days, 'voltsRunningAvg', recentFrom);
    if (v < 13.2) add('Alternador', 'warn', `Com o motor ligado, a tensão fica em ${fmt(v, 2)} V: o alternador pode não estar carregando bem (o normal é 13,5 a 14,7 V).`);
    else if (v > 14.8) add('Alternador', 'warn', `Com o motor ligado, a tensão fica em ${fmt(v, 2)} V, acima do normal: verifique o regulador do alternador.`);
    else add('Alternador', 'ok', `Carga com o motor ligado em ${fmt(v, 2)} V.`);
  }

  if (enough('coolantWarmAvg')) {
    const t = mean(days, 'coolantWarmAvg', recentFrom);
    const max = Math.max(...days.slice(recentFrom).map((d) => d.coolantMax).filter((x) => x != null));
    if (max >= 105) add('Arrefecimento', 'bad', `O motor chegou a ${fmt(max, 0)} °C. Confira o nível do líquido, a ventoinha e a válvula termostática.`);
    else if (t > 100) add('Arrefecimento', 'warn', `Motor aquecido trabalhando em ${fmt(t, 0)} °C em média, acima do comum.`);
    else add('Arrefecimento', 'ok', `Motor aquecido em ${fmt(t, 0)} °C em média (máxima ${fmt(max, 0)} °C).`);
  }

  if (enough('lambdaPostSd')) {
    const sd = mean(days, 'lambdaPostSd', recentFrom);
    if (sd > 0.2) add('Catalisador', 'warn', `A sonda depois do catalisador está oscilando (${fmt(sd, 2)} V): sinal de que o catalisador pode estar perdendo eficiência.`);
    else add('Catalisador', 'ok', `Sonda depois do catalisador estável (oscilação de ${fmt(sd, 2)} V).`);
  }

  if (days.slice(recentFrom).some((d) => d.milOn)) add('Injeção', 'bad', 'A luz de injeção acendeu nos últimos dias. Veja a aba Falhas.');
  return out;
}

/** Séries dos gráficos: datas e um array por medida (null onde o dia não tem a leitura). */
export function healthCharts(days) {
  const pick = (key, d = 2) => days.map((x) => (x[key] == null ? null : Number(x[key].toFixed(d))));
  return {
    labels: days.map((d) => d.day.split('-').reverse().slice(0, 2).join('/')),
    stftWarm: pick('stftWarmAvg', 1),
    stftIdle: pick('stftIdleAvg', 1),
    voltsOff: pick('voltsOffAvg'),
    voltsRunning: pick('voltsRunningAvg'),
    coolantWarm: pick('coolantWarmAvg', 1),
    coolantMax: pick('coolantMax', 1),
    lambdaSd: pick('lambdaPostSd', 3),
  };
}

export function buildHealth(days) {
  return {
    days: days.length,
    since: days.length ? days[0].day.split('-').reverse().join('/') : null,
    findings: healthFindings(days),
    chart: healthCharts(days),
    // tabela: os 30 dias mais recentes, do mais novo para o mais velho
    table: days.slice(-30).reverse().map((d) => ({ ...d, day: d.day.split('-').reverse().join('/') })),
  };
}

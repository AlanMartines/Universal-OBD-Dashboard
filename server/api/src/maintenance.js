// Situação de cada item de manutenção: a mesma regra do app (maintenance/Maintenance.kt). Vence pelo que chegar
// primeiro, km ou data; a próxima troca anotada (o que o mecânico passou) vale no lugar do intervalo.

const DAY_MS = 24 * 60 * 60 * 1000;
export const SOON_DAYS = 30;

/** Aviso antes do km: 10% do trecho (entre 300 e 1.000 km). */
export const soonKm = (spanKm) => Math.min(1000, Math.max(300, spanKm * 0.1));

export function addMonths(ms, months) {
  const d = new Date(ms);
  d.setMonth(d.getMonth() + months);
  return d.getTime();
}

const LEVELS = ['OK', 'SOON', 'DUE'];

/**
 * @param item {intervalKm, intervalMonths, nextKm, nextAt (ms)}; @param last {ts (ms), odometerKm} do registro mais
 * novo (lastKm: o mais novo com km); @param currentKm hodômetro de agora (null = desconhecido).
 */
export function maintenanceStatus(item, lastAt, lastKm, currentKm, now = Date.now()) {
  if (lastAt == null && item.nextKm == null && item.nextAt == null) {
    return { level: 'UNKNOWN', nextKm: null, remainingKm: null, nextAt: null, remainingDays: null };
  }
  const nextKm = item.nextKm ?? (item.intervalKm > 0 && lastKm != null ? lastKm + item.intervalKm : null);
  const remainingKm = nextKm != null && currentKm != null ? nextKm - currentKm : null;
  const nextAt = item.nextAt ?? (lastAt != null && item.intervalMonths > 0 ? addMonths(lastAt, item.intervalMonths) : null);
  const remainingDays = nextAt != null ? Math.floor((nextAt - now) / DAY_MS) : null;
  const span = nextKm != null && lastKm != null && nextKm > lastKm ? nextKm - lastKm : (item.intervalKm > 0 ? item.intervalKm : 5000);
  const byKm = remainingKm == null ? null : remainingKm <= 0 ? 'DUE' : remainingKm <= soonKm(span) ? 'SOON' : 'OK';
  const byDate = remainingDays == null ? null : remainingDays < 0 ? 'DUE' : remainingDays <= SOON_DAYS ? 'SOON' : 'OK';
  const both = [byKm, byDate].filter(Boolean);
  const level = both.length ? both.reduce((a, b) => (LEVELS.indexOf(b) > LEVELS.indexOf(a) ? b : a)) : 'UNKNOWN';
  return { level, nextKm, remainingKm, nextAt, remainingDays };
}

const ORDER = ['DUE', 'SOON', 'UNKNOWN', 'OK'];

/** Itens com registros e situação, do mais urgente ao em dia, e o total gasto. */
export function maintenanceOverview(items, records, currentKm, now = Date.now()) {
  const list = items.map((it) => {
    const recs = records.filter((r) => r.itemId === it.id).sort((a, b) => b.ts - a.ts);
    const lastKm = recs.find((r) => r.odometerKm != null)?.odometerKm ?? null;
    return { ...it, records: recs, status: maintenanceStatus(it, recs[0]?.ts ?? null, lastKm, currentKm, now) };
  }).sort((a, b) => ORDER.indexOf(a.status.level) - ORDER.indexOf(b.status.level)
    || (a.status.remainingKm ?? Infinity) - (b.status.remainingKm ?? Infinity));
  const totalCost = records.reduce((s, r) => s + (r.cost ?? 0), 0);
  return {
    items: list,
    totalCost,
    due: list.filter((i) => i.status.level === 'DUE').length,
    soon: list.filter((i) => i.status.level === 'SOON').length,
  };
}

// Consumo real entre tanques cheios, a mesma regra do app: litros colocados até o tanque cheio
// seguinte ÷ km rodados entre eles. Abastecimentos parciais entram na soma do intervalo.
const GASOLINE = new Set(['gasoline', 'gasoline_premium']);

export function fuelSummary(items, timeZone = 'America/Sao_Paulo') {
  const sorted = [...items].sort((a, b) => a.ts - b.ts);
  const intervals = [];
  let start = null;
  let liters = 0;
  let cost = 0;
  let types = new Set();
  for (const f of sorted) {
    if (start) {
      liters += f.liters;
      cost = cost !== null && f.totalPrice !== null ? cost + f.totalPrice : null;
      if (!f.fullTank) types.add(f.fuelType);
    }
    if (f.fullTank) {
      if (start && start.odometerKm !== null && f.odometerKm !== null && f.odometerKm > start.odometerKm && liters > 0) {
        const kinds = new Set([...types, start.fuelType]);
        const fuelType = kinds.size === 1 ? start.fuelType : [...kinds].every((k) => GASOLINE.has(k)) ? 'gasoline' : 'mix';
        const km = f.odometerKm - start.odometerKm;
        intervals.push({ from: start.ts, to: f.ts, km, liters, kmPerL: km / liters, cost, costPerKm: cost === null ? null : cost / km, fuelType });
      }
      start = f;
      liters = 0;
      cost = 0;
      types = new Set();
    }
  }
  const month = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit' });
  const byMonth = {};
  for (const f of sorted) {
    if (f.totalPrice === null) continue;
    const key = month.format(new Date(f.ts));
    byMonth[key] = (byMonth[key] ?? 0) + f.totalPrice;
  }
  const km = intervals.reduce((s, i) => s + i.km, 0);
  const lit = intervals.reduce((s, i) => s + i.liters, 0);
  const priced = intervals.filter((i) => i.cost !== null);
  const pricedKm = priced.reduce((s, i) => s + i.km, 0);
  return {
    count: sorted.length,
    totalLiters: sorted.reduce((s, f) => s + f.liters, 0),
    totalCost: sorted.reduce((s, f) => s + (f.totalPrice ?? 0), 0),
    avgKmPerL: lit > 0 ? km / lit : null,
    costPerKm: pricedKm > 0 ? priced.reduce((s, i) => s + i.cost, 0) / pricedKm : null,
    costByMonth: byMonth,
    intervals: intervals.reverse(),
  };
}

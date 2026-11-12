import { test } from 'node:test';
import assert from 'node:assert/strict';
import { maintenanceStatus, soonKm } from '../src/maintenance.js';

const DAY = 864e5;
const now = Date.UTC(2026, 10, 12, 12);

test('próxima troca anotada vale no lugar do intervalo', () => {
  const s = maintenanceStatus({ intervalKm: 15000, intervalMonths: 12, nextKm: 187000 }, now - 10 * DAY, 180000, 186500, now);
  assert.equal(s.nextKm, 187000);
  assert.equal(s.remainingKm, 500);
  assert.equal(s.level, 'SOON');   // 10% de 7.000 = 700
});

test('sem registro e sem próxima troca: sem registro', () => {
  assert.equal(maintenanceStatus({ intervalKm: 10000 }, null, null, 100000, now).level, 'UNKNOWN');
});

test('vence pela data mesmo com km longe', () => {
  const s = maintenanceStatus({ nextKm: 250000, nextAt: now - DAY }, now - 700 * DAY, 180000, 181000, now);
  assert.equal(s.level, 'DUE');
});

test('intervalo antigo sem próxima troca anotada', () => {
  const s = maintenanceStatus({ intervalKm: 10000, intervalMonths: 12 }, now - 30 * DAY, 180000, 185000, now);
  assert.equal(s.nextKm, 190000);
  assert.equal(s.level, 'OK');
  assert.equal(soonKm(2000), 300);
  assert.equal(soonKm(50000), 1000);
});

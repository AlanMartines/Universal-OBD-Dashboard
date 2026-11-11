// Serviço à parte para as tarefas periódicas. Se parar, a API e o painel seguem funcionando.
import { writeFileSync } from 'node:fs';
import { createPool, purgeExpired, rollupHealth } from './db.js';

const HEARTBEAT = '/tmp/worker-alive';
const retentionDays = Number(process.env.RETENTION_DAYS || 90);
const intervalMs = Number(process.env.PURGE_INTERVAL_MINUTES || 60) * 60000;
const pool = createPool(process.env.DATABASE_URL);

// Na primeira volta resume tudo o que ainda existe; depois, só os últimos dias (o de hoje muda a cada hora).
let rollupDays = retentionDays + 1;

async function tick() {
  try {
    // Antes da limpeza: o resumo de saúde guarda o dia antes de as amostras sumirem.
    await rollupHealth(pool, rollupDays);
    rollupDays = 3;
    await purgeExpired(pool, retentionDays);
    writeFileSync(HEARTBEAT, String(Date.now()));
    console.log(JSON.stringify({ msg: 'limpeza concluida', at: new Date().toISOString() }));
  } catch (error) {
    // Falha pontual não derruba o serviço: tenta de novo no próximo ciclo.
    console.error(JSON.stringify({ msg: 'falha na limpeza', error: error.message }));
  }
}

await tick();
const timer = setInterval(tick, intervalMs);

async function shutdown() {
  clearInterval(timer);
  await pool.end();
  process.exit(0);
}
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

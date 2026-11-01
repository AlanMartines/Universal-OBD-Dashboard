import { buildApp } from './app.js';
import { loadConfig } from './config.js';
import { bootstrap, createPool } from './db.js';

const config = loadConfig();
const pool = createPool(config.databaseUrl);

await bootstrap(pool, config);
const app = await buildApp({ config, pool });

async function shutdown() {
  await app.close();
  await pool.end();
  process.exit(0);
}
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

await app.listen({ port: config.port, host: config.host });

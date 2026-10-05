// Entry point: `node --disable-warning=ExperimentalWarning src/main.ts` (Node 24 runs TypeScript directly).
// Public API on HOST:PORT (behind nginx/Caddy); read-only admin page on ADMIN_HOST:ADMIN_PORT (127.0.0.1).

import { join } from 'node:path';
import { getConnInfo } from '@hono/node-server/conninfo';
import { serve } from '@hono/node-server';
import { createAdminApp } from './admin.ts';
import { createApp } from './app.ts';
import { checkModel } from './ai/upstream.ts';
import { openDatabase } from './db.ts';
import { ConfigError, loadConfig } from './env.ts';
import { runRetention } from './retention.ts';

function log(message: string): void {
  console.log(`[thaigit-api] ${new Date().toISOString()} ${message}`);
}

let config;
try {
  config = loadConfig();
} catch (error) {
  console.error(
    `[thaigit-api] Cấu hình sai: ${error instanceof ConfigError ? error.message : 'không đọc được'}`,
  );
  process.exit(1);
}

const db = openDatabase(join(config.dataDir, 'thaigit.db'));
const { app, state } = createApp({
  config,
  db,
  peer: (c) => {
    try {
      return getConnInfo(c).remote.address ?? '0.0.0.0';
    } catch {
      return '0.0.0.0';
    }
  },
});

const healthLoop = async () => {
  const healthy = await checkModel(config.hermes);
  if (healthy !== state.aiHealthy) log(`model ${config.hermes.model}: ${healthy ? 'ok' : 'down'}`);
  state.aiHealthy = healthy;
};
await healthLoop();
const healthTimer = setInterval(() => void healthLoop(), 60_000);

const retention = () => {
  try {
    runRetention(db, Date.now());
  } catch {
    log('retention lỗi (sẽ thử lại)');
  }
};
retention();
const retentionTimer = setInterval(retention, 6 * 60 * 60_000);

const server = serve({ fetch: app.fetch, hostname: config.host, port: config.port });
const admin = serve({ fetch: createAdminApp(db).fetch, hostname: config.adminHost, port: config.adminPort });
log(`API http://${config.host}:${config.port} · admin http://${config.adminHost}:${config.adminPort}`);

// Graceful shutdown: stop accepting connections and wait for in-flight AI streams (up to 100 s; compose allows 120 s).
let stopping = false;
const shutdown = async (signal: string) => {
  if (stopping) return;
  stopping = true;
  log(`${signal}: đang xả ${state.activeStreams} stream`);
  clearInterval(healthTimer);
  clearInterval(retentionTimer);
  server.close();
  admin.close();
  const deadline = Date.now() + 100_000;
  while (state.activeStreams > 0 && Date.now() < deadline)
    await new Promise((resolve) => setTimeout(resolve, 250));
  db.close();
  process.exit(0);
};
process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { APP_DIR, CONFIG_PATH, DB_PATH, loadConfig, saveConfig } from './paths.js';
import { buildGateway } from './gateway.js';
import { listAccounts } from './db.js';
import { refreshQuota } from './accounts.js';
import { scanAccountHealth, startAutoSwitch } from './autoSwitch.js';

const VERSION = '0.1.0-preview.8';
const here = path.dirname(fileURLToPath(import.meta.url));

function uiDir(): string {
  // dist/main.js lives in core/dist, so ui/dist sits two levels up.
  return path.resolve(here, '..', '..', 'ui', 'dist');
}

async function alreadyRunning(port: number): Promise<boolean> {
  try {
    const response = await fetch(`http://127.0.0.1:${port}/healthz`, {
      signal: AbortSignal.timeout(1200),
    });
    if (!response.ok) return false;
    const body = (await response.json()) as { ok?: boolean; management_api?: number };
    return body.ok === true && body.management_api === 3;
  } catch {
    return false;
  }
}

function banner(config: ReturnType<typeof loadConfig>, eligible: number): void {
  const lines = [
    '',
    `  Codex Manager core v${VERSION}`,
    `  ─────────────────────────────────────────────`,
    `  data dir     ${APP_DIR}`,
    `  database     ${DB_PATH}`,
    `  config       ${CONFIG_PATH}`,
    `  gateway      http://127.0.0.1:${config.port}/v1`,
    `  api key      available in Manager settings`,
    `  accounts     ${listAccounts().length} (${eligible} eligible)`,
    '',
    `  Point Codex at this gateway from the UI, or run:`,
    `    CODEX_MANAGER_PORT=${config.port} npm start`,
    '',
  ];
  process.stdout.write(`${lines.join('\n')}\n`);
}

async function main(): Promise<void> {
  const config = loadConfig();

  const envPort = Number(process.env.CODEX_MANAGER_PORT ?? '');
  if (Number.isFinite(envPort) && envPort > 0) {
    config.port = envPort;
    saveConfig(config);
  }

  if (await alreadyRunning(config.port)) {
    process.stdout.write(
      `Codex Manager core is already running on http://127.0.0.1:${config.port} (open the UI there).\n`,
    );
    return;
  }

  const app = await buildGateway({ config, uiDir: uiDir(), startedAt: Date.now() });

  try {
    await app.listen({ port: config.port, host: '127.0.0.1' });
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === 'EADDRINUSE') {
      process.stderr.write(
        `Port ${config.port} is already in use. Set another port with CODEX_MANAGER_PORT=8056 npm start, then update config.toml.\n`,
      );
      process.exitCode = 1;
      return;
    }
    throw error;
  }

  const rows = listAccounts();
  const eligible = rows.filter((row) => row.status === 'active').length;
  banner(config, eligible);

  // Stale quota snapshots are refreshed in the background so the dashboard
  // opens with real numbers without delaying startup. The same sweep emits
  // low-quota events for the desktop notifications.
  void scanAccountHealth(config);

  // Auto-switch is opt-in. When enabled it polls quotas at the configured
  // interval, moves the CLI login when the current account runs low, and
  // uses the same close/write/reopen controller as manual account changes.
  startAutoSwitch(config);

  // Even with auto-switch off, check account health every five minutes so
  // notifications and the menu-bar quota stay honest.
  setInterval(() => void scanAccountHealth(config), 5 * 60 * 1000).unref();

  // When a rate-limit cooldown ends, refresh that account once (throttled) so
  // the dashboard flips back to "Ready" and the lease opens up automatically.
  const lastAutoRefresh = new Map<string, number>();
  const sweepCooldowns = async (): Promise<void> => {
    for (const row of listAccounts()) {
      if (row.status !== 'rate_limited' || !row.cooldown_until) continue;
      if (row.cooldown_until > Date.now()) continue;
      if (Date.now() - (lastAutoRefresh.get(row.id) ?? 0) < 120_000) continue;
      lastAutoRefresh.set(row.id, Date.now());
      try {
        await refreshQuota(row.id, config);
      } catch {
        /* retried on the next sweep */
      }
    }
  };
  setInterval(() => void sweepCooldowns(), 60_000).unref();
  void sweepCooldowns();

  const shutdown = async (signal: string): Promise<void> => {
    process.stdout.write(`\n${signal} received, shutting down.\n`);
    try {
      await app.close();
    } finally {
      process.exit(0);
    }
  };
  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
}

main().catch((error) => {
  process.stderr.write(`Codex Manager failed to start: ${(error as Error).stack ?? error}\n`);
  process.exit(1);
});

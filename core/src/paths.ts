import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { z } from 'zod';

export const APP_DIR = path.join(os.homedir(), '.codex-manager');
export const CONFIG_PATH = path.join(APP_DIR, 'config.json');
export const DB_PATH = path.join(APP_DIR, 'data.db');
export const KEY_PATH = path.join(APP_DIR, 'secret.key');

/** CODEX_HOME lets users keep parallel profiles; the primary client lives here by default. */
export function codexHome(): string {
  return process.env.CODEX_HOME?.trim() || path.join(os.homedir(), '.codex');
}

export function codexAuthPath(home = codexHome()): string {
  return path.join(home, 'auth.json');
}

export function codexConfigPath(home = codexHome()): string {
  return path.join(home, 'config.toml');
}

export const DEFAULT_UPSTREAM = 'https://chatgpt.com/backend-api/codex';

const ConfigSchema = z.object({
  port: z.number().int().min(1024).max(65535).default(8055),
  api_key: z.string().default(''),
  upstream_base: z.string().url().default(DEFAULT_UPSTREAM),
  max_account_attempts: z.number().int().min(1).max(5).default(3),
  request_timeout_ms: z.number().int().min(10_000).max(600_000).default(600_000),
});

export type AppConfig = z.infer<typeof ConfigSchema>;

function ensureDirs(): void {
  fs.mkdirSync(APP_DIR, { recursive: true, mode: 0o700 });
  try {
    fs.chmodSync(APP_DIR, 0o700);
  } catch {
    /* best effort on platforms without POSIX modes */
  }
}

export function newApiKey(): string {
  return `sk-${crypto.randomUUID().replaceAll('-', '')}`;
}

export function loadConfig(): AppConfig {
  ensureDirs();
  let raw: unknown = {};
  if (fs.existsSync(CONFIG_PATH)) {
    try {
      raw = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
    } catch (error) {
      throw new Error(`Invalid config.json: ${(error as Error).message}`);
    }
  }
  const parsed = ConfigSchema.parse(raw);
  if (!parsed.api_key) {
    parsed.api_key = newApiKey();
    saveConfig(parsed);
  }
  return parsed;
}

export function saveConfig(config: AppConfig): void {
  ensureDirs();
  const tmp = `${CONFIG_PATH}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, `${JSON.stringify(config, null, 2)}\n`, { mode: 0o600 });
  fs.renameSync(tmp, CONFIG_PATH);
}

/** The upstream base can be overridden through config; keeps tests and proxies simple. */
export function upstreamBase(config: AppConfig): string {
  return config.upstream_base.replace(/\/+$/, '');
}

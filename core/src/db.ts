import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import { DB_PATH, APP_DIR } from './paths.js';

export interface QuotaWindow {
  used_percent: number;
  limit_window_seconds: number;
  reset_after_seconds: number;
  reset_at: number;
}

export interface Quota {
  plan_type?: string;
  allowed?: boolean;
  limit_reached?: boolean;
  primary?: QuotaWindow;
  secondary?: QuotaWindow;
  credits?: { has_credits?: boolean; unlimited?: boolean; balance?: string };
  captured_at: number;
  source: 'usage' | 'headers';
}

export type AccountStatus = 'active' | 'rate_limited' | 'expired' | 'error';

export interface AccountRow {
  id: string;
  email: string;
  account_id: string;
  plan_type: string | null;
  auth_mode: string;
  token_blob: string;
  quota_json: string | null;
  status: AccountStatus;
  status_reason: string | null;
  cooldown_until: number | null;
  last_used: number;
  created_at: number;
}

export interface RequestRow {
  id: string;
  account_id: string | null;
  ts: number;
  model: string | null;
  status: number | null;
  latency_ms: number | null;
  note: string | null;
}

fs.mkdirSync(APP_DIR, { recursive: true, mode: 0o700 });

export const db = new DatabaseSync(DB_PATH);

// Tokens are encrypted, but the database still should not be group/world readable.
for (const suffix of ['', '-wal', '-shm']) {
  try {
    fs.chmodSync(`${DB_PATH}${suffix}`, 0o600);
  } catch {
    /* file may not exist yet */
  }
}

db.exec(`
  PRAGMA journal_mode = WAL;
  PRAGMA foreign_keys = ON;

  CREATE TABLE IF NOT EXISTS accounts (
    id             TEXT PRIMARY KEY,
    email          TEXT NOT NULL,
    account_id     TEXT NOT NULL,
    plan_type      TEXT,
    auth_mode      TEXT NOT NULL DEFAULT 'chatgpt',
    token_blob     TEXT NOT NULL,
    quota_json     TEXT,
    status         TEXT NOT NULL DEFAULT 'active',
    status_reason  TEXT,
    cooldown_until INTEGER,
    last_used      INTEGER NOT NULL DEFAULT 0,
    created_at     INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS requests (
    id         TEXT PRIMARY KEY,
    account_id TEXT,
    ts         INTEGER NOT NULL,
    model      TEXT,
    status     INTEGER,
    latency_ms INTEGER,
    note       TEXT
  );
  CREATE INDEX IF NOT EXISTS idx_requests_ts ON requests(ts DESC);

  CREATE TABLE IF NOT EXISTS settings (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );
`);

export function listAccounts(): AccountRow[] {
  return db.prepare('SELECT * FROM accounts ORDER BY created_at ASC').all() as unknown as AccountRow[];
}

export function getAccount(id: string): AccountRow | null {
  const row = db.prepare('SELECT * FROM accounts WHERE id = ?').get(id);
  return (row as unknown as AccountRow) ?? null;
}

export function upsertAccount(input: {
  id: string;
  email: string;
  account_id: string;
  plan_type?: string | null;
  auth_mode: string;
  token_blob: string;
}): AccountRow {
  const now = Date.now();
  db.prepare(
    `INSERT INTO accounts (id, email, account_id, plan_type, auth_mode, token_blob, created_at, last_used)
     VALUES (?, ?, ?, ?, ?, ?, ?, 0)
     ON CONFLICT(id) DO UPDATE SET
       email = excluded.email,
       account_id = excluded.account_id,
       plan_type = COALESCE(excluded.plan_type, accounts.plan_type),
       token_blob = excluded.token_blob,
       status = 'active',
       status_reason = NULL,
       cooldown_until = NULL`,
  ).run(
    input.id,
    input.email,
    input.account_id,
    input.plan_type ?? null,
    input.auth_mode,
    input.token_blob,
    now,
  );
  return getAccount(input.id)!;
}

export function updateTokens(id: string, tokenBlob: string, planType?: string | null): void {
  db.prepare(
    `UPDATE accounts SET token_blob = ?, plan_type = COALESCE(?, plan_type), status = 'active',
       status_reason = NULL, cooldown_until = NULL WHERE id = ?`,
  ).run(tokenBlob, planType ?? null, id);
}

export function setQuota(id: string, quota: Quota): void {
  db.prepare('UPDATE accounts SET quota_json = ?, plan_type = COALESCE(?, plan_type) WHERE id = ?').run(
    JSON.stringify(quota),
    quota.plan_type ?? null,
    id,
  );
}

export function setStatus(
  id: string,
  status: AccountStatus,
  reason: string | null,
  cooldownUntil: number | null = null,
): void {
  db.prepare('UPDATE accounts SET status = ?, status_reason = ?, cooldown_until = ? WHERE id = ?').run(
    status,
    reason,
    cooldownUntil,
    id,
  );
}

export function touchAccount(id: string): void {
  db.prepare('UPDATE accounts SET last_used = ? WHERE id = ?').run(Date.now(), id);
}

export function removeAccount(id: string): void {
  db.prepare('DELETE FROM accounts WHERE id = ?').run(id);
  db.prepare('DELETE FROM requests WHERE account_id = ?').run(id);
}

export function logRequest(row: Omit<RequestRow, 'ts'> & { ts?: number }): void {
  db.prepare(
    'INSERT INTO requests (id, account_id, ts, model, status, latency_ms, note) VALUES (?, ?, ?, ?, ?, ?, ?)',
  ).run(
    row.id,
    row.account_id,
    row.ts ?? Date.now(),
    row.model,
    row.status,
    row.latency_ms,
    row.note,
  );
  db.prepare(
    'DELETE FROM requests WHERE id NOT IN (SELECT id FROM requests ORDER BY ts DESC LIMIT 500)',
  ).run();
}

export function listRequests(limit = 50): RequestRow[] {
  return db
    .prepare('SELECT * FROM requests ORDER BY ts DESC LIMIT ?')
    .all(limit) as unknown as RequestRow[];
}

export function getSetting<T>(key: string, fallback: T): T {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key) as
    | { value: string }
    | undefined;
  if (!row) return fallback;
  try {
    return JSON.parse(row.value) as T;
  } catch {
    return fallback;
  }
}

export function setSetting(key: string, value: unknown): void {
  db.prepare(
    'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
  ).run(key, JSON.stringify(value));
}

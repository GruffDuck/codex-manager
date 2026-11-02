import { listAccounts, type AccountRow } from './db.js';
import { isEligible } from './accounts.js';
import { quotaWeight } from './quota.js';
import type { Quota } from './db.js';

/**
 * Smooth weighted round-robin. Each account carries a "current weight" that
 * grows by its quota-derived weight on every pick and shrinks by the total
 * weight of the pool when selected. Accounts with more headroom therefore get
 * proportionally more traffic without ever starving low-quota accounts.
 */
const currentWeight = new Map<string, number>();

function quotaOf(row: AccountRow): Quota | null {
  if (!row.quota_json) return null;
  try {
    return JSON.parse(row.quota_json) as Quota;
  } catch {
    return null;
  }
}

export function weightOf(row: AccountRow): number {
  return quotaWeight(quotaOf(row));
}

export interface LeaseOptions {
  /** Accounts already tried for this request; never retried within one request. */
  exclude?: ReadonlySet<string>;
  /** `x-codex-account` pin: either our id or the upstream account id. */
  pin?: string | null;
  now?: number;
}

export interface LeaseResult {
  row: AccountRow;
  weight: number;
}

export function pickAccount(options: LeaseOptions = {}): LeaseResult | null {
  const now = options.now ?? Date.now();
  const exclude = options.exclude ?? new Set<string>();
  const rows = listAccounts();

  if (options.pin) {
    const pinned = rows.find(
      (row) => row.id === options.pin || row.account_id === options.pin || row.email === options.pin,
    );
    // A pin is strict: an unknown or unavailable account fails loudly instead of
    // silently routing somewhere the caller did not ask for.
    if (!pinned || !isEligible(pinned, now) || exclude.has(pinned.id)) return null;
    return { row: pinned, weight: weightOf(pinned) };
  }

  const pool = rows.filter((row) => isEligible(row, now) && !exclude.has(row.id));
  if (pool.length === 0) return null;

  let total = 0;
  let best: AccountRow | null = null;
  let bestScore = Number.NEGATIVE_INFINITY;

  for (const row of pool) {
    const weight = weightOf(row);
    total += weight;
    const score = (currentWeight.get(row.id) ?? 0) + weight;
    currentWeight.set(row.id, score);
    if (score > bestScore) {
      bestScore = score;
      best = row;
    }
  }

  if (!best) return null;
  currentWeight.set(best.id, bestScore - total);
  return { row: best, weight: weightOf(best) };
}

/** When nothing is eligible, tell the caller when the earliest cooldown ends. */
export function nextEligibleAt(now = Date.now()): number | null {
  const stamps = listAccounts()
    .filter((row) => row.status === 'rate_limited' && row.cooldown_until !== null)
    .map((row) => row.cooldown_until as number)
    .filter((value) => value > now);
  if (stamps.length === 0) return null;
  return Math.min(...stamps);
}

export function poolSummary(): { total: number; eligible: number; names: string[] } {
  const rows = listAccounts();
  const now = Date.now();
  return {
    total: rows.length,
    eligible: rows.filter((row) => isEligible(row, now)).length,
    names: rows.map((row) => row.email),
  };
}

/** Called after an account is removed so stale weights cannot leak. */
export function forgetAccount(id: string): void {
  currentWeight.delete(id);
}

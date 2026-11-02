import type { AppConfig } from './paths.js';
import type { Quota, QuotaWindow } from './db.js';
import type { CodexTokens } from './codexAuth.js';

export function usageUrl(config: AppConfig): string {
  const origin = new URL(config.upstream_base).origin;
  return `${origin}/backend-api/wham/usage`;
}

export function upstreamHeaders(tokens: CodexTokens, extra: Record<string, string> = {}): Record<string, string> {
  return {
    authorization: `Bearer ${tokens.access_token}`,
    'chatgpt-account-id': tokens.account_id,
    originator: 'codex_cli_rs',
    accept: 'application/json',
    ...extra,
  };
}

function windowOf(value: unknown): QuotaWindow | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const row = value as Record<string, unknown>;
  const used = Number(row.used_percent);
  if (!Number.isFinite(used)) return undefined;
  return {
    used_percent: used,
    limit_window_seconds: Number(row.limit_window_seconds ?? 0),
    reset_after_seconds: Number(row.reset_after_seconds ?? 0),
    reset_at: Number(row.reset_at ?? 0),
  };
}

export function quotaFromUsage(payload: unknown): Quota {
  const root = (payload ?? {}) as Record<string, unknown>;
  const rate = (root.rate_limit ?? {}) as Record<string, unknown>;
  const credits = (root.credits ?? {}) as Record<string, unknown>;
  return {
    ...(typeof root.plan_type === 'string' ? { plan_type: root.plan_type } : {}),
    ...(typeof rate.allowed === 'boolean' ? { allowed: rate.allowed } : {}),
    ...(typeof rate.limit_reached === 'boolean' ? { limit_reached: rate.limit_reached } : {}),
    ...(windowOf(rate.primary_window) ? { primary: windowOf(rate.primary_window)! } : {}),
    ...(windowOf(rate.secondary_window) ? { secondary: windowOf(rate.secondary_window)! } : {}),
    credits: {
      ...(typeof credits.has_credits === 'boolean' ? { has_credits: credits.has_credits } : {}),
      ...(typeof credits.unlimited === 'boolean' ? { unlimited: credits.unlimited } : {}),
      ...(typeof credits.balance === 'string' ? { balance: credits.balance } : {}),
    },
    captured_at: Date.now(),
    source: 'usage',
  };
}

export async function fetchUsage(config: AppConfig, tokens: CodexTokens): Promise<{
  quota: Quota;
  email?: string;
  accountId?: string;
  status: number;
}> {
  const response = await fetch(usageUrl(config), {
    headers: upstreamHeaders(tokens),
    signal: AbortSignal.timeout(20_000),
  });
  const text = await response.text();
  let payload: unknown = null;
  try {
    payload = JSON.parse(text);
  } catch {
    /* keep null; the caller reports the status */
  }
  if (!response.ok) {
    throw Object.assign(new Error(`usage request failed: HTTP ${response.status}`), {
      status: response.status,
      body: text.slice(0, 500),
    });
  }
  const root = (payload ?? {}) as Record<string, unknown>;
  return {
    quota: quotaFromUsage(payload),
    ...(typeof root.email === 'string' ? { email: root.email } : {}),
    ...(typeof root.account_id === 'string' ? { accountId: root.account_id } : {}),
    status: response.status,
  };
}

/** Reads quota straight from the headers Codex servers attach to every response. */
export function quotaFromHeaders(headers: Headers, previous: Quota | null): Quota | null {
  const primaryUsed = headers.get('x-codex-primary-used-percent');
  const secondaryUsed = headers.get('x-codex-secondary-used-percent');
  if (primaryUsed === null && secondaryUsed === null) return null;

  const num = (name: string): number => {
    const raw = headers.get(name);
    const value = raw === null ? NaN : Number(raw);
    return Number.isFinite(value) ? value : 0;
  };

  const plan = headers.get('x-codex-plan-type') ?? previous?.plan_type;
  const primary: QuotaWindow = {
    used_percent: num('x-codex-primary-used-percent'),
    limit_window_seconds: num('x-codex-primary-window-minutes') * 60,
    reset_after_seconds: num('x-codex-primary-reset-after-seconds'),
    reset_at: num('x-codex-primary-reset-at'),
  };
  const secondary: QuotaWindow = {
    used_percent: num('x-codex-secondary-used-percent'),
    limit_window_seconds: num('x-codex-secondary-window-minutes') * 60,
    reset_after_seconds: num('x-codex-secondary-reset-after-seconds'),
    reset_at: num('x-codex-secondary-reset-at'),
  };
  const activeLimit = headers.get('x-codex-active-limit');

  return {
    ...(plan ? { plan_type: plan } : {}),
    ...(activeLimit ? { limit_reached: primary.used_percent >= 100 } : {}),
    primary,
    secondary,
    ...(previous?.credits ? { credits: previous.credits } : {}),
    captured_at: Date.now(),
    source: 'headers',
  };
}

/** Used for weighted scheduling: never makes an ineligible account eligible. */
export function quotaWeight(quota: Quota | null): number {
  if (!quota) return 1;
  const values = [quota.primary?.used_percent, quota.secondary?.used_percent].filter(
    (value): value is number => typeof value === 'number',
  );
  if (values.length === 0) return 1;
  const remaining = 100 - Math.max(...values);
  if (remaining < 25) return 1;
  if (remaining < 75) return 2;
  return 3;
}

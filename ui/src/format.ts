import type { Account, AccountStatus, QuotaWindow } from './types';

export function relativeFromNow(targetMs: number, now = Date.now()): string {
  const delta = Math.round((targetMs - now) / 1000);
  const abs = Math.abs(delta);
  const units: Array<[number, string]> = [
    [86400, 'd'],
    [3600, 'h'],
    [60, 'm'],
  ];
  let value = abs;
  let label = `${abs}s`;
  for (const [size, suffix] of units) {
    if (abs >= size) {
      value = Math.floor(abs / size);
      label = `${value}${suffix}`;
      break;
    }
  }
  return delta >= 0 ? `in ${label}` : `${label} ago`;
}

export function timeSince(ts: number, now = Date.now()): string {
  if (now - ts < 1500) return 'just now';
  return relativeFromNow(ts, now);
}

export function clockTime(ts: number): string {
  return new Date(ts).toLocaleTimeString('en-US', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });
}

/** Logs span days, so the time column has to say which day it means. */
export function logTime(ts: number, now = Date.now()): string {
  const date = new Date(ts);
  const today = new Date(now);
  const time = clockTime(ts);
  if (date.toDateString() === today.toDateString()) return time;
  const sameYear = date.getFullYear() === today.getFullYear();
  const day = date.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    ...(sameYear ? {} : { year: 'numeric' }),
  });
  return `${day} · ${time}`;
}

export function duration(ms: number): string {
  const seconds = Math.max(0, Math.floor(ms / 1000));
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${minutes}m`;
  if (minutes > 0) return `${minutes}m`;
  return `${seconds}s`;
}

export function durationLong(ms: number): string {
  const seconds = Math.max(0, Math.floor(ms / 1000));
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const parts: string[] = [];
  if (days) parts.push(`${days} day${days === 1 ? '' : 's'}`);
  if (hours) parts.push(`${hours} hour${hours === 1 ? '' : 's'}`);
  if (!days && minutes) parts.push(`${minutes} min`);
  return parts.length ? parts.join(' ') : 'less than a minute';
}

/** Quota is shown as percent *remaining*, so a shrinking bar means less headroom. */
export function remainingOf(window: QuotaWindow | undefined | null): number | null {
  if (!window || typeof window.used_percent !== 'number') return null;
  return Math.max(0, Math.min(100, Math.round(100 - window.used_percent)));
}

export function remainingOfAccount(account: Account): number | null {
  const windows = [account.quota?.primary, account.quota?.secondary].filter(
    (window): window is QuotaWindow => Boolean(window && typeof window.used_percent === 'number'),
  );
  if (windows.length === 0) return null;
  return Math.min(...windows.map((window) => remainingOf(window) ?? 0));
}

export function windowLabel(seconds: number): string {
  if (!seconds) return 'Quota';
  if (seconds <= 6 * 3600) return '5h';
  if (seconds <= 25 * 3600) return '24h';
  if (seconds >= 6 * 86400) return 'Week';
  if (seconds >= 86400) return `${Math.round(seconds / 86400)}d`;
  if (seconds >= 3600) return `${Math.round(seconds / 3600)}h`;
  return `${Math.round(seconds / 60)}m`;
}

export function resetLabel(window: QuotaWindow | undefined | null): string | null {
  if (!window || !window.reset_at) return null;
  const target = window.reset_at * 1000;
  if (target <= Date.now()) return 'reset due';
  return `resets ${relativeFromNow(target)}`;
}

export type Tone = 'ok' | 'warn' | 'bad' | 'neutral';

export function statusOf(account: Account): { tone: AccountStatus | 'ready'; text: string } {
  if (account.status === 'active') {
    return { tone: 'ready', text: 'Ready' };
  }
  if (account.status === 'rate_limited') {
    if (account.cooldown_until && account.cooldown_until <= Date.now()) {
      return { tone: 'ready', text: 'Ready' };
    }
    return {
      tone: 'rate_limited',
      text: account.cooldown_until
        ? `Limited · resets ${relativeFromNow(account.cooldown_until).replace(/^in /, 'in ')}`
        : 'Limited',
    };
  }
  if (account.status === 'expired') return { tone: 'expired', text: 'Sign-in expired' };
  return { tone: 'error', text: account.status_reason ?? 'Error' };
}

export function toneClass(tone: string): Tone {
  if (tone === 'ready') return 'ok';
  if (tone === 'rate_limited') return 'warn';
  if (tone === 'expired' || tone === 'error') return 'bad';
  return 'neutral';
}

export function barTone(left: number): 'ok' | 'warn' | 'low' {
  if (left <= 15) return 'low';
  if (left <= 45) return 'warn';
  return 'ok';
}

export function planLabel(plan: string | null): string | null {
  if (!plan) return null;
  if (plan === 'plus') return 'Plus';
  if (plan === 'pro') return 'Pro';
  if (plan === 'team') return 'Team';
  if (plan === 'enterprise') return 'Enterprise';
  if (plan === 'free') return 'Free';
  return plan.charAt(0).toUpperCase() + plan.slice(1);
}

export function shortHome(path: string): string {
  return path.replace(/^\/Users\/[^/]+/, '~');
}

export function shortUrl(url: string): string {
  return url.replace(/^https?:\/\//, '').replace(/\/v1$/, '');
}

export function percentile(values: number[], p: number): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((left, right) => left - right);
  const index = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
  return sorted[Math.max(0, index)] ?? null;
}

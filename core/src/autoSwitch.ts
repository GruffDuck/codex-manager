import { restartController, RestartError, type RestartController } from './restart.js';
import { setSetting } from './db.js';
import {
  activeCodexAccountId,
  currentAccountId,
  listPublic,
  refreshQuota,
  switchTo,
  type AccountPublic,
} from './accounts.js';
import type { AppConfig } from './paths.js';
import { loadSettings, type AppSettings } from './settings.js';
import { pushEvent } from './events.js';

export interface AutoSwitchResult {
  enabled: boolean;
  action: 'switched' | 'kept' | 'no_alternative' | 'no_accounts' | 'disabled' | 'prepared' | 'deferred' | 'unavailable';
  reason: string;
  current: { id: string; email: string; remaining: number | null } | null;
  target: { id: string; email: string; remaining: number | null } | null;
  threshold: number;
  checked_at: number;
}

/** Remaining headroom is the tightest of the active quota windows. */
export function remainingPercent(account: AccountPublic): number | null {
  const windows = [account.quota?.primary, account.quota?.secondary].filter(
    (window): window is NonNullable<typeof window> => Boolean(window && typeof window.used_percent === 'number'),
  );
  if (windows.length === 0) return null;
  const used = Math.max(...windows.map((window) => window.used_percent));
  return Math.max(0, Math.min(100, Math.round(100 - used)));
}

function describe(account: AccountPublic): { id: string; email: string; remaining: number | null } {
  return { id: account.id, email: account.email, remaining: remainingPercent(account) };
}

let inFlight: Promise<AutoSwitchResult> | null = null;
const lowQuotaSeen = new Map<string, number>();
const errorSeen = new Map<string, string>();

function noteAccountHealth(accounts: AccountPublic[], settings: AppSettings): void {
  for (const account of accounts) {
    const remaining = remainingPercent(account);
    const key = account.id;
    if (remaining !== null) {
      const previous = lowQuotaSeen.get(key);
      const below = remaining <= settings.notifications.low_quota_threshold;
      const captured = account.quota?.captured_at ?? 0;
      if (below && previous !== captured) {
        lowQuotaSeen.set(key, captured);
        if (settings.notifications.low_quota) {
          pushEvent({
            type: 'low_quota',
            title: `${account.email} is low on quota`,
            detail: `${remaining}% remaining — below the ${settings.notifications.low_quota_threshold}% warning line.`,
            account_id: account.id,
            notify: true,
          });
        }
      } else if (!below && previous !== undefined) {
        lowQuotaSeen.delete(key);
      }
    }

    if (account.status === 'expired' || account.status === 'error') {
      const signature = `${account.status}:${account.status_reason ?? ''}`;
      if (errorSeen.get(key) !== signature) {
        errorSeen.set(key, signature);
        if (settings.notifications.account_errors) {
          pushEvent({
            type: 'account_error',
            title: `${account.email} needs attention`,
            detail: account.status_reason ?? (account.status === 'expired' ? 'Sign-in expired.' : 'Account error.'),
            account_id: account.id,
            notify: true,
          });
        }
      }
    } else {
      errorSeen.delete(key);
    }

    if (account.status === 'rate_limited' && account.eligible === false) {
      const signature = `limited:${account.cooldown_until ?? 0}`;
      if (errorSeen.get(key) !== signature) {
        errorSeen.set(key, signature);
        if (settings.notifications.account_errors) {
          pushEvent({
            type: 'quota_exhausted',
            title: `${account.email} hit its quota limit`,
            detail: account.cooldown_until
              ? `Routing paused until ${new Date(account.cooldown_until).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}.`
              : 'Routing paused until the quota window resets.',
            account_id: account.id,
            notify: true,
          });
        }
      }
    }
  }
}

/**
 * Refreshes stale quota snapshots and emits low-quota / account-error events.
 * This runs even when auto-switch is off, so notifications still work. Duplicate
 * events are suppressed until the quota snapshot or status changes.
 */
export async function scanAccountHealth(
  config: AppConfig,
  settings: AppSettings = loadSettings(),
  refreshAfterMs = 10 * 60 * 1000,
): Promise<AccountPublic[]> {
  let accounts = listPublic(config);
  const cutoff = Date.now() - refreshAfterMs;
  let refreshed = false;
  for (const account of accounts) {
    const captured = account.quota?.captured_at ?? 0;
    if (captured >= cutoff) continue;
    try {
      await refreshQuota(account.id, config);
      refreshed = true;
    } catch {
      /* the next sweep retries; the row already carries the error */
    }
  }
  if (refreshed) accounts = listPublic(config);
  noteAccountHealth(accounts, settings);
  return accounts;
}

async function execute(config: AppConfig, restarter: Pick<RestartController, 'status' | 'restart'>): Promise<AutoSwitchResult> {
  const settings = loadSettings();
  const checkedAt = Date.now();
  const base = {
    enabled: settings.auto_switch.enabled,
    threshold: settings.auto_switch.remaining_threshold,
    checked_at: checkedAt,
  };

  if (!settings.auto_switch.enabled) {
    return {
      ...base,
      action: 'disabled',
      reason: 'Auto-switch is turned off.',
      current: null,
      target: null,
    };
  }

  // Quota polling is the heartbeat of the feature: snapshots older than one
  // interval are refreshed before deciding. Failures are shown on the account
  // row and never abort the whole check.
  const accounts = settings.auto_switch.allow_refresh
    ? await scanAccountHealth(config, settings, settings.auto_switch.interval_seconds * 1000)
    : await scanAccountHealth(config, settings, Number.POSITIVE_INFINITY);

  if (accounts.length === 0) {
    return {
      ...base,
      action: 'no_accounts',
      reason: 'No accounts are connected.',
      current: null,
      target: null,
    };
  }

  const restartStatus = settings.auto_switch.target === 'codex' ? await restarter.status() : null;
  if (restartStatus && !restartStatus.supported) {
    return { ...base, action: 'unavailable', reason: restartStatus.reason, current: null, target: null };
  }
  if (restartStatus && !restartStatus.running) {
    return { ...base, action: 'kept', reason: 'Codex is closed. Automatic switching waits until it is running.', current: null, target: null };
  }
  const linkedId = activeCodexAccountId();
  const chosenId = restartStatus ? linkedId : linkedId ?? currentAccountId();
  const current = accounts.find((account) => account.id === chosenId) ?? null;
  if (restartStatus && !current) {
    return { ...base, action: 'no_alternative', reason: 'The selected Codex login is not in Manager. Choose an account first.', current: null, target: null };
  }

  const ranked = accounts
    .filter((account) => account.eligible && remainingPercent(account) !== null && remainingPercent(account)! > settings.auto_switch.remaining_threshold)
    .map((account) => ({ account, remaining: remainingPercent(account) }))
    .sort((left, right) => (right.remaining ?? -1) - (left.remaining ?? -1));

  const alternative = ranked.find((entry) => entry.account.id !== current?.id) ?? null;
  const currentRemaining = current ? remainingPercent(current) : null;

  const exhausted = !current || !current.eligible || (currentRemaining !== null && currentRemaining <= settings.auto_switch.remaining_threshold);

  if (!current) {
    if (!alternative) {
      return { ...base, action: 'no_alternative', reason: 'No eligible account to switch to.', current: null, target: null };
    }
    return { ...base, action: 'switched', reason: 'No Codex login was linked; selected the account with the most headroom.', current: null, target: describe(alternative.account) };
  }

  if (!exhausted) {
    return {
      ...base,
      action: 'kept',
      reason: `Current account still has ${currentRemaining === null ? 'unknown' : `${currentRemaining}%`} headroom.`,
      current: describe(current),
      target: null,
    };
  }

  if (!alternative) {
    return {
      ...base,
      action: 'no_alternative',
      reason: 'No other eligible account is available; staying on the current login.',
      current: describe(current),
      target: null,
    };
  }

  const alternativeRemaining = alternative.remaining;
  const meaningful =
    alternativeRemaining === null ||
    currentRemaining === null ||
    alternativeRemaining > Math.max(settings.auto_switch.remaining_threshold, currentRemaining + 2);
  if (!meaningful) {
    return {
      ...base,
      action: 'no_alternative',
      reason: 'The current login is still the best available option.',
      current: describe(current),
      target: null,
    };
  }

  return {
    ...base,
    action: 'switched',
    reason:
      currentRemaining === null
        ? 'Current account has no quota snapshot; moved to a healthy login.'
        : `Current login dropped to ${currentRemaining}% remaining (threshold ${settings.auto_switch.remaining_threshold}%).`,
    current: describe(current),
    target: describe(alternative.account),
  };
}

/** Runs one check, applies the switch, and emits notifications. */
export function runAutoSwitch(config: AppConfig, restarter: Pick<RestartController, 'status' | 'restart'> = restartController): Promise<AutoSwitchResult> {
  if (inFlight) return inFlight;
  const task = (async (): Promise<AutoSwitchResult> => {
    const result = await execute(config, restarter);
    if (result.action === 'switched' && result.target) {
      const settings = loadSettings();
      if (settings.auto_switch.target === 'codex') {
        try {
          const operation = await restarter.restart(result.target.id, config, 'auto');
          if (operation.phase !== 'completed' || operation.account_id !== result.target.id) {
            throw new RestartError('The restart did not complete for the selected login.', 'restart_unverified');
          }
          result.reason += ' Codex closed and reopened with the selected login saved.';
          setSetting('current_account_id', result.target.id);
        } catch (error) {
          if (!(error instanceof RestartError) || !['account_change_busy', 'restart_cooldown'].includes(error.code)) {
            pushEvent({ type: 'account_error', title: 'Codex account restart did not finish',
              detail: error instanceof RestartError ? error.message : 'Check the restart status in Manager.',
              account_id: result.target.id, notify: settings.notifications.account_errors });
          }
          return { ...result, action: error instanceof RestartError && error.code === 'account_change_busy' ? 'deferred' : 'unavailable',
            reason: error instanceof RestartError ? error.message : 'The Codex restart failed. Check its state in Manager.' };
        }
      } else {
        await switchTo(result.target.id, config);
        result.action = 'prepared';
        result.reason += ' CLI login saved. Open desktop sessions were not changed.';
      }
      pushEvent({
        type: 'auto_switch',
        title: `${result.action === 'switched' ? 'Codex switched to' : 'CLI login prepared for'} ${result.target.email}`,
        detail: result.reason,
        account_id: result.target.id,
        notify: settings.notifications.auto_switch,
      });
    }
    return result;
  })();

  inFlight = task.finally(() => {
    inFlight = null;
  });
  return inFlight;
}

/**
 * Background watchdog. It wakes every 15 seconds, but only performs work when
 * the configured interval has elapsed, so setting changes take effect without
 * a restart.
 */
export function startAutoSwitch(config: AppConfig): void {
  let lastRun = 0;
  let running = false;

  const tick = async (): Promise<void> => {
    if (running) return;
    const settings = loadSettings();
    if (!settings.auto_switch.enabled) {
      lastRun = Date.now();
      return;
    }
    if (Date.now() - lastRun < settings.auto_switch.interval_seconds * 1000) return;
    running = true;
    let deferred = false;
    try {
      deferred = (await runAutoSwitch(config)).action === 'deferred';
    } catch {
      /* errors are reflected on the account rows and retried next tick */
    } finally {
      running = false;
      lastRun = deferred ? 0 : Date.now();
    }
  };

  const timer = setInterval(() => void tick(), 15_000);
  timer.unref();
  const first = setTimeout(() => void tick(), 8_000);
  first.unref();
}

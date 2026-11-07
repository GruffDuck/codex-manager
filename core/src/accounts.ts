import fs from 'node:fs';
import { syncLinkedT3Code } from './t3Sync.js';
import { withClientMutation } from './clientMutation.js';
import { seal, open } from './crypto.js';
import {
  getAccount,
  listAccounts,
  logRequest,
  removeAccount,
  setQuota,
  setSetting,
  getSetting,
  setStatus,
  touchAccount,
  updateTokens,
  upsertAccount,
  type AccountRow,
  type AccountStatus,
  type Quota,
} from './db.js';
import {
  accountIdFromIdToken,
  identityFromIdToken,
  readAuthFile,
  switchClientTo,
  type CodexTokens,
} from './codexAuth.js';
import { needsRefresh, refreshTokens } from './oauth.js';
import { fetchUsage } from './quota.js';
import { codexAuthPath, type AppConfig } from './paths.js';

export class AccountError extends Error {
  status: number;
  code: string;

  constructor(message: string, status = 400, code = 'account_error') {
    super(message);
    this.name = 'AccountError';
    this.status = status;
    this.code = code;
  }
}

export interface AccountPublic {
  id: string;
  email: string;
  account_id: string;
  plan_type: string | null;
  status: AccountStatus;
  status_reason: string | null;
  cooldown_until: number | null;
  last_used: number;
  created_at: number;
  quota: Quota | null;
  weight: number;
  is_current: boolean;
  eligible: boolean;
}

export const CURRENT_ACCOUNT_KEY = 'current_account_id';

export function tokensOf(row: AccountRow): CodexTokens {
  try {
    return open<CodexTokens>(row.token_blob);
  } catch {
    throw new AccountError('Stored credentials cannot be decrypted (secret.key changed?)', 500, 'undecryptable');
  }
}

export function currentAccountId(): string | null {
  return getSetting<string | null>(CURRENT_ACCOUNT_KEY, null);
}

/**
 * Anything that hits the upstream should go through this so an expired access
 * token is refreshed once and persisted instead of failing the request.
 */
export async function ensureFresh(row: AccountRow): Promise<CodexTokens> {
  const latest = getAccount(row.id) ?? row;
  const tokens = tokensOf(latest);
  if (!needsRefresh(tokens)) return tokens;
  return forceRefresh(latest);
}

const refreshInFlight = new Map<string, Promise<CodexTokens>>();

/** Unconditional refresh, used after an upstream 401 even if the JWT still looks valid. */
export function forceRefresh(row: AccountRow): Promise<CodexTokens> {
  const pending = refreshInFlight.get(row.id);
  if (pending) return pending;
  const latest = getAccount(row.id) ?? row;
  // A request holding an older row may get a 401 after another request has
  // already rotated the credentials. Retry with those credentials first.
  if (latest.token_blob !== row.token_blob) return ensureFresh(latest);
  const task = refreshAccountTokens(latest).finally(() => {
    refreshInFlight.delete(row.id);
  });
  refreshInFlight.set(row.id, task);
  return task;
}

async function refreshAccountTokens(row: AccountRow): Promise<CodexTokens> {
  const tokens = tokensOf(row);

  try {
    const refreshed = await refreshTokens(tokens);
    const next: CodexTokens = {
      ...tokens,
      access_token: refreshed.access_token,
      refresh_token: refreshed.refresh_token,
    };
    if (refreshed.id_token) next.id_token = refreshed.id_token;
    if (!next.account_id) {
      const derived = accountIdFromIdToken(next.id_token);
      if (derived) next.account_id = derived;
    }
    updateTokens(row.id, seal(next));
    return next;
  } catch (error) {
    const message = (error as Error).message;
    const revoked = /invalid_grant|invalid_token|revoked|token_expired|could not validate/i.test(message);
    setStatus(row.id, revoked ? 'expired' : 'error', message.slice(0, 300), null);
    throw new AccountError(
      revoked ? 'Refresh token was rejected; sign in again' : `Token refresh failed: ${message}`,
      revoked ? 401 : 502,
      revoked ? 'expired' : 'refresh_failed',
    );
  }
}

/** Normalises the many shapes people paste: auth.json, a token bundle, or a bare token pair. */
function normaliseTokens(raw: unknown): CodexTokens {
  if (!raw || typeof raw !== 'object') throw new AccountError('JSON must be an object');
  const root = raw as Record<string, unknown>;
  const candidate =
    root.tokens && typeof root.tokens === 'object'
      ? (root.tokens as Record<string, unknown>)
      : root;

  const access = candidate.access_token;
  const refresh = candidate.refresh_token;
  if (typeof access !== 'string' || !access) {
    throw new AccountError('Missing access_token');
  }
  if (typeof refresh !== 'string' || !refresh) {
    throw new AccountError('Missing refresh_token (needed to keep the account alive)');
  }

  const idToken = typeof candidate.id_token === 'string' ? candidate.id_token : undefined;
  const accountId =
    (typeof candidate.account_id === 'string' ? candidate.account_id : undefined) ??
    accountIdFromIdToken(idToken);
  if (!accountId) {
    throw new AccountError('Missing account_id (not present in the token bundle or id_token)');
  }

  const provenance =
    candidate.oauth_provenance && typeof candidate.oauth_provenance === 'object'
      ? (candidate.oauth_provenance as Record<string, unknown>)
      : undefined;

  return {
    access_token: access,
    refresh_token: refresh,
    ...(idToken ? { id_token: idToken } : {}),
    account_id: accountId,
    ...(typeof candidate.login_owner_id === 'string'
      ? { login_owner_id: candidate.login_owner_id }
      : {}),
    oauth_provenance: {
      issuer:
        (typeof provenance?.issuer === 'string' ? provenance.issuer : undefined) ??
        'https://auth.openai.com',
      client_id:
        (typeof provenance?.client_id === 'string' ? provenance.client_id : undefined) ??
        'app_EMoamEEZ73f0CkXaXp7hrann',
    },
  };
}

function labelFor(tokens: CodexTokens): { email: string; plan: string | null } {
  const identity = identityFromIdToken(tokens.id_token);
  return {
    email: identity.email ?? `account-${tokens.account_id.slice(0, 8)}`,
    plan: identity.plan ?? null,
  };
}

/** Adds or updates one account. Quota is refreshed opportunistically, never fatally. */
export async function addTokens(
  tokens: CodexTokens,
  config: AppConfig,
): Promise<{ account: AccountPublic; warning?: string }> {
  const label = labelFor(tokens);
  let row = upsertAccount({
    id: tokens.account_id,
    email: label.email,
    account_id: tokens.account_id,
    plan_type: label.plan,
    auth_mode: 'chatgpt',
    token_blob: seal(tokens),
  });

  let warning: string | undefined;
  try {
    row = await refreshQuota(row.id, config);
  } catch (error) {
    warning = `Account saved, but the first quota check failed: ${(error as Error).message}`;
  }

  if (!currentAccountId()) setSetting(CURRENT_ACCOUNT_KEY, row.id);
  return { account: toPublic(row, config), ...(warning ? { warning } : {}) };
}

export async function importFromCodexHome(
  config: AppConfig,
  home?: string,
): Promise<{ account: AccountPublic; warning?: string }> {
  const auth = readAuthFile(home ? `${home.replace(/\/+$/, '')}/auth.json` : undefined);
  if (!auth) throw new AccountError('No ~/.codex/auth.json found; run `codex login` first', 404);
  if (auth.auth_mode && auth.auth_mode !== 'chatgpt') {
    throw new AccountError(`auth.json uses auth_mode="${auth.auth_mode}", not a ChatGPT login`, 409);
  }
  const tokens = normaliseTokens(auth);
  return addTokens(tokens, config);
}

export async function addFromJson(
  text: string,
  config: AppConfig,
): Promise<{ account: AccountPublic; warning?: string }> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new AccountError('That is not valid JSON');
  }
  return addTokens(normaliseTokens(parsed), config);
}

export async function addFromOAuth(
  params: { access_token: string; refresh_token: string; id_token?: string },
  config: AppConfig,
): Promise<{ account: AccountPublic; warning?: string }> {
  return addTokens(normaliseTokens({ ...params, oauth_provenance: { issuer: 'https://auth.openai.com' } }), config);
}

function statusFromQuota(quota: Quota): {
  status: AccountStatus;
  reason: string | null;
  cooldownUntil: number | null;
} {
  const windows = [quota.primary, quota.secondary].filter(
    (window): window is NonNullable<typeof window> => Boolean(window),
  );
  const blocked = windows.find((window) => window.used_percent >= 100);
  if (quota.limit_reached || blocked) {
    const window = blocked ?? quota.primary ?? quota.secondary;
    const cooldown =
      window && window.reset_at > 0
        ? window.reset_at * 1000
        : window && window.reset_after_seconds > 0
          ? Date.now() + window.reset_after_seconds * 1000
          : null;
    return { status: 'rate_limited', reason: 'Usage limit reached', cooldownUntil: cooldown };
  }
  return { status: 'active', reason: null, cooldownUntil: null };
}

export async function refreshQuota(id: string, config: AppConfig): Promise<AccountRow> {
  const row = getAccount(id);
  if (!row) throw new AccountError('Account not found', 404, 'not_found');

  const tokens = await ensureFresh(row);
  let usage;
  try {
    usage = await fetchUsage(config, tokens);
  } catch (error) {
    const status = (error as { status?: number }).status;
    if (status === 401) {
      setStatus(id, 'expired', 'Upstream rejected the access token', null);
      throw new AccountError('Upstream rejected the access token; sign in again', 401, 'expired');
    }
    setStatus(id, 'error', (error as Error).message.slice(0, 300), null);
    throw new AccountError(`Quota check failed: ${(error as Error).message}`, 502, 'usage_failed');
  }

  const quota = usage.quota;
  const fresh = getAccount(id)!;
  const email = usage.email ?? fresh.email;
  upsertAccount({
    id: fresh.id,
    email,
    account_id: fresh.account_id,
    plan_type: quota.plan_type ?? fresh.plan_type,
    auth_mode: fresh.auth_mode,
    token_blob: fresh.token_blob,
  });
  setQuota(id, quota);
  const verdict = statusFromQuota(quota);
  setStatus(id, verdict.status, verdict.reason, verdict.cooldownUntil);
  return getAccount(id)!;
}

/** Copies one account into the Codex CLI's auth.json so the terminal client uses it. */
export async function switchTo(id: string, config: AppConfig): Promise<{ path: string; account: AccountPublic; t3_code: import('./t3Sync.js').T3LinkStatus }> {
  return withClientMutation(async () => {
    const row = getAccount(id);
    if (!row) throw new AccountError('Account not found', 404, 'not_found');
    const tokens = await ensureFresh(row);
    const path = switchClientTo(tokens);

    // Keep our quota fresh, but never block the switch on a network failure.
    let updated = row;
    try {
      updated = await refreshQuota(id, config);
    } catch {
      /* the switch already succeeded */
    }

    touchAccount(id);
    setSetting(CURRENT_ACCOUNT_KEY, id);
    logRequest({
      id: `switch-${Date.now()}`,
      account_id: id,
      model: null,
      status: 200,
      latency_ms: null,
      note: 'Switched Codex CLI auth.json',
    });
    const t3_code = await syncLinkedT3Code(tokensOf(getAccount(id) ?? updated), id);
    return { path, account: toPublic(updated, config), t3_code };
  });
}

export function remove(id: string): void {
  if (!getAccount(id)) throw new AccountError('Account not found', 404, 'not_found');
  removeAccount(id);
  if (currentAccountId() === id) {
    const next = listAccounts()[0];
    setSetting(CURRENT_ACCOUNT_KEY, next?.id ?? null);
  }
}

export function isEligible(row: AccountRow, now = Date.now()): boolean {
  if (row.status === 'expired') return false;
  if (row.status === 'rate_limited') {
    return row.cooldown_until !== null && row.cooldown_until <= now;
  }
  if (row.status === 'error') {
    return row.cooldown_until === null || row.cooldown_until <= now;
  }
  return true;
}

export function toPublic(row: AccountRow, _config?: AppConfig): AccountPublic {
  let quota: Quota | null = null;
  if (row.quota_json) {
    try {
      quota = JSON.parse(row.quota_json) as Quota;
    } catch {
      quota = null;
    }
  }
  const values = [quota?.primary?.used_percent, quota?.secondary?.used_percent].filter(
    (value): value is number => typeof value === 'number',
  );
  const remaining = values.length ? 100 - Math.max(...values) : 100;
  const weight = remaining < 25 ? 1 : remaining < 75 ? 2 : 3;
  return {
    id: row.id,
    email: row.email,
    account_id: row.account_id,
    plan_type: row.plan_type,
    status: row.status,
    status_reason: row.status_reason,
    cooldown_until: row.cooldown_until,
    last_used: row.last_used,
    created_at: row.created_at,
    quota,
    weight,
    is_current: currentAccountId() === row.id,
    eligible: isEligible(row),
  };
}

export function listPublic(config: AppConfig): AccountPublic[] {
  return listAccounts().map((row) => toPublic(row, config));
}

/** Reads the Codex CLI login that is active right now, for "is it in sync?" checks. */
export function activeCodexAccountId(): string | null {
  try {
    const auth = readAuthFile();
    if (!auth) return null;
    const tokens = normaliseTokens(auth);
    return getAccount(tokens.account_id) ? tokens.account_id : null;
  } catch {
    return null;
  }
}

export function hasAccounts(): boolean {
  return listAccounts().length > 0;
}

export function accountCounts(): { total: number; active: number } {
  const rows = listAccounts();
  return { total: rows.length, active: rows.filter((row) => isEligible(row)).length };
}

export function backupExists(): boolean {
  return fs.existsSync(`${codexAuthPath()}.codex-manager.bak`);
}

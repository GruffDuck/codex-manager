import path from 'node:path';
import fs from 'node:fs';
import { Readable } from 'node:stream';
import Fastify, { type FastifyInstance, type FastifyRequest } from 'fastify';
import { z } from 'zod';
import {
  accountCounts,
  activeCodexAccountId,
  addFromJson,
  addFromOAuth,
  backupExists,
  currentAccountId,
  ensureFresh,
  forceRefresh,
  importFromCodexHome,
  listPublic,
  refreshQuota,
  remove as removeAccount,
  switchTo,
  tokensOf,
} from './accounts.js';
import {
  listAccounts,
  listRequests,
  logRequest,
  setQuota,
  setSetting,
  setStatus,
  touchAccount,
  type AccountRow,
  type Quota,
} from './db.js';
import { safeEqual } from './crypto.js';
import { quotaFromHeaders } from './quota.js';
import { nextEligibleAt, pickAccount } from './lease.js';
import { newApiKey, saveConfig, upstreamBase, codexHome, type AppConfig } from './paths.js';
import { cancelLogin, exchangeCode, OAUTH_PORT, startLogin } from './login.js';
import { applyCodexConfig, codexConfigStatus, restoreCodexConfig } from './codexConfig.js';
import { loadSettings, SettingsPatchSchema, updateSettings } from './settings.js';
import { listEvents, latestEventId, pushEvent } from './events.js';
import { runAutoSwitch } from './autoSwitch.js';
import { desktop, type DesktopBridge } from './desktop.js';
import { restartController, type RestartController } from './restart.js';

const VERSION = '0.1.0-preview.4';
const HOP_BY_HOP = new Set([
  'content-length',
  'content-encoding',
  'transfer-encoding',
  'connection',
  'keep-alive',
  'proxy-authenticate',
  'proxy-authorization',
  'te',
  'trailer',
  'upgrade',
]);

export interface GatewayDeps {
  config: AppConfig;
  uiDir?: string;
  startedAt?: number;
  desktop?: DesktopBridge;
  restart?: Pick<RestartController, 'status' | 'restart'>;
}

function httpError(status: number, message: string, code = 'error'): Error & { status: number; code: string } {
  return Object.assign(new Error(message), { status, code });
}

function isJson(buffer: Buffer): unknown {
  try {
    return JSON.parse(buffer.toString('utf8'));
  } catch {
    return undefined;
  }
}

function forwardHeaders(request: FastifyRequest, tokens: { access_token: string; account_id: string }): Record<string, string> {
  const headers: Record<string, string> = {
    authorization: `Bearer ${tokens.access_token}`,
    'chatgpt-account-id': tokens.account_id,
    originator: (request.headers.originator as string | undefined) ?? 'codex_cli_rs',
    accept: (request.headers.accept as string | undefined) ?? 'text/event-stream',
    'content-type': 'application/json',
  };
  for (const name of ['user-agent', 'version', 'session_id', 'conversation_id', 'openai-beta', 'x-codex-installation-id']) {
    const value = request.headers[name];
    if (typeof value === 'string' && value) headers[name] = value;
  }
  return headers;
}

function copyHeaders(upstream: Response, extra: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  upstream.headers.forEach((value, key) => {
    if (!HOP_BY_HOP.has(key.toLowerCase())) out[key] = value;
  });
  return { ...out, ...extra };
}

function quotaFromRow(row: AccountRow): Quota | null {
  if (!row.quota_json) return null;
  try {
    return JSON.parse(row.quota_json) as Quota;
  } catch {
    return null;
  }
}

function cooldownOf(quota: Quota): number | null {
  const windows = [quota.primary, quota.secondary].filter(
    (window): window is NonNullable<typeof window> => Boolean(window && window.used_percent >= 100),
  );
  const window = windows[0] ?? quota.primary ?? quota.secondary;
  if (!window) return null;
  if (window.reset_at > 0) return window.reset_at * 1000;
  if (window.reset_after_seconds > 0) return Date.now() + window.reset_after_seconds * 1000;
  return null;
}

/** Every upstream response carries the freshest quota; use it before anything else. */
function captureQuota(row: AccountRow, headers: Headers, retryAfterSeconds?: number): Quota | null {
  const quota = quotaFromHeaders(headers, quotaFromRow(row));
  if (!quota) {
    if (retryAfterSeconds && Number.isFinite(retryAfterSeconds)) {
      setStatus(row.id, 'rate_limited', 'Upstream asked us to retry later', Date.now() + retryAfterSeconds * 1000);
    }
    return null;
  }
  if (row.status === 'expired') return quota;

  setQuota(row.id, quota);
  const blocked =
    quota.limit_reached ||
    (quota.primary?.used_percent ?? 0) >= 100 ||
    (quota.secondary?.used_percent ?? 0) >= 100;
  if (blocked) {
    const cooldown = cooldownOf(quota) ?? (retryAfterSeconds ? Date.now() + retryAfterSeconds * 1000 : null);
    setStatus(row.id, 'rate_limited', 'Usage limit reached', cooldown);
  } else if (row.status !== 'active') {
    setStatus(row.id, 'active', null, null);
  }
  return quota;
}

async function readJson<T>(request: FastifyRequest, schema: z.ZodType<T>): Promise<T> {
  const raw = request.body;
  if (!Buffer.isBuffer(raw) || raw.length === 0) throw httpError(400, 'A JSON body is required', 'bad_request');
  const parsed = isJson(raw);
  if (parsed === undefined) throw httpError(400, 'Body is not valid JSON', 'bad_request');
  const result = schema.safeParse(parsed);
  if (!result.success) {
    const detail = result.error.issues
      .map((issue) => `${issue.path.join('.') || 'body'}: ${issue.message}`)
      .join('; ');
    throw httpError(400, detail, 'bad_request');
  }
  return result.data;
}

function maskKey(key: string): string {
  return key.length <= 10 ? '***' : `${key.slice(0, 6)}…${key.slice(-4)}`;
}

function stamp(date = new Date()): string {
  return date.toISOString().slice(0, 10);
}

function attachment(reply: { header(name: string, value: string): unknown }, filename: string): void {
  reply.header('content-disposition', `attachment; filename="${filename}"`);
  reply.header('cache-control', 'no-store');
}

function hasCredentials(entry: unknown): boolean {
  if (!entry || typeof entry !== 'object') return false;
  const root = entry as Record<string, unknown>;
  const candidate = root.credentials && typeof root.credentials === 'object' ? root.credentials : root;
  const tokens = candidate as Record<string, unknown>;
  return typeof tokens.access_token === 'string' || typeof tokens.refresh_token === 'string';
}

function importBundles(parsed: unknown): unknown[] {
  if (Array.isArray(parsed)) return parsed;
  if (parsed && typeof parsed === 'object') {
    const accounts = (parsed as { accounts?: unknown }).accounts;
    if (Array.isArray(accounts)) {
      return accounts.map((entry) => {
        if (entry && typeof entry === 'object' && 'credentials' in entry) {
          return (entry as { credentials: unknown }).credentials;
        }
        return entry;
      });
    }
  }
  return [parsed];
}

function accountExport(includeCredentials: boolean) {
  return {
    format: 'codex-manager.accounts',
    version: 1,
    exported_at: new Date().toISOString(),
    contains_credentials: includeCredentials,
    account_count: listAccounts().length,
    accounts: listAccounts().map((row) => {
      const quota = quotaFromRow(row);
      const base = {
        email: row.email,
        account_id: row.account_id,
        plan_type: row.plan_type,
        status: row.status,
        status_reason: row.status_reason,
        quota,
        last_used: row.last_used,
        created_at: row.created_at,
        is_current: currentAccountId() === row.id,
      };
      if (!includeCredentials) return base;
      return { ...base, credentials: tokensOf(row) };
    }),
  };
}

export async function buildGateway(deps: GatewayDeps): Promise<FastifyInstance> {
  const config = deps.config;
  const live = deps.desktop ?? desktop;
  const restarter = deps.restart ?? restartController;
  const startedAt = deps.startedAt ?? Date.now();
  const app = Fastify({ logger: false, bodyLimit: 32 * 1024 * 1024 });

  // Raw JSON bodies: /v1 traffic is forwarded byte-for-byte instead of being re-encoded.
  app.addContentTypeParser('application/json', { parseAs: 'buffer' }, (_request, body, done) => {
    done(null, body);
  });

  app.addHook('onRequest', async (request, reply) => {
    const route = request.url.split('?')[0] ?? '';
    if (route.startsWith('/api/')) {
      const host = request.headers.host?.split(':')[0];
      const origin = request.headers.origin;
      let originAllowed = !origin;
      if (origin) {
        try {
          const url = new URL(origin);
          originAllowed = url.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(url.hostname)
            && url.host === request.headers.host;
        } catch { originAllowed = false; }
      }
      if (!['localhost', '127.0.0.1'].includes(host ?? '') || !originAllowed || request.headers['sec-fetch-site'] === 'cross-site') {
        return reply.code(403).send({ error: { code: 'local_origin_required', message: 'Open Manager locally to manage accounts.' } });
      }
    }
    if (!route.startsWith('/v1')) return;
    const header = request.headers.authorization ?? '';
    const bearer = header.toLowerCase().startsWith('bearer ') ? header.slice(7).trim() : '';
    const fallback = (request.headers['x-api-key'] as string | undefined) ?? '';
    const presented = bearer || fallback;
    if (!presented || !safeEqual(presented, config.api_key)) {
      reply
        .code(401)
        .header('www-authenticate', 'Bearer realm="codex-manager"')
        .send({
          error: {
            message: 'Invalid API key. Use the key shown in Codex Manager.',
            type: 'invalid_request_error',
            code: 'invalid_api_key',
          },
        });
    }
  });

  app.setErrorHandler((error, _request, reply) => {
    const err = error as Error & { status?: number; code?: string };
    const status = err.status ?? 500;
    const code = err.code ?? 'error';
    if (status >= 500) app.log.error(err);
    void reply.code(status).send({
      error: { message: err.message, type: status >= 500 ? 'server_error' : 'invalid_request_error', code },
    });
  });

  app.get('/healthz', async () => {
    const counts = accountCounts();
    return {
      ok: true,
      management_api: 3,
      version: VERSION,
      accounts: counts,
      uptime_ms: Date.now() - startedAt,
    };
  });

  // ---------------------------------------------------------------- Responses

  app.post('/v1/responses', async (request, reply) => {
    const raw = request.body as unknown;
    if (!Buffer.isBuffer(raw) || raw.length === 0) throw httpError(400, 'A JSON body is required', 'bad_request');

    const payload = isJson(raw) as { model?: unknown; stream?: unknown } | undefined;
    if (!payload) throw httpError(400, 'Body is not valid JSON', 'bad_request');
    const model = typeof payload.model === 'string' ? payload.model : null;
    const wantsStream = payload.stream === true || (request.headers.accept ?? '').includes('text/event-stream');
    const pinHeader = request.headers['x-codex-account'];
    const pin = typeof pinHeader === 'string' && pinHeader.trim() ? pinHeader.trim() : null;

    if (listAccounts().length === 0) {
      throw httpError(
        503,
        'No Codex accounts configured yet. Add one in Codex Manager (import from ~/.codex/auth.json or sign in).',
        'no_accounts',
      );
    }

    const requestId = `req-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
    const started = Date.now();
    const tried = new Set<string>();
    const maxAttempts = Math.max(1, Math.min(config.max_account_attempts, listAccounts().length));
    let lastFailure: { status: number; body: Buffer; headers: Record<string, string> } | null = null;

    for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
      const lease = pickAccount({ exclude: tried, pin });
      if (!lease) break;
      const row = lease.row;
      tried.add(row.id);

      let tokens;
      try {
        tokens = await ensureFresh(row);
      } catch (error) {
        lastFailure = {
          status: (error as { status?: number }).status ?? 502,
          body: Buffer.from(JSON.stringify({ error: { message: (error as Error).message, code: 'token_error' } })),
          headers: { 'content-type': 'application/json' },
        };
        continue;
      }

      const url = `${upstreamBase(config)}/responses`;
      const sendUpstream = async (accessToken: string, accountId: string): Promise<Response> => {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), config.request_timeout_ms);
        timer.unref();
        const headers = forwardHeaders(request, { access_token: accessToken, account_id: accountId });
        if (wantsStream) headers.accept = 'text/event-stream';
        try {
          return await fetch(url, {
            method: 'POST',
            headers,
            body: raw as unknown as Uint8Array,
            signal: controller.signal,
          });
        } finally {
          clearTimeout(timer);
        }
      };

      let upstream: Response;
      try {
        upstream = await sendUpstream(tokens.access_token, tokens.account_id);
        if (upstream.status === 401) {
          // A still-valid-looking JWT can be revoked server-side; refresh once and retry this account.
          const refreshed = await forceRefresh(row).catch(() => null);
          if (refreshed) {
            upstream.body?.cancel().catch(() => {});
            upstream = await sendUpstream(refreshed.access_token, refreshed.account_id);
          }
        }
      } catch (error) {
        lastFailure = {
          status: 502,
          body: Buffer.from(
            JSON.stringify({ error: { message: `Upstream unreachable: ${(error as Error).message}`, code: 'upstream_unreachable' } }),
          ),
          headers: { 'content-type': 'application/json' },
        };
        continue;
      }

      const retryAfter = Number(upstream.headers.get('retry-after') ?? NaN);
      captureQuota(row, upstream.headers, Number.isFinite(retryAfter) ? retryAfter : undefined);

      if (upstream.status === 401) {
        setStatus(row.id, 'expired', 'Upstream rejected the credentials', null);
        lastFailure = {
          status: 401,
          body: Buffer.from(await upstream.text()).subarray(0, 4000),
          headers: { 'content-type': upstream.headers.get('content-type') ?? 'application/json' },
        };
        continue;
      }

      if (upstream.status === 429) {
        lastFailure = {
          status: 429,
          body: Buffer.from((await upstream.text()).slice(0, 4000)),
          headers: { 'content-type': upstream.headers.get('content-type') ?? 'application/json' },
        };
        continue;
      }

      if (upstream.status >= 500) {
        lastFailure = {
          status: upstream.status,
          body: Buffer.from((await upstream.text()).slice(0, 4000)),
          headers: { 'content-type': upstream.headers.get('content-type') ?? 'application/json' },
        };
        continue;
      }

      touchAccount(row.id);
      const extra = {
        'x-codex-manager-account': row.email,
        'x-codex-manager-account-id': row.account_id,
        'x-codex-manager-request-id': requestId,
        'x-codex-manager-attempts': String(attempt + 1),
      };

      if (wantsStream && upstream.body) {
        reply.hijack();
        reply.raw.writeHead(upstream.status, copyHeaders(upstream, extra));
        const stream = Readable.fromWeb(upstream.body as Parameters<typeof Readable.fromWeb>[0]);
        stream.on('error', () => {
          reply.raw.destroy();
        });
        reply.raw.on('close', () => {
          stream.destroy();
          logRequest({
            id: requestId,
            account_id: row.id,
            model,
            status: upstream.status,
            latency_ms: Date.now() - started,
            note: 'stream closed',
          });
        });
        stream.pipe(reply.raw);
        return reply;
      }

      const body = Buffer.from(await upstream.arrayBuffer());
      logRequest({
        id: requestId,
        account_id: row.id,
        model,
        status: upstream.status,
        latency_ms: Date.now() - started,
        note: null,
      });
      for (const [key, value] of Object.entries(copyHeaders(upstream, extra))) reply.header(key, value);
      return reply.code(upstream.status).send(body);
    }

    if (lastFailure) {
      logRequest({
        id: requestId,
        account_id: null,
        model,
        status: lastFailure.status,
        latency_ms: Date.now() - started,
        note: 'all attempts failed',
      });
      for (const [key, value] of Object.entries(lastFailure.headers)) reply.header(key, value);
      reply.header('x-codex-manager-request-id', requestId);
      reply.header('x-codex-manager-attempts', String(tried.size));
      const resumeAt = nextEligibleAt();
      if (resumeAt) reply.header('retry-after', String(Math.max(1, Math.ceil((resumeAt - Date.now()) / 1000))));
      return reply.code(lastFailure.status).send(lastFailure.body);
    }

    const resumeAt = nextEligibleAt();
    const seconds = resumeAt ? Math.max(1, Math.ceil((resumeAt - Date.now()) / 1000)) : 60;
    logRequest({
      id: requestId,
      account_id: null,
      model,
      status: 429,
      latency_ms: Date.now() - started,
      note: 'no eligible account',
    });
    return reply
      .code(429)
      .header('retry-after', String(seconds))
      .send({
        error: {
          message: 'Every Codex account is rate limited or unavailable.',
          type: 'rate_limit_error',
          code: 'all_accounts_exhausted',
          resume_after_seconds: seconds,
        },
      });
  });

  // ------------------------------------------------------------------- Models

  let modelsCache: { at: number; body: unknown } | null = null;

  app.get('/v1/models', async (_request, reply) => {
    if (modelsCache && Date.now() - modelsCache.at < 5 * 60 * 1000) return modelsCache.body;

    const lease = pickAccount();
    if (!lease) throw httpError(429, 'No eligible Codex account for model discovery', 'all_accounts_exhausted');
    const tokens = await ensureFresh(lease.row);
    const clientVersion = '0.164.0';
    const response = await fetch(`${upstreamBase(config)}/models?client_version=${clientVersion}`, {
      headers: {
        authorization: `Bearer ${tokens.access_token}`,
        'chatgpt-account-id': tokens.account_id,
        originator: 'codex_cli_rs',
        accept: 'application/json',
      },
      signal: AbortSignal.timeout(20_000),
    });
    if (!response.ok) {
      throw httpError(502, `Model discovery failed upstream with HTTP ${response.status}`, 'models_failed');
    }
    const body = (await response.json()) as unknown;
    modelsCache = { at: Date.now(), body };
    void reply.header('cache-control', 'private, max-age=300');
    return body;
  });

  app.get('/v1/usage', async () => {
    const accounts = listPublic(config);
    return {
      object: 'codex_manager.usage',
      accounts: accounts.map((account) => ({
        id: account.id,
        email: account.email,
        plan_type: account.plan_type,
        status: account.status,
        cooldown_until: account.cooldown_until,
        quota: account.quota,
      })),
    };
  });

  // ------------------------------------------------------------------ Control

  app.get('/api/state', async () => {
    const counts = accountCounts();
    const requests = listRequests(80);
    return {
      version: VERSION,
      started_at: startedAt,
      uptime_ms: Date.now() - startedAt,
      gateway: {
        port: config.port,
        url: `http://127.0.0.1:${config.port}/v1`,
        upstream_base: upstreamBase(config),
        api_key: config.api_key,
        api_key_masked: maskKey(config.api_key),
        max_account_attempts: config.max_account_attempts,
        request_timeout_ms: config.request_timeout_ms,
        oauth_port: OAUTH_PORT,
      },
      codex_home: codexHome(),
      accounts: listPublic(config),
      counts,
      current_account_id: currentAccountId(),
      codex_auth_account_id: activeCodexAccountId(),
      codex_desktop: await live.status(),
      codex_restart: await restarter.status(),
      backup_exists: backupExists(),
      codex_config: codexConfigStatus(),
      settings: loadSettings(),
      events: listEvents(0, 12),
      event_cursor: latestEventId(),
      requests,
      total_requests: listRequests(500).length,
    };
  });

  app.get('/api/requests', async (request) => {
    const limit = Number((request.query as { limit?: string }).limit ?? 80);
    return { requests: listRequests(Number.isFinite(limit) ? Math.min(Math.max(limit, 1), 500) : 80) };
  });

  app.post('/api/accounts/import', async () => {
    const result = await importFromCodexHome(config);
    pushEvent({
      type: 'import',
      title: `Imported ${result.account.email} from the CLI`,
      detail: result.warning ?? null,
      account_id: result.account.id,
    });
    return { ok: true, ...result };
  });

  app.get('/api/accounts/export', async (request, reply) => {
    const query = request.query as { credentials?: string; download?: string };
    const includeCredentials = query.credentials === '1' || query.credentials === 'true';
    const payload = accountExport(includeCredentials);
    if (query.download === '1') {
      attachment(reply, `codex-manager-accounts-${stamp()}${includeCredentials ? '-with-credentials' : ''}.json`);
    } else {
      reply.header('cache-control', 'no-store');
    }
    if (includeCredentials && payload.accounts.length > 0) {
      pushEvent({
        type: 'export',
        title: 'Exported accounts with credentials',
        detail: 'The downloaded file contains live tokens. Store it carefully.',
      });
    }
    return payload;
  });

  app.post('/api/accounts/import-bulk', async (request) => {
    const body = await readJson(request, z.object({ json: z.string().min(1) }));
    let parsed: unknown;
    try {
      parsed = JSON.parse(body.json);
    } catch {
      throw httpError(400, 'That file is not valid JSON', 'bad_request');
    }

    const entries = importBundles(parsed);
    if (entries.length === 0) throw httpError(400, 'No account entries found in that file', 'bad_request');
    if (entries.length > 100) throw httpError(400, 'Import at most 100 accounts at a time', 'bad_request');

    const results: Array<{ ok: boolean; email?: string; error?: string }> = [];
    for (const entry of entries) {
      if (!hasCredentials(entry)) {
        const email =
          entry && typeof entry === 'object' && typeof (entry as { email?: unknown }).email === 'string'
            ? ((entry as { email: string }).email)
            : undefined;
        results.push({ ok: false, ...(email ? { email } : {}), error: 'Entry has no credentials (metadata-only export)' });
        continue;
      }
      try {
        const added = await addFromJson(JSON.stringify(entry), config);
        results.push({ ok: true, email: added.account.email });
      } catch (error) {
        results.push({ ok: false, error: (error as Error).message });
      }
    }

    const imported = results.filter((row) => row.ok).length;
    const failed = results.length - imported;
    if (imported > 0) {
      pushEvent({
        type: 'import',
        title: `Imported ${imported} account${imported === 1 ? '' : 's'}`,
        detail: failed > 0 ? `${failed} entr${failed === 1 ? 'y' : 'ies'} could not be imported.` : null,
      });
    }
    return { ok: failed === 0, imported, failed, results, accounts: listPublic(config) };
  });

  app.post('/api/accounts/json', async (request) => {
    const body = await readJson(request, z.object({ json: z.string().min(1) }));
    const result = await addFromJson(body.json, config);
    return { ok: true, ...result };
  });

  app.post('/api/accounts/:id/refresh', async (request) => {
    const { id } = request.params as { id: string };
    await refreshQuota(id, config);
    return { ok: true, accounts: listPublic(config) };
  });

  app.post('/api/accounts/refresh-all', async () => {
    const rows = listAccounts();
    const results: Array<{ id: string; ok: boolean; error?: string }> = [];
    for (const row of rows) {
      try {
        await refreshQuota(row.id, config);
        results.push({ id: row.id, ok: true });
      } catch (error) {
        results.push({ id: row.id, ok: false, error: (error as Error).message });
      }
    }
    return { ok: true, results, accounts: listPublic(config) };
  });

  app.post('/api/accounts/:id/switch', async (request) => {
    const { id } = request.params as { id: string };
    const result = await switchTo(id, config);
    pushEvent({
      type: 'switch',
      title: `Codex CLI now uses ${result.account.email}`,
      detail: 'Wrote ~/.codex/auth.json',
      account_id: id,
    });
    return { ok: true, ...result, accounts: listPublic(config) };
  });

  app.get('/api/codex/desktop', async () => live.status());

  app.post('/api/accounts/:id/live-switch', async (request) => {
    const { id } = request.params as { id: string };
    const account = listPublic(config).find((account) => account.id === id);
    if (!account) throw httpError(404, 'Account not found', 'not_found');
    const verified = await live.switchAccount(account.account_id);
    if (verified.state !== 'connected' || verified.account_id !== account.account_id) {
      throw httpError(409, 'Codex did not confirm the selected account.', 'desktop_unverified');
    }
    setSetting('current_account_id', id);
    pushEvent({ type: 'switch', title: `Codex now uses ${account.email}`, detail: 'The running Codex server confirmed the selected account. No restart.', account_id: id });
    return { ok: true, restart_required: false, desktop: verified, accounts: listPublic(config) };
  });

  app.get('/api/codex/restart', async () => restarter.status());
  app.post('/api/accounts/:id/use-in-codex', async (request) => {
    const { id } = request.params as { id: string };
    const operation = await restarter.restart(id, config, 'manual');
    pushEvent({ type: 'switch', title: 'Codex restarted with the selected login',
      detail: 'Codex closed, the login was saved and Codex reopened. The running UI account was not independently read.', account_id: id });
    return { ok: true, restarted: true, restart_required: false, operation, accounts: listPublic(config) };
  });

  // Explicit fallback: prepare credentials without claiming a live switch.
  app.post('/api/accounts/:id/prepare', async (request) => {
    const { id } = request.params as { id: string };
    const result = await switchTo(id, config);
    const written = codexConfigStatus().applied ? restoreCodexConfig() : null;
    pushEvent({
      type: 'switch',
      title: `Codex login prepared for ${result.account.email}`,
      detail: 'Quit and reopen Codex to load this login. The running desktop session has not been verified.',
      account_id: id,
    });
    return {
      ok: true,
      ...result,
      config: written,
      restart_required: true,
      codex_config: codexConfigStatus(),
      accounts: listPublic(config),
    };
  });

  app.post('/api/accounts/:id/use-in-cli', async (request) => {
    const { id } = request.params as { id: string };
    const result = await switchTo(id, config);
    pushEvent({
      type: 'switch',
      title: `Codex CLI now uses ${result.account.email}`,
      detail: 'Wrote ~/.codex/auth.json only; config.toml was left unchanged.',
      account_id: id,
    });
    return { ok: true, ...result, accounts: listPublic(config) };
  });

  app.delete('/api/accounts/:id', async (request) => {
    const { id } = request.params as { id: string };
    removeAccount(id);
    return { ok: true, accounts: listPublic(config) };
  });

  // ------------------------------------------------------- Settings & events

  app.get('/api/settings', async () => ({ settings: loadSettings() }));

  app.patch('/api/settings', async (request) => {
    const patch = await readJson(request, SettingsPatchSchema);
    const settings = updateSettings(patch);
    pushEvent({
      type: 'system',
      title:
        patch.auto_switch?.enabled === true
          ? 'Auto-switch enabled'
          : patch.auto_switch?.enabled === false
            ? 'Auto-switch disabled'
            : 'Settings updated',
      detail: settings.auto_switch.enabled
        ? `Checks every ${Math.round(settings.auto_switch.interval_seconds / 60)} min; switches at ${settings.auto_switch.remaining_threshold}% remaining.`
        : 'Auto-switch is off.',
      notify: false,
    });
    return { ok: true, settings };
  });

  app.get('/api/events', async (request) => {
    const query = request.query as { since?: string; limit?: string };
    const since = Number(query.since ?? 0);
    const limit = Number(query.limit ?? 60);
    return {
      events: listEvents(Number.isFinite(since) ? since : 0, Number.isFinite(limit) ? limit : 60),
      cursor: latestEventId(),
    };
  });

  app.post('/api/auto-switch/check', async () => {
    const result = await runAutoSwitch(config, restarter);
    return { ok: true, ...result, accounts: listPublic(config) };
  });

  app.get('/api/diagnostics', async (request, reply) => {
    const query = request.query as { download?: string };
    const generated = new Date();
    if (query.download === '1') attachment(reply, `codex-manager-diagnostics-${stamp(generated)}.json`);
    else reply.header('cache-control', 'no-store');

    return {
      format: 'codex-manager.diagnostics',
      version: VERSION,
      generated_at: generated.toISOString(),
      app: {
        version: VERSION,
        uptime_ms: Date.now() - startedAt,
        node: process.version,
        platform: process.platform,
        arch: process.arch,
        pid: process.pid,
        memory_mb: Math.round(process.memoryUsage().rss / 1024 / 1024),
      },
      gateway: {
        port: config.port,
        url: `http://127.0.0.1:${config.port}/v1`,
        upstream_base: upstreamBase(config),
        api_key_masked: maskKey(config.api_key),
        max_account_attempts: config.max_account_attempts,
        request_timeout_ms: config.request_timeout_ms,
        oauth_port: OAUTH_PORT,
      },
      codex_home: codexHome(),
      codex_config: codexConfigStatus(),
      counts: accountCounts(),
      settings: loadSettings(),
      accounts: listPublic(config),
      requests: listRequests(120),
      events: listEvents(0, 60),
    };
  });

  // --------------------------------------------------------------------- OAuth

  app.post('/api/login/start', async () => {
    const session = await startLogin(
      {
        onCode: async (code, state) => {
          const tokens = await exchangeCode({ code, state });
          const { account } = await addFromOAuth(tokens, config);
          return { label: account.email };
        },
      },
      { port: OAUTH_PORT },
    ).catch((error: NodeJS.ErrnoException) => {
      if (error.code === 'EADDRINUSE') {
        throw httpError(
          409,
          `Port ${OAUTH_PORT} is busy (a \`codex login\` window may be open). Close it and try again.`,
          'oauth_port_busy',
        );
      }
      throw error;
    });
    return { ok: true, ...session };
  });

  app.post('/api/login/cancel', async () => {
    cancelLogin();
    return { ok: true };
  });

  // -------------------------------------------------------------------- Config

  app.patch('/api/config', async (request) => {
    const body = await readJson(
      request,
      z.object({
        upstream_base: z.string().url().optional(),
        max_account_attempts: z.number().int().min(1).max(5).optional(),
        request_timeout_ms: z.number().int().min(10_000).max(600_000).optional(),
      }),
    );
    if (body.upstream_base) config.upstream_base = body.upstream_base.replace(/\/+$/, '');
    if (body.max_account_attempts) config.max_account_attempts = body.max_account_attempts;
    if (body.request_timeout_ms) config.request_timeout_ms = body.request_timeout_ms;
    saveConfig(config);
    modelsCache = null;
    return { ok: true, gateway: { ...config, api_key: maskKey(config.api_key) } };
  });

  app.post('/api/key/rotate', async () => {
    config.api_key = newApiKey();
    saveConfig(config);
    return { ok: true, api_key: config.api_key };
  });

  app.post('/api/codex/config', async (request) => {
    const body = await readJson(
      request,
      z.object({ model: z.string().optional(), model_provider: z.string().optional() }).default({}),
    );
    const result = applyCodexConfig({
      port: config.port,
      apiKey: config.api_key,
      ...(body?.model ? { model: body.model } : {}),
      ...(body?.model_provider ? { provider: body.model_provider } : {}),
    });
    setSetting('codex_config_applied_at', Date.now());
    return { ok: true, ...result };
  });

  app.delete('/api/codex/config', async () => {
    const result = restoreCodexConfig();
    return { ok: true, ...result };
  });

  // ---------------------------------------------------------------- Static UI

  const uiDir = deps.uiDir ?? path.resolve(process.cwd(), 'ui/dist');
  const indexFile = path.join(uiDir, 'index.html');

  if (fs.existsSync(indexFile)) {
    app.get('/', async (_request, reply) => {
      reply.type('text/html; charset=utf-8');
      return fs.createReadStream(indexFile);
    });

    app.get('/assets/*', async (request, reply) => {
      const relative = (request.params as { '*': string })['*'];
      const resolved = path.resolve(uiDir, 'assets', relative);
      if (!resolved.startsWith(path.resolve(uiDir, 'assets'))) throw httpError(403, 'Forbidden', 'forbidden');
      if (!fs.existsSync(resolved)) throw httpError(404, 'Not found', 'not_found');
      const ext = path.extname(resolved);
      const types: Record<string, string> = {
        '.js': 'text/javascript; charset=utf-8',
        '.css': 'text/css; charset=utf-8',
        '.svg': 'image/svg+xml',
        '.woff2': 'font/woff2',
        '.png': 'image/png',
      };
      reply.type(types[ext] ?? 'application/octet-stream');
      reply.header('cache-control', 'public, max-age=31536000, immutable');
      return fs.createReadStream(resolved);
    });

    // Fonts and other public files sit beside index.html rather than under
    // assets/. Without this route the SPA fallback would answer a font request
    // with HTML, and the browser would silently fall back to a system face.
    app.get('/fonts/*', async (request, reply) => {
      const relative = (request.params as { '*': string })['*'];
      const fontsDir = path.resolve(uiDir, 'fonts');
      const resolved = path.resolve(fontsDir, relative);
      if (!resolved.startsWith(fontsDir)) throw httpError(403, 'Forbidden', 'forbidden');
      if (!fs.existsSync(resolved)) throw httpError(404, 'Not found', 'not_found');
      reply.type('font/woff2');
      reply.header('cache-control', 'public, max-age=31536000, immutable');
      return fs.createReadStream(resolved);
    });


    app.setNotFoundHandler((request, reply) => {
      if (request.method === 'GET' && !request.url.startsWith('/api') && !request.url.startsWith('/v1')) {
        reply.type('text/html; charset=utf-8');
        return reply.send(fs.createReadStream(indexFile));
      }
      return reply.code(404).send({
        error: { message: 'Not found', type: 'invalid_request_error', code: 'not_found' },
      });
    });
  } else {
    app.get('/', async (_request, reply) => {
      reply.type('text/plain; charset=utf-8');
      return [
        'Codex Manager core is running.',
        '',
        'The UI bundle was not found. Run `npm run dev` (Vite on :5173) or `npm run build`.',
        '',
        `Gateway: http://127.0.0.1:${config.port}/v1`,
        `API key: ${config.api_key}`,
      ].join('\n');
    });
  }

  return app;
}

import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const home = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-manager-gateway-'));
process.env.HOME = home;
process.env.USERPROFILE = home;
process.env.CODEX_HOME = path.join(home, '.codex');
fs.mkdirSync(process.env.CODEX_HOME, { recursive: true });

const ACCOUNT_A = '11111111-1111-4111-8111-111111111111';
const ACCOUNT_B = '22222222-2222-4222-8222-222222222222';

function quotaHeaders(primary: number, secondary: number): Record<string, string> {
  return {
    'x-codex-plan-type': 'plus',
    'x-codex-primary-used-percent': String(primary),
    'x-codex-secondary-used-percent': String(secondary),
    'x-codex-primary-window-minutes': '300',
    'x-codex-secondary-window-minutes': '10080',
    'x-codex-primary-reset-after-seconds': '3600',
    'x-codex-secondary-reset-after-seconds': '86400',
    'x-codex-primary-reset-at': String(Math.floor(Date.now() / 1000) + 3600),
    'x-codex-secondary-reset-at': String(Math.floor(Date.now() / 1000) + 86400),
  };
}

const mock = http.createServer((request, response) => {
  const url = new URL(request.url ?? '/', 'http://127.0.0.1');
  const account = String(request.headers['chatgpt-account-id'] ?? 'unknown');

  if (url.pathname.endsWith('/wham/usage')) {
    const id = account.slice(0, 6);
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end(
      JSON.stringify({
        account_id: account,
        email: `${id}@mock.local`,
        plan_type: 'plus',
        rate_limit: {
          allowed: true,
          limit_reached: false,
          primary_window: {
            used_percent: 5,
            limit_window_seconds: 18000,
            reset_after_seconds: 3600,
            reset_at: Math.floor(Date.now() / 1000) + 3600,
          },
          secondary_window: {
            used_percent: 1,
            limit_window_seconds: 604800,
            reset_after_seconds: 86400,
            reset_at: Math.floor(Date.now() / 1000) + 86400,
          },
        },
      }),
    );
    return;
  }

  if (url.pathname.endsWith('/models')) {
    response.writeHead(200, { 'content-type': 'application/json', ...quotaHeaders(5, 1) });
    response.end(JSON.stringify({ object: 'list', data: [{ id: 'mock-large', object: 'model' }] }));
    return;
  }

  if (url.pathname.endsWith('/responses')) {
    let body = '';
    request.on('data', (chunk) => {
      body += chunk;
    });
    request.on('end', () => {
      const parsed = JSON.parse(body || '{}') as { model?: string };

      if (parsed.model === 'limited') {
        response.writeHead(429, { 'content-type': 'application/json', ...quotaHeaders(100, 90) });
        response.end(JSON.stringify({ error: { message: 'mock rate limit', code: 'rate_limit_exceeded' } }));
        return;
      }
      if (parsed.model === 'boom') {
        response.writeHead(503, { 'content-type': 'application/json' });
        response.end(JSON.stringify({ error: { message: 'mock unavailable' } }));
        return;
      }

      response.writeHead(200, { 'content-type': 'application/json', ...quotaHeaders(11, 3) });
      response.end(
        JSON.stringify({
          object: 'response',
          id: 'resp_mock',
          echo: {
            authorization: request.headers.authorization,
            account,
            originator: request.headers.originator,
            model: parsed.model,
          },
        }),
      );
    });
    return;
  }

  response.writeHead(404, { 'content-type': 'application/json' });
  response.end('{}');
});

let base = '';
let app: Awaited<ReturnType<typeof import('../core/src/gateway.js').buildGateway>>;

before(async () => {
  await new Promise<void>((resolve) => mock.listen(0, '127.0.0.1', resolve));
  const address = mock.address();
  if (!address || typeof address === 'string') throw new Error('mock server did not bind');
  base = `http://127.0.0.1:${address.port}`;

  const { buildGateway } = await import('../core/src/gateway.js');
  const { addTokens } = await import('../core/src/accounts.js');
  const config = {
    port: 8055,
    api_key: 'sk-gateway-test',
    upstream_base: base,
    max_account_attempts: 2,
    request_timeout_ms: 20_000,
  };
  app = await buildGateway({ config });
  await app.ready();

  for (const [id, token] of [
    [ACCOUNT_A, 'token-a'],
    [ACCOUNT_B, 'token-b'],
  ] as const) {
    await addTokens({ access_token: token, refresh_token: `refresh-${token}`, account_id: id }, config);
  }
});

after(async () => {
  await app?.close();
  await new Promise<void>((resolve) => mock.close(() => resolve()));
});

function post(url: string, payload: unknown, headers: Record<string, string> = {}) {
  return app.inject({
    method: 'POST',
    url,
    headers: { 'content-type': 'application/json', ...headers },
    payload: JSON.stringify(payload),
  });
}

const auth = { authorization: 'Bearer sk-gateway-test' };

test('gateway rejects requests without the local API key', async () => {
  const response = await post('/v1/responses', { model: 'mock-large' });
  assert.equal(response.statusCode, 401);
  assert.equal((response.json() as { error: { code: string } }).error.code, 'invalid_api_key');
});

test('forwards the body, swaps credentials and reports the chosen account', async () => {
  const response = await post('/v1/responses', { model: 'mock-large', input: 'hello' }, auth);
  assert.equal(response.statusCode, 200);
  const body = response.json() as {
    echo: { authorization: string; account: string; originator: string; model: string };
  };
  assert.equal(body.echo.model, 'mock-large');
  assert.match(body.echo.authorization, /^Bearer token-[ab]$/);
  assert.ok([ACCOUNT_A, ACCOUNT_B].includes(body.echo.account));
  assert.equal(body.echo.originator, 'codex_cli_rs');
  assert.ok(response.headers['x-codex-manager-account']);
  assert.equal(response.headers['x-codex-manager-attempts'], '1');
});

test('pins a request to one account', async () => {
  const response = await post(
    '/v1/responses',
    { model: 'mock-large' },
    { ...auth, 'x-codex-account': ACCOUNT_B },
  );
  assert.equal(response.statusCode, 200);
  assert.equal((response.json() as { echo: { account: string } }).echo.account, ACCOUNT_B);
});

test('model discovery is proxied and cached', async () => {
  const response = await app.inject({ method: 'GET', url: '/v1/models', headers: auth });
  assert.equal(response.statusCode, 200);
  const body = response.json() as { data: Array<{ id: string }> };
  assert.equal(body.data[0]?.id, 'mock-large');
});

test('429 exhausts the pool, records quota and returns retry-after', async () => {
  const { listAccounts, setStatus } = await import('../core/src/db.js');
  const { isEligible } = await import('../core/src/accounts.js');

  const response = await post('/v1/responses', { model: 'limited' }, auth);
  assert.equal(response.statusCode, 429);
  assert.equal((response.json() as { error: { message: string } }).error.message, 'mock rate limit');
  const retryAfter = Number(response.headers['retry-after']);
  assert.ok(Number.isFinite(retryAfter) && retryAfter > 0, 'retry-after must be present');

  for (const id of [ACCOUNT_A, ACCOUNT_B]) {
    const row = listAccounts().find((candidate) => candidate.id === id);
    assert.ok(row);
    assert.equal(row?.status, 'rate_limited');
    assert.equal(isEligible(row!), false);
    assert.equal(JSON.parse(row!.quota_json!).primary.used_percent, 100);
  }

  // A pin to a limited account fails fast instead of silently using the other one.
  const pinned = await post('/v1/responses', { model: 'mock-large' }, { ...auth, 'x-codex-account': ACCOUNT_A });
  assert.equal(pinned.statusCode, 429);

  // Cooldown expiry makes the account selectable again.
  for (const id of [ACCOUNT_A, ACCOUNT_B]) setStatus(id, 'rate_limited', 'test', Date.now() - 1);
  const recovered = await post('/v1/responses', { model: 'mock-large' }, auth);
  assert.equal(recovered.statusCode, 200);
});

test('5xx responses fail over to the next account without burning the pool', async () => {
  const { listAccounts } = await import('../core/src/db.js');
  const response = await post('/v1/responses', { model: 'boom' }, auth);
  assert.equal(response.statusCode, 503);
  assert.equal(response.headers['x-codex-manager-attempts'], '2');
  const active = listAccounts().filter((row) => row.status === 'active');
  assert.ok(active.length >= 1, '5xx attempts must not mark accounts as limited');
});

test('management API exposes state and never leaks tokens', async () => {
  const response = await app.inject({ method: 'GET', url: '/api/state' });
  assert.equal(response.statusCode, 200);
  const body = response.json() as { accounts: Array<Record<string, unknown>>; gateway: { api_key: string } };
  assert.equal(body.gateway.api_key, 'sk-gateway-test');
  assert.ok(body.accounts.length >= 2);
  assert.ok(!response.body.includes('token-a'), 'state must not contain access tokens');
  assert.ok(!response.body.includes('refresh-token-a'), 'state must not contain refresh tokens');
});

test('settings default to safe values and accept validated patches', async () => {
  const initial = await app.inject({ method: 'GET', url: '/api/settings' });
  assert.equal(initial.statusCode, 200);
  const before = initial.json() as { settings: { auto_switch: { enabled: boolean; interval_seconds: number } } };
  assert.equal(before.settings.auto_switch.enabled, false);
  assert.equal(before.settings.auto_switch.interval_seconds, 60);

  const patched = await app.inject({
    method: 'PATCH',
    url: '/api/settings',
    headers: { 'content-type': 'application/json' },
    payload: JSON.stringify({ auto_switch: { enabled: true, remaining_threshold: 5, target: 'cli' }, notifications: { low_quota_threshold: 12 } }),
  });
  assert.equal(patched.statusCode, 200);
  const after = patched.json() as {
    settings: { auto_switch: { enabled: boolean; remaining_threshold: number }; notifications: { low_quota_threshold: number; auto_switch: boolean } };
  };
  assert.equal(after.settings.auto_switch.enabled, true);
  assert.equal(after.settings.auto_switch.remaining_threshold, 5);
  assert.equal(after.settings.notifications.low_quota_threshold, 12);
  assert.equal(after.settings.notifications.auto_switch, true);

  const invalid = await app.inject({
    method: 'PATCH',
    url: '/api/settings',
    headers: { 'content-type': 'application/json' },
    payload: JSON.stringify({ auto_switch: { interval_seconds: 5 } }),
  });
  assert.equal(invalid.statusCode, 400);
});

test('account export omits tokens by default and includes them only on request', async () => {
  const safe = await app.inject({ method: 'GET', url: '/api/accounts/export' });
  assert.equal(safe.statusCode, 200);
  const safeBody = safe.json() as { contains_credentials: boolean; accounts: Array<Record<string, unknown>> };
  assert.equal(safeBody.contains_credentials, false);
  assert.ok(safeBody.accounts.length >= 2);
  assert.ok(!safe.body.includes('token-a'));
  assert.ok(!safe.body.includes('refresh-token-a'));

  const full = await app.inject({ method: 'GET', url: '/api/accounts/export?credentials=1&download=1' });
  assert.equal(full.statusCode, 200);
  assert.match(String(full.headers['content-disposition']), /attachment; filename=/);
  assert.equal(full.headers['cache-control'], 'no-store');
  const fullBody = full.json() as { contains_credentials: boolean; accounts: Array<{ credentials?: { access_token?: string } }> };
  assert.equal(fullBody.contains_credentials, true);
  assert.ok(fullBody.accounts.some((account) => account.credentials?.access_token === 'token-a'));
  assert.match(full.body, /refresh-token-a/);
});

test('bulk import accepts an exported account file and validates entries', async () => {
  const accountC = '33333333-3333-4333-8333-333333333333';
  const payload = {
    format: 'codex-manager.accounts',
    version: 1,
    accounts: [
      {
        email: 'bulk@mock.local',
        account_id: accountC,
        credentials: { access_token: 'token-c', refresh_token: 'refresh-token-c', account_id: accountC },
      },
      { email: 'metadata-only@mock.local', account_id: 'nope' },
    ],
  };
  const response = await app.inject({
    method: 'POST',
    url: '/api/accounts/import-bulk',
    headers: { 'content-type': 'application/json' },
    payload: JSON.stringify({ json: JSON.stringify(payload) }),
  });
  assert.equal(response.statusCode, 200);
  const body = response.json() as {
    imported: number;
    failed: number;
    results: Array<{ ok: boolean; email?: string; error?: string }>;
    accounts: Array<{ id: string; email: string }>;
  };
  assert.equal(body.imported, 1);
  assert.equal(body.failed, 1);
  assert.ok(body.accounts.some((account) => account.id === accountC));
  assert.match(body.results.find((row) => !row.ok)?.error ?? '', /metadata-only export/);

  const missing = await app.inject({
    method: 'POST',
    url: '/api/accounts/import-bulk',
    headers: { 'content-type': 'application/json' },
    payload: JSON.stringify({ json: '{not json' }),
  });
  assert.equal(missing.statusCode, 400);

  // Keep the pool deterministic for the routing tests that follow.
  const removed = await app.inject({ method: 'DELETE', url: `/api/accounts/${accountC}` });
  assert.equal(removed.statusCode, 200);
});

test('diagnostics are downloadable and never contain credentials', async () => {
  const response = await app.inject({ method: 'GET', url: '/api/diagnostics?download=1' });
  assert.equal(response.statusCode, 200);
  assert.match(String(response.headers['content-disposition']), /diagnostics/);
  const body = response.json() as { format: string; gateway: { api_key_masked: string }; accounts: unknown[] };
  assert.equal(body.format, 'codex-manager.diagnostics');
  assert.match(body.gateway.api_key_masked, /…/);
  assert.ok(body.accounts.length >= 2);
  assert.ok(!response.body.includes('token-a'));
  assert.ok(!response.body.includes('refresh-token-a'));
});

test('Prepare login removes gateway mode and explicitly requires restart', async () => {
  const fs = await import('node:fs');
  const path = await import('node:path');
  const { applyCodexConfig } = await import('../core/src/codexConfig.js');
  applyCodexConfig({ port: 8055, apiKey: 'sk-test' });
  const response = await app.inject({ method: 'POST', url: `/api/accounts/${ACCOUNT_B}/prepare` });
  assert.equal(response.statusCode, 200);
  const body = response.json() as {
    path: string;
    config: { path: string } | null;
    restart_required: boolean;
    codex_config: { applied: boolean };
    accounts: Array<{ id: string; is_current: boolean }>;
  };
  assert.equal(body.codex_config.applied, false);
  assert.equal(body.restart_required, true);
  assert.ok(body.accounts.find((account) => account.id === ACCOUNT_B)?.is_current);
  assert.ok(fs.existsSync(body.path));
  assert.ok(fs.existsSync(path.join(process.env.CODEX_HOME!, 'config.toml')));
  const configPath = path.join(process.env.CODEX_HOME!, 'config.toml');
  const directConfig = fs.readFileSync(configPath, 'utf8');
  assert.doesNotMatch(directConfig, /\[model_providers\.codex_manager\]/);
  assert.doesNotMatch(directConfig, /requires_openai_auth = false/);
  const auth = JSON.parse(fs.readFileSync(path.join(process.env.CODEX_HOME!, 'auth.json'), 'utf8')) as {
    tokens: { access_token: string; account_id: string };
  };
  assert.equal(auth.tokens.access_token, 'token-b');
  assert.equal(auth.tokens.account_id, ACCOUNT_B);
  const repeated = await app.inject({ method: 'POST', url: `/api/accounts/${ACCOUNT_B}/prepare` });
  assert.equal(repeated.statusCode, 200);
  assert.equal(repeated.json().config, null);
  assert.equal(fs.readFileSync(configPath, 'utf8'), directConfig);
});

test('auto-switch check moves a low account and records an event', async () => {
  const fs = await import('node:fs');
  const path = await import('node:path');
  const { listAccounts, setQuota, setSetting, setStatus } = await import('../core/src/db.js');
  const { tokensOf } = await import('../core/src/accounts.js');
  const { switchClientTo } = await import('../core/src/codexAuth.js');
  const now = Date.now();
  setStatus(ACCOUNT_A, 'active', null, null);
  setStatus(ACCOUNT_B, 'active', null, null);

  // Point auth.json at A without hitting the mock usage endpoint, otherwise
  // switchTo would refresh the carefully staged low quota away.
  const rowA = listAccounts().find((row) => row.id === ACCOUNT_A)!;
  switchClientTo(tokensOf(rowA));
  setSetting('current_account_id', ACCOUNT_A);

  setQuota(ACCOUNT_A, {
    primary: { used_percent: 98, limit_window_seconds: 18000, reset_after_seconds: 3600, reset_at: Math.floor(now / 1000) + 3600 },
    secondary: { used_percent: 10, limit_window_seconds: 604800, reset_after_seconds: 86400, reset_at: Math.floor(now / 1000) + 86400 },
    captured_at: now,
    source: 'usage',
  });
  setQuota(ACCOUNT_B, {
    primary: { used_percent: 10, limit_window_seconds: 18000, reset_after_seconds: 3600, reset_at: Math.floor(now / 1000) + 3600 },
    secondary: { used_percent: 10, limit_window_seconds: 604800, reset_after_seconds: 86400, reset_at: Math.floor(now / 1000) + 86400 },
    captured_at: now,
    source: 'usage',
  });

  const response = await app.inject({ method: 'POST', url: '/api/auto-switch/check' });
  assert.equal(response.statusCode, 200);
  const body = response.json() as {
    action: string;
    target: { id: string; email: string } | null;
    current: { id: string } | null;
  };
  assert.equal(body.action, 'prepared');
  assert.equal(body.target?.id, ACCOUNT_B);
  const auth = JSON.parse(fs.readFileSync(path.join(process.env.CODEX_HOME!, 'auth.json'), 'utf8')) as {
    tokens: { account_id: string };
  };
  assert.equal(auth.tokens.account_id, ACCOUNT_B);

  const events = await app.inject({ method: 'GET', url: '/api/events?since=0' });
  assert.equal(events.statusCode, 200);
  const eventBody = events.json() as { events: Array<{ type: string; notify: boolean }>; cursor: number };
  assert.ok(eventBody.events.some((event) => event.type === 'auto_switch' && event.notify === true));
  assert.ok(eventBody.cursor > 0);
});


test('account management refuses cross-origin and DNS-rebinding requests', async () => {
  for (const headers of [{ origin: 'https://attacker.example' }, { host: 'attacker.example' }, { 'sec-fetch-site': 'cross-site' }]) {
    const response = await app.inject({ method: 'POST', url: `/api/accounts/${ACCOUNT_A}/use-in-codex`, headers });
    assert.equal(response.statusCode, 403);
  }
});

test('account button and zero-quota auto-switch use the same close-write-reopen controller', async () => {
  const { buildGateway } = await import('../core/src/gateway.js');
  const { RestartController } = await import('../core/src/restart.js');
  const { setQuota, setStatus } = await import('../core/src/db.js');
  const { updateSettings } = await import('../core/src/settings.js');
  const { runAutoSwitch } = await import('../core/src/autoSwitch.js');
  const config = { port: 8055, api_key: 'test', upstream_base: base, max_account_attempts: 2, request_timeout_ms: 20_000 };
  let running = true;
  const calls: string[] = [];
  const restart = new RestartController({
    inspect: async () => ({ installed: true, running }),
    quit: async () => { calls.push('quit'); running = false; },
    launch: async () => { calls.push('launch'); running = true; },
  }, async () => {});
  const gateway = await buildGateway({ config, restart });
  try {
    const manual = await gateway.inject({ method: 'POST', url: `/api/accounts/${ACCOUNT_A}/use-in-codex` });
    assert.equal(manual.statusCode, 200);
    assert.equal(manual.json().restarted, true);
    assert.equal(manual.json().operation.verification, 'process_and_auth_file');
    assert.deepEqual(calls, ['quit', 'launch']);
    for (const [id, used] of [[ACCOUNT_A, 100], [ACCOUNT_B, 10]] as const) {
      setStatus(id, 'active', null, null);
      setQuota(id, { primary: { used_percent: used, limit_window_seconds: 18000, reset_after_seconds: 3600,
        reset_at: Math.floor(Date.now() / 1000) + 3600 }, captured_at: Date.now(), source: 'usage' });
    }
    updateSettings({ auto_switch: { enabled: true, target: 'codex', allow_refresh: false, remaining_threshold: 0 } });
    const switched = await runAutoSwitch(config, restart);
    assert.equal(switched.action, 'switched');
    assert.equal(switched.target?.id, ACCOUNT_B);
    assert.deepEqual(calls, ['quit', 'launch', 'quit', 'launch']);
    assert.equal(JSON.parse(fs.readFileSync(path.join(process.env.CODEX_HOME!, 'auth.json'), 'utf8')).tokens.account_id, ACCOUNT_B);
    assert.equal((await runAutoSwitch(config, restart)).action, 'kept');
    assert.equal(calls.length, 4, 'a healthy account must not be restarted repeatedly');
  } finally {
    updateSettings({ auto_switch: { enabled: false, target: 'cli' } });
    await gateway.close();
  }
});

test('gateway configuration can be applied without a request body', async () => {
  const response = await app.inject({ method: 'POST', url: '/api/codex/config' });
  assert.equal(response.statusCode, 200);
  assert.equal(response.json().ok, true);
  assert.equal(response.json().path, `${process.env.CODEX_HOME}/config.toml`);
});

test('T3 linked profile keeps one stable path and preserves the active Codex login/config', async (t) => {
  const { T3SyncController, t3SyncController } = await import('../core/src/t3Sync.js');
  const controller = new T3SyncController({ inspect: async () => ({ installed: true, running: false }), quit: async () => {}, launch: async () => {} }, async () => {});
  t.mock.method(t3SyncController, 'select', controller.select.bind(controller));
  const { getAccount } = await import('../core/src/db.js');
  const { tokensOf } = await import('../core/src/accounts.js');
  const authFile = path.join(process.env.CODEX_HOME!, 'auth.json');
  const configFile = path.join(process.env.CODEX_HOME!, 'config.toml');
  const originalAuth = fs.existsSync(authFile) ? fs.readFileSync(authFile, 'utf8') : null;
  const originalConfig = fs.existsSync(configFile) ? fs.readFileSync(configFile, 'utf8') : null;
  const { buildGateway } = await import('../core/src/gateway.js');
  let restarts = 0;
  const gateway = await buildGateway({
    config: { port: 8055, api_key: 'sk-t3-test', upstream_base: base, max_account_attempts: 1, request_timeout_ms: 20_000 },
    restart: {
      status: async () => ({ supported: true, installed: true, running: true, reason: '', operation: null }),
      restart: async () => { restarts++; throw new Error('T3 preparation must not restart Codex'); },
    },
  });
  try {
    const response = await gateway.inject({ method: 'POST', url: `/api/accounts/${ACCOUNT_A}/use-in-t3-code` });
    assert.equal(response.statusCode, 200);
    const result = response.json();
    assert.equal(result.status, 'prepared');
    assert.equal(result.connection_verified, false);
    assert.equal(result.shadow_home, '');
    assert.ok(path.isAbsolute(result.codex_home));
    assert.notEqual(result.codex_home, process.env.CODEX_HOME);
    const file = path.join(result.codex_home, 'auth.json');
    assert.equal(JSON.parse(fs.readFileSync(file, 'utf8')).tokens.account_id, ACCOUNT_A);
    assert.equal(JSON.parse(fs.readFileSync(file, 'utf8')).tokens.access_token, tokensOf(getAccount(ACCOUNT_A)!).access_token);
    assert.match(fs.readFileSync(path.join(result.codex_home, 'config.toml'), 'utf8'), /cli_auth_credentials_store = "file"/);
    if (process.platform !== 'win32') {
      assert.equal(fs.statSync(file).mode & 0o777, 0o600);
      assert.equal(fs.statSync(result.codex_home).mode & 0o777, 0o700);
    }
    assert.ok(!response.body.includes('access_token'));
    assert.ok(!response.body.includes('refresh_token'));
    fs.appendFileSync(path.join(result.codex_home, 'config.toml'), 'model = "keep-model"\n');
    const repeated = await gateway.inject({ method: 'POST', url: `/api/accounts/${ACCOUNT_A}/use-in-t3-code` });
    assert.equal(repeated.statusCode, 200);
    assert.equal(repeated.json().codex_home, result.codex_home);
    assert.match(fs.readFileSync(path.join(result.codex_home, 'config.toml'), 'utf8'), /keep-model/);
    const other = await gateway.inject({ method: 'POST', url: `/api/accounts/${ACCOUNT_B}/use-in-t3-code` });
    assert.equal(other.statusCode, 200);
    assert.equal(other.json().codex_home, result.codex_home);
    assert.equal(JSON.parse(fs.readFileSync(path.join(other.json().codex_home, 'auth.json'), 'utf8')).tokens.account_id, ACCOUNT_B);
    assert.equal(fs.existsSync(authFile) ? fs.readFileSync(authFile, 'utf8') : null, originalAuth);
    assert.equal(fs.existsSync(configFile) ? fs.readFileSync(configFile, 'utf8') : null, originalConfig);
    assert.equal(restarts, 0);
    const missing = await gateway.inject({ method: 'POST', url: '/api/accounts/not-an-account/use-in-t3-code' });
    assert.equal(missing.statusCode, 404);
    const crossOrigin = await gateway.inject({ method: 'POST', url: `/api/accounts/${ACCOUNT_A}/use-in-t3-code`, headers: { origin: 'https://example.com' } });
    assert.equal(crossOrigin.statusCode, 403);
    const disconnected = await gateway.inject({ method: 'POST', url: '/api/t3-code/disconnect' });
    assert.equal(disconnected.json().t3_code.enabled, false);
  } finally {
    await gateway.close();
  }
});

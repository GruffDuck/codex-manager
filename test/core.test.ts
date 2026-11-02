import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// A throwaway HOME keeps the real ~/.codex-manager database out of tests.
const home = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-manager-core-'));
process.env.HOME = home;
process.env.USERPROFILE = home;
process.env.CODEX_HOME = path.join(home, '.codex');
fs.mkdirSync(process.env.CODEX_HOME, { recursive: true });

const { seal, open } = await import('../core/src/crypto.js');
const { quotaFromUsage, quotaFromHeaders, quotaWeight } = await import('../core/src/quota.js');
const { upsertAccount, setQuota, setStatus, listAccounts } = await import('../core/src/db.js');
const { pickAccount, nextEligibleAt } = await import('../core/src/lease.js');
const { addFromJson, toPublic, isEligible } = await import('../core/src/accounts.js');
const { applyCodexConfig, restoreCodexConfig, codexConfigStatus } = await import('../core/src/codexConfig.js');

const config = {
  port: 8055,
  api_key: 'sk-test',
  upstream_base: 'http://127.0.0.1:9',
  max_account_attempts: 3,
  request_timeout_ms: 10_000,
};

test('sealed tokens round-trip and reject tampering', () => {
  const tokens = { access_token: 'a', refresh_token: 'r', account_id: 'acct' };
  const box = seal(tokens);
  assert.deepEqual(open(box), tokens);

  const bytes = Buffer.from(box, 'base64');
  bytes[bytes.length - 1] ^= 0xff;
  assert.throws(() => open(bytes.toString('base64')));
});

test('usage payload maps to quota windows', () => {
  const quota = quotaFromUsage({
    plan_type: 'plus',
    rate_limit: {
      allowed: false,
      limit_reached: true,
      primary_window: { used_percent: 100, limit_window_seconds: 18000, reset_after_seconds: 60, reset_at: 1793370698 },
      secondary_window: { used_percent: 69, limit_window_seconds: 604800, reset_after_seconds: 600, reset_at: 1793792490 },
    },
    credits: { has_credits: false, unlimited: false, balance: '0' },
  });
  assert.equal(quota.plan_type, 'plus');
  assert.equal(quota.limit_reached, true);
  assert.equal(quota.primary?.used_percent, 100);
  assert.equal(quota.secondary?.limit_window_seconds, 604800);
  assert.equal(quota.source, 'usage');
});

test('response headers map minutes to seconds', () => {
  const headers = new Headers({
    'x-codex-plan-type': 'pro',
    'x-codex-primary-used-percent': '42',
    'x-codex-secondary-used-percent': '10',
    'x-codex-primary-window-minutes': '300',
    'x-codex-secondary-window-minutes': '10080',
    'x-codex-primary-reset-after-seconds': '120',
    'x-codex-secondary-reset-after-seconds': '240',
    'x-codex-primary-reset-at': '1793370698',
    'x-codex-secondary-reset-at': '1793792490',
  });
  const quota = quotaFromHeaders(headers, null);
  assert.ok(quota);
  assert.equal(quota.plan_type, 'pro');
  assert.equal(quota.primary?.used_percent, 42);
  assert.equal(quota.primary?.limit_window_seconds, 18_000);
  assert.equal(quota.secondary?.limit_window_seconds, 604_800);
  assert.equal(quota.source, 'headers');
  assert.equal(quotaFromHeaders(new Headers(), null), null);
});

test('weights reward spare quota without ever making an account eligible', () => {
  assert.equal(quotaWeight(null), 1);
  assert.equal(quotaWeight({ primary: { used_percent: 0, limit_window_seconds: 0, reset_after_seconds: 0, reset_at: 0 }, captured_at: 0, source: 'usage' }), 3);
  assert.equal(quotaWeight({ primary: { used_percent: 60, limit_window_seconds: 0, reset_after_seconds: 0, reset_at: 0 }, captured_at: 0, source: 'usage' }), 2);
  assert.equal(quotaWeight({ primary: { used_percent: 90, limit_window_seconds: 0, reset_after_seconds: 0, reset_at: 0 }, captured_at: 0, source: 'usage' }), 1);
});

function addAccount(id: string, used: number, status: 'active' | 'rate_limited' = 'active', cooldownMs = 0): void {
  upsertAccount({
    id,
    email: `${id}@example.test`,
    account_id: id,
    plan_type: 'plus',
    auth_mode: 'chatgpt',
    token_blob: seal({ access_token: 'a', refresh_token: 'r', account_id: id }),
  });
  setQuota(id, {
    plan_type: 'plus',
    primary: { used_percent: used, limit_window_seconds: 18000, reset_after_seconds: 60, reset_at: Math.floor(Date.now() / 1000) + 60 },
    secondary: { used_percent: 0, limit_window_seconds: 604800, reset_after_seconds: 60, reset_at: Math.floor(Date.now() / 1000) + 60 },
    captured_at: Date.now(),
    source: 'usage',
  });
  setStatus(id, status, status === 'rate_limited' ? 'test' : null, status === 'rate_limited' ? Date.now() + cooldownMs : null);
}

test('smooth weighted round-robin favours the account with headroom', () => {
  addAccount('acct-a', 0);
  addAccount('acct-b', 60);
  addAccount('acct-c', 90);

  const counts = { 'acct-a': 0, 'acct-b': 0, 'acct-c': 0 };
  for (let i = 0; i < 60; i += 1) {
    const lease = pickAccount();
    assert.ok(lease);
    counts[lease.row.id as keyof typeof counts] += 1;
  }

  assert.ok(counts['acct-a'] > counts['acct-b'], 'a should outrank b');
  assert.ok(counts['acct-b'] > counts['acct-c'], 'b should outrank c');
  for (const value of Object.values(counts)) assert.ok(value > 5, 'no starvation');
});

test('pinning and eligibility rules', () => {
  const pinned = pickAccount({ pin: 'acct-c' });
  assert.equal(pinned?.row.id, 'acct-c');

  addAccount('acct-d', 100, 'rate_limited', 60_000);
  assert.equal(pickAccount({ pin: 'acct-d' }), null);
  assert.ok(nextEligibleAt() !== null);

  const row = listAccounts().find((candidate) => candidate.id === 'acct-d');
  assert.ok(row);
  assert.equal(isEligible(row), false);

  setStatus('acct-d', 'rate_limited', 'test', Date.now() - 1_000);
  const cooled = listAccounts().find((candidate) => candidate.id === 'acct-d');
  assert.ok(cooled);
  assert.equal(isEligible(cooled), true);
});

test('adding accounts from JSON is tolerant but refuses incomplete bundles', async () => {
  const bundle = JSON.stringify({
    tokens: {
      access_token: 'access',
      refresh_token: 'refresh',
      account_id: 'acct-json',
      id_token: 'x',
    },
  });
  const result = await addFromJson(bundle, config);
  assert.equal(result.account.id, 'acct-json');
  assert.ok(result.warning, 'quota fetch against a dead port should warn, not throw');
  assert.ok(result.account.email.startsWith('account-'), 'falls back to a placeholder label');

  await assert.rejects(() => addFromJson('{"access_token":"only"}', config), /Missing refresh_token/);
  await assert.rejects(() => addFromJson('not json', config), /not valid JSON/);

  const row = listAccounts().find((candidate) => candidate.id === 'acct-json');
  assert.ok(row);
  assert.ok(!JSON.stringify(toPublic(row, config)).includes('access_token'), 'public view must not leak tokens');
});

test('config.toml block is written, backed up and reversible', async () => {
  const { parse } = await import('smol-toml');
  const file = path.join(process.env.CODEX_HOME as string, 'config.toml');
  const original = 'model = "gpt-5-legacy"\napproval_policy = "on-request"\n\n[projects."/tmp"]\ntrust_level = "trusted"\n';
  fs.writeFileSync(file, original);

  const applied = applyCodexConfig({ port: 8055, apiKey: 'sk-secret' });
  assert.equal(applied.backup, `${file}.codex-manager.bak`);
  assert.ok(applied.warnings.length >= 1);

  const written = fs.readFileSync(file, 'utf8');
  assert.match(written, /\[model_providers\.codex_manager\]/);
  assert.match(written, /base_url = "http:\/\/127\.0\.0\.1:8055\/v1"/);
  assert.match(written, /wire_api = "responses"/);
  assert.match(written, /requires_openai_auth = false/);
  assert.match(written, /Authorization = "Bearer sk-secret"/);
  assert.match(written, /# codex-manager-removed: model = "gpt-5-legacy"/);
  assert.equal((written.match(/^model = /gm) ?? []).length, 1, 'only the managed model key may remain');
  assert.match(written, /^model = "gpt-5-legacy"$/m, 'existing model choice is inherited');
  assert.equal(codexConfigStatus().applied, true);

  // The generated file must stay valid TOML: root keys first, provider table last.
  const parsed = parse(written) as {
    model_provider?: string;
    model?: string;
    approval_policy?: string;
    model_providers?: Record<string, { base_url?: string; wire_api?: string; requires_openai_auth?: boolean }>;
  };
  assert.equal(parsed.model_provider, 'codex_manager');
  assert.equal(parsed.model, 'gpt-5-legacy');
  assert.equal(parsed.approval_policy, 'on-request');
  assert.equal(parsed.model_providers?.codex_manager?.base_url, 'http://127.0.0.1:8055/v1');
  assert.equal(parsed.model_providers?.codex_manager?.wire_api, 'responses');
  assert.equal(parsed.model_providers?.codex_manager?.requires_openai_auth, false);

  const restored = restoreCodexConfig();
  assert.equal(restored.restored, false);
  const back = fs.readFileSync(file, 'utf8');
  assert.ok(!back.includes('codex-manager'));
  assert.match(back, /model = "gpt-5-legacy"/);
  assert.match(back, /approval_policy = "on-request"/);
  assert.equal(codexConfigStatus().applied, false);
});

test('rewriting gateway settings preserves the chosen model and original root settings', async () => {
  const { parse } = await import('smol-toml');
  const file = path.join(process.env.CODEX_HOME!, 'config.toml');
  fs.writeFileSync(file, 'model = "custom-model"\nmodel_provider = "openai"\n\n[projects."/tmp"]\ntrust_level = "trusted"\n');
  applyCodexConfig({ port: 8055, apiKey: 'sk-original' });
  applyCodexConfig({ port: 8056, apiKey: 'sk-rotated' });
  applyCodexConfig({ port: 8056, apiKey: 'sk-rotated' });
  const managed = parse(fs.readFileSync(file, 'utf8'));
  assert.equal(managed.model, 'custom-model');
  assert.equal(managed.model_provider, 'codex_manager');
  restoreCodexConfig();
  const restored = parse(fs.readFileSync(file, 'utf8'));
  assert.equal(restored.model, 'custom-model');
  assert.equal(restored.model_provider, 'openai');
  assert.ok(restored.projects);
});

test('concurrent refreshes share one rotation and stale callers reuse the latest tokens', async () => {
  const http = await import('node:http');
  const { forceRefresh, ensureFresh } = await import('../core/src/accounts.js');
  let calls = 0;
  let fail = false;
  const access = `e30.${Buffer.from(JSON.stringify({ exp: Math.floor(Date.now() / 1000) + 3600 })).toString('base64url')}.signature`;
  const server = http.createServer((_request, response) => {
    calls += 1;
    response.writeHead(fail ? 503 : 200, { 'content-type': 'application/json' });
    response.end(JSON.stringify(fail ? { error: 'temporarily_unavailable' } : {
      access_token: access, refresh_token: `rotated-${calls}`,
    }));
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    const address = server.address() as { port: number };
    const row = upsertAccount({ id: 'refresh-test', account_id: 'refresh-test', email: 'refresh@example.test',
      plan_type: 'plus', auth_mode: 'chatgpt', token_blob: seal({ access_token: 'old', refresh_token: 'initial',
        account_id: 'refresh-test', oauth_provenance: { issuer: `http://127.0.0.1:${address.port}` } }) });
    const results = await Promise.all([forceRefresh(row), forceRefresh(row), forceRefresh(row)]);
    assert.equal(calls, 1);
    assert.ok(results.every((tokens) => tokens.refresh_token === 'rotated-1'));
    assert.equal((await ensureFresh(row)).refresh_token, 'rotated-1');
    assert.equal((await forceRefresh(row)).refresh_token, 'rotated-1');
    assert.equal(calls, 1, 'stale requests must not rotate the old refresh token again');
    const latest = listAccounts().find((account) => account.id === row.id)!;
    fail = true;
    await assert.rejects(forceRefresh(latest), /Token refresh failed/);
    fail = false;
    assert.equal((await forceRefresh(latest)).refresh_token, 'rotated-3');
    assert.equal(calls, 3, 'a failed refresh must release the per-account lock');
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
});

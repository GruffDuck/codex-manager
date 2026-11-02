import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const home = fs.mkdtempSync(path.join(os.tmpdir(), 'cm-restart-'));
process.env.HOME = home;
process.env.USERPROFILE = home;
process.env.CODEX_HOME = path.join(home, '.codex');
fs.mkdirSync(process.env.CODEX_HOME, { recursive: true });
const { RestartController, RestartError } = await import('../core/src/restart.js');
const { upsertAccount } = await import('../core/src/db.js');
const { seal } = await import('../core/src/crypto.js');
const { switchTo } = await import('../core/src/accounts.js');
const file = path.join(process.env.CODEX_HOME, 'auth.json');
const configFile = path.join(process.env.CODEX_HOME, 'config.toml');
const config = { port: 8055, api_key: 'test', upstream_base: 'http://127.0.0.1:9', max_account_attempts: 2, request_timeout_ms: 10_000 };
const { applyCodexConfig } = await import('../core/src/codexConfig.js');
const original = JSON.stringify({ auth_mode: 'chatgpt', tokens: { access_token: 'old', refresh_token: 'old-r', account_id: 'old' } });
function setup() {
  fs.writeFileSync(file, original);
  fs.writeFileSync(configFile, 'model = "test-model"\n');
  upsertAccount({ id: 'next', account_id: 'next', email: 'next@example.test', plan_type: 'plus', auth_mode: 'chatgpt',
    token_blob: seal({ access_token: 'next-access', refresh_token: 'next-refresh', account_id: 'next' }) });
}
function host() {
  const state = { running: true, calls: [] as string[], failQuit: false, failLaunch: 0 };
  return { state,
    inspect: async () => ({ installed: true, running: state.running }),
    quit: async () => { state.calls.push('quit'); if (state.failQuit) throw new RestartError('quit refused'); state.running = false; },
    launch: async () => {
      state.calls.push(`launch:${JSON.parse(fs.readFileSync(file, 'utf8')).tokens.account_id}`);
      if (state.failLaunch-- > 0) { state.running = true; throw new RestartError('launch failed'); }
      state.running = true;
    },
  };
}

test('restart closes first, writes the selected login, removes gateway mode and reopens Codex', async () => {
  setup();
  applyCodexConfig({ port: 8055, apiKey: 'test' });
  const app = host();
  const controller = new RestartController(app, async () => {});
  const result = await controller.restart('next', config);
  assert.equal(result.phase, 'completed');
  assert.equal(result.verification, 'process_and_auth_file');
  assert.deepEqual(app.state.calls, ['quit', 'launch:next']);
  assert.equal(JSON.parse(fs.readFileSync(file, 'utf8')).tokens.account_id, 'next');
  assert.doesNotMatch(fs.readFileSync(configFile, 'utf8'), /codex_manager/);
  assert.equal((await controller.status()).operation?.phase, 'completed');
});

test('a refused quit leaves the original login untouched and never launches another copy', async () => {
  setup();
  const app = host(); app.state.failQuit = true;
  const controller = new RestartController(app, async () => {});
  await assert.rejects(controller.restart('next', config), /quit refused/);
  assert.equal(fs.readFileSync(file, 'utf8'), original);
  assert.deepEqual(app.state.calls, ['quit']);
  assert.equal((await controller.status()).operation?.phase, 'failed');
  await assert.rejects(controller.restart('next', config, 'auto'), (e: InstanceType<typeof RestartError>) => e.code === 'restart_cooldown');
});

test('a failed reopen stops the partially opened app, restores the original files and reopens the original login', async () => {
  setup();
  const beforeConfig = fs.readFileSync(configFile, 'utf8');
  const app = host(); app.state.failLaunch = 1;
  const controller = new RestartController(app, async () => {});
  await assert.rejects(controller.restart('next', config), /Previous login restored and Codex reopened/);
  assert.equal(fs.readFileSync(file, 'utf8'), original);
  assert.equal(fs.readFileSync(configFile, 'utf8'), beforeConfig);
  assert.deepEqual(app.state.calls, ['quit', 'launch:next', 'quit', 'launch:old']);
});

test('overwritten login after startup is rejected and rolled back', async () => {
  setup(); const app = host(); let waits = 0;
  const controller = new RestartController(app, async () => { if (++waits === 1) fs.writeFileSync(file, original); });
  await assert.rejects(controller.restart('next', config), /did not keep the selected login/);
  assert.equal((await controller.status()).operation?.verification, null);
  assert.equal(fs.readFileSync(file, 'utf8'), original);
});

test('restart and CLI writes cannot race; lock releases when restart finishes', async () => {
  setup(); const app = host(); let release!: () => void; let entered!: () => void;
  const started = new Promise<void>((resolve) => { entered = resolve; });
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const controller = new RestartController(app, async () => { entered(); await gate; });
  const operation = controller.restart('next', config);
  await started;
  await assert.rejects(controller.restart('next', config), /in progress/);
  await assert.rejects(switchTo('next', config), /in progress/);
  release();
  await operation;
  await switchTo('next', config);
});

test('bad credentials fail before Codex is closed', async () => {
  setup();
  const expired = `e30.${Buffer.from(JSON.stringify({ exp: 1 })).toString('base64url')}.x`;
  upsertAccount({ id: 'expired', account_id: 'expired', email: 'expired@example.test', plan_type: 'plus', auth_mode: 'chatgpt',
    token_blob: seal({ access_token: expired, refresh_token: 'bad', account_id: 'expired', oauth_provenance: { issuer: 'http://127.0.0.1:9' } }) });
  const app = host(); const controller = new RestartController(app, async () => {});
  await assert.rejects(controller.restart('expired', config));
  assert.deepEqual(app.state.calls, []);
  assert.equal(fs.readFileSync(file, 'utf8'), original);
});

test('an interrupted restart is surfaced as failed and a manual retry can complete', async () => {
  setup();
  const { setSetting } = await import('../core/src/db.js');
  setSetting('codex_restart_operation', { id: 'interrupted', account_id: 'next', phase: 'opening', message: 'Opening',
    started_at: Date.now(), updated_at: Date.now(), verification: null });
  const controller = new RestartController(host(), async () => {});
  assert.equal((await controller.status()).operation?.phase, 'failed');
  assert.equal((await controller.restart('next', config)).phase, 'completed');
});

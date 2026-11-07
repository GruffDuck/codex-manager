import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const fixture = fs.mkdtempSync(path.join(os.tmpdir(), 'cm-t3-linked-'));
process.env.HOME = fixture;
process.env.USERPROFILE = fixture;
process.env.CODEX_HOME = path.join(fixture, '.codex');
const { T3SyncController, T3_HOME, t3SyncController, t3LinkStatus } = await import('../core/src/t3Sync.js');
const { setSetting, upsertAccount } = await import('../core/src/db.js');
const { seal } = await import('../core/src/crypto.js');
const { switchTo } = await import('../core/src/accounts.js');
const { RestartController } = await import('../core/src/restart.js');
const auth = path.join(T3_HOME, 'auth.json');
const account = (id: string) => ({ access_token: `access-${id}`, refresh_token: `refresh-${id}`, account_id: id });
const read = () => JSON.parse(fs.readFileSync(auth, 'utf8')).tokens.account_id;
const config = { port: 8055, api_key: 'test', upstream_base: 'http://127.0.0.1:9', max_account_attempts: 1, request_timeout_ms: 10_000 };
function host(running = true) {
  const state = { running, calls: [] as string[], refuse: false, failLaunch: 0 };
  return { state,
    inspect: async () => ({ installed: true, running: state.running }),
    quit: async () => { state.calls.push(`quit:${read()}`); if (state.refuse) throw new Error('refused'); state.running = false; },
    launch: async () => { state.calls.push(`launch:${read()}`); state.running = true; if (state.failLaunch-- > 0) throw new Error('failed'); },
  };
}
async function setup(running = true) {
  setSetting('t3_code_link_v1', null);
  // getSetting returns null when explicitly stored; use a full disabled baseline.
  setSetting('t3_code_link_v1', { enabled: false, codex_home: T3_HOME, account_id: null, state: 'disabled', message: '', verification: null });
  const app = host(running);
  const controller = new T3SyncController(app, async () => {});
  await controller.select(account('a'), 'a', true);
  return { app, controller };
}

test('linked switching closes before writing, preserves sessions/config and uses one home', async () => {
  const { app, controller } = await setup();
  const configFile = path.join(T3_HOME, 'config.toml');
  fs.writeFileSync(configFile, 'cli_auth_credentials_store = "file"\nmodel = "keep"\n');
  fs.mkdirSync(path.join(T3_HOME, 'sessions'), { recursive: true });
  fs.writeFileSync(path.join(T3_HOME, 'sessions/test'), 'keep-session');
  const result = await controller.select(account('b'), 'b');
  assert.equal(result.state, 'ready');
  assert.equal(result.verification, 'process_and_auth_file');
  assert.deepEqual(app.state.calls, ['quit:a', 'launch:b']);
  assert.equal(read(), 'b');
  assert.match(fs.readFileSync(configFile, 'utf8'), /model = "keep"/);
  assert.equal(fs.readFileSync(path.join(T3_HOME, 'sessions/test'), 'utf8'), 'keep-session');
  await controller.select(account('b'), 'b');
  assert.equal(app.state.calls.length, 2, 'same-account selections must not restart or overwrite refreshed credentials');
});

test('a closed T3 stays closed and a disabled link does nothing', async () => {
  const { app, controller } = await setup(false);
  await controller.select(account('b'), 'b');
  assert.equal(read(), 'b');
  assert.deepEqual(app.state.calls, []);
  setSetting('t3_code_link_v1', { ...t3LinkStatus(), enabled: false, state: 'disabled' });
  await controller.select(account('c'), 'c');
  assert.equal(read(), 'b');
});

test('a refused quit keeps the old login and exposes a failure', async () => {
  const { app, controller } = await setup();
  app.state.refuse = true;
  const result = await controller.select(account('b'), 'b');
  assert.equal(result.state, 'failed');
  assert.equal(result.account_id, 'a');
  assert.equal(read(), 'a');
  assert.deepEqual(app.state.calls, ['quit:a']);
});

test('failed launch restores the previous T3 login and reopens it', async () => {
  const { app, controller } = await setup();
  app.state.failLaunch = 1;
  const result = await controller.select(account('b'), 'b');
  assert.equal(result.state, 'failed');
  assert.equal(result.account_id, 'a');
  assert.equal(read(), 'a');
  assert.match(result.message, /Previous T3 login restored/);
  assert.deepEqual(app.state.calls, ['quit:a', 'launch:b', 'quit:b', 'launch:a']);
});

test('CLI and desktop account changes both update linked T3; T3 failures do not undo Codex', async (t) => {
  const { app, controller } = await setup(false);
  t.mock.method(t3SyncController, 'select', controller.select.bind(controller));
  for (const id of ['b', 'c', 'd']) upsertAccount({ id, email: `${id}@example.test`, account_id: id, auth_mode: 'chatgpt', token_blob: seal(account(id)) });
  await switchTo('b', config);
  assert.equal(read(), 'b');
  const codex = { running: true };
  const restart = new RestartController({ inspect: async () => ({ installed: true, running: codex.running }),
    quit: async () => { codex.running = false; }, launch: async () => { codex.running = true; } }, async () => {});
  await restart.restart('c', config, 'auto');
  assert.equal(read(), 'c');
  app.state.running = true;
  app.state.refuse = true;
  assert.equal((await restart.restart('d', config, 'manual')).phase, 'completed');
  assert.equal(JSON.parse(fs.readFileSync(path.join(process.env.CODEX_HOME!, 'auth.json'), 'utf8')).tokens.account_id, 'd');
  assert.equal(read(), 'c');
  assert.equal(t3LinkStatus().state, 'failed');
});

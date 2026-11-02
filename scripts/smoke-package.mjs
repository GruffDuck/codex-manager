import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import net from 'node:net';
import { once } from 'node:events';
import assert from 'node:assert/strict';

const bundle = path.resolve(process.argv[2] || 'release/mac-arm64/Codex Manager.app/Contents/Resources');
const runtime = path.join(bundle, 'runtime', process.platform === 'win32' ? 'node.exe' : 'node');
const app = path.join(bundle, 'app');
const home = await fs.mkdtemp(path.join(os.tmpdir(), 'cm-package-smoke-'));
const listener = net.createServer();
await new Promise((resolve) => listener.listen(0, '127.0.0.1', resolve));
const port = listener.address().port;
await new Promise((resolve) => listener.close(resolve));
const child = spawn(runtime, ['--disable-warning=ExperimentalWarning', path.join(app, 'core/dist/main.js')], {
  cwd: home,
  env: { ...process.env, HOME: home, CODEX_HOME: path.join(home, '.codex'), CODEX_MANAGER_PORT: String(port),
    CODEX_MANAGER_CODEX_SOCKET: path.join(home, 'no-desktop.sock') },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let log = '';
child.stdout.on('data', (bytes) => { log = (log + bytes.toString()).slice(-10_000); });
child.stderr.on('data', (bytes) => { log = (log + bytes.toString()).slice(-10_000); });
try {
  let healthy = false;
  for (let i = 0; i < 60; i++) {
    if (child.exitCode !== null) throw new Error(`Packaged core exited: ${child.exitCode}`);
    try {
      const r = await fetch(`http://127.0.0.1:${port}/healthz`, { signal: AbortSignal.timeout(500) });
      const body = r.ok ? await r.json() : null;
      if (body?.ok && body.management_api === 3) { healthy = true; break; }
    } catch { /* bounded startup retry */ }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  assert.ok(healthy, 'packaged core must start using only its bundled runtime and dependencies');
  const state = await (await fetch(`http://127.0.0.1:${port}/api/state`)).json();
  assert.equal(state.accounts.length, 0);
  assert.equal(state.codex_desktop.state, 'unavailable');
  assert.equal(state.codex_home, path.join(home, '.codex'));
  const html = await (await fetch(`http://127.0.0.1:${port}/`)).text();
  assert.match(html, /assets\/index-.*\.js/);
  const manifest = JSON.parse(await fs.readFile(path.join(bundle, 'runtime/manifest.json'), 'utf8'));
  assert.equal(manifest.arch, process.arch);
  console.log(JSON.stringify({ ok: true, node: manifest.version, arch: manifest.arch, accounts: 0,
    ui: 'served', desktop: state.codex_desktop.state, isolated_profile: true }, null, 2));
} catch (error) {
  // Never print logs wholesale, even though this test uses an empty profile.
  throw new Error(`${error.message}; startup log bytes: ${Buffer.byteLength(log)}`);
} finally {
  const exited = once(child, 'exit');
  child.kill('SIGTERM');
  await Promise.race([exited, new Promise((resolve) => setTimeout(resolve, 2000))]);
  if (child.exitCode === null) child.kill('SIGKILL');
  await fs.rm(home, { recursive: true, force: true });
}

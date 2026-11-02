/**
 * One command for development: TS core with `tsx watch` on :8055 and Vite on
 * :5173 (which proxies /api to the core). Ctrl-C stops both.
 */
import { spawn } from 'node:child_process';
import process from 'node:process';

const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const children = [];

function run(name, args, color) {
  const child = spawn(npm, args, { stdio: ['ignore', 'pipe', 'pipe'], env: process.env });
  const prefix = `\x1b[${color}m[${name}]\x1b[0m `;
  const pipe = (stream, target) => {
    let buffer = '';
    stream.setEncoding('utf8');
    stream.on('data', (chunk) => {
      buffer += chunk;
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';
      for (const line of lines) target.write(`${prefix}${line}\n`);
    });
  };
  pipe(child.stdout, process.stdout);
  pipe(child.stderr, process.stderr);
  child.on('exit', (code) => {
    process.stdout.write(`${prefix}exited with ${code}\n`);
    shutdown(code ?? 0);
  });
  children.push(child);
  return child;
}

let stopping = false;
function shutdown(code) {
  if (stopping) return;
  stopping = true;
  for (const child of children) {
    if (!child.killed) child.kill('SIGTERM');
  }
  setTimeout(() => process.exit(code), 250).unref();
}

process.on('SIGINT', () => shutdown(0));
process.on('SIGTERM', () => shutdown(0));

async function coreRunning() {
  try {
    const response = await fetch('http://127.0.0.1:8055/healthz', { signal: AbortSignal.timeout(800) });
    return response.ok;
  } catch {
    return false;
  }
}

process.stdout.write('\n  Codex Manager dev\n  core  → http://127.0.0.1:8055\n  ui    → http://127.0.0.1:5173\n\n');

if (await coreRunning()) {
  process.stdout.write('[core] already healthy on :8055 — reusing it (stop it to use tsx watch)\n');
} else {
  run('core', ['run', 'dev:core'], '36');
}
setTimeout(() => run('ui', ['run', 'dev:ui'], '35'), 600);

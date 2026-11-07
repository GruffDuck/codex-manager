import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { z } from 'zod';
import { codexHome } from './paths.js';
const run = promisify(execFile);
const delay = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
export interface LifecycleHost {
  inspect(): Promise<{ installed: boolean; running: boolean }>;
  quit(): Promise<void>;
  launch(): Promise<void>;
}
export class RestartError extends Error {
  constructor(message: string, public code = 'restart_failed', public status = 409) { super(message); }
}

export class MacLifecycleHost implements LifecycleHost {
  constructor(private target: 'codex' | 't3-code' = 'codex') {}
  private get appName() { return this.target === 'codex' ? 'Codex' : 'T3 Code'; }
  private helper = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../electron/native/bin/codex-lifecycle');
  private async command(command: 'status' | 'quit' | 'launch') {
    if (process.platform !== 'darwin' || !fs.existsSync(this.helper)) {
      throw new RestartError(`Automatic ${this.appName} restart requires the macOS desktop build.`, 'restart_unsupported');
    }
    try {
      const { stdout } = await run(this.helper, [command, ...(command === 'launch' && this.target === 'codex' ? [codexHome()] : [])], { env: { ...process.env, CODEX_MANAGER_LIFECYCLE_TARGET: this.target }, timeout: command === 'quit' ? 30_000 : 25_000, maxBuffer: 64 * 1024 });
      return z.object({ ok: z.literal(true), installed: z.boolean().optional(), running: z.boolean(), pids: z.array(z.number()).optional() }).parse(JSON.parse(stdout));
    } catch {
      throw new RestartError((command === 'quit' ? 'Codex did not finish quitting. The login has not been replaced.'
        : command === 'launch' ? 'Codex could not be reopened.' : 'Codex could not be located on this Mac.').replaceAll('Codex', this.appName), `restart_${command}_failed`);
    }
  }
  async inspect() { const result = await this.command('status'); return { installed: result.installed === true, running: result.running }; }
  async quit() {
    // Record Codex descendants so credentials are not replaced while a child
    // app-server is still exiting and could write the old login back.
    const state = await this.command('status');
    const snapshot = await run('/bin/ps', ['-axo', 'pid=,ppid=,comm='], { timeout: 3000, maxBuffer: 4 * 1024 * 1024 });
    const rows = snapshot.stdout.split('\n').flatMap((line) => {
      const m = /^\s*(\d+)\s+(\d+)\s+(.+)$/.exec(line);
      return m ? [{ pid: Number(m[1]), parent: Number(m[2]), command: m[3]! }] : [];
    });
    const descendants = new Set(state.pids ?? []);
    let changed = true;
    while (changed) {
      changed = false;
      for (const row of rows) if (descendants.has(row.parent) && !descendants.has(row.pid)) { descendants.add(row.pid); changed = true; }
    }
    const tracked = rows.filter((row) => descendants.has(row.pid));
    await this.command('quit');
    for (let attempt = 0; attempt < 50; attempt++) {
      const current = await run('/bin/ps', ['-axo', 'pid=,comm='], { timeout: 3000, maxBuffer: 4 * 1024 * 1024 });
      const alive = tracked.some((row) => current.stdout.split('\n').some((line) => {
        const m = /^\s*(\d+)\s+(.+)$/.exec(line);
        return m && Number(m[1]) === row.pid && m[2] === row.command;
      }));
      if (!alive) return;
      await delay(200);
    }
    throw new RestartError(`A ${this.appName} child process is still exiting. No login was replaced.`, 'restart_children_running');
  }
  async launch() { await this.command('launch'); }
}

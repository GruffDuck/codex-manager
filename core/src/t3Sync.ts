import fs from 'node:fs';
import path from 'node:path';
import { APP_DIR } from './paths.js';
import { getSetting, setSetting } from './db.js';
import { readAuthFile, writeAuthAtomic, type CodexTokens } from './codexAuth.js';
import { pushEvent } from './events.js';
import { MacLifecycleHost, type LifecycleHost } from './lifecycleHost.js';

const KEY = 't3_code_link_v1';
export const T3_HOME = path.join(APP_DIR, 'integrations', 't3-code', 'linked');
export interface T3LinkStatus {
  enabled: boolean;
  codex_home: string;
  account_id: string | null;
  state: 'disabled' | 'ready' | 'switching' | 'failed';
  message: string;
  verification: 'process_and_auth_file' | 'auth_file' | null;
}
export function t3LinkStatus(): T3LinkStatus {
  return getSetting<T3LinkStatus>(KEY, {
    enabled: false, codex_home: T3_HOME, account_id: null, state: 'disabled',
    message: 'Connect T3 Code once to follow Manager account changes.', verification: null,
  });
}
function save(value: T3LinkStatus) { setSetting(KEY, value); return value; }

export class T3SyncController {
  constructor(private host: LifecycleHost = new MacLifecycleHost('t3-code'),
    private wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))) {}

  /** Call under withClientMutation; the same lock covers Codex and T3 writes. */
  async select(tokens: CodexTokens, id: string, enable = false): Promise<T3LinkStatus> {
    const before = t3LinkStatus();
    if (!before.enabled && !enable) return before;
    const file = path.join(T3_HOME, 'auth.json');
    let old: string | null = null;
    // Do not overwrite tokens T3 may have refreshed, or restart a healthy same-account session.
    if (before.enabled && before.state === 'ready' && before.account_id === id && readAuthFile(file)?.tokens.account_id === tokens.account_id) return before;
    const next: T3LinkStatus = { ...before, enabled: true, codex_home: T3_HOME,
      state: 'switching', message: 'Updating T3 Code login.', verification: null };
    let running = false;
    let closed = false;
    let written = false;
    save(next);
    try {
      // First connection prepares a profile before the one-time provider setup.
      // Later selections close the desktop and its tracked child processes first.
      if (before.enabled) {
        const status = await this.host.inspect();
        running = status.running;
        if (running) {
          await this.host.quit();
          closed = true;
          if ((await this.host.inspect()).running) throw new Error('T3 Code is still running.');
        }
      }
      old = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : null;
      fs.mkdirSync(T3_HOME, { recursive: true, mode: 0o700 });
      fs.chmodSync(T3_HOME, 0o700);
      try { fs.writeFileSync(path.join(T3_HOME, 'config.toml'), 'cli_auth_credentials_store = "file"\n', { flag: 'wx', mode: 0o600 }); }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error; }
      writeAuthAtomic({ auth_mode: 'chatgpt', OPENAI_API_KEY: null, tokens }, file);
      written = true;
      if (readAuthFile(file)?.tokens.account_id !== tokens.account_id) throw new Error('T3 login verification failed.');
      if (running) {
        await this.host.launch();
        for (let i = 0; i < 3; i++) {
          await this.wait(500);
          if (!(await this.host.inspect()).running) throw new Error('T3 Code exited after reopening.');
          if (readAuthFile(file)?.tokens.account_id !== tokens.account_id) throw new Error('T3 Code did not keep the selected login.');
        }
      }
      return save({ ...next, account_id: id, state: 'ready',
        message: running ? 'T3 Code restarted with the selected login saved.' : 'T3 Code login saved. Closed apps remain closed.',
        verification: running ? 'process_and_auth_file' : 'auth_file' });
    } catch {
      let recovery = '';
      if (written) {
        try {
          if (running && (await this.host.inspect()).running) await this.host.quit();
          if (running && (await this.host.inspect()).running) throw new Error('T3 Code is still running.');
          if (old === null) fs.rmSync(file, { force: true });
          else {
            const temporary = `${file}.${process.pid}.restore`;
            fs.writeFileSync(temporary, old, { mode: 0o600 });
            fs.renameSync(temporary, file);
          }
          if (running) await this.host.launch();
          recovery = ' Previous T3 login restored.';
        } catch { recovery = ' Automatic recovery did not finish; check T3 Code before retrying.'; }
      } else if (closed && running) {
        try { await this.host.launch(); } catch { recovery = ' Reopen T3 Code manually.'; }
      }
      return save({ ...before, state: 'failed', verification: null,
        message: 'T3 Code could not switch. Its CLI or desktop needs attention. Retry Use in T3 Code after checking the provider.' + recovery });
    }
  }
}
export const t3SyncController = new T3SyncController();

/** A T3 failure must not disguise a completed Codex change as a failed Codex restart. */
export async function syncLinkedT3Code(tokens: CodexTokens, id: string) {
  let status: T3LinkStatus;
  try { status = await t3SyncController.select(tokens, id); }
  catch { status = save({ ...t3LinkStatus(), state: 'failed', verification: null,
    message: 'T3 Code profile could not be read or updated. Check the profile and retry Use in T3 Code.' }); }
  if (status.state === 'failed') pushEvent({ type: 'account_error', title: 'T3 Code account change needs attention',
    detail: status.message, account_id: id, notify: true });
  return status;
}

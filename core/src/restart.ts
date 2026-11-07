import { MacLifecycleHost, RestartError, type LifecycleHost } from './lifecycleHost.js';
import { syncLinkedT3Code } from './t3Sync.js';
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { codexAuthPath, codexConfigPath, codexHome, type AppConfig } from './paths.js';
import { getAccount, getSetting, setSetting, touchAccount } from './db.js';
import { ensureFresh, tokensOf, CURRENT_ACCOUNT_KEY } from './accounts.js';
import { readAuthFile, switchClientTo } from './codexAuth.js';
import { codexConfigStatus, restoreCodexConfig } from './codexConfig.js';
import { seal } from './crypto.js';
import { withClientMutation } from './clientMutation.js';

const delay = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
const OP_KEY = 'codex_restart_operation';
const BACKUP_KEY = 'codex_restart_rollback';
export type RestartPhase = 'preparing' | 'closing' | 'writing' | 'opening' | 'checking' | 'completed' | 'failed';
export interface RestartOperation {
  id: string; account_id: string; phase: RestartPhase; message: string;
  started_at: number; updated_at: number; verification: 'process_and_auth_file' | null;
}
export interface RestartStatus { supported: boolean; installed: boolean; running: boolean; reason: string; operation: RestartOperation | null }
export { MacLifecycleHost, RestartError, type LifecycleHost } from './lifecycleHost.js';

interface Snapshot { auth: string | null; config: string | null; current: string | null }
const snapshot = (): Snapshot => ({
  auth: fs.existsSync(codexAuthPath()) ? fs.readFileSync(codexAuthPath(), 'utf8') : null,
  config: fs.existsSync(codexConfigPath()) ? fs.readFileSync(codexConfigPath(), 'utf8') : null,
  current: getSetting<string | null>(CURRENT_ACCOUNT_KEY, null),
});
function restore(saved: Snapshot) {
  for (const [file, content] of [[codexAuthPath(), saved.auth], [codexConfigPath(), saved.config]] as const) {
    if (content === null) { fs.rmSync(file, { force: true }); continue; }
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const tmp = `${file}.${randomUUID()}.tmp`;
    fs.writeFileSync(tmp, content, { mode: 0o600 });
    fs.renameSync(tmp, file);
  }
  setSetting(CURRENT_ACCOUNT_KEY, saved.current);
}

export class RestartController {
  private busy = false;
  private cached: { value: RestartStatus; at: number } | null = null;
  constructor(private host: LifecycleHost = new MacLifecycleHost(), private wait = delay) {}
  async status(): Promise<RestartStatus> {
    let operation = getSetting<RestartOperation | null>(OP_KEY, null);
    if (operation && !this.busy && !['completed', 'failed'].includes(operation.phase)) {
      operation = { ...operation, phase: 'failed', updated_at: Date.now(), verification: null,
        message: 'The previous account restart was interrupted. Check Codex before retrying.' };
      setSetting(OP_KEY, operation);
    }
    if (this.cached && Date.now() - this.cached.at < 3000) return { ...this.cached.value, operation };
    let value: RestartStatus;
    try {
      const host = await this.host.inspect();
      value = { supported: true, ...host, reason: 'Switching closes Codex, saves the selected login and opens Codex again.', operation };
    } catch (error) {
      value = { supported: false, installed: false, running: false, reason: error instanceof RestartError ? error.message : 'Automatic restart is unavailable.', operation };
    }
    this.cached = { value, at: Date.now() };
    return value;
  }
  async restart(id: string, _config: AppConfig, source: 'manual' | 'auto' = 'manual'): Promise<RestartOperation> {
    if (this.busy) throw new RestartError('Another Codex account change is in progress.', 'account_change_busy');
    this.busy = true;
    try {
      return await withClientMutation(async () => {
        const previous = getSetting<RestartOperation | null>(OP_KEY, null);
        if (source === 'auto' && previous && (previous.phase !== 'completed') && Date.now() - previous.updated_at < 10 * 60_000) {
          throw new RestartError('The previous restart needs attention. Automatic retries are paused for ten minutes.', 'restart_cooldown');
        }
        const row = getAccount(id);
        if (!row) throw new RestartError('Account not found.', 'not_found', 404);
        const operation: RestartOperation = { id: randomUUID(), account_id: id, phase: 'preparing', message: 'Checking the selected account.', started_at: Date.now(), updated_at: Date.now(), verification: null };
        const phase = (name: RestartPhase, message: string) => {
          Object.assign(operation, { phase: name, message, updated_at: Date.now() });
          setSetting(OP_KEY, operation);
          this.cached = null;
        };
        let saved: Snapshot | null = null;
        let quitAttempted = false;
        let launched = false;
        let wasRunning = false;
        phase('preparing', 'Checking the selected account and Codex installation.');
        try {
          const host = await this.host.inspect();
          if (!host.installed) throw new RestartError('Codex is not installed.');
          wasRunning = host.running;
          // Fail invalid credentials before touching the running application.
          let tokens = await ensureFresh(row);
          phase('closing', 'Closing Codex before replacing the login.');
          quitAttempted = true;
          await this.host.quit();
          if ((await this.host.inspect()).running) throw new RestartError('Codex is still running. The login has not been replaced.');
          saved = snapshot();
          setSetting(BACKUP_KEY, seal(saved));
          phase('writing', 'Saving the selected account.');
          tokens = await ensureFresh(getAccount(id) ?? row);
          switchClientTo(tokens);
          if (codexConfigStatus().applied) restoreCodexConfig();
          if (readAuthFile()?.tokens.account_id !== row.account_id) throw new RestartError('The selected login could not be saved.');
          phase('opening', 'Opening Codex with the selected login.');
          await this.host.launch();
          launched = true;
          phase('checking', 'Checking that Codex stays open and the selected login remains saved.');
          for (let attempt = 0; attempt < 3; attempt++) {
            await this.wait(1000);
            if (!(await this.host.inspect()).running) throw new RestartError('Codex exited after reopening.');
            if (readAuthFile()?.tokens.account_id !== row.account_id) throw new RestartError('Codex did not keep the selected login.');
          }
          touchAccount(id);
          setSetting(CURRENT_ACCOUNT_KEY, id);
          await syncLinkedT3Code(tokensOf(getAccount(id) ?? row), id);
          operation.verification = 'process_and_auth_file';
          phase('completed', 'Codex reopened and the selected login is saved.');
          setSetting(BACKUP_KEY, null);
          return operation;
        } catch (error) {
          let rollback = '';
          if (saved) {
            try {
              // launch() may have opened an app even when its response failed.
              if (launched || (await this.host.inspect()).running) await this.host.quit();
              if ((await this.host.inspect()).running) throw new Error('still running');
              restore(saved);
              if (wasRunning) await this.host.launch();
              setSetting(BACKUP_KEY, null);
              rollback = wasRunning ? ' Previous login restored and Codex reopened.' : ' Previous login restored.';
            } catch { rollback = ' Automatic recovery did not finish. Check Codex and the saved login before retrying.'; }
          } else if (quitAttempted && wasRunning) {
            try { if (!(await this.host.inspect()).running) await this.host.launch(); } catch { rollback = ' Reopen Codex manually; the login was not replaced.'; }
          }
          const message = (error instanceof RestartError ? error.message : 'The Codex account restart failed.') + rollback;
          phase('failed', message);
          throw new RestartError(message, error instanceof RestartError ? error.code : 'restart_failed');
        }
      });
    } finally { this.busy = false; this.cached = null; }
  }
}
export const restartController = new RestartController();

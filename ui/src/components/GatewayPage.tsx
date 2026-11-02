import { useState } from 'react';
import {
  ArrowRight,
  Check,
  Copy,
  Download,
  Eye,
  EyeOff,
  KeyRound,
  Minus,
  PlugZap,
  RefreshCw,
  ShieldCheck,
} from 'lucide-react';
import type { State } from '../types';
import { durationLong, shortHome } from '../format';

interface Props {
  state: State;
  busy: boolean;
  configMessage: string | null;
  onApplyConfig: () => void;
  onRestoreConfig: () => void;
  onRotateKey: () => void;
  notify: (message: string, tone?: 'ok' | 'err') => void;
}

export function GatewayPage({
  state,
  busy,
  configMessage,
  onApplyConfig,
  onRestoreConfig,
  onRotateKey,
  notify,
}: Props) {
  const [revealed, setRevealed] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const gateway = state.gateway;
  const applied = state.codex_config.applied;
  const cliAccount = state.accounts.find((account) => account.id === state.codex_auth_account_id) ?? null;

  const copy = async (value: string, label: string) => {
    try {
      await navigator.clipboard.writeText(value);
      notify(`${label} copied.`);
    } catch {
      notify('Clipboard is unavailable; select the value manually.', 'err');
    }
  };

  return (
    <div className="page gateway-page">
      <header className="title-row">
        <div>
          <h1>Gateway</h1>
          <p className="lede">
            {applied
              ? 'Gateway mode is configured. Quit and reopen Codex to load it; requests through Manager can rotate across accounts.'
              : 'Optionally send Codex requests through Manager to share quota across your saved accounts.'}
          </p>
        </div>
        <div className="title-actions">
          {applied ? (
            <button type="button" className="btn btn-quiet-danger" disabled={busy} onClick={() => setConfirmRemove(true)}>
              Disable gateway
            </button>
          ) : null}
          <button type="button" className="btn btn-primary" disabled={busy} onClick={onApplyConfig}>
            <PlugZap size={13} />
            {applied ? 'Update gateway settings' : 'Enable gateway'}
          </button>
        </div>
      </header>

      <section className={`panel gateway-status${applied ? ' applied' : ''}`} aria-labelledby="gateway-state">
        <div className="gateway-state-main">
          <span className={`state-badge${applied ? ' ok' : ''}`}>{applied ? 'Configured' : 'Optional'}</span>
          <div>
            <h2 id="gateway-state">
              {applied ? 'Gateway settings are saved' : 'Direct sign-in is available without a gateway'}
            </h2>
            <p>
              {applied
                ? 'Quit and reopen Codex to load these settings. Saved settings do not verify the running app connection.'
                : 'Enabling the gateway backs up your settings and adds a local connection. It does not add an account to the Codex app.'}
            </p>
          </div>
        </div>

        <div className="gateway-checks">
          <span className="check is-ok">
            <Check size={12} />
            Gateway running on 127.0.0.1:{gateway.port}
          </span>
          <span className={`check${cliAccount ? ' is-ok' : ''}`}>
            {cliAccount ? <Check size={12} /> : <Minus size={12} />}
            {cliAccount ? `Auth pinned to ${cliAccount.email}` : 'No login pinned in auth.json'}
          </span>
          <span className={`check${applied ? ' is-ok' : ''}`}>
            {applied ? <Check size={12} /> : <Minus size={12} />}
            {applied ? 'Managed config.toml block' : 'config.toml is unmanaged'}
          </span>
        </div>

        <div className="gateway-path">
          <span>Config file</span>
          <code>{shortHome(state.codex_config.path)}</code>
          {state.codex_config.backup ? <span className="panel-note">Backup written beside it</span> : null}
        </div>

        {configMessage ? (
          <p className="gateway-message" role="status">
            <Check size={12} />
            {configMessage}
          </p>
        ) : null}

        {confirmRemove ? (
          <div className="confirm-row">
            <p>
              Remove the managed block? Codex will go back to its original config, and this app will stop seeing its
              requests.
            </p>
            <div className="confirm-actions">
              <button type="button" className="btn btn-sm btn-ghost" onClick={() => setConfirmRemove(false)}>
                Cancel
              </button>
              <button
                type="button"
                className="btn btn-sm btn-danger"
                disabled={busy}
                onClick={() => {
                  setConfirmRemove(false);
                  onRestoreConfig();
                }}
              >
                Remove block
              </button>
            </div>
          </div>
        ) : null}
      </section>

      <div className="gateway-grid">
        <section className="panel" aria-labelledby="connection-title">
          <header className="panel-head">
            <div className="panel-title">
              <h2 id="connection-title">Connection</h2>
              <span className="panel-note">Use these values when pointing another Codex client here.</span>
            </div>
            <button
              type="button"
              className="btn btn-sm btn-ghost"
              disabled={busy}
              onClick={onRotateKey}
              title="Generate a new local key; config.toml is rewritten if managed"
            >
              <RefreshCw size={12} className={busy ? 'spin' : undefined} />
              Rotate key
            </button>
          </header>

          <dl className="kv-list">
            <div>
              <dt>Endpoint</dt>
              <dd>
                <code>{gateway.url}</code>
                <button
                  type="button"
                  className="icon-btn"
                  onClick={() => void copy(gateway.url, 'Endpoint')}
                  title="Copy endpoint"
                  aria-label="Copy endpoint"
                >
                  <Copy size={12} />
                </button>
              </dd>
            </div>
            <div>
              <dt>API key</dt>
              <dd>
                <code title={revealed ? gateway.api_key : 'Reveal to see the full key'}>
                  {revealed ? gateway.api_key : gateway.api_key_masked}
                </code>
                <button
                  type="button"
                  className="icon-btn"
                  onClick={() => setRevealed((value) => !value)}
                  title={revealed ? 'Hide key' : 'Reveal key'}
                  aria-label={revealed ? 'Hide API key' : 'Reveal API key'}
                >
                  {revealed ? <EyeOff size={12} /> : <Eye size={12} />}
                </button>
                <button
                  type="button"
                  className="icon-btn"
                  onClick={() => void copy(gateway.api_key, 'API key')}
                  title="Copy key"
                  aria-label="Copy API key"
                >
                  <Copy size={12} />
                </button>
              </dd>
            </div>
            <div>
              <dt>Upstream</dt>
              <dd>
                <code>{gateway.upstream_base.replace(/^https?:\/\//, '')}</code>
              </dd>
            </div>
            <div>
              <dt>Codex auth</dt>
              <dd>
                {cliAccount ? (
                  <span className="status ok">
                    <i />
                    {cliAccount.email}
                  </span>
                ) : (
                  <span className="muted">Not managed by this app</span>
                )}
              </dd>
            </div>
            <div>
              <dt>Codex home</dt>
              <dd>
                <code>{shortHome(state.codex_home)}</code>
              </dd>
            </div>
            <div>
              <dt>Request policy</dt>
              <dd className="muted">
                {gateway.max_account_attempts} attempts · {Math.round(gateway.request_timeout_ms / 1000)}s timeout ·
                sign-in listener :{gateway.oauth_port}
              </dd>
            </div>
          </dl>
        </section>

        <section className="panel" aria-labelledby="routing-title">
          <header className="panel-head">
            <div className="panel-title">
              <h2 id="routing-title">How a request is routed</h2>
              <span className="panel-note">For requests through Manager</span>
            </div>
          </header>
          <ol className="rules">
            <li>
              <strong>Codex calls the gateway.</strong> The local key above stands in for the upstream credential; it
              never leaves this machine.
            </li>
            <li>
              <strong>The pool picks a login.</strong> Smooth weighted round-robin favours the login with the most
              remaining headroom, and pins one when you pass <code>x-codex-account</code>.
            </li>
            <li>
              <strong>Failures move on.</strong> A 401 refreshes the token, 429 parks that login until reset, and 5xx
              retries on another login before the caller sees an error.
            </li>
            <li>
              <strong>Headers update the meters.</strong> Every upstream <code>x-codex-*</code> header updates the
              quota bars, so the next request starts from fresher numbers.
            </li>
            <li>
              <strong>Credentials stay sealed.</strong> Tokens are encrypted with AES-256-GCM in{' '}
              <code>~/.codex-manager</code>; config.toml only holds a local key.
            </li>
          </ol>
          <footer className="panel-foot routing-foot">
            <ShieldCheck size={13} aria-hidden />
            <span>Listening on loopback only. No port is exposed to the network.</span>
          </footer>
        </section>
      </div>

      <section className="panel diag-panel" aria-labelledby="diag-title">
        <div className="diag-copy">
          <h2 id="diag-title">Diagnostics</h2>
          <p>Version, account state, settings and the retained request log — with masked credentials.</p>
        </div>
        <dl className="diag-facts">
          <div>
            <dt>Version</dt>
            <dd>v{state.version}</dd>
          </div>
          <div>
            <dt>Uptime</dt>
            <dd>{durationLong(state.uptime_ms)}</dd>
          </div>
          <div>
            <dt>Requests</dt>
            <dd>{state.total_requests}</dd>
          </div>
          <div>
            <dt>Auth backup</dt>
            <dd>{state.backup_exists ? 'Ready' : 'None'}</dd>
          </div>
        </dl>
        <a className="btn" href="/api/diagnostics?download=1">
          <Download size={13} />
          Download JSON
        </a>
      </section>

      <p className="page-foot">
        <KeyRound size={12} aria-hidden />
        Changing config.toml takes effect the next time Codex starts. Run <code>codex</code> in a new terminal to pick
        it up.
        <a className="quiet-link" href="#/accounts">
          Back to accounts
          <ArrowRight size={12} />
        </a>
      </p>
    </div>
  );
}

import { useEffect, useRef, useState } from 'react';
import { Check, ExternalLink, FileJson, FileUp, LogIn, Upload, X } from 'lucide-react';
import { api, post } from '../api';
import { openSignIn, type SignInDestination } from '../desktop';
import type { BulkImportResult, LoginSession, State } from '../types';

interface Props {
  initialView?: 'single' | 'bulk';
  accountCount: number;
  onClose: () => void;
  onAdded: (message: string) => void;
  notify: (message: string, tone?: 'ok' | 'err') => void;
}

type Tab = 'single' | 'bulk';

export function AddAccountModal({ initialView = 'single', accountCount, onClose, onAdded, notify }: Props) {
  const [tab, setTab] = useState<Tab>(initialView);
  const [busy, setBusy] = useState<'import' | 'login' | 'json' | 'bulk' | null>(null);
  const [waiting, setWaiting] = useState<LoginSession | null>(null);
  const [json, setJson] = useState('');
  const [showJson, setShowJson] = useState(false);
  const [bulkText, setBulkText] = useState('');
  const [fileName, setFileName] = useState<string | null>(null);
  const [bulkResult, setBulkResult] = useState<BulkImportResult | null>(null);
  const [destination, setDestination] = useState<SignInDestination>('browser');
  const desktop = Boolean(window.codexManager);
  const dialog = useRef<HTMLDivElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    dialog.current?.focus();
    return () => {
      document.body.style.overflow = previous;
    };
  }, []);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  // The OAuth callback lands on the local listener, not in this window. Poll the
  // state until the new account appears, then close so the pool is visible.
  useEffect(() => {
    if (!waiting) return;
    let cancelled = false;
    const timer = window.setInterval(() => {
      void api<State>('/api/state')
        .then((next) => {
          if (cancelled || next.accounts.length <= accountCount) return;
          const added = next.accounts.find((account) => account.email)?.email;
          onAdded(added ? `Added ${added}.` : 'Account added.');
          void window.codexManager?.closeSignIn().catch(() => undefined);
          onClose();
        })
        .catch(() => undefined);
    }, 2000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [accountCount, onAdded, onClose, waiting]);

  const importFromCli = async () => {
    setBusy('import');
    try {
      const result = await post<{ account?: { email?: string }; warning?: string }>('/api/accounts/import');
      onAdded(`Added ${result.account?.email ?? 'account'} from ~/.codex/auth.json.`);
      if (result.warning) notify(result.warning, 'err');
      onClose();
    } catch (error) {
      notify((error as Error).message, 'err');
    } finally {
      setBusy(null);
    }
  };

  const launchSignIn = async (session: LoginSession, mode: SignInDestination) => {
    setDestination(mode);
    try { await openSignIn(session.url, mode); }
    catch { notify('Could not open sign-in. Try your browser or copy the sign-in link.', 'err'); }
  };

  const startLogin = async (mode: SignInDestination) => {
    setBusy('login');
    try {
      const session = await post<LoginSession>('/api/login/start');
      setWaiting(session);
      await launchSignIn(session, mode);
    } catch (error) {
      notify((error as Error).message, 'err');
      setWaiting(null);
    } finally {
      setBusy(null);
    }
  };

  const cancelLogin = async () => {
    setWaiting(null);
    await window.codexManager?.closeSignIn().catch(() => undefined);
    await post('/api/login/cancel').catch(() => undefined);
  };

  const copySignIn = async () => {
    if (!waiting) return;
    try { await navigator.clipboard.writeText(waiting.url); notify('Sign-in link copied.'); }
    catch { notify('Could not copy the sign-in link.', 'err'); }
  };

  const addJson = async () => {
    if (!json.trim()) return;
    setBusy('json');
    try {
      const result = await post<{ account?: { email?: string }; warning?: string }>('/api/accounts/json', { json });
      onAdded(`Added ${result.account?.email ?? 'account'}.`);
      if (result.warning) notify(result.warning, 'err');
      onClose();
    } catch (error) {
      notify((error as Error).message, 'err');
    } finally {
      setBusy(null);
    }
  };

  const readFile = async (file: File) => {
    if (!file.name.toLowerCase().endsWith('.json')) {
      notify('Choose a .json export from Codex Manager.', 'err');
      return;
    }
    try {
      const text = await file.text();
      setBulkText(text);
      setFileName(file.name);
      setBulkResult(null);
    } catch {
      notify('That file could not be read.', 'err');
    }
  };

  const importBulk = async () => {
    if (!bulkText.trim()) return;
    setBusy('bulk');
    try {
      const result = await post<BulkImportResult>('/api/accounts/import-bulk', { json: bulkText });
      setBulkResult(result);
      const message =
        result.imported === 0
          ? 'No accounts were imported.'
          : `Imported ${result.imported} account${result.imported === 1 ? '' : 's'}${result.failed ? ` · ${result.failed} failed` : ''}.`;
      if (result.imported > 0) onAdded(message);
      else notify(message, 'err');
    } catch (error) {
      notify((error as Error).message, 'err');
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="overlay" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <div
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="add-account-title"
        ref={dialog}
        tabIndex={-1}
      >
        <header className="modal-head">
          <div>
            <h2 id="add-account-title">Connect an account</h2>
            <p className="modal-sub">Each login keeps its own encrypted tokens, quota snapshot and routing weight.</p>
          </div>
          <button type="button" className="icon-btn" onClick={onClose} aria-label="Close dialog">
            <X size={15} />
          </button>
        </header>

        {!waiting ? (
          <div className="modal-tabs" role="tablist" aria-label="Add account method">
            <button
              type="button"
              role="tab"
              aria-selected={tab === 'single'}
              className={tab === 'single' ? 'on' : undefined}
              onClick={() => setTab('single')}
            >
              One login
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={tab === 'bulk'}
              className={tab === 'bulk' ? 'on' : undefined}
              onClick={() => setTab('bulk')}
            >
              Import bundle
            </button>
          </div>
        ) : null}

        {waiting ? (
          <div className="waiting">
            <div className="waiting-head">
              <span className="spinner" aria-hidden />
              <div>
                <h3>Waiting for ChatGPT</h3>
                <p>
                  Finish signing in {destination === 'browser' ? 'in your browser' : 'in the sign-in window'}.
                  Your account will appear here when sign-in completes.
                </p>
              </div>
            </div>
            <div className="modal-foot">
              <span className="hint">Sign-in expires after ten minutes. Callback: localhost:{portOf(waiting.redirect_uri)}</span>
              <div className="foot-actions">
                {desktop ? (
                  <button type="button" className="btn btn-sm" onClick={() => void launchSignIn(waiting, 'browser')}>
                    <ExternalLink size={13} /> Open in browser
                  </button>
                ) : (
                  <a className="btn btn-sm" href={waiting.url} target="_blank" rel="noopener noreferrer">Open in browser</a>
                )}
                <button type="button" className="btn btn-sm btn-ghost" onClick={() => void copySignIn()}>Copy link</button>
                <button type="button" className="btn btn-sm btn-ghost" onClick={() => void cancelLogin()}>
                  Cancel
                </button>
              </div>
            </div>
          </div>
        ) : tab === 'single' ? (
          <div className="modal-body">
            <div className="option">
              <span className="option-icon" aria-hidden>
                <LogIn size={16} />
              </span>
              <div className="option-copy">
                <h3>Sign in with ChatGPT</h3>
                <p>Choose your default browser or a separate sign-in window. Manager never asks for your password.</p>
              </div>
              <button
                type="button"
                className="btn btn-sm btn-primary"
                disabled={busy !== null}
                onClick={() => void startLogin('browser')}
              >
                <ExternalLink size={13} /> Open browser
              </button>
              {desktop ? (
                <button type="button" className="btn btn-sm" disabled={busy !== null} onClick={() => void startLogin('app')}>
                  In app
                </button>
              ) : null}
            </div>

            <div className="option">
              <span className="option-icon" aria-hidden>
                <Upload size={16} />
              </span>
              <div className="option-copy">
                <h3>Import the current Codex login</h3>
                <p>
                  Reads <code>~/.codex/auth.json</code> once. The original file is left untouched.
                </p>
              </div>
              <button type="button" className="btn btn-sm" disabled={busy !== null} onClick={() => void importFromCli()}>
                Import
              </button>
            </div>

            <div className="option option-stack">
              <div className="option-row">
                <span className="option-icon" aria-hidden>
                  <FileJson size={16} />
                </span>
                <div className="option-copy">
                  <h3>Paste a token bundle</h3>
                  <p>auth.json contents, or an object with access_token, refresh_token and account_id.</p>
                </div>
                <button type="button" className="btn btn-sm btn-ghost" onClick={() => setShowJson((value) => !value)}>
                  {showJson ? 'Hide' : 'Open'}
                </button>
              </div>
              {showJson ? (
                <>
                  <textarea
                    className="input textarea mono-input"
                    aria-label="Token bundle JSON"
                    placeholder='{ "access_token": "…", "refresh_token": "…", "account_id": "…" }'
                    value={json}
                    onChange={(event) => setJson(event.target.value)}
                    spellCheck={false}
                  />
                  <div className="option-actions">
                    <button
                      type="button"
                      className="btn btn-sm btn-primary"
                      disabled={busy !== null || !json.trim()}
                      onClick={() => void addJson()}
                    >
                      Add account
                    </button>
                  </div>
                </>
              ) : null}
            </div>

            <div className="modal-foot">
              <span className="hint">Stored credentials are encrypted on this computer.</span>
              <button type="button" className="btn btn-sm btn-ghost" onClick={onClose}>
                Close
              </button>
            </div>
          </div>
        ) : (
          <div className="modal-body">
            <label className={`dropzone${fileName ? ' filled' : ''}`}>
              <input
                ref={fileInput}
                type="file"
                accept="application/json,.json"
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  if (file) void readFile(file);
                  event.target.value = '';
                }}
              />
              <span className="dropzone-icon" aria-hidden>
                <FileUp size={18} />
              </span>
              <span className="dropzone-title">{fileName ?? 'Drop a Codex Manager export here'}</span>
              <span className="dropzone-hint">
                {fileName
                  ? 'Choose another file, or import the text below.'
                  : 'Or choose a .json file. Metadata-only exports import nothing without credentials.'}
              </span>
            </label>

            <div className="bulk-or">
              <span>or paste the bundle</span>
            </div>

            <textarea
              className="input textarea mono-input"
              aria-label="Account bundle JSON"
              placeholder='{ "format": "codex-manager.accounts", "accounts": [ … ] }'
              value={bulkText}
              onChange={(event) => {
                setBulkText(event.target.value);
                setFileName(null);
                setBulkResult(null);
              }}
              spellCheck={false}
            />

            <div className="bulk-actions">
              <span className="hint">Up to 100 accounts per import. Existing accounts are updated in place.</span>
              <button
                type="button"
                className="btn btn-primary"
                disabled={busy !== null || !bulkText.trim()}
                onClick={() => void importBulk()}
              >
                {busy === 'bulk' ? 'Importing…' : 'Import bundle'}
              </button>
            </div>

            {bulkResult ? (
              <div className={`bulk-result${bulkResult.failed > 0 ? ' has-failures' : ''}`} role="status">
                <div className="bulk-summary">
                  <span className="status ok">
                    <Check size={12} />
                    {bulkResult.imported} imported
                  </span>
                  {bulkResult.failed > 0 ? <span className="status bad">{bulkResult.failed} failed</span> : null}
                </div>
                <ul className="bulk-list">
                  {bulkResult.results.map((entry, index) => (
                    <li key={`${entry.email ?? 'entry'}-${index}`}>
                      <span className={`event-dot ${entry.ok ? 'ok' : 'bad'}`} aria-hidden />
                      <span className="bulk-email">{entry.email ?? `Entry ${index + 1}`}</span>
                      <span className="bulk-message">{entry.ok ? 'Added' : entry.error}</span>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}

            <div className="modal-foot">
              <span className="hint">Imports update matching accounts and keep their quota history.</span>
              <button type="button" className="btn btn-sm btn-ghost" onClick={onClose}>
                Done
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function portOf(redirect: string): string {
  try {
    return new URL(redirect).port || '1455';
  } catch {
    return '1455';
  }
}

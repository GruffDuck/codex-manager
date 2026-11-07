import { useEffect, useRef, useState } from 'react';
import { CheckCircle2, Copy, X } from 'lucide-react';
import type { Account, State } from '../types';
import { post } from '../api';

interface PreparedProfile {
  status: 'prepared';
  codex_home: string;
  connection_verified: false;
  link: NonNullable<State['t3_code']>;
}

interface Props {
  account: Account;
  link: State['t3_code'];
  onClose: () => void;
  onPrepared: () => void;
  notify: (message: string, tone?: 'ok' | 'err') => void;
}

export function T3CodeModal({ account, link, onClose, onPrepared, notify }: Props) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [profile, setProfile] = useState<PreparedProfile | null>(null);
  const [busy, setBusy] = useState(false);
  const [disconnected, setDisconnected] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const element = dialog.current;
    element?.showModal();
    return () => element?.close();
  }, []);

  const prepare = async () => {
    setBusy(true);
    setError(null);
    try {
      setDisconnected(false);
      setProfile(await post<PreparedProfile>(`/api/accounts/${account.id}/use-in-t3-code`));
      onPrepared();
    } catch (error) {
      setError((error as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const disconnect = async () => {
    setBusy(true);
    setError(null);
    try {
      await post('/api/t3-code/disconnect');
      setDisconnected(true);
      setProfile(null);
      onPrepared();
      notify('T3 Code linked switching disabled.');
    } catch (error) { setError((error as Error).message); }
    finally { setBusy(false); }
  };

  const copy = async () => {
    if (!profile) return;
    try {
      await navigator.clipboard.writeText(profile.codex_home);
      notify('T3 Code profile path copied.');
    } catch {
      notify('Could not copy. Select and copy the profile path below.', 'err');
    }
  };

  return (
    <dialog ref={dialog} className="modal t3-modal" aria-labelledby="t3-title"
      onCancel={(event) => { event.preventDefault(); if (!busy) onClose(); }}>
      <header className="modal-head">
        <div>
          <h2 id="t3-title">Use in T3 Code</h2>
          <p className="modal-sub">{account.email}</p>
        </div>
        <button type="button" className="icon-btn" disabled={busy} onClick={onClose} aria-label="Close dialog"><X size={17} /></button>
      </header>
      <div className="modal-body t3-body">
        {profile ? (
          <>
            <p className="t3-ready"><CheckCircle2 size={16} /> Linked profile ready</p>
            <ol className="t3-steps">
              <li>Open <strong>Settings → Providers</strong> in T3 Code and select this computer&apos;s local environment.</li>
              <li>One time only: edit your existing <strong>Codex CLI</strong> provider instance. Keep using that same instance when accounts change.</li>
              <li>Set <strong>CODEX_HOME path</strong> to the path below. Leave <strong>Shadow home path</strong> empty.</li>
              <li>Save and refresh provider status. Future Manager account changes update this same profile and restart T3 Code if it is open.</li>
            </ol>
            <label className="field-label" htmlFor="t3-profile-path">CODEX_HOME path</label>
            <div className="t3-path">
              <input id="t3-profile-path" className="input" readOnly value={profile.codex_home} onFocus={(event) => event.target.select()} />
              <button type="button" className="btn btn-outline" onClick={() => void copy()}><Copy size={14} /> Copy</button>
            </div>
            <p className="field-hint">This path belongs to this computer. A remote server or WSL environment needs its own login.</p>
            <p className="field-hint">If you used Preview 5, replace its account-specific path with this linked path once. Refresh provider status and check the reported account; Manager does not read T3’s private UI account.</p>
          </>
        ) : (
          <p>Link T3 Code to Manager with one fixed profile path. After the one-time provider setup, manual and automatic Manager account changes also switch T3 Code. If T3 Code is open, it closes and reopens; active replies may be interrupted.</p>
        )}
        <p className="field-hint">All linked accounts use the same T3 profile and session directory. Closed T3 Code apps stay closed. Codex and T3 Code share the selected account’s quota. Automatic desktop restart currently requires macOS.</p>
        <p className="field-hint">The profile stores login credentials on disk with restricted permissions. Disconnect below to stop following Manager. Removing an account does not delete a profile in use by T3 Code.</p>
        {error ? <p role="alert" className="warn-text">{error}</p> : null}
      </div>
      <footer className="modal-foot">
        {!disconnected && (profile?.link.enabled || link?.enabled) ? <button type="button" className="btn btn-quiet" disabled={busy} onClick={() => void disconnect()}>Disconnect linked switching</button> : null}
        {profile ? <button type="button" className="btn btn-primary" onClick={onClose}>Done</button> : (
          <button type="button" className="btn btn-primary" disabled={busy} onClick={() => void prepare()}>{busy ? 'Preparing…' : 'Link and use this account'}</button>
        )}
      </footer>
    </dialog>
  );
}

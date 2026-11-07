import { ArrowRight, Laptop, Plus, RefreshCw, ShieldCheck } from 'lucide-react';
import type { Account, State } from '../types';
import { AccountRow } from './AccountRow';
import { ActivityStrip } from './ActivityStrip';
import { Logo } from './Logo';

interface Props {
  state: State;
  busy: Set<string>;
  onAdd: () => void;
  onRefreshAll: () => void;
  onUseCodex: (account: Account) => void;
  onPrepare: (account: Account) => void;
  onUseCli: (account: Account) => void;
  onUseT3Code: (account: Account) => void;
  onRefreshAccount: (account: Account) => void;
  onRemove: (account: Account) => void;
}

export function AccountsPage({ state, busy, onAdd, onRefreshAll, onUseCodex, onPrepare, onUseCli, onUseT3Code, onRefreshAccount, onRemove }: Props) {
  const prepared = state.accounts.find((account) => account.id === state.codex_auth_account_id) ?? null;
  const restart = state.codex_restart;
  const operation = restart?.operation;
  const changing = Boolean(operation && !['completed', 'failed'].includes(operation.phase));
  const gateway = state.codex_config.applied;
  const accounts = [...state.accounts].sort((a, b) =>
    Number(b.id === prepared?.id) - Number(a.id === prepared?.id) ||
    Number(b.eligible) - Number(a.eligible) || a.email.localeCompare(b.email),
  );

  return (
    <div className="page accounts-page">
      <header className="title-row">
        <div>
          <h1>Accounts <span className="heading-count">{accounts.length}</span></h1>
          <p className="lede">Your ChatGPT accounts, with quota at a glance.</p>
        </div>
        <div className="title-actions">
          <button type="button" className="btn btn-quiet" disabled={busy.has('global') || !accounts.length} onClick={onRefreshAll}>
            <RefreshCw size={14} className={busy.has('global') ? 'spin' : undefined} />
            Refresh quotas
          </button>
          <button type="button" className="btn btn-primary" onClick={onAdd}><Plus size={15} /> Add account</button>
        </div>
      </header>

      <section className="login-status" aria-labelledby="login-status-title">
        <span className="login-status-icon"><Laptop size={20} /></span>
        <div className="login-status-copy">
          <h2 id="login-status-title">{changing ? 'Changing account…' : restart?.running ? 'Codex is running' : 'Codex is closed'}</h2>
          <p>{prepared ? <strong>{prepared.email}</strong> : 'Choose an account below.'}<span>{changing ? operation?.message : 'Switching accounts closes Codex, saves the login and reopens it.'}</span></p>
        </div>
        <a className="quiet-link" href="#/gateway">{gateway ? 'Manage gateway' : 'Gateway options'}<ArrowRight size={13} /></a>
      </section>

      {!restart?.supported ? <p className="desktop-note" role="status">{restart?.reason ?? 'Checking automatic restart support…'}</p> : null}
      {operation?.phase === 'failed' ? <p className="desktop-note" role="alert"><strong>Account change failed.</strong> {operation.message}</p> : null}

      {state.t3_code?.enabled ? <p className="desktop-note" role="status">
        <strong>T3 Code linked.</strong> {['failed', 'switching'].includes(state.t3_code.state) ? state.t3_code.message : 'Follows Manager account changes. An open T3 Code app restarts to load the new login.'}
      </p> : null}
      <section className="panel pool" aria-labelledby="pool-title">
        <header className="panel-head">
          <div className="panel-title"><h2 id="pool-title">Saved accounts</h2><span className="panel-note">{state.counts.active} available</span></div>
          <span className="panel-note">Quota remaining</span>
        </header>
        {!accounts.length ? (
          <div className="empty-state">
            <Logo size={34} />
            <h2>Add your first account</h2>
            <p>Sign in with ChatGPT or import an existing Codex login. Your accounts stay on this Mac.</p>
            <button type="button" className="btn btn-primary" onClick={onAdd}><Plus size={14} /> Add account</button>
          </div>
        ) : (
          <div className="account-list">{accounts.map((account) => (
            <AccountRow key={account.id} account={account} active={false}
              restartAvailable={restart?.supported === true} linked={account.id === prepared?.id && !gateway}
              busy={changing || busy.has(account.id) || busy.has('global')}
              onUseCodex={() => onUseCodex(account)} onPrepare={() => onPrepare(account)} onUseCli={() => onUseCli(account)} onUseT3Code={() => onUseT3Code(account)}
              onRefresh={() => onRefreshAccount(account)} onRemove={() => onRemove(account)} />
          ))}</div>
        )}
      </section>
      <p className="accounts-note"><ShieldCheck size={14} /> Switching restarts Codex and may interrupt an active reply. At zero quota, auto-switch uses the same restart process.</p>
      {state.events.length > 0 ? <ActivityStrip events={state.events} /> : null}
    </div>
  );
}

import { useEffect, useRef, useState } from 'react';
import { ArrowUpRight, Check, MoreHorizontal, RefreshCw, Terminal, Trash2 } from 'lucide-react';
import type { Account } from '../types';
import {
  planLabel,
  relativeFromNow,
  resetLabel,
  remainingOf,
  statusOf,
  toneClass,
  windowLabel,
} from '../format';
import { Battery } from './Battery';

interface Props {
  account: Account;
  linked: boolean;
  active: boolean;
  restartAvailable: boolean;
  busy: boolean;
  onUseCodex: () => void;
  onPrepare: () => void;
  onUseCli: () => void;
  onUseT3Code: () => void;
  onRefresh: () => void;
  onRemove: () => void;
}

export function AccountRow({ account, linked, active, restartAvailable, busy, onUseCodex, onPrepare, onUseCli, onUseT3Code, onRefresh, onRemove }: Props) {
  const [confirming, setConfirming] = useState(false);
  const timer = useRef<number | null>(null);
  const status = statusOf(account);
  const quota = account.quota;
  const primary = quota?.primary;
  const secondary = quota?.secondary;
  const primaryLeft = remainingOf(primary);
  const secondaryLeft = remainingOf(secondary);
  const plan = planLabel(account.plan_type);
  const cooldownOver =
    account.status === 'rate_limited' &&
    account.cooldown_until !== null &&
    account.cooldown_until <= Date.now();

  useEffect(
    () => () => {
      if (timer.current !== null) window.clearTimeout(timer.current);
    },
    [],
  );

  const resets = [resetLabel(primary), resetLabel(secondary)].filter((label): label is string => Boolean(label));

  return (
    <article className={`account-row${active || linked ? ' is-prepared' : ''}`}>
      <div className="account-ident">
        <span className="avatar" aria-hidden>
          {(account.email || '?').slice(0, 1).toUpperCase()}
        </span>
        <div className="account-copy">
          <div className="account-name">
            <span className="account-email" title={account.email}>
              {account.email}
            </span>
          </div>
          <div className="account-meta">
            <span className={`status ${toneClass(status.tone)}`} title={account.status_reason ?? undefined}>
              <i />
              {status.text}
            </span>
            {plan ? (
              <>
                <span className="sep">·</span>
                <span>{plan}</span>
              </>
            ) : null}
            {active || linked ? <span className="prepared-mark"><Check size={11} /> Selected login</span> : null}
          </div>
        </div>
      </div>

      <div className="account-quota">
        {quota && (primaryLeft !== null || secondaryLeft !== null) ? (
          <>
            {primaryLeft !== null ? (
              <div className="quota-row">
                <span className="quota-k">{windowLabel(primary?.limit_window_seconds ?? 0)}</span>
                <Battery value={primaryLeft} label={`${windowLabel(primary?.limit_window_seconds ?? 0)} quota remaining`} />
                <span className="quota-v" title={`${Math.round(primary?.used_percent ?? 0)}% used`}>
                  {primaryLeft}%
                </span>
              </div>
            ) : null}
            {secondaryLeft !== null ? (
              <div className="quota-row">
                <span className="quota-k">{windowLabel(secondary?.limit_window_seconds ?? 0)}</span>
                <Battery value={secondaryLeft} label={`${windowLabel(secondary?.limit_window_seconds ?? 0)} quota remaining`} />
                <span className="quota-v" title={`${Math.round(secondary?.used_percent ?? 0)}% used`}>
                  {secondaryLeft}%
                </span>
              </div>
            ) : null}
            <p className="quota-foot">
              {cooldownOver ? (
                <span className="warn-text">Reset overdue — refresh to confirm.</span>
              ) : resets.length > 0 ? (
                <>Resets in {resets.map((label) => label.replace(/^resets in /, '')).join(' · ')}</>
              ) : quota ? (
                <>Snapshot captured {relativeFromNow(quota.captured_at)}</>
              ) : null}
            </p>
          </>
        ) : (
          <p className="quota-foot">
            No quota snapshot yet. Refresh to ask ChatGPT for this login&apos;s limits.
          </p>
        )}
      </div>

      <div className="account-actions">
        <div className="account-client-actions">
        <button
          type="button"
          className={`btn btn-sm${active ? ' btn-current' : ' btn-outline'}`}
          disabled={busy || !restartAvailable}
          onClick={onUseCodex}
          title="Close Codex, save this account and reopen Codex"
        >
          {active ? <Check size={12} /> : <ArrowUpRight size={12} />}
          {linked ? 'Restart Codex' : 'Use in Codex'}
        </button>
        <button type="button" className="btn btn-sm btn-outline" disabled={busy}
          onClick={onUseT3Code} title="Use this account in the linked T3 Code profile">
          <ArrowUpRight size={12} /> Use in T3 Code
        </button>
        </div>
        <button
          type="button"
          className="icon-btn"
          disabled={busy}
          onClick={onRefresh}
          title="Refresh this login's quota"
          aria-label="Refresh quota"
        >
          <RefreshCw size={13} className={busy ? 'spin' : undefined} />
        </button>
        <details className="account-more" onKeyDown={(event) => {
          if (event.key === 'Escape') event.currentTarget.open = false;
        }} onBlur={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget)) event.currentTarget.open = false;
        }}>
          <summary className="icon-btn" aria-label={`More actions for ${account.email}`} title="More actions"><MoreHorizontal size={17} /></summary>
          <div className="account-menu">
            <span className="account-menu-id">Account {account.account_id.slice(0, 8)}</span>
            <button type="button" className="btn btn-sm btn-quiet" disabled={busy} onClick={onPrepare}>Prepare login for restart</button>
            <button
              type="button"
              className="btn btn-sm btn-quiet"
              disabled={busy}
              onClick={onUseCli}
              title="Writes this login into ~/.codex/auth.json only"
            >
              <Terminal size={12} />
              Use in CLI
            </button>
            {confirming ? (
              <button
                type="button"
                className="btn btn-sm btn-danger"
                disabled={busy}
                onClick={() => {
                  setConfirming(false);
                  onRemove();
                }}
              >
                Remove?
              </button>
            ) : (
              <button
                type="button"
                className="btn btn-sm btn-quiet-danger"
                disabled={busy}
                onClick={() => {
                  setConfirming(true);
                  if (timer.current !== null) window.clearTimeout(timer.current);
                  timer.current = window.setTimeout(() => setConfirming(false), 4500);
                }}
                title="Remove account"
                aria-label="Remove account"
              >
                <Trash2 size={13} /> Remove account
              </button>
            )}
          </div>
        </details>
      </div>
    </article>
  );
}

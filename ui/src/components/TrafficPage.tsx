import { useEffect, useMemo, useState } from 'react';
import { ArrowRight, Search } from 'lucide-react';
import type { RequestLog, State } from '../types';
import { duration, logTime, percentile, timeSince } from '../format';

interface Props {
  state: State;
}

type Filter = 'all' | 'ok' | 'err';

function statusTone(status: number | null): string {
  if (status === null) return 'neutral';
  if (status >= 200 && status < 300) return 'ok';
  if (status === 429) return 'warn';
  if (status >= 400) return 'bad';
  return 'neutral';
}

function rowMatches(row: RequestLog, query: string, email: string | null): boolean {
  if (!query) return true;
  const needle = query.toLowerCase();
  return [email ?? '', row.model ?? '', row.note ?? '', row.status === null ? '' : String(row.status)]
    .join(' ')
    .toLowerCase()
    .includes(needle);
}

function statusCounts(rows: RequestLog[]): { all: number; ok: number; err: number } {
  let ok = 0;
  let err = 0;
  for (const row of rows) {
    if (row.status !== null && row.status >= 200 && row.status < 300) ok += 1;
    else if (row.status !== null && row.status >= 400) err += 1;
  }
  return { all: rows.length, ok, err };
}

export function TrafficPage({ state }: Props) {
  const [filter, setFilter] = useState<Filter>('all');
  const [query, setQuery] = useState('');
  const [limit, setLimit] = useState(20);
  const byId = useMemo(() => new Map(state.accounts.map((account) => [account.id, account.email])), [state.accounts]);
  const counts = useMemo(() => statusCounts(state.requests), [state.requests]);
  const okRequests = counts.ok;
  const rate = state.requests.length > 0 ? Math.round((okRequests / state.requests.length) * 100) : null;
  const latencies = state.requests
    .map((row) => row.latency_ms)
    .filter((value): value is number => typeof value === 'number');
  const p95 = percentile(latencies, 95);
  const limited = state.requests.filter((row) => row.status === 429).length;
  const failed = state.requests.filter((row) => row.status !== null && row.status >= 400 && row.status !== 429).length;

  const filtered = useMemo(
    () =>
      state.requests.filter((row) => {
        const email = row.account_id ? (byId.get(row.account_id) ?? null) : null;
        if (filter === 'ok' && !(row.status !== null && row.status >= 200 && row.status < 300)) return false;
        if (filter === 'err' && !(row.status !== null && row.status >= 400)) return false;
        return rowMatches(row, query, email);
      }),
    [byId, filter, query, state.requests],
  );

  useEffect(() => {
    setLimit(20);
  }, [filter, query]);

  const shown = filtered.slice(0, limit);
  const range = filtered.length === 0 ? '0' : `1–${shown.length} of ${filtered.length}`;

  return (
    <div className="page traffic-page">
      <header className="title-row">
        <div>
          <h1>Traffic</h1>
          <p className="lede">
            {state.requests.length === 0
              ? 'No requests have reached the gateway yet. Once Codex is connected, every call lands here.'
              : `${state.requests.length} retained request${state.requests.length === 1 ? '' : 's'}. Every rotation, retry and quota update passes through this log.`}
          </p>
        </div>
        <span className="freshness">Up {duration(state.uptime_ms)}</span>
      </header>

      <section className="stat-band" aria-label="Traffic summary">
        <div className="stat">
          <span className="stat-label">Requests</span>
          <span className="stat-value">{state.requests.length}</span>
          <span className="stat-foot">of {state.total_requests} retained</span>
        </div>
        <div className="stat">
          <span className="stat-label">Succeeded</span>
          <span className={`stat-value ${rate === 100 ? 'ok' : undefined}`}>{rate === null ? '—' : `${rate}%`}</span>
          <span className="stat-foot">
            {okRequests} of {state.requests.length} in log
          </span>
        </div>
        <div className="stat">
          <span className="stat-label">Latency p95</span>
          <span className="stat-value">{p95 === null ? '—' : `${p95} ms`}</span>
          <span className="stat-foot">{latencies.length} timed call{latencies.length === 1 ? '' : 's'}</span>
        </div>
        <div className="stat">
          <span className="stat-label">Failures</span>
          <span className={`stat-value ${limited + failed > 0 ? 'bad' : undefined}`}>{limited + failed}</span>
          <span className="stat-foot">
            {limited} limited · {failed} failed
          </span>
        </div>
      </section>

      <section className="panel log-panel" aria-labelledby="log-title">
        <header className="log-head">
          <div className="panel-title">
            <h2 id="log-title">Request log</h2>
            <span className="panel-note">Newest first · local retention only</span>
          </div>
          <div className="log-tools">
            <label className="search">
              <Search size={13} aria-hidden />
              <input
                type="search"
                value={query}
                placeholder="Search login, model or note"
                aria-label="Search requests"
                onChange={(event) => setQuery(event.target.value)}
              />
            </label>
            <div className="tabs" role="group" aria-label="Filter requests">
              <button type="button" className={filter === 'all' ? 'on' : undefined} onClick={() => setFilter('all')}>
                All <span>{counts.all}</span>
              </button>
              <button type="button" className={filter === 'ok' ? 'on' : undefined} onClick={() => setFilter('ok')}>
                Succeeded <span>{counts.ok}</span>
              </button>
              <button type="button" className={filter === 'err' ? 'on' : undefined} onClick={() => setFilter('err')}>
                Errors <span>{counts.err}</span>
              </button>
            </div>
          </div>
        </header>

        {state.requests.length === 0 ? (
          <div className="empty-state table-empty">
            <h2>Nothing routed yet</h2>
            <p>
              The log fills as soon as Codex points at this gateway. Account switches are recorded here too, even
              when no model is called.
            </p>
            <a className="btn btn-primary" href="#/gateway">
              Open gateway setup
              <ArrowRight size={13} />
            </a>
          </div>
        ) : filtered.length === 0 ? (
          <div className="empty-state table-empty">
            <h2>No requests match this view</h2>
            <p>Try a different search, or clear the filter to see every recorded request.</p>
            <button
              type="button"
              className="btn"
              onClick={() => {
                setQuery('');
                setFilter('all');
              }}
            >
              Clear filters
            </button>
          </div>
        ) : (
          <>
            <div className="table-wrap">
              <table className="req-table">
                <thead>
                  <tr>
                    <th scope="col">Time</th>
                    <th scope="col">Login</th>
                    <th scope="col">Model</th>
                    <th scope="col" className="num">
                      Status
                    </th>
                    <th scope="col" className="num">
                      Latency
                    </th>
                    <th scope="col">Note</th>
                  </tr>
                </thead>
                <tbody>
                  {shown.map((row) => (
                    <RequestRow key={row.id} row={row} email={row.account_id ? (byId.get(row.account_id) ?? null) : null} />
                  ))}
                </tbody>
              </table>
            </div>

            <div className="mobile-requests">
              {shown.map((row) => (
                <MobileRequest
                  key={row.id}
                  row={row}
                  email={row.account_id ? (byId.get(row.account_id) ?? null) : null}
                />
              ))}
            </div>

            <footer className="panel-foot log-foot">
              <span>
                Showing {range} · switch operations appear as 200 with no model
              </span>
              {filtered.length > limit ? (
                <button type="button" className="btn btn-sm" onClick={() => setLimit((value) => value + 20)}>
                  Show 20 more
                </button>
              ) : (
                <span className="panel-note">End of the retained log</span>
              )}
            </footer>
          </>
        )}
      </section>
    </div>
  );
}

function RequestRow({ row, email }: { row: RequestLog; email: string | null }) {
  return (
    <tr>
      <td className="mono time" title={new Date(row.ts).toLocaleString('en-US')}>
        {logTime(row.ts)}
      </td>
      <td className="login">{row.account_id ? (email ?? 'Removed login') : <span className="muted">Unassigned</span>}</td>
      <td className="mono model">{row.model ?? '—'}</td>
      <td className="num">
        <span className={`status-pill ${statusTone(row.status)}`}>{row.status ?? '—'}</span>
      </td>
      <td className="num mono">{row.latency_ms === null ? '—' : `${row.latency_ms} ms`}</td>
      <td className="note" title={row.note ?? undefined}>
        {row.note ?? ''}
      </td>
    </tr>
  );
}

function MobileRequest({ row, email }: { row: RequestLog; email: string | null }) {
  return (
    <article className="mobile-req">
      <div className="mobile-req-top">
        <span className="mobile-req-login">{row.account_id ? (email ?? 'Removed login') : 'Unassigned'}</span>
        <span className={`status-pill ${statusTone(row.status)}`}>{row.status ?? '—'}</span>
      </div>
      <div className="mobile-req-meta">
        <span className="mono">{timeSince(row.ts)}</span>
        <span className="sep">·</span>
        <span className="mono">{row.model ?? 'switch'}</span>
        <span className="sep">·</span>
        <span className="mono">{row.latency_ms === null ? '—' : `${row.latency_ms} ms`}</span>
      </div>
      {row.note ? <p className="mobile-req-note">{row.note}</p> : null}
    </article>
  );
}

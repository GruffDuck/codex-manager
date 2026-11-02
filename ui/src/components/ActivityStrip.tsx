import type { AppEvent } from '../types';
import { relativeFromNow } from '../format';

const TONE: Record<AppEvent['type'], 'ok' | 'warn' | 'bad' | 'neutral'> = {
  auto_switch: 'ok',
  switch: 'ok',
  import: 'ok',
  export: 'neutral',
  config: 'ok',
  system: 'neutral',
  low_quota: 'warn',
  quota_exhausted: 'warn',
  account_error: 'bad',
};

export function ActivityStrip({ events }: { events: AppEvent[] }) {
  const items = events.slice(0, 4);

  return (
    <section className="panel activity" aria-labelledby="activity-title">
      <header className="panel-head">
        <div className="panel-title">
          <h2 id="activity-title">Recent activity</h2>
          <span className="panel-note">This session</span>
        </div>
        <span className="panel-note">Newest first</span>
      </header>

      {items.length === 0 ? (
        <p className="activity-empty">
          Quota checks, switches and import results collect here. The feed resets when the core restarts.
        </p>
      ) : (
        <div className="activity-grid">
          {items.map((event) => (
            <article className="activity-item" key={event.id}>
              <span className={`event-dot ${TONE[event.type]}`} aria-hidden />
              <div className="activity-copy">
                <div className="activity-top">
                  <h3>{event.title}</h3>
                  <time title={new Date(event.ts).toLocaleString('en-US')}>{relativeFromNow(event.ts)}</time>
                </div>
                {event.detail ? <p>{event.detail}</p> : null}
              </div>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}

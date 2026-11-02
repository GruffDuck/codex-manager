/**
 * A small in-memory feed of things worth telling the user about. The desktop
 * shell polls it and raises native notifications; the UI shows the same items
 * in its activity line. Nothing here is persisted: events are runtime signals,
 * not an audit log.
 */
export type AppEventType =
  | 'auto_switch'
  | 'low_quota'
  | 'account_error'
  | 'quota_exhausted'
  | 'switch'
  | 'import'
  | 'export'
  | 'config'
  | 'system';

export interface AppEvent {
  id: number;
  ts: number;
  type: AppEventType;
  title: string;
  detail: string | null;
  account_id: string | null;
  notify: boolean;
}

let sequence = 0;
const LIMIT = 120;
const events: AppEvent[] = [];

export function pushEvent(input: {
  type: AppEventType;
  title: string;
  detail?: string | null;
  account_id?: string | null;
  notify?: boolean;
  ts?: number;
}): AppEvent {
  sequence += 1;
  const event: AppEvent = {
    id: sequence,
    ts: input.ts ?? Date.now(),
    type: input.type,
    title: input.title,
    detail: input.detail ?? null,
    account_id: input.account_id ?? null,
    notify: input.notify === true,
  };
  events.push(event);
  if (events.length > LIMIT) events.splice(0, events.length - LIMIT);
  return event;
}

export function listEvents(since = 0, limit = 60): AppEvent[] {
  return events
    .filter((event) => event.id > since)
    .slice(-Math.max(1, Math.min(limit, LIMIT)));
}

export function latestEventId(): number {
  return events.length > 0 ? (events[events.length - 1] as AppEvent).id : sequence;
}

/** Tests import fresh module state; this keeps their event ids deterministic. */
export function resetEvents(): void {
  events.length = 0;
  sequence = 0;
}

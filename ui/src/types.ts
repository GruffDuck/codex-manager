export interface QuotaWindow {
  used_percent: number;
  limit_window_seconds: number;
  reset_after_seconds: number;
  reset_at: number;
}

export interface Quota {
  plan_type?: string;
  allowed?: boolean;
  limit_reached?: boolean;
  primary?: QuotaWindow;
  secondary?: QuotaWindow;
  credits?: { has_credits?: boolean; unlimited?: boolean; balance?: string };
  captured_at: number;
  source: 'usage' | 'headers';
}

export type AccountStatus = 'active' | 'rate_limited' | 'expired' | 'error';

export interface Account {
  id: string;
  email: string;
  account_id: string;
  plan_type: string | null;
  status: AccountStatus;
  status_reason: string | null;
  cooldown_until: number | null;
  last_used: number;
  created_at: number;
  quota: Quota | null;
  weight: number;
  is_current: boolean;
  eligible: boolean;
}

export interface RequestLog {
  id: string;
  account_id: string | null;
  ts: number;
  model: string | null;
  status: number | null;
  latency_ms: number | null;
  note: string | null;
}

export interface AppSettings {
  auto_switch: {
    enabled: boolean;
    remaining_threshold: number;
    interval_seconds: number;
    allow_refresh: boolean;
    target: 'cli' | 'codex';
  };
  notifications: {
    auto_switch: boolean;
    low_quota: boolean;
    account_errors: boolean;
    low_quota_threshold: number;
  };
}

export type SettingsPatch = {
  auto_switch?: Partial<AppSettings['auto_switch']>;
  notifications?: Partial<AppSettings['notifications']>;
};

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

export interface State {
  version: string;
  started_at: number;
  uptime_ms: number;
  gateway: {
    port: number;
    url: string;
    upstream_base: string;
    api_key: string;
    api_key_masked: string;
    max_account_attempts: number;
    request_timeout_ms: number;
    oauth_port: number;
  };
  t3_code?: {
    enabled: boolean; codex_home: string; account_id: string | null;
    state: 'disabled' | 'ready' | 'switching' | 'failed'; message: string;
    verification: 'process_and_auth_file' | 'auth_file' | null;
  };
  codex_home: string;
  accounts: Account[];
  counts: { total: number; active: number };
  current_account_id: string | null;
  codex_auth_account_id: string | null;
  codex_restart: {
    supported: boolean; installed: boolean; running: boolean; reason: string;
    operation: { id: string; account_id: string; phase: 'preparing' | 'closing' | 'writing' | 'opening' | 'checking' | 'completed' | 'failed'; message: string; started_at: number; updated_at: number; verification: 'process_and_auth_file' | null } | null;
  };
  codex_desktop: {
    state: 'connected' | 'unavailable' | 'unverified';
    reason: string;
    account_id: string | null;
    email: string | null;
    busy: boolean | null;
    checked_at: number;
    sessions: Array<{ account_id: string; email: string | null }>;
  };
  backup_exists: boolean;
  codex_config: { path: string; applied: boolean; backup: string | null };
  settings: AppSettings;
  events: AppEvent[];
  event_cursor: number;
  requests: RequestLog[];
  total_requests: number;
}

export interface LoginSession {
  url: string;
  state: string;
  redirect_uri: string;
  expires_at: number;
}

export interface AutoSwitchResult {
  enabled: boolean;
  action: 'switched' | 'kept' | 'no_alternative' | 'no_accounts' | 'disabled' | 'prepared' | 'deferred' | 'unavailable';
  reason: string;
  current: { id: string; email: string; remaining: number | null } | null;
  target: { id: string; email: string; remaining: number | null } | null;
  threshold: number;
  checked_at: number;
}

export interface BulkImportResult {
  ok: boolean;
  imported: number;
  failed: number;
  results: Array<{ ok: boolean; email?: string; error?: string }>;
  accounts?: Account[];
}

export interface MutationResult {
  ok: boolean;
  accounts?: Account[];
  warning?: string;
}

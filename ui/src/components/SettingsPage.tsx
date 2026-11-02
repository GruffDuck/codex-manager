import { useEffect, useRef, useState } from 'react';
import { Download, FileUp, RefreshCw } from 'lucide-react';
import type { AutoSwitchResult, AppSettings, SettingsPatch, State } from '../types';
import type { Theme } from '../theme';
import { Field, NumberField, Segmented, Toggle } from './Primitives';
import { shortHome } from '../format';

interface Props {
  settings: AppSettings;
  desktop: State['codex_restart'];
  version: string;
  codexHome: string;
  sampleEmail: string | null;
  theme: Theme;
  onTheme: (theme: Theme) => void;
  onPatch: (patch: SettingsPatch) => Promise<void>;
  onCheckAutoSwitch: () => Promise<AutoSwitchResult>;
  onImport: () => void;
  notify: (message: string, tone?: 'ok' | 'err') => void;
}

const INTERVALS = [
  { value: 120, label: '2 minutes' },
  { value: 300, label: '5 minutes' },
  { value: 600, label: '10 minutes' },
  { value: 900, label: '15 minutes' },
  { value: 1800, label: '30 minutes' },
  { value: 3600, label: '60 minutes' },
];

function actionTone(action: AutoSwitchResult['action']): string {
  if (action === 'switched') return 'ok';
  if (action === 'unavailable' || action === 'deferred' || action === 'no_alternative' || action === 'no_accounts' || action === 'disabled') return 'warn';
  return 'neutral';
}

export function SettingsPage({
  settings,
  desktop,
  version,
  codexHome,
  sampleEmail,
  theme,
  onTheme,
  onPatch,
  onCheckAutoSwitch,
  onImport,
  notify,
}: Props) {
  const [saved, setSaved] = useState(false);
  const [saving, setSaving] = useState(false);
  const [checking, setChecking] = useState(false);
  const [checkResult, setCheckResult] = useState<AutoSwitchResult | null>(null);
  const [confirmCredentials, setConfirmCredentials] = useState(false);
  const savedTimer = useRef<number | null>(null);

  useEffect(
    () => () => {
      if (savedTimer.current !== null) window.clearTimeout(savedTimer.current);
    },
    [],
  );

  const save = async (patch: SettingsPatch) => {
    setSaving(true);
    try {
      await onPatch(patch);
      setSaved(true);
      if (savedTimer.current !== null) window.clearTimeout(savedTimer.current);
      savedTimer.current = window.setTimeout(() => setSaved(false), 3500);
    } catch {
      /* App surfaces the error and restores the previous settings. */
    } finally {
      setSaving(false);
    }
  };

  const check = async () => {
    setChecking(true);
    try {
      setCheckResult(await onCheckAutoSwitch());
    } catch (error) {
      notify((error as Error).message, 'err');
    } finally {
      setChecking(false);
    }
  };

  const notifyEmail = sampleEmail ?? 'your login';
  const previewLeft = Math.max(1, settings.notifications.low_quota_threshold - 3);

  return (
    <div className="page settings-page">
      <header className="title-row">
        <div>
          <h1>Settings</h1>
          <p className="lede">How the pool switches, when it warns you, and where the local data lives.</p>
        </div>
        <span className={`save-stamp${saved ? ' on' : ''}`} role="status" aria-live="polite">
          {saving ? 'Saving…' : saved ? 'Saved' : 'Changes save immediately'}
        </span>
      </header>

      <section className="settings-section" aria-labelledby="auto-title">
        <div className="settings-label">
          <h2 id="auto-title">Automatic switching</h2>
          <p>
            Codex mode closes the app, changes the saved account and reopens it when quota reaches the threshold. The threshold is
            measured on the tightest active quota window.
          </p>
        </div>
        <div className="settings-panel">
          {!desktop?.supported ? (
            <p className="desktop-note"><strong>Automatic restart is unavailable.</strong> {desktop?.reason ?? 'Refresh the Manager connection.'} CLI mode only prepares a login file.</p>
          ) : null}
          <div className="setting-row">
            <div>
              <h3>Enable automatic switching</h3>
              <p>{settings.auto_switch.enabled ? `On · checks every ${Math.round(settings.auto_switch.interval_seconds / 60)} minutes` : 'Off · switches only when you press a button'}</p>
            </div>
            <Toggle
              checked={settings.auto_switch.enabled}
              label="Automatic switching"
              onChange={(value) => void save({ auto_switch: { enabled: value } })}
            />
          </div>

          <div className="form-grid">
            <Field
              label="Target"
              hint={
                settings.auto_switch.target === 'codex'
                  ? 'Closes Codex, saves the next login and opens it again. This can interrupt an active reply.'
                  : 'Writes auth.json only. config.toml stays as it is.'
              }
            >
              <Segmented
                label="Auto-switch target"
                value={settings.auto_switch.target}
                options={[
                  { value: 'cli', label: 'CLI only' },
                  { value: 'codex', label: 'Restart Codex' },
                ]}
                onChange={(target) => void save({ auto_switch: { target } })}
              />
            </Field>

            <Field label="Switch when" hint="Use 0% to switch only when quota is exhausted.">
              <NumberField
                value={settings.auto_switch.remaining_threshold}
                min={0}
                max={50}
                suffix="%"
                label="Remaining headroom threshold"
                onCommit={(value) => void save({ auto_switch: { remaining_threshold: value } })}
              />
            </Field>

            <Field label="Check every" hint="Also the age at which a quota snapshot is refreshed.">
              <select
                className="input select"
                aria-label="Auto-switch check interval"
                value={settings.auto_switch.interval_seconds}
                onChange={(event) => void save({ auto_switch: { interval_seconds: Number(event.target.value) } })}
              >
                {INTERVALS.map((interval) => (
                  <option key={interval.value} value={interval.value}>
                    {interval.label}
                  </option>
                ))}
              </select>
            </Field>

            <div className="field">
              <span className="field-label">Refresh stale quota</span>
              <div className="inline-toggle">
                <Toggle
                  checked={settings.auto_switch.allow_refresh}
                  label="Refresh stale quota before switching"
                  onChange={(value) => void save({ auto_switch: { allow_refresh: value } })}
                />
                <span className="field-hint">
                  Ask ChatGPT for a fresh snapshot before deciding, rather than trusting the last one.
                </span>
              </div>
            </div>
          </div>

          <div className="settings-actions">
            <button type="button" className="btn" disabled={checking} onClick={() => void check()}>
              <RefreshCw size={12} className={checking ? 'spin' : undefined} />
              Check now
            </button>
            {checkResult ? (
              <p className={`check-result ${actionTone(checkResult.action)}`}>
                <strong>
                  {checkResult.action === 'switched'
                    ? 'Codex restarted'
                    : checkResult.action === 'prepared'
                      ? 'CLI login prepared'
                    : checkResult.action === 'deferred'
                      ? 'Waiting for Codex'
                    : checkResult.action === 'unavailable'
                      ? 'Restart unavailable'
                    : checkResult.action === 'kept'
                      ? 'Kept current login'
                      : checkResult.action === 'disabled'
                        ? 'Auto-switch is off'
                        : 'No change'}
                </strong>
                {checkResult.reason}
              </p>
            ) : (
              <p className="settings-hint">Checks the current policy. Enable automatic switching to prepare a different login.</p>
            )}
          </div>
        </div>
      </section>

      <section className="settings-section" aria-labelledby="notify-title">
        <div className="settings-label">
          <h2 id="notify-title">Notifications</h2>
          <p>
            Native macOS notifications while the desktop app is running, and the same entries in the in-app activity
            feed.
          </p>
        </div>
        <div className="settings-panel">
          <div className="setting-row">
            <div>
              <h3>Automatic switches</h3>
              <p>Tell me when Manager prepares another login.</p>
            </div>
            <Toggle
              checked={settings.notifications.auto_switch}
              label="Notify on automatic switches"
              onChange={(value) => void save({ notifications: { auto_switch: value } })}
            />
          </div>
          <div className="setting-row">
            <div>
              <h3>Low quota</h3>
              <p>Warn once per quota snapshot when a login drops below the line.</p>
            </div>
            <div className="row-controls">
              <NumberField
                value={settings.notifications.low_quota_threshold}
                min={1}
                max={50}
                suffix="%"
                label="Low quota warning threshold"
                onCommit={(value) => void save({ notifications: { low_quota_threshold: value } })}
              />
              <Toggle
                checked={settings.notifications.low_quota}
                label="Notify on low quota"
                onChange={(value) => void save({ notifications: { low_quota: value } })}
              />
            </div>
          </div>
          <div className="setting-row">
            <div>
              <h3>Account errors</h3>
              <p>Sign-in expiry, rejected refresh tokens and exhausted quota windows.</p>
            </div>
            <Toggle
              checked={settings.notifications.account_errors}
              label="Notify on account errors"
              onChange={(value) => void save({ notifications: { account_errors: value } })}
            />
          </div>

          <div className="notification-preview" data-ui>
            <span className="preview-label">Preview · low quota</span>
            <div className="preview-card">
              <span className="event-dot warn" aria-hidden />
              <div>
                <strong>{notifyEmail} is low on quota</strong>
                <p>
                  {previewLeft}% remaining — below the {settings.notifications.low_quota_threshold}% warning line.
                </p>
              </div>
              <time>now</time>
            </div>
          </div>
        </div>
      </section>

      <section className="settings-section" aria-labelledby="data-title">
        <div className="settings-label">
          <h2 id="data-title">Data</h2>
          <p>
            Accounts, quota snapshots and settings stay on this Mac. Exports with credentials contain live tokens;
            they are not encrypted.
          </p>
        </div>
        <div className="settings-panel">
          <dl className="kv-list compact">
            <div>
              <dt>App storage</dt>
              <dd>
                <code>~/.codex-manager</code>
              </dd>
            </div>
            <div>
              <dt>Codex home</dt>
              <dd>
                <code>{shortHome(codexHome)}</code>
              </dd>
            </div>
          </dl>

          <div className="data-actions">
            <a className="btn" href="/api/accounts/export?download=1">
              <Download size={12} />
              Export metadata
            </a>
            <button type="button" className="btn" onClick={onImport}>
              <FileUp size={12} />
              Import accounts
            </button>
            <a className="btn" href="/api/diagnostics?download=1">
              <Download size={12} />
              Diagnostics
            </a>
            <button type="button" className="btn btn-quiet-danger" onClick={() => setConfirmCredentials(true)}>
              Export with credentials
            </button>
          </div>

          {confirmCredentials ? (
            <div className="confirm-row">
              <p>
                This download includes live refresh tokens for every login. Store it somewhere private and delete it
                when you are done.
              </p>
              <div className="confirm-actions">
                <button type="button" className="btn btn-sm btn-ghost" onClick={() => setConfirmCredentials(false)}>
                  Cancel
                </button>
                <a
                  className="btn btn-sm btn-danger"
                  href="/api/accounts/export?credentials=1&download=1"
                  onClick={() => setConfirmCredentials(false)}
                >
                  Download with tokens
                </a>
              </div>
            </div>
          ) : null}
        </div>
      </section>

      <section className="settings-section" aria-labelledby="appearance-title">
        <div className="settings-label">
          <h2 id="appearance-title">Appearance</h2>
          <p>The sheet and frame follow this choice. Stored locally; it does not affect Codex.</p>
        </div>
        <div className="settings-panel appearance-panel">
          <Field label="Theme" hint="Your choice is remembered. Both themes use the same layout.">
            <Segmented
              label="Theme"
              value={theme}
              options={[
                { value: 'light', label: 'Light' },
                { value: 'dark', label: 'Dark' },
              ]}
              onChange={onTheme}
            />
          </Field>
          <p className="settings-hint">
            Toggle from the top bar any time. The chosen theme is remembered in this browser profile.
          </p>
        </div>
      </section>

      <footer className="settings-foot">
        <span>Codex Manager v{version}</span>
        <span>Independent implementation · not affiliated with OpenAI</span>
      </footer>
    </div>
  );
}

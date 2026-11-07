import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  Moon,
  PlugZap,
  RefreshCw,
  Settings,
  Sun,
  Users,
} from 'lucide-react';
import { api, del, patch, post } from './api';
import type {
  Account,
  AppSettings,
  AutoSwitchResult,
  SettingsPatch,
  State,
} from './types';
import { T3CodeModal } from './components/T3CodeModal';
import { AccountsPage } from './components/AccountsPage';
import { AddAccountModal } from './components/AddAccountModal';
import { GatewayPage } from './components/GatewayPage';
import { Logo } from './components/Logo';
import { SettingsPage } from './components/SettingsPage';
import { TrafficPage } from './components/TrafficPage';
import { shortHome, timeSince } from './format';
import { useTheme } from './theme';

interface Toast {
  id: number;
  message: string;
  tone: 'ok' | 'err';
}

type Section = 'accounts' | 'traffic' | 'gateway' | 'settings';

const SECTIONS: Section[] = ['accounts', 'traffic', 'gateway', 'settings'];

const SECTION_META: Record<Section, { label: string; title: string; icon: typeof Users }> = {
  accounts: { label: 'Accounts', title: 'Accounts', icon: Users },
  traffic: { label: 'Traffic', title: 'Traffic', icon: Activity },
  gateway: { label: 'Gateway', title: 'Gateway', icon: PlugZap },
  settings: { label: 'Settings', title: 'Settings', icon: Settings },
};

function readRoute(): Section {
  const hash = window.location.hash.replace(/^#\/?/, '');
  return SECTIONS.includes(hash as Section) ? (hash as Section) : 'accounts';
}

function mergeSettings(current: AppSettings, patchValue: SettingsPatch): AppSettings {
  return {
    auto_switch: { ...current.auto_switch, ...(patchValue.auto_switch ?? {}) },
    notifications: { ...current.notifications, ...(patchValue.notifications ?? {}) },
  };
}

function attentionCount(accounts: Account[]): number {
  return accounts.filter((account) => {
    if (account.status === 'active') return false;
    if (account.status === 'rate_limited' && account.cooldown_until && account.cooldown_until <= Date.now()) {
      return false;
    }
    return true;
  }).length;
}

export default function App() {
  const [state, setState] = useState<State | null>(null);
  const [offline, setOffline] = useState(false);
  const [lastUpdated, setLastUpdated] = useState(0);
  const [route, setRoute] = useState<Section>(readRoute);
  const [busy, setBusy] = useState<Set<string>>(new Set());
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [addView, setAddView] = useState<'single' | 'bulk' | null>(null);
  const [t3Account, setT3Account] = useState<Account | null>(null);
  const [configMessage, setConfigMessage] = useState<string | null>(null);
  const toastId = useRef(1);
  const { theme, setTheme, toggle } = useTheme();

  const notify = useCallback((message: string, tone: 'ok' | 'err' = 'ok') => {
    const id = toastId.current++;
    setToasts((current) => [...current.slice(-3), { id, message, tone }]);
    window.setTimeout(() => {
      setToasts((current) => current.filter((toast) => toast.id !== id));
    }, 5200);
  }, []);

  const setLoading = useCallback((key: string, value: boolean) => {
    setBusy((current) => {
      const next = new Set(current);
      if (value) next.add(key);
      else next.delete(key);
      return next;
    });
  }, []);

  const refresh = useCallback(async () => {
    try {
      const next = await api<State>('/api/state');
      setState(next);
      setOffline(false);
      setLastUpdated(Date.now());
      return next;
    } catch {
      setOffline(true);
      return null;
    }
  }, []);

  useEffect(() => {
    void refresh();
    const timer = window.setInterval(() => {
      if (!document.hidden) void refresh();
    }, 4000);
    return () => window.clearInterval(timer);
  }, [refresh]);

  useEffect(() => {
    if (!window.location.hash) window.history.replaceState(null, '', '#/accounts');
    const onHash = () => setRoute(readRoute());
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  useEffect(() => {
    document.title = `${SECTION_META[route].title} · Codex Manager`;
    document.querySelector('.sheet')?.scrollTo({ top: 0 });
  }, [route]);

  useEffect(() => {
    if (navigator.userAgent.includes('Electron')) {
      document.documentElement.dataset.electron = 'true';
    }
  }, []);

  const run = useCallback(
    async (key: string, action: () => Promise<void>) => {
      setLoading(key, true);
      try {
        await action();
      } catch (error) {
        notify((error as Error).message, 'err');
      } finally {
        setLoading(key, false);
      }
    },
    [notify, setLoading],
  );

  const refreshAll = () =>
    run('global', async () => {
      const result = await post<{ results: Array<{ ok: boolean }> }>('/api/accounts/refresh-all');
      await refresh();
      const failed = result.results.filter((row) => !row.ok).length;
      notify(
        failed ? `Quotas refreshed — ${failed} login${failed === 1 ? '' : 's'} failed.` : 'All quotas refreshed.',
        failed ? 'err' : 'ok',
      );
    });

  const useInCodex = (account: Account) =>
    run(account.id, async () => {
      await post(`/api/accounts/${account.id}/use-in-codex`);
      const refreshed = await refresh();
      if (refreshed?.t3_code?.state === 'failed') notify(refreshed.t3_code.message, 'err');
      setConfigMessage(null);
      notify(`Codex reopened with the login saved for ${account.email}.`);
    });

  const prepareLogin = (account: Account) =>
    run(account.id, async () => {
      await post(`/api/accounts/${account.id}/prepare`);
      await refresh();
      notify(`Login prepared for ${account.email}. Quit and reopen Codex manually to load it.`);
    });

  const useInCli = (account: Account) =>
    run(account.id, async () => {
      await post(`/api/accounts/${account.id}/use-in-cli`);
      await refresh();
      notify(`Codex CLI now uses ${account.email}. config.toml was left alone.`);
    });

  const refreshAccount = (account: Account) =>
    run(account.id, async () => {
      await post(`/api/accounts/${account.id}/refresh`);
      await refresh();
      notify(`${account.email} quota refreshed.`);
    });

  const removeAccount = (account: Account) =>
    run(account.id, async () => {
      await del(`/api/accounts/${account.id}`);
      await refresh();
      notify(`Removed ${account.email}.`);
    });

  const applyConfig = () =>
    run('config', async () => {
      const result = await post<{ warnings?: string[]; path: string }>('/api/codex/config', {});
      await refresh();
      setConfigMessage(
        result.warnings?.length
          ? `Written, with notes: ${result.warnings.join(' ')}`
          : 'Gateway settings saved. Quit and reopen Codex to load them.',
      );
      notify('Gateway settings saved. Quit and reopen Codex to load them.');
    });

  const restoreConfig = () =>
    run('config', async () => {
      await del<{ path: string }>('/api/codex/config');
      await refresh();
      setConfigMessage('Original settings restored. Quit and reopen Codex to load them.');
      notify('Managed block removed from config.toml.');
    });

  const rotateKey = () =>
    run('config', async () => {
      const result = await post<{ api_key: string }>('/api/key/rotate');
      if (state?.codex_config.applied) {
        await post('/api/codex/config', {});
        setConfigMessage('API key rotated and config.toml rewritten.');
      } else {
        setConfigMessage('API key rotated.');
      }
      await refresh();
      notify(result.api_key ? 'API key rotated.' : 'Key rotated.');
    });

  const updateSettings = useCallback(
    async (patchValue: SettingsPatch) => {
      const previous = state?.settings ?? null;
      if (previous) {
        setState((current) => (current ? { ...current, settings: mergeSettings(current.settings, patchValue) } : current));
      }
      try {
        const result = await patch<{ ok: boolean; settings: AppSettings }>('/api/settings', patchValue);
        setState((current) => (current ? { ...current, settings: result.settings } : current));
      } catch (error) {
        if (previous) {
          setState((current) => (current ? { ...current, settings: previous } : current));
        }
        notify((error as Error).message, 'err');
        throw error;
      }
    },
    [notify, state?.settings],
  );

  const checkAutoSwitch = useCallback(async () => {
    const result = await post<AutoSwitchResult>('/api/auto-switch/check');
    await refresh();
    notify(result.reason, result.action === 'unavailable' ? 'err' : 'ok');
    return result;
  }, [notify, refresh]);

  const addAccount = (view: 'single' | 'bulk' = 'single') => setAddView(view);

  if (!state) {
    return (
      <div className="boot">
        <Logo size={44} />
        <h1>Codex Manager</h1>
        <p>
          {offline
            ? 'The core is not answering on 127.0.0.1:8055. Start it with npm start, or launch the desktop app.'
            : 'Loading the account pool and gateway state…'}
        </p>
        {offline ? (
          <button type="button" className="btn" onClick={() => void refresh()}>
            Try again
          </button>
        ) : null}
      </div>
    );
  }

  const attention = attentionCount(state.accounts);
  const auto = state.settings.auto_switch;
  const freshness = lastUpdated ? timeSince(lastUpdated) : '—';
  const meta = SECTION_META[route];

  const navItems = SECTIONS.map((id) => ({
    id,
    label: SECTION_META[id].label,
    icon: SECTION_META[id].icon,
    badge: id === 'accounts' && attention > 0 ? attention : undefined,
  }));

  return (
    <div className="app" data-route={route}>
      <aside className="rail">
        <div className="rail-brand">
          <a className="brand" href="#/accounts" aria-label="Codex Manager home">
            <Logo size={27} />
            <span className="brand-name">
              Codex <strong>Manager</strong>
            </span>
          </a>
          <span className="brand-scope">Account manager</span>
        </div>

        <nav className="rail-nav" aria-label="Sections">
          {navItems.map((item) => (
            <a
              key={item.id}
              href={`#/${item.id}`}
              className={`nav-link${route === item.id ? ' active' : ''}`}
              aria-current={route === item.id ? 'page' : undefined}
            >
              <item.icon size={16} />
              <span>{item.label}</span>
              {item.badge ? (
                <span className="nav-badge" title={`${item.badge} login${item.badge === 1 ? '' : 's'} need attention`}>
                  {item.badge}
                </span>
              ) : null}
            </a>
          ))}
        </nav>

        <div className="rail-foot">
          <div className="rail-status">
            <span className={`dot ${offline ? 'bad' : 'ok'}`} />
            <div>
              <strong>{offline ? 'Manager offline' : 'Manager running'}</strong>
              <span>127.0.0.1:{state.gateway.port}</span>
            </div>
          </div>
          <div className="rail-auto">
            <span>Auto-switch</span>
            <strong>{auto.enabled ? `On · ${auto.remaining_threshold}%` : 'Off'}</strong>
          </div>
          <div className="rail-utilities">
            <span className="version">v{state.version}</span>
            <button
              type="button"
              className="icon-btn"
              onClick={toggle}
              title={theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}
              aria-label="Toggle color theme"
            >
              {theme === 'dark' ? <Sun size={14} /> : <Moon size={14} />}
            </button>
          </div>
          <p className="rail-disclaimer">Independent implementation. Not affiliated with OpenAI.</p>
        </div>
      </aside>

      <div className="stage">
        <header className="topbar">
          <div className="topbar-left">
            <a className="mobile-brand" href="#/accounts" aria-label="Codex Manager home">
              <Logo size={24} />
              <span>Codex Manager</span>
            </a>
            <span className="scope">
              <span className="scope-label">{meta.title}</span>
              <span className="scope-sep">/</span>
              <code>{shortHome(state.codex_home)}</code>
            </span>
            <nav className="top-nav" aria-label="Primary">
              {navItems.map((item) => (
                <a key={item.id} href={`#/${item.id}`} className={route === item.id ? 'active' : undefined}>
                  {item.label}
                </a>
              ))}
            </nav>
          </div>

          <div className="topbar-right">
            <a className={`top-status${offline ? ' off' : ''}`} href="#/gateway" title="Open gateway details">
              <span className={`dot ${offline ? 'bad' : 'ok'}`} />
              {offline ? 'Manager offline' : 'Manager running'}
            </a>
            <span className="freshness" title={lastUpdated ? new Date(lastUpdated).toLocaleString('en-US') : undefined}>
              {offline ? 'No contact' : `Updated ${freshness}`}
            </span>
            <button
              type="button"
              className="icon-btn"
              onClick={() => void refresh()}
              disabled={!offline && busy.has('state')}
              title="Refresh state"
              aria-label="Refresh state"
            >
              <RefreshCw size={13} />
            </button>
            <button
              type="button"
              className="icon-btn theme-toggle"
              onClick={toggle}
              title={theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}
              aria-label="Toggle color theme"
            >
              {theme === 'dark' ? <Sun size={14} /> : <Moon size={14} />}
            </button>
          </div>
        </header>

        <main className="sheet" aria-label={meta.title}>
          {offline ? (
            <div className="offline-banner" role="status">
              <AlertTriangle size={14} />
              <span>
                The core stopped answering. Showing the last state from {lastUpdated ? timeSince(lastUpdated) : 'this session'}.
              </span>
              <button type="button" className="btn btn-sm" onClick={() => void refresh()}>
                Retry
              </button>
            </div>
          ) : null}

          {route === 'accounts' ? (
            <AccountsPage
              state={state}
              busy={busy}
              onAdd={() => addAccount('single')}
              onRefreshAll={() => void refreshAll()}
              onUseCodex={(account) => void useInCodex(account)}
              onPrepare={(account) => void prepareLogin(account)}
              onUseCli={(account) => void useInCli(account)}
              onUseT3Code={setT3Account}
              onRefreshAccount={(account) => void refreshAccount(account)}
              onRemove={(account) => void removeAccount(account)}
            />
          ) : null}

          {route === 'traffic' ? <TrafficPage state={state} /> : null}

          {route === 'gateway' ? (
            <GatewayPage
              state={state}
              busy={busy.has('config')}
              configMessage={configMessage}
              onApplyConfig={() => void applyConfig()}
              onRestoreConfig={() => void restoreConfig()}
              onRotateKey={() => void rotateKey()}
              notify={notify}
            />
          ) : null}

          {route === 'settings' ? (
            <SettingsPage
              settings={state.settings}
              desktop={state.codex_restart}
              version={state.version}
              codexHome={state.codex_home}
              sampleEmail={state.accounts[0]?.email ?? null}
              theme={theme}
              onTheme={setTheme}
              onPatch={updateSettings}
              onCheckAutoSwitch={checkAutoSwitch}
              onImport={() => addAccount('bulk')}
              notify={notify}
            />
          ) : null}
        </main>
      </div>

      <nav className="bottom-nav" aria-label="Sections">
        {navItems.map((item) => (
          <a
            key={item.id}
            href={`#/${item.id}`}
            className={route === item.id ? 'active' : undefined}
            aria-current={route === item.id ? 'page' : undefined}
          >
            <span className="bottom-icon">
              <item.icon size={18} />
              {item.badge ? <span className="bottom-badge">{item.badge}</span> : null}
            </span>
            {item.label}
          </a>
        ))}
      </nav>

      {t3Account ? <T3CodeModal link={state.t3_code} account={t3Account} onClose={() => setT3Account(null)} notify={notify} onPrepared={() => void refresh()} /> : null}

      {addView ? (
        <AddAccountModal
          initialView={addView}
          onClose={() => setAddView(null)}
          onAdded={(message) => {
            notify(message);
            void refresh();
          }}
          notify={notify}
        />
      ) : null}

      <div className="toasts" role="status" aria-live="polite">
        {toasts.map((toast) => (
          <div key={toast.id} className={`toast ${toast.tone}`}>
            {toast.tone === 'ok' ? <CheckCircle2 size={14} /> : <AlertTriangle size={14} />}
            {toast.message}
          </div>
        ))}
      </div>
    </div>
  );
}

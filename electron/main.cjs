// Thin desktop shell: it owns the window and the lifetime of the core process,
// exactly like the standalone-core pattern used by Antigravity Manager.
const { app, BrowserWindow, dialog, shell, Tray, nativeImage, nativeTheme, screen, ipcMain, Notification } = require('electron');

app.setName('Codex Manager');
if (process.platform === 'win32') app.setAppUserModelId('local.codex-manager');
const { signInUrl, webUrl, startDesktop } = require('./desktop-policy.cjs');
const startupAt = Date.now();
const { spawn, execFileSync } = require('node:child_process');
const path = require('node:path');
const fs = require('node:fs');
const http = require('node:http');
if (process.env.CODEX_MANAGER_USER_DATA) {
  fs.mkdirSync(process.env.CODEX_MANAGER_USER_DATA, { recursive: true });
  app.setPath('userData', process.env.CODEX_MANAGER_USER_DATA);
}

const root = path.join(__dirname, '..');
const coreEntry = path.join(root, 'core', 'dist', 'main.js');
const uiIndex = path.join(root, 'ui', 'dist', 'index.html');
const PORT = Number(process.env.CODEX_MANAGER_PORT || 8055);
const BASE = `http://127.0.0.1:${PORT}`;
const EXPECTED_VERSION = require('../package.json').version;

let core = null;
let win = null;
let tray = null;
let popover = null;
let quitting = false;
let eventCursor = 0;
let eventTimer = null;
let incompatibleCore = false;
let signInWindow = null;
let startupFailure = null;
function markStartup(stage) {
  fs.appendFile(path.join(app.getPath('userData'), 'startup.log'), `${new Date().toISOString()} ${stage} ${Date.now() - startupAt}ms\n`, () => {});
}

// Single instance: a second launch just focuses the existing window.
if (!app.requestSingleInstanceLock()) {
  app.exit(0);
} else {
  app.on('second-instance', () => {
    if (!win) return;
    if (win.isMinimized()) win.restore();
    win.show();
    win.focus();
  });
}

function nodeBinary() {
  if (app.isPackaged) {
    const binary = path.join(process.resourcesPath, 'runtime', process.platform === 'win32' ? 'node.exe' : 'node');
    if (!fs.existsSync(binary)) throw new Error('Bundled Node runtime is missing. Reinstall Codex Manager.');
    const manifest = JSON.parse(fs.readFileSync(path.join(process.resourcesPath, 'runtime', 'manifest.json'), 'utf8'));
    return { binary, version: manifest.version };
  }
  const candidates = [
    process.env.CODEX_MANAGER_NODE,
    '/opt/homebrew/bin/node',
    '/usr/local/bin/node',
    '/usr/bin/node',
    'node',
  ].filter(Boolean);
  for (const candidate of candidates) {
    try {
      const version = execFileSync(candidate, ['-v'], { encoding: 'utf8' }).trim();
      const [major, minor] = version.replace(/^v/, '').split('.').map(Number);
      if (major > 23 || (major === 23 && minor >= 4)) {
        return { binary: candidate, version };
      }
    } catch {
      /* try next */
    }
  }
  // Last resort: a plain `node` from PATH, even if the version check failed.
  return { binary: 'node', version: 'unknown' };
}

function health() {
  return new Promise((resolve) => {
    const request = http.get(`${BASE}/healthz`, { timeout: 800 }, (response) => {
      let body = '';
      response.on('data', (chunk) => {
        body += chunk;
      });
      response.on('end', () => {
        try {
          const status = JSON.parse(body);
          incompatibleCore = status.ok === true && (status.management_api !== 3 || status.version !== EXPECTED_VERSION);
          resolve(status.ok === true && status.management_api === 3 && status.version === EXPECTED_VERSION);
        } catch {
          resolve(false);
        }
      });
    });
    request.on('error', () => resolve(false));
    request.on('timeout', () => {
      request.destroy();
      resolve(false);
    });
  });
}

async function waitForCore(timeoutMs = 20000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (startupFailure) throw startupFailure;
    if (await health()) return true;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  return false;
}

async function startCore() {
  if (await health()) return; // dev: `npm run dev:core` already owns the port
  if (incompatibleCore) throw new Error('An older Codex Manager core is still running. Quit the previous Manager before starting this version.');

  const { binary, version } = nodeBinary();
  if (!fs.existsSync(coreEntry)) {
    throw new Error(`Core bundle is missing at ${coreEntry}. Run \`npm run build\` first.`);
  }

  const logFile = path.join(app.getPath('userData'), 'core.log');
  const log = fs.createWriteStream(logFile, { flags: 'a' });
  log.write(`\n=== ${new Date().toISOString()} starting core with ${binary} (${version}) ===\n`);

  core = spawn(binary, ['--disable-warning=ExperimentalWarning', coreEntry], {
    cwd: root,
    env: { ...process.env, CODEX_MANAGER_PORT: String(PORT) },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  core.once('error', (error) => { startupFailure = new Error(`Could not start the bundled runtime: ${error.message}`); });
  core.stdout.pipe(log);
  core.stderr.pipe(log);

  core.on('exit', (code) => {
    startupFailure = new Error(`Core stopped during startup (exit ${code}). See ${logFile}`);
    log.write(`=== core exited with ${code} ===\n`);
    if (code !== 0 && win && !win.isDestroyed()) {
      dialog.showErrorBox('Codex Manager core stopped', `Exit code ${code}. See ${logFile}`);
    }
  });

  if (!(await waitForCore())) {
    throw new Error(`Core did not become healthy on ${BASE}. See ${logFile}`);
  }
}

async function createWindow(starting = false) {
  win = new BrowserWindow({
    width: 1180,
    height: 820,
    minWidth: 900,
    minHeight: 620,
    backgroundColor: '#f8f9fb',
    icon: path.join(__dirname, 'assets', 'icon.png'),
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  win.once('ready-to-show', () => { win.show(); markStartup('window-visible'); });
  // Closing the window keeps the app (and the core) alive in the tray.
  win.on('close', (event) => {
    if (!quitting) {
      event.preventDefault();
      win.hide();
    }
  });
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (webUrl(url)) void shell.openExternal(url).catch(() => {});
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (event, url) => {
    if (new URL(url).origin === BASE) return;
    event.preventDefault();
    if (webUrl(url)) void shell.openExternal(url).catch(() => {});
  });
  if (starting) await win.loadFile(path.join(__dirname, 'startup.html'));
  else await win.loadURL(BASE);
}

function assertMainWindow(event) {
  if (!win || event.sender !== win.webContents || event.senderFrame !== win.webContents.mainFrame || new URL(event.senderFrame.url).origin !== BASE) {
    throw new Error('Sign-in can only be opened from Manager.');
  }
}
ipcMain.handle('login:open', async (event, value, mode) => {
  assertMainWindow(event);
  const url = signInUrl(value);
  if (mode === 'browser') {
    await shell.openExternal(url.href);
    if (signInWindow && !signInWindow.isDestroyed()) signInWindow.close();
    return;
  }
  if (mode !== 'app') throw new Error('Invalid sign-in destination.');
  if (signInWindow && !signInWindow.isDestroyed()) signInWindow.close();
  const child = new BrowserWindow({
    width: 560, height: 760, parent: win, title: 'Sign in with ChatGPT',
    icon: path.join(__dirname, 'assets', 'icon.png'),
    webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false },
  });
  signInWindow = child;
  child.on('closed', () => { if (signInWindow === child) signInWindow = null; });
  const callbackOrigin = new URL(url.searchParams.get('redirect_uri')).origin;
  child.webContents.on('will-navigate', (event, target) => {
    const next = new URL(target);
    if (next.protocol !== 'https:' && next.origin !== callbackOrigin) event.preventDefault();
  });
  child.webContents.setWindowOpenHandler(({ url: target }) => {
    if (webUrl(target) && new URL(target).protocol === 'https:') void shell.openExternal(target).catch(() => {});
    return { action: 'deny' };
  });
  await child.loadURL(url.href);
});
ipcMain.handle('login:close', (event) => {
  assertMainWindow(event);
  if (signInWindow && !signInWindow.isDestroyed()) signInWindow.close();
});

function getJson(pathname) {
  return new Promise((resolve) => {
    const request = http.get(`${BASE}${pathname}`, { timeout: 1500 }, (response) => {
      let body = '';
      response.on('data', (chunk) => {
        body += chunk;
      });
      response.on('end', () => {
        try {
          resolve(JSON.parse(body));
        } catch {
          resolve(null);
        }
      });
    });
    request.on('error', () => resolve(null));
    request.on('timeout', () => {
      request.destroy();
      resolve(null);
    });
  });
}

function postJson(pathname) {
  return new Promise((resolve) => {
    const request = http.request(`${BASE}${pathname}`, { method: 'POST', timeout: 30000 }, (response) => {
      response.resume();
      response.on('end', () => resolve(true));
    });
    request.on('error', () => resolve(false));
    request.on('timeout', () => {
      request.destroy();
      resolve(false);
    });
    request.end();
  });
}

function shortWindow(seconds) {
  if (!seconds) return 'quota';
  if (seconds <= 6 * 3600) return '5h';
  if (seconds <= 25 * 3600) return '24h';
  return 'wk';
}

function quotaSummary(account) {
  const quota = account.quota;
  if (!quota) return 'no quota yet';
  const parts = [];
  for (const window of [quota.primary, quota.secondary]) {
    if (!window || typeof window.used_percent !== 'number') continue;
    parts.push(`${shortWindow(window.limit_window_seconds)} ${Math.round(100 - window.used_percent)}%`);
  }
  return parts.length > 0 ? parts.join(' · ') : 'no quota yet';
}

function showWindow() {
  if (!win) void createWindow();
  else {
    if (win.isMinimized()) win.restore();
    win.show();
    win.focus();
  }
}

// ------------------------------------------------------------------ notifications
// The core publishes a tiny event feed for account switches, low quota and
// credential problems. Poll it and surface native notifications; the same
// events are visible inside the app's activity line.
async function pollEvents() {
  const payload = await getJson(`/api/events?since=${eventCursor}`);
  if (!payload || !Array.isArray(payload.events)) return;

  if (eventCursor === 0) {
    eventCursor = Number(payload.cursor) || 0;
    return;
  }

  for (const event of payload.events) {
    if (typeof event.id === 'number' && event.id > eventCursor) {
      eventCursor = event.id;
    }
    if (!event.notify || !Notification.isSupported()) continue;
    const notification = new Notification({
      title: event.title,
      body: event.detail || 'Open Codex Manager for details.',
      silent: false,
    });
    notification.on('click', () => showWindow());
    notification.show();
  }
}

function startEventNotifications() {
  if (eventTimer) return;
  void pollEvents();
  eventTimer = setInterval(() => void pollEvents(), 12_000);
  eventTimer.unref();
}

function createPopover() {
  popover = new BrowserWindow({
    width: 368,
    height: 480,
    show: false,
    frame: false,
    transparent: true,
    resizable: false,
    movable: false,
    fullscreenable: false,
    skipTaskbar: true,
    hasShadow: false,
    backgroundColor: '#00000000',
    webPreferences: {
      preload: path.join(__dirname, 'tray-preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  void popover.loadFile(path.join(__dirname, 'tray.html'));
  popover.on('blur', () => {
    if (popover && !popover.webContents.isDevToolsOpened()) popover.hide();
  });
  popover.on('close', (event) => {
    if (!quitting) {
      event.preventDefault();
      popover.hide();
    }
  });
  popover.on('closed', () => {
    popover = null;
  });
  popover.webContents.on('before-input-event', (_event, input) => {
    if (input.key === 'Escape') popover.hide();
  });
}

function positionPopover() {
  if (!tray || !popover) return;
  const [width] = popover.getSize();
  const bounds = tray.getBounds();
  const display = screen.getDisplayNearestPoint({ x: Math.round(bounds.x), y: Math.round(bounds.y) });
  const centered = Math.round(bounds.x + bounds.width / 2 - width / 2);
  const minX = display.workArea.x + 8;
  const maxX = display.workArea.x + display.workArea.width - width - 8;
  popover.setPosition(
    Math.min(maxX, Math.max(minX, centered)),
    Math.round(bounds.y + bounds.height + 6),
    false,
  );
}

function togglePopover() {
  if (!popover || popover.isDestroyed()) createPopover();
  if (popover.isVisible()) {
    popover.hide();
    return;
  }
  positionPopover();
  popover.show();
  popover.focus();
}

ipcMain.handle('tray:state', () => getJson('/api/state'));
ipcMain.handle('tray:refresh', async () => {
  await postJson('/api/accounts/refresh-all');
  await updateTrayTitle();
  return getJson('/api/state');
});
ipcMain.handle('tray:resize', (_event, height) => {
  if (!popover || popover.isDestroyed()) return;
  const next = Math.max(180, Math.min(620, Math.round(Number(height) || 480)));
  const [, current] = popover.getSize();
  if (current !== next) popover.setSize(368, next, false);
  if (popover.isVisible()) positionPopover();
});
ipcMain.handle('tray:open', () => {
  if (popover) popover.hide();
  showWindow();
});
ipcMain.handle('tray:quit', () => app.quit());

// The title next to the menu-bar icon always shows the remaining quota of the
// account the Codex CLI currently uses — no window needed.
async function updateTrayTitle() {
  if (!tray) return;
  const state = await getJson('/api/state');
  if (!state) {
    if (process.platform === 'darwin') tray.setTitle('');
    tray.setToolTip('Codex Manager — core offline');
    return;
  }
  const accounts = state.accounts ?? [];
  // The title follows the account Codex is actually linked to. Before the
  // first "Use in Codex" there is no auth mapping yet, so fall back to the
  // gateway's routing pick and then simply to the first account.
  const current =
    accounts.find((account) => account.id === state.codex_auth_account_id) ??
    accounts.find((account) => account.is_current) ??
    accounts[0];
  if (!current) {
    if (process.platform === 'darwin') tray.setTitle('');
    tray.setToolTip('Codex Manager — CLI not linked');
    return;
  }
  const primary = current.quota?.primary;
  const left = primary && typeof primary.used_percent === 'number' ? Math.round(100 - primary.used_percent) : null;
  if (process.platform === 'darwin') tray.setTitle(left === null ? '' : `${left}%`, { fontType: 'monospacedDigit' });
  tray.setToolTip(`Codex Manager — ${current.email}\n${quotaSummary(current)}`);
}

function createTray() {
  const icon = nativeImage.createEmpty();
  for (const [scaleFactor, file] of [
    [1, 'trayTemplate.png'],
    [2, 'trayTemplate@2x.png'],
  ]) {
    try {
      icon.addRepresentation({
        scaleFactor,
        buffer: fs.readFileSync(path.join(__dirname, 'assets', file)),
      });
    } catch {
      /* keep whichever representation loaded */
    }
  }
  if (icon.isEmpty()) {
    icon.addRepresentation({
      scaleFactor: 2,
      buffer: fs.readFileSync(path.join(__dirname, 'assets', 'icon.png')),
    });
  }
  icon.setTemplateImage(process.platform === 'darwin');
  tray = new Tray(process.platform === 'darwin' ? icon : nativeImage.createFromPath(path.join(__dirname, 'assets', 'icon.png')).resize({ width: 20, height: 20 }));
  tray.setToolTip('Codex Manager');
  tray.on('click', () => togglePopover());
  tray.on('right-click', () => togglePopover());
  setInterval(() => void updateTrayTitle(), 30_000).unref();
  void updateTrayTitle();
}

app.whenReady().then(async () => {
  try {
    // Development aid: force a colour scheme so both popover themes can be
    // reviewed side by side with --theme=light / --theme=dark.
    const themeArg = process.argv.find((arg) => arg.startsWith('--theme='));
    if (themeArg) nativeTheme.themeSource = themeArg.split('=')[1] === 'dark' ? 'dark' : 'light';
    if (process.platform === 'darwin' && app.dock) {
      app.dock.setIcon(path.join(__dirname, 'assets', 'icon.png'));
    }
    if (!fs.existsSync(uiIndex)) {
      throw new Error('UI bundle is missing. Run `npm run build` (or use `npm run dev` in a terminal).');
    }
    await startDesktop({
      showLoading: () => createWindow(true),
      startCore: async () => { await startCore(); markStartup('core-ready'); },
      loadApp: async () => { await win.loadURL(BASE); win.show(); markStartup('ui-loaded'); },
      startBackground: () => { createTray(); startEventNotifications(); },
    });
    // Development aid: open the menu-bar popover without a click, so its
    // layout can be reviewed and screenshotted.
    if (process.argv.includes('--show-popover')) {
      setTimeout(() => togglePopover(), 5000);
    }
  } catch (error) {
    dialog.showErrorBox('Codex Manager failed to start', String(error.message || error));
    app.quit();
  }

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) void createWindow();
    else if (win && !win.isVisible()) win.show();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', () => {
  quitting = true;
  if (core && !core.killed) core.kill('SIGTERM');
});

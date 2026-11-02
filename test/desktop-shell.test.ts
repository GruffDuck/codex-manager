import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const { signInUrl, webUrl, startDesktop } = createRequire(import.meta.url)('../electron/desktop-policy.cjs');
const auth = 'https://auth.openai.com/oauth/authorize?redirect_uri=http%3A%2F%2Flocalhost%3A1455%2Fauth%2Fcallback';

test('desktop sign-in accepts only the official authorize URL and a local callback', () => {
  assert.equal(signInUrl(auth).origin, 'https://auth.openai.com');
  for (const value of [auth.replace('auth.openai.com', 'auth.openai.com.evil.test'), auth.replace('https:', 'file:'), auth.replace('localhost', 'evil.test'), auth.replace('/oauth/authorize', '/other'), 'javascript:alert(1)', auth.replace('auth.openai.com', 'user:password@auth.openai.com')]) {
    assert.throws(() => signInUrl(value));
  }
  assert.equal(webUrl('file:///C:/Windows/system32/cmd.exe'), false);
  assert.equal(webUrl('https://example.com'), true);
});

test('desktop shows a window before waiting for the core and does not gate UI on background requests', async () => {
  const events: string[] = [];
  let release!: () => void;
  const blocked = new Promise<void>(resolve => { release = resolve; });
  const started = startDesktop({
    showLoading: async () => { events.push('visible'); },
    startCore: async () => { events.push('core'); await blocked; },
    loadApp: async () => { events.push('ui'); },
    startBackground: () => { events.push('background'); return new Promise(() => {}); },
  });
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(events, ['visible', 'core']);
  release();
  await started;
  assert.deepEqual(events, ['visible', 'core', 'ui', 'background']);
});

test('core failure keeps the app from loading and starting background work', async () => {
  const events: string[] = [];
  await assert.rejects(startDesktop({
    showLoading: async () => { events.push('visible'); },
    startCore: async () => { throw new Error('runtime unavailable'); },
    loadApp: async () => { events.push('ui'); },
    startBackground: () => { events.push('background'); },
  }), /runtime unavailable/);
  assert.deepEqual(events, ['visible']);
});

test('desktop IPC opens the default browser, rejects foreign frames and isolates in-app sign-in', async () => {
  const { runInNewContext } = await import('node:vm');
  const fs = await import('node:fs');
  const handlers = new Map<string, (...args: any[]) => any>();
  const external: string[] = [];
  const windows: any[] = [];
  class Window {
    webContents: any;
    events = new Map();
    options: any;
    loaded = '';
    constructor(options: any) {
      this.options = options;
      this.webContents = { mainFrame: { url: 'http://127.0.0.1:8055/' },
        setWindowOpenHandler: () => {}, on: () => {} };
      windows.push(this);
    }
    once() {}
    on(name: string, fn: any) { this.events.set(name, fn); }
    async loadFile() {}
    async loadURL(url: string) { this.loaded = url; }
    isDestroyed() { return false; }
    close() { this.events.get('closed')?.(); }
  }
  const ready = { then: () => {} };
  const electron = { app: { setName() {}, setPath() {}, requestSingleInstanceLock: () => true, on() {}, whenReady: () => ready },
    BrowserWindow: Window, ipcMain: { handle: (name: string, fn: any) => handlers.set(name, fn) },
    shell: { openExternal: async (url: string) => { external.push(url); } } };
  const require = createRequire(new URL('../electron/main.cjs', import.meta.url));
  const context: any = { require: (name: string) => name === 'electron' ? electron : require(name),
    __dirname: new URL('../electron/', import.meta.url).pathname, process: { env: {}, platform: 'darwin' }, console, URL, setTimeout, setInterval };
  runInNewContext(fs.readFileSync(new URL('../electron/main.cjs', import.meta.url), 'utf8') + '\nglobalThis.openWindow = createWindow;', context);
  await context.openWindow(true);
  const main = windows[0];
  const event = { sender: main.webContents, senderFrame: main.webContents.mainFrame };
  await handlers.get('login:open')!(event, auth, 'browser');
  assert.deepEqual(external, [signInUrl(auth).href]);
  assert.equal(windows.length, 1, 'browser sign-in must not open a blank Electron popup');
  await assert.rejects(handlers.get('login:open')!({ ...event, senderFrame: { url: event.senderFrame.url } }, auth, 'browser'), /only be opened from Manager/);
  await assert.rejects(handlers.get('login:open')!(event, 'file:///private/secret', 'browser'));
  await handlers.get('login:open')!(event, auth, 'app');
  const child = windows[1];
  assert.equal(child.options.webPreferences.nodeIntegration, false);
  assert.equal(child.options.webPreferences.sandbox, true);
  assert.equal(child.options.webPreferences.preload, undefined);
  assert.equal(child.loaded, signInUrl(auth).href);
});

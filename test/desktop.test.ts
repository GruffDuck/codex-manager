import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { randomUUID } from 'node:crypto';
import { WebSocketServer } from 'ws';
import { DesktopError, LiveDesktop, desktopSharesSocket } from '../core/src/desktop.js';

const A = 'account-a';
const B = 'account-b';

test('attachment proof rejects a separate daemon and accepts a connected desktop peer', () => {
  const ps = ' 20 /Applications/ChatGPT.app/Contents/MacOS/ChatGPT\n 30 codex';
  const server = 'codex 30 user 5u unix 0xabc 0t0 /private/server.sock\ncodex 30 user 6u unix 0xdef 0t0 ->0x123';
  assert.equal(desktopSharesSocket(ps, server, '/private/server.sock'), false);
  assert.equal(desktopSharesSocket(ps, `${server}\nChatGPT 20 user 7u unix 0x123 0t0 ->0xdef`, '/private/server.sock'), true);
  assert.equal(desktopSharesSocket('20 /Applications/Other.app/Contents/MacOS/Other', `${server}\nOther 20 user 7u unix 0x123 0t0 ->0xdef`, '/private/server.sock'), false);
});

test('live desktop switches over an existing socket and verifies the actual active session', async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'cm-live-'));
  const socket = process.platform === 'win32' ? String.raw`\\.\pipe\cm-live-${randomUUID()}` : path.join(home, 'server.sock');
  const server = http.createServer();
  const wss = new WebSocketServer({ server });
  let selected = A;
  let busy = false;
  let verifyWrong = false;
  let needsLogin = false;
  let malformed = false;
  let loseSwitchResponse = false;
  const methods: string[] = [];
  const sessions = () => ({ activeSessionId: selected, sessions: [A, B].map((id) => ({
    sessionId: id, email: `${id}@example.test`, isActive: selected === id,
    selectedWorkspaceAccountId: id, workspaces: [{ accountId: id }],
  })) });
  wss.on('connection', (ws) => {
    ws.on('message', (bytes) => {
      const message = JSON.parse(bytes.toString());
      methods.push(message.method);
      if (!message.id) return;
      let result: unknown = {};
      if (message.method === 'accountSession/list') result = malformed ? { active: 'wrong' } : sessions();
      if (message.method === 'thread/loaded/list') result = { data: ['thread-1'], nextCursor: null };
      if (message.method === 'thread/read') result = { thread: { status: { type: busy ? 'active' : 'idle' } } };
      if (message.method === 'accountSession/switch') {
        assert.equal(message.params.allowBrowserLogin, false);
        if (loseSwitchResponse) { ws.close(); return; }
        if (needsLogin) result = { loginId: 'login', authUrl: 'https://example.test/login' };
        else {
          if (!verifyWrong) selected = message.params.accountId;
          result = sessions();
        }
      }
      ws.send(JSON.stringify({ id: message.id, result }));
    });
  });
  await new Promise<void>((resolve) => server.listen(socket, resolve));
  const live = () => new LiveDesktop({ socket: () => socket, assertAttached: async () => {} });
  try {
    const bridge = live();
    const initial = await bridge.status();
    assert.equal(initial.state, 'connected');
    assert.equal(initial.account_id, A);
    const switched = await bridge.switchAccount(B);
    assert.equal(switched.account_id, B);
    assert.equal((await bridge.status()).account_id, B);
    assert.equal(methods.filter((method) => method === 'accountSession/switch').length, 1);
    assert.ok(!methods.includes('account/login/start'), 'must not inject credentials or start a browser login');

    busy = true;
    await assert.rejects(live().switchAccount(A), (error: DesktopError) => error.code === 'desktop_busy');
    assert.equal(selected, B);
    busy = false;
    await assert.rejects(live().switchAccount('not-signed-in'), (error: DesktopError) => error.code === 'desktop_login_missing');
    verifyWrong = true;
    await assert.rejects(live().switchAccount(A), (error: DesktopError) => error.code === 'desktop_unverified');
    verifyWrong = false;
    needsLogin = true;
    await assert.rejects(live().switchAccount(A), (error: DesktopError) => error.code === 'desktop_login_required');
    needsLogin = false;
    loseSwitchResponse = true;
    await assert.rejects(live().switchAccount(A), (error: DesktopError) => error.code === 'desktop_disconnected');
    loseSwitchResponse = false;
    malformed = true;
    assert.equal((await live().status()).state, 'unavailable');
    assert.equal(selected, B);
  } finally {
    for (const client of wss.clients) client.terminate();
    await new Promise<void>((resolve) => wss.close(() => resolve()));
    await new Promise<void>((resolve) => server.close(() => resolve()));
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test('failed desktop attachment never connects or changes the login', async () => {
  const bridge = new LiveDesktop({ socket: () => '/nonexistent.sock', assertAttached: async () => { throw new DesktopError('Desktop uses stdio'); } });
  assert.equal((await bridge.status()).state, 'unavailable');
  await assert.rejects(bridge.switchAccount(B), /Desktop uses stdio/);
});

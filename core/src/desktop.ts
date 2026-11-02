import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { randomUUID } from 'node:crypto';
import WebSocket from 'ws';
import { z } from 'zod';
import { codexHome } from './paths.js';

const run = promisify(execFile);
const sessionSchema = z.object({
  sessionId: z.string(), email: z.string().nullable(), isActive: z.boolean(),
  selectedWorkspaceAccountId: z.string().nullable(),
  workspaces: z.array(z.object({ accountId: z.string() }).passthrough()),
});
const sessionsSchema = z.object({ activeSessionId: z.string().nullable(), sessions: z.array(sessionSchema) });
type Sessions = z.infer<typeof sessionsSchema>;
export interface DesktopStatus {
  state: 'connected' | 'unavailable' | 'unverified';
  reason: string;
  account_id: string | null;
  email: string | null;
  busy: boolean | null;
  checked_at: number;
  sessions: Array<{ account_id: string; email: string | null }>;
}
export interface DesktopBridge {
  status(): Promise<DesktopStatus>;
  switchAccount(accountId: string): Promise<DesktopStatus>;
}
export class DesktopError extends Error {
  constructor(message: string, public code = 'desktop_unavailable', public status = 409) { super(message); }
}

export function desktopSocket(): string {
  return process.env.CODEX_MANAGER_CODEX_SOCKET?.trim() || path.join(codexHome(), 'app-server-control', 'app-server-control.sock');
}

/** Prove a running desktop process has a Unix connection to the server that
 * owns this socket. A separate daemon using the same HOME is not sufficient. */
export function desktopSharesSocket(ps: string, lsof: string, socket: string): boolean {
  const desktopPids = new Set(ps.split('\n').flatMap((line) => {
    const match = /^\s*(\d+)\s+(.+)$/.exec(line);
    return match && /\/(?:ChatGPT|Codex)\.app\/Contents\/MacOS\/(?:ChatGPT|Codex)(?:\s|$)/.test(match[2]!) ? [match[1]!] : [];
  }));
  const endpoints = lsof.split('\n').flatMap((line) => {
    const match = /^\S+\s+(\d+)\s+.*?\bunix\s+(0x[\da-f]+)\s+\S+\s+(.*)$/i.exec(line);
    return match ? [{ pid: match[1]!, node: match[2]!, name: match[3]!.trim() }] : [];
  });
  const owners = new Set(endpoints.filter((entry) => entry.name === socket).map((entry) => entry.pid));
  return endpoints.some((entry) => desktopPids.has(entry.pid) && (
    entry.name === socket || endpoints.some((peer) => owners.has(peer.pid) && entry.name === `->${peer.node}`)
  ));
}

async function assertDesktopAttached(socket: string): Promise<void> {
  if (process.platform !== 'darwin') throw new DesktopError('Live desktop attachment verification is currently supported on macOS only.');
  const dir = fs.lstatSync(path.dirname(socket));
  const stat = fs.lstatSync(socket);
  if (!stat.isSocket() || stat.uid !== process.getuid?.() || !dir.isDirectory() || dir.uid !== stat.uid || (dir.mode & 0o022)) {
    throw new DesktopError('Codex control socket must belong to this user in a private directory.');
  }
  const [ps, sockets] = await Promise.all([
    run('/bin/ps', ['-axo', 'pid=,comm='], { timeout: 2500, maxBuffer: 4 * 1024 * 1024 }),
    run('/usr/sbin/lsof', ['-n', '-U'], { timeout: 2500, maxBuffer: 8 * 1024 * 1024 }),
  ]);
  if (!desktopSharesSocket(ps.stdout, sockets.stdout, socket)) {
    throw new DesktopError('The running Codex desktop is not connected to this shared server. No account was changed.', 'desktop_not_attached');
  }
}

/** Small bounded JSON-RPC client; never starts a second app-server. */
export class DesktopRpc {
  private pending = new Map<string, { resolve: (value: unknown) => void; reject: (error: Error) => void; timer: NodeJS.Timeout }>();
  private ws: WebSocket;
  private closed = false;
  activityObserved = false;
  constructor(socket: string) {
    this.ws = new WebSocket('ws://localhost/rpc', {
      createConnection: () => net.createConnection(socket),
      maxPayload: 2 * 1024 * 1024,
    });
    this.ws.on('message', (raw) => {
      try {
        const message = JSON.parse(raw.toString()) as { id?: string; result?: unknown; error?: unknown; method?: string };
        if (message.method === 'thread/status/changed' || message.method === 'turn/started') this.activityObserved = true;
        if (!message.id) return;
        const pending = this.pending.get(message.id);
        if (!pending) return;
        clearTimeout(pending.timer);
        this.pending.delete(message.id);
        // Do not echo server error bodies: they may contain private data.
        if (message.error) pending.reject(new DesktopError('Codex rejected the live request. Update Codex or use Prepare login.', 'desktop_rpc_rejected'));
        else pending.resolve(message.result);
      } catch { this.close(); }
    });
    this.ws.on('error', () => this.fail());
    this.ws.on('close', () => this.fail());
  }
  private fail() {
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(new DesktopError('Codex connection closed. The active account is not verified.', 'desktop_disconnected'));
    }
    this.pending.clear();
  }
  async open(): Promise<void> {
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => { this.close(); reject(new DesktopError('Codex connection timed out.')); }, 3000);
      this.ws.once('open', () => { clearTimeout(timer); resolve(); });
      this.ws.once('error', () => { clearTimeout(timer); reject(new DesktopError('Could not connect to the running Codex server.')); });
    });
    await this.call('initialize', {
      clientInfo: { name: 'codex_manager', title: 'Codex Manager', version: '0.1.0' },
      capabilities: { experimentalApi: true, requestAttestation: false },
    });
    this.ws.send(JSON.stringify({ method: 'initialized', params: {} }));
  }
  call(method: string, params: unknown = {}): Promise<unknown> {
    if (this.closed || this.ws.readyState !== WebSocket.OPEN) return Promise.reject(new DesktopError('Codex is disconnected.'));
    const id = randomUUID();
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new DesktopError('Codex did not confirm the request in time.', 'desktop_timeout'));
      }, 4000);
      this.pending.set(id, { resolve, reject, timer });
      this.ws.send(JSON.stringify({ id, method, params }), (error) => {
        if (error) { clearTimeout(timer); this.pending.delete(id); reject(new DesktopError('Could not send the Codex request.')); }
      });
    });
  }
  close() {
    this.closed = true;
    this.fail();
    this.ws.on('error', () => {});
    this.ws.terminate();
  }
}

function active(sessions: Sessions) {
  return sessions.sessions.find((session) => session.sessionId === sessions.activeSessionId && session.isActive) ?? null;
}

export class LiveDesktop implements DesktopBridge {
  private cached: DesktopStatus | null = null;
  private checking: Promise<DesktopStatus> | null = null;
  private switching = false;
  constructor(private options: {
    socket?: () => string;
    assertAttached?: (socket: string) => Promise<void>;
  } = {}) {}
  private async connect(): Promise<DesktopRpc> {
    const socket = this.options.socket?.() ?? desktopSocket();
    try { await (this.options.assertAttached ?? assertDesktopAttached)(socket); }
    catch (error) {
      if (error instanceof DesktopError) throw error;
      throw new DesktopError('Live connection unavailable. This Codex may use a private stdio server. Prepare a login and reopen Codex manually.');
    }
    const client = new DesktopRpc(socket);
    try { await client.open(); return client; }
    catch (error) { client.close(); throw error; }
  }
  private async read(client: DesktopRpc): Promise<DesktopStatus> {
    const sessions = sessionsSchema.parse(await client.call('accountSession/list', { refreshWorkspaceMetadata: false }));
    const account = active(sessions);
    return {
      state: 'connected', reason: 'Verified connection to the server used by the running Codex desktop.',
      account_id: account?.selectedWorkspaceAccountId ?? null, email: account?.email ?? null,
      busy: null, checked_at: Date.now(),
      sessions: sessions.sessions.flatMap((session) => session.workspaces.map((workspace) => ({ account_id: workspace.accountId, email: session.email }))),
    };
  }
  status(): Promise<DesktopStatus> {
    if (this.switching && this.cached) return Promise.resolve(this.cached);
    if (this.cached && Date.now() - this.cached.checked_at < 3000) return Promise.resolve(this.cached);
    if (this.checking) return this.checking;
    this.checking = (async () => {
      let client: DesktopRpc | null = null;
      try { client = await this.connect(); this.cached = await this.read(client); }
      catch (error) {
        this.cached = { state: 'unavailable', reason: error instanceof DesktopError ? error.message : 'Codex returned an unsupported account response.',
          account_id: null, email: null, busy: null, checked_at: Date.now(), sessions: [] };
      } finally { client?.close(); }
      return this.cached!;
    })().finally(() => { this.checking = null; });
    return this.checking;
  }
  private async assertIdle(client: DesktopRpc): Promise<void> {
    const pageSchema = z.object({ data: z.array(z.string()), nextCursor: z.string().nullable() });
    let cursor: string | null = null;
    const seen = new Set<string>();
    for (let page = 0; page < 20; page += 1) {
      const threads = pageSchema.parse(await client.call('thread/loaded/list', { cursor, limit: 100 }));
      for (const threadId of threads.data) {
        const response = z.object({ thread: z.object({ status: z.object({ type: z.string() }) }) }).parse(
          await client.call('thread/read', { threadId, includeTurns: false }),
        );
        if (response.thread.status.type !== 'idle') throw new DesktopError('Codex has active or unverified work. The switch will wait for an idle check.', 'desktop_busy');
      }
      cursor = threads.nextCursor;
      if (!cursor) return;
      if (seen.has(cursor)) break;
      seen.add(cursor);
    }
    throw new DesktopError('Could not check every loaded Codex chat. No account was changed.', 'desktop_busy');
  }
  async switchAccount(accountId: string): Promise<DesktopStatus> {
    if (this.switching) throw new DesktopError('Another account switch is already in progress.', 'desktop_busy');
    this.switching = true;
    let client: DesktopRpc | null = null;
    try {
      client = await this.connect();
      const sessions = sessionsSchema.parse(await client.call('accountSession/list', { refreshWorkspaceMetadata: false }));
      const target = sessions.sessions.find((session) => session.workspaces.some((workspace) => workspace.accountId === accountId));
      if (!target) throw new DesktopError('This account is not signed in to Codex yet. Add it in Codex before using live switching.', 'desktop_login_missing');
      await this.assertIdle(client);
      // A second inspection catches turns that started during enumeration.
      if (client.activityObserved) throw new DesktopError('Codex activity changed during the check. Try again when idle.', 'desktop_busy');
      // No token injection, browser login, config rewrite, or app restart.
      const response = await client.call('accountSession/switch', { sessionId: target.sessionId, accountId, allowBrowserLogin: false });
      if (!sessionsSchema.safeParse(response).success) throw new DesktopError('Codex needs an interactive login. Finish signing in inside Codex.', 'desktop_login_required');
      const verified = await this.read(client);
      if (verified.account_id !== accountId) throw new DesktopError('Codex did not confirm the selected account. Refresh its status before trying again.', 'desktop_unverified');
      this.cached = verified;
      return verified;
    } catch (error) {
      this.cached = null;
      if (error instanceof DesktopError) throw error;
      throw new DesktopError('Codex returned an unsupported response. The account switch could not be verified.', 'desktop_unverified');
    } finally { this.switching = false; client?.close(); }
  }
}

export const desktop = new LiveDesktop();

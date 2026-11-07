import crypto from 'node:crypto';
import http from 'node:http';
import { DEFAULT_CLIENT_ID, DEFAULT_ISSUER } from './codexAuth.js';
import type { RefreshResult } from './oauth.js';

/**
 * Codex CLI signs in through a loopback redirect on port 1455. We mimic that
 * exactly so a login performed here is interchangeable with `codex login`:
 * same client_id, same redirect_uri, same PKCE shape. The listener only exists
 * while a login is in flight.
 */
export const OAUTH_PORT = Number(process.env.CODEX_MANAGER_OAUTH_PORT ?? 1455);
export const CALLBACK_PATH = '/auth/callback';

export interface LoginSession {
  id: string;
  url: string;
  state: string;
  redirect_uri: string;
  expires_at: number;
}

export interface LoginCallbacks {
  onCode: (code: string, state: string) => Promise<{ label: string }>;
  onError?: (message: string) => void;
}

export interface LoginStatus {
  status: 'pending' | 'completed' | 'failed' | 'cancelled';
  label?: string;
  message?: string;
}
const results = new Map<string, LoginStatus>();
export function loginStatus(id: string): LoginStatus | null { return results.get(id) ?? null; }

let active: {
  server: http.Server;
  state: string;
  callbacks: LoginCallbacks;
  timer: NodeJS.Timeout;
} | null = null;

function base64url(buffer: Buffer): string {
  return buffer.toString('base64url');
}

export function pkcePair(): { verifier: string; challenge: string } {
  const verifier = base64url(crypto.randomBytes(32));
  const challenge = base64url(crypto.createHash('sha256').update(verifier).digest());
  return { verifier, challenge };
}

export function authorizeUrl(params: {
  clientId: string;
  redirectUri: string;
  challenge: string;
  state: string;
}): string {
  const url = new URL(`${DEFAULT_ISSUER}/oauth/authorize`);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('client_id', params.clientId);
  url.searchParams.set('redirect_uri', params.redirectUri);
  url.searchParams.set('scope', 'openid profile email offline_access');
  url.searchParams.set('code_challenge', params.challenge);
  url.searchParams.set('code_challenge_method', 'S256');
  url.searchParams.set('state', params.state);
  url.searchParams.set('id_token_add_organizations', 'true');
  url.searchParams.set('codex_cli_simplified_flow', 'true');
  url.searchParams.set('originator', 'codex_cli_rs');
  return url.toString();
}

function page(title: string, body: string): string {
  const escape = (value: string) => value.replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]!);
  title = escape(title);
  body = escape(body);
  return `<!doctype html><meta charset="utf-8"><title>${title}</title>
<style>
  :root { color-scheme: dark }
  body { font: 15px/1.6 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; background:#0b0d12; color:#e8ecf4;
         display:grid; place-items:center; height:100vh; margin:0 }
  .card { background:#141822; border:1px solid #232a38; border-radius:14px; padding:28px 32px; max-width:420px; text-align:center }
  h1 { font-size:18px; margin:0 0 8px }
  p { color:#9aa6bd; margin:0 }
</style>
<div class="card"><h1>${title}</h1><p>${body}</p></div>`;
}

function close(): void {
  if (!active) return;
  clearTimeout(active.timer);
  try {
    active.server.close();
  } catch {
    /* already closed */
  }
  active = null;
}

export function cancelLogin(): void {
  if (active) active.callbacks.onError?.('cancelled');
  close();
}

export async function startLogin(
  callbacks: LoginCallbacks,
  options: { clientId?: string; port?: number; timeoutMs?: number } = {},
): Promise<LoginSession> {
  cancelLogin();
  const id = crypto.randomUUID();
  while (results.size >= 32) results.delete(results.keys().next().value!);
  const clientId = options.clientId ?? DEFAULT_CLIENT_ID;
  const port = options.port ?? OAUTH_PORT;
  const redirectUri = `http://localhost:${port}${CALLBACK_PATH}`;
  const { verifier, challenge } = pkcePair();
  const state = base64url(crypto.randomBytes(16));
  const failed = (message: string) => {
    if (results.get(id)?.status !== 'pending') return;
    results.set(id, { status: message === 'cancelled' ? 'cancelled' : 'failed', message });
    callbacks.onError?.(message);
  };

  const server = http.createServer(async (req, res) => {
    const remote = req.socket.remoteAddress ?? '';
    if (!/^(127\.|::1$|::ffff:127\.)/.test(remote)) {
      res.writeHead(403, { 'content-type': 'text/plain' }).end('loopback only');
      return;
    }
    const url = new URL(req.url ?? '/', `http://localhost:${port}`);
    if (url.pathname !== CALLBACK_PATH) {
      res.writeHead(404, { 'content-type': 'text/plain' }).end('not found');
      return;
    }
    const returnedState = url.searchParams.get('state');
    if (returnedState !== state || results.get(id)?.status !== 'pending') {
      res.writeHead(400, { 'content-type': 'text/plain' }).end('Invalid or completed sign-in session');
      return;
    }
    const error = url.searchParams.get('error');
    if (error) {
      const description = url.searchParams.get('error_description') ?? error;
      failed(description);
      res.writeHead(400, { 'content-type': 'text/html' }).end(page('Sign-in failed', description));
      close();
      return;
    }
    const code = url.searchParams.get('code');
    if (!code || returnedState !== state) {
      res.writeHead(400, { 'content-type': 'text/html' }).end(page('Sign-in failed', 'Missing code or state mismatch.'));
      return;
    }
    try {
      const result = await callbacks.onCode(code, state);
      results.set(id, { status: 'completed', label: result.label });
      res
        .writeHead(200, { 'content-type': 'text/html' })
        .end(page('Account added', `${result.label} is ready. You can close this tab and return to Codex Manager.`));
    } catch (err) {
      failed((err as Error).message);
      res
        .writeHead(500, { 'content-type': 'text/html' })
        .end(page('Sign-in failed', (err as Error).message));
    } finally {
      setTimeout(() => { if (active?.server === server) close(); }, 1500).unref();
    }
  });

  const listen = (host: string, ipv6Only = false) =>
    new Promise<void>((resolve, reject) => {
      const onError = (error: NodeJS.ErrnoException) => {
        server.off('listening', onListening);
        reject(error);
      };
      const onListening = () => {
        server.off('error', onError);
        resolve();
      };
      server.once('error', onError);
      server.once('listening', onListening);
      server.listen({ port, host, ipv6Only });
    });

  try {
    // Dual-stack binding so `http://localhost:1455` works whether the browser
    // prefers ::1 or 127.0.0.1. Non-loopback callers are rejected above.
    await listen('::');
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === 'EADDRNOTAVAIL' || code === 'EAFNOSUPPORT' || code === 'EINVAL') {
      await listen('127.0.0.1');
    } else {
      throw error;
    }
  }

  const timer = setTimeout(() => {
    failed('Login timed out');
    if (active?.server === server) close();
  }, options.timeoutMs ?? 10 * 60 * 1000);
  timer.unref();

  results.set(id, { status: 'pending' });
  active = { server, state, callbacks: { ...callbacks, onError: failed }, timer };
  // The verifier is kept in memory only; the state key ties the callback to it.
  verifiers.set(state, { verifier, redirectUri, createdAt: Date.now() });

  return {
    id,
    url: authorizeUrl({ clientId, redirectUri, challenge, state }),
    state,
    redirect_uri: redirectUri,
    expires_at: Date.now() + (options.timeoutMs ?? 10 * 60 * 1000),
  };
}

const verifiers = new Map<string, { verifier: string; redirectUri: string; createdAt: number }>();

function takeVerifier(state: string): { verifier: string; redirectUri: string } {
  const entry = verifiers.get(state);
  if (!entry) throw new Error('Unknown login state; start the sign-in again');
  verifiers.delete(state);
  if (Date.now() - entry.createdAt > 11 * 60 * 1000) throw new Error('Login session expired');
  return entry;
}

/** Exchanges the authorization code for tokens using the stored PKCE verifier. */
export async function exchangeCode(params: {
  code: string;
  state: string;
  clientId?: string;
}): Promise<RefreshResult> {
  const { verifier, redirectUri } = takeVerifier(params.state);
  const response = await fetch(`${DEFAULT_ISSUER}/oauth/token`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify({
      grant_type: 'authorization_code',
      code: params.code,
      redirect_uri: redirectUri,
      client_id: params.clientId ?? DEFAULT_CLIENT_ID,
      code_verifier: verifier,
    }),
  });
  const text = await response.text();
  if (!response.ok) {
    let detail = `HTTP ${response.status}`;
    try {
      const parsed = JSON.parse(text) as { error?: { code?: string; message?: string } | string };
      const inner = parsed.error;
      detail = (typeof inner === 'string' ? inner : (inner?.code ?? inner?.message)) ?? detail;
    } catch {
      /* ignore */
    }
    throw new Error(`Code exchange failed: ${detail}`);
  }
  const parsed = JSON.parse(text) as Record<string, unknown>;
  if (typeof parsed.access_token !== 'string' || typeof parsed.refresh_token !== 'string') {
    throw new Error('Code exchange returned an incomplete token set');
  }
  return {
    access_token: parsed.access_token,
    refresh_token: parsed.refresh_token,
    ...(typeof parsed.id_token === 'string' ? { id_token: parsed.id_token } : {}),
  };
}

import fs from 'node:fs';
import path from 'node:path';
import { codexAuthPath, codexHome } from './paths.js';

/**
 * The subset of `~/.codex/auth.json` we care about. Codex writes this file itself,
 * so we preserve unknown fields whenever we rewrite a token for the same account.
 */
export interface CodexTokens {
  access_token: string;
  refresh_token: string;
  id_token?: string;
  account_id: string;
  login_owner_id?: string;
  oauth_provenance?: { issuer?: string; client_id?: string };
}

export interface CodexAuthFile {
  auth_mode?: string;
  OPENAI_API_KEY?: string | null;
  tokens: CodexTokens;
  last_refresh?: string;
  [key: string]: unknown;
}

export const DEFAULT_CLIENT_ID = 'app_EMoamEEZ73f0CkXaXp7hrann';
export const DEFAULT_ISSUER = 'https://auth.openai.com';

export function readAuthFile(file = codexAuthPath()): CodexAuthFile | null {
  if (!fs.existsSync(file)) return null;
  const parsed = JSON.parse(fs.readFileSync(file, 'utf8')) as CodexAuthFile;
  if (!parsed?.tokens?.access_token && !parsed?.tokens?.refresh_token) {
    throw new Error('auth.json does not contain Codex tokens');
  }
  return parsed;
}

/** Decodes the id_token payload without verifying it; only used for display fields. */
export function claimsFromIdToken(idToken: string | undefined): Record<string, unknown> | null {
  if (!idToken) return null;
  const parts = idToken.split('.');
  if (parts.length < 2 || !parts[1]) return null;
  try {
    const parsed = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8')) as unknown;
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

export function accountIdFromIdToken(idToken: string | undefined): string | undefined {
  const payload = claimsFromIdToken(idToken);
  if (!payload) return undefined;
  const auth =
    payload['https://api.openai.com/auth'] && typeof payload['https://api.openai.com/auth'] === 'object'
      ? (payload['https://api.openai.com/auth'] as Record<string, unknown>)
      : undefined;
  const candidate =
    (auth?.chatgpt_account_id as string | undefined) ??
    (payload.chatgpt_account_id as string | undefined) ??
    (payload.account_id as string | undefined);
  return typeof candidate === 'string' && candidate ? candidate : undefined;
}

export function identityFromIdToken(idToken: string | undefined): {
  email?: string;
  plan?: string;
} {
  const payload = claimsFromIdToken(idToken);
  if (!payload) return {};
  const email = typeof payload.email === 'string' ? payload.email : undefined;
  const auth =
    payload['https://api.openai.com/auth'] && typeof payload['https://api.openai.com/auth'] === 'object'
      ? (payload['https://api.openai.com/auth'] as Record<string, unknown>)
      : undefined;
  const plan =
    auth && typeof auth.chatgpt_plan_type === 'string' ? auth.chatgpt_plan_type : undefined;
  return { ...(email ? { email } : {}), ...(plan ? { plan } : {}) };
}

export function clientIdOf(tokens: CodexTokens): string {
  return tokens.oauth_provenance?.client_id?.trim() || DEFAULT_CLIENT_ID;
}

export function writeAuthAtomic(auth: CodexAuthFile, file = codexAuthPath()): void {
  const dir = path.dirname(file);
  fs.mkdirSync(dir, { recursive: true });
  if (fs.existsSync(file) && !fs.existsSync(`${file}.codex-manager.bak`)) {
    fs.copyFileSync(file, `${file}.codex-manager.bak`);
    fs.chmodSync(`${file}.codex-manager.bak`, 0o600);
  }
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
  const payload = { ...auth, last_refresh: new Date().toISOString() };
  const handle = fs.openSync(tmp, 'w', 0o600);
  try {
    fs.writeFileSync(handle, `${JSON.stringify(payload, null, 2)}\n`);
    fs.fsyncSync(handle);
  } finally {
    fs.closeSync(handle);
  }
  fs.renameSync(tmp, file);
}

/** Rewrites the Codex client token for one account, preserving unrelated auth fields. */
export function switchClientTo(tokens: CodexTokens): string {
  const home = codexHome();
  const current = readAuthFile(path.join(home, 'auth.json'));
  const next: CodexAuthFile = {
    ...(current ?? {}),
    auth_mode: 'chatgpt',
    OPENAI_API_KEY: null,
    tokens,
  };
  writeAuthAtomic(next, path.join(home, 'auth.json'));
  return path.join(home, 'auth.json');
}

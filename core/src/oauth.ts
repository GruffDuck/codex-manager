import { clientIdOf, DEFAULT_ISSUER, type CodexTokens } from './codexAuth.js';

export interface RefreshResult {
  access_token: string;
  refresh_token: string;
  id_token?: string;
}

function jwtExpiry(token: string | undefined): number | null {
  if (!token) return null;
  const part = token.split('.')[1];
  if (!part) return null;
  try {
    const payload = JSON.parse(Buffer.from(part, 'base64url').toString('utf8')) as { exp?: number };
    return typeof payload.exp === 'number' ? payload.exp * 1000 : null;
  } catch {
    return null;
  }
}

/** Milliseconds until the access token expires, or null when it is not a JWT. */
export function expiresAt(tokens: CodexTokens): number | null {
  return jwtExpiry(tokens.access_token) ?? jwtExpiry(tokens.id_token);
}

export function needsRefresh(tokens: CodexTokens, skewMs = 120_000): boolean {
  const exp = expiresAt(tokens);
  return exp !== null && exp - Date.now() < skewMs;
}

export async function refreshTokens(tokens: CodexTokens): Promise<RefreshResult> {
  const clientId = clientIdOf(tokens);
  const issuer = tokens.oauth_provenance?.issuer?.replace(/\/+$/, '') || DEFAULT_ISSUER;
  const body = new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: tokens.refresh_token,
    client_id: clientId,
    scope: 'openid profile email',
  });

  const response = await fetch(`${issuer}/oauth/token`, {
    method: 'POST',
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
      accept: 'application/json',
    },
    body,
  });

  const text = await response.text();
  if (!response.ok) {
    let detail = `HTTP ${response.status}`;
    try {
      const parsedError = JSON.parse(text) as {
        error?: string | { code?: string; message?: string; type?: string };
      };
      const inner = parsedError.error;
      const candidate =
        typeof inner === 'string' ? inner : (inner?.code ?? inner?.message ?? inner?.type);
      if (typeof candidate === 'string' && candidate) detail = candidate;
    } catch {
      /* non-JSON error body */
    }
    throw Object.assign(new Error(`token refresh failed: ${detail}`), {
      status: response.status,
      detail,
    });
  }

  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(text) as Record<string, unknown>;
  } catch {
    throw new Error('token refresh returned a non-JSON body');
  }

  const access = parsed.access_token;
  if (typeof access !== 'string' || !access) {
    throw new Error('token refresh returned no access_token');
  }

  // OpenAI rotates refresh tokens; keep the old one only when the server does not send a new one.
  const nextRefresh =
    typeof parsed.refresh_token === 'string' && parsed.refresh_token
      ? parsed.refresh_token
      : tokens.refresh_token;

  return {
    access_token: access,
    refresh_token: nextRefresh,
    ...(typeof parsed.id_token === 'string' ? { id_token: parsed.id_token } : {}),
  };
}

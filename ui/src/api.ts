export class ApiError extends Error {
  status: number;
  code: string;

  constructor(message: string, status: number, code = 'error') {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
  }
}

export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(path, {
    ...init,
    headers: {
      ...(init.body ? { 'content-type': 'application/json' } : {}),
      ...(init.headers ?? {}),
    },
  });

  const text = await response.text();
  let parsed: unknown = null;
  if (text) {
    try {
      parsed = JSON.parse(text);
    } catch {
      parsed = null;
    }
  }

  if (!response.ok) {
    const error = (parsed as { error?: { message?: string; code?: string } } | null)?.error;
    throw new ApiError(error?.message ?? `Request failed (HTTP ${response.status})`, response.status, error?.code);
  }

  return parsed as T;
}

export const post = <T>(path: string, body?: unknown): Promise<T> =>
  api<T>(path, { method: 'POST', ...(body === undefined ? {} : { body: JSON.stringify(body) }) });

export const patch = <T>(path: string, body: unknown): Promise<T> =>
  api<T>(path, { method: 'PATCH', body: JSON.stringify(body) });

export const del = <T>(path: string): Promise<T> => api<T>(path, { method: 'DELETE' });

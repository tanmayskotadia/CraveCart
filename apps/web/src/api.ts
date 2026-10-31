const origin = import.meta.env.VITE_API_ORIGIN ?? '';
export async function assistantStream<T>(
  path: string,
  body: unknown,
  signal: AbortSignal,
  onProgress: (message: string) => void,
  key: string,
  refreshed = false,
): Promise<T> {
  const response = await fetch(origin + '/api/v1' + path, {
    method: 'POST',
    credentials: 'include',
    cache: 'no-store',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'text/event-stream',
      'X-CSRF-Token': csrf,
      'Idempotency-Key': key,
    },
    body: JSON.stringify(body),
    signal: AbortSignal.any([signal, AbortSignal.timeout(45000)]),
  });
  if (response.status === 401 && !refreshed) {
    await refresh();
    return assistantStream(path, body, signal, onProgress, key, true);
  }
  if (!response.headers.get('content-type')?.startsWith('text/event-stream')) {
    const value = (await response.json()) as { data: T; error?: { code: string; message: string } };
    if (!response.ok)
      throw new ApiError(
        response.status,
        value.error?.code ?? 'ASSISTANT_UNAVAILABLE',
        value.error?.message ?? 'Assistant unavailable',
      );
    return value.data;
  }
  if (!response.body) throw new Error('Assistant stream unavailable');
  const reader = response.body.getReader(),
    decoder = new TextDecoder();
  let buffer = '',
    received = 0;
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      received += chunk.value.byteLength;
      if (received > 256000) throw new Error('Assistant response exceeded its limit');
      buffer += decoder.decode(chunk.value, { stream: true });
      buffer = buffer.replace(/\r\n/g, '\n');
      let boundary: number;
      while ((boundary = buffer.indexOf('\n\n')) >= 0) {
        const event = buffer.slice(0, boundary);
        buffer = buffer.slice(boundary + 2);
        const name = event
          .split('\n')
          .find((l) => l.startsWith('event:'))
          ?.slice(6)
          .trim();
        const data = event
          .split('\n')
          .filter((l) => l.startsWith('data:'))
          .map((l) => l.slice(5).trimStart())
          .join('\n');
        if (!data) continue;
        const value = JSON.parse(data);
        if (name === 'progress')
          onProgress(String(value.message ?? 'Checking current information'));
        if (name === 'result') return value as T;
        if (name === 'error')
          throw new Error(String(value.message ?? 'Reload the conversation to recover'));
      }
    }
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
  throw new Error('The response ended before confirmation. Reload the conversation to recover.');
}
let csrf = '';
let refreshing: Promise<void> | undefined;
export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
  ) {
    super(message);
  }
}
export function setCsrf(value: string) {
  csrf = value;
}
async function raw<T>(
  path: string,
  options: { method?: string; body?: unknown; headers?: Record<string, string> } = {},
): Promise<T> {
  const binary = options.body instanceof Blob;
  const response = await fetch(`${origin}/api/v1${path}`, {
    method: options.method ?? 'GET',
    credentials: 'include',
    cache: 'no-store',
    headers: {
      ...(options.body !== undefined
        ? { 'Content-Type': binary ? 'application/octet-stream' : 'application/json' }
        : {}),
      ...(csrf ? { 'X-CSRF-Token': csrf } : {}),
      ...options.headers,
    },
    body:
      options.body === undefined
        ? undefined
        : binary
          ? (options.body as Blob)
          : JSON.stringify(options.body),
    signal: AbortSignal.timeout(binary ? 20_000 : 25_000),
  });
  let result: { data: T; error?: { code: string; message: string } };
  try {
    result = await response.json();
  } catch {
    throw new ApiError(
      response.status || 503,
      'INVALID_RESPONSE',
      'The service is temporarily unavailable. Please try again.',
    );
  }
  if (!response.ok)
    throw new ApiError(
      response.status,
      result.error?.code ?? 'REQUEST_FAILED',
      result.error?.message ?? 'The request could not be completed',
    );
  return result.data;
}
export async function refresh() {
  const perform = async () => {
    const token = await raw<{ csrfToken: string }>('/auth/csrf');
    csrf = token.csrfToken;
    await raw('/auth/refresh', { method: 'POST', body: {} });
  };
  refreshing ??= (
    navigator.locks ? navigator.locks.request('cravecart-session-refresh', perform) : perform()
  ).finally(() => {
    refreshing = undefined;
  });
  return refreshing;
}
export async function api<T>(
  path: string,
  options: { method?: string; body?: unknown; headers?: Record<string, string> } = {},
): Promise<T> {
  try {
    return await raw<T>(path, options);
  } catch (error) {
    if (
      error instanceof ApiError &&
      error.status === 401 &&
      !/^\/auth\/(?:login|register|otp\/|refresh|csrf|mfa\/verify)/.test(path) &&
      csrf
    ) {
      await refresh();
      return raw<T>(path, options);
    }
    throw error;
  }
}
export async function documentBlob(path: string, refreshed = false): Promise<Blob> {
  const response = await fetch(`${origin}/api/v1${path}`, {
    credentials: 'include',
    cache: 'no-store',
    signal: AbortSignal.timeout(20_000),
  });
  if (response.status === 401 && csrf && !refreshed) {
    await refresh();
    return documentBlob(path, true);
  }
  if (!response.ok) {
    let message = 'Document is unavailable';
    let code = 'DOCUMENT_UNAVAILABLE';
    try {
      const error = (await response.json()).error;
      if (typeof error?.message === 'string') message = error.message;
      if (typeof error?.code === 'string') code = error.code;
    } catch {
      /* No private response bodies are surfaced. */
    }
    throw new ApiError(response.status, code, message);
  }
  return response.blob();
}

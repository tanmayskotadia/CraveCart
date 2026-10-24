const origin = import.meta.env.VITE_API_ORIGIN ?? '';
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
export async function documentBlob(path: string) {
  const response = await fetch(`${origin}/api/v1${path}`, {
    credentials: 'include',
    cache: 'no-store',
    signal: AbortSignal.timeout(20_000),
  });
  if (!response.ok) {
    let message = 'Document is unavailable';
    try {
      message = (await response.json()).error.message;
    } catch {
      /* No private response bodies are surfaced. */
    }
    throw new ApiError(response.status, 'DOCUMENT_UNAVAILABLE', message);
  }
  return response.blob();
}

/// <reference types="vite/client" />
import { afterEach, describe, expect, it, vi } from 'vitest';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe('authenticated document downloads', () => {
  it('uses the configured API origin and refreshes an expired session once', async () => {
    vi.stubEnv('VITE_API_ORIGIN', 'https://api.example.test');
    vi.stubGlobal('navigator', {});
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(new Response('', { status: 401 }))
      .mockResolvedValueOnce(Response.json({ data: { csrfToken: 'fresh-csrf' } }))
      .mockResolvedValueOnce(Response.json({ data: {} }))
      .mockResolvedValueOnce(new Response('private-export'));
    vi.stubGlobal('fetch', fetch);
    const { documentBlob, setCsrf } = await import('../../apps/web/src/api.js');
    setCsrf('existing-csrf');
    expect(await (await documentBlob('/privacy/requests/test/download')).text()).toBe(
      'private-export',
    );
    expect(fetch.mock.calls.map(([url]) => url)).toEqual([
      'https://api.example.test/api/v1/privacy/requests/test/download',
      'https://api.example.test/api/v1/auth/csrf',
      'https://api.example.test/api/v1/auth/refresh',
      'https://api.example.test/api/v1/privacy/requests/test/download',
    ]);
    expect(fetch.mock.calls[3]?.[1]).toMatchObject({ credentials: 'include', cache: 'no-store' });
  });

  it('preserves fresh sign-in requirements without retrying authorization failures', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(
          Response.json(
            { error: { code: 'REAUTHENTICATION_REQUIRED', message: 'Sign in again to download.' } },
            { status: 403 },
          ),
        ),
    );
    const { documentBlob, setCsrf } = await import('../../apps/web/src/api.js');
    setCsrf('existing-csrf');
    await expect(documentBlob('/privacy/requests/test/download')).rejects.toMatchObject({
      status: 403,
      code: 'REAUTHENTICATION_REQUIRED',
      message: 'Sign in again to download.',
    });
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('stops after one refresh when a download still returns unauthorized', async () => {
    vi.stubGlobal('navigator', {});
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(new Response('', { status: 401 }))
      .mockResolvedValueOnce(Response.json({ data: { csrfToken: 'fresh-csrf' } }))
      .mockResolvedValueOnce(Response.json({ data: {} }))
      .mockResolvedValueOnce(new Response('not JSON', { status: 401 }));
    vi.stubGlobal('fetch', fetch);
    const { documentBlob, setCsrf } = await import('../../apps/web/src/api.js');
    setCsrf('existing-csrf');
    await expect(documentBlob('/private-document')).rejects.toMatchObject({
      status: 401,
      code: 'DOCUMENT_UNAVAILABLE',
    });
    expect(fetch).toHaveBeenCalledTimes(4);
  });
});

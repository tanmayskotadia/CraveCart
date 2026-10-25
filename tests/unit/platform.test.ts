import { describe, it, expect, vi, afterEach } from 'vitest';
import request from 'supertest';
import { createApp, type Resources } from '@cravecart/platform';
import { loadConfig } from '@cravecart/config';
import { platformSchema } from '@cravecart/contracts';
import { syntheticAdapters } from '@cravecart/adapters';
import { payloadHash, validateEvent } from '@cravecart/persistence';
import { canEnter } from '../../apps/web/src/access.js';

const config = loadConfig({ NODE_ENV: 'test' });
const resources: Resources = {
  check: async () => ({ mongo: false, rabbitmq: false, redis: false }),
  close: async () => {},
};
afterEach(() => vi.unstubAllEnvs());
describe('service HTTP contract', () => {
  const app = createApp({ name: 'admin', config, resources });
  it('is live while dependencies are down, but never claims readiness', async () => {
    expect((await request(app).get('/health/live')).status).toBe(200);
    const ready = await request(app).get('/health/ready');
    expect(ready.status).toBe(503);
    expect(ready.body.checks.mongo).toBe(false);
  });
  it('returns the exact public capability schema and canonical request ID', async () => {
    const id = '20d2826f-65f8-4f71-a4b5-97e1c2733f9a';
    const response = await request(app).get('/api/v1/platform').set('X-Request-ID', id);
    expect(response.status).toBe(200);
    expect(platformSchema.safeParse(response.body).success).toBe(true);
    expect(response.body.meta.requestId).toBe(id);
    expect(response.headers['cache-control']).toBe('no-store');
    expect(response.body.data.capabilities.ordering).toBe(false);
  });
  it('rejects unknown query input and replaces untrusted request IDs', async () => {
    const response = await request(app)
      .get('/api/v1/platform?role=admin')
      .set('X-Request-ID', 'secret-in-header');
    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('INVALID_REQUEST');
    expect(response.body.error.requestId).not.toBe('secret-in-header');
  });
  it('keeps metrics private and returns safe errors for unknown routes', async () => {
    expect((await request(app).get('/metrics')).status).toBe(401);
    expect(
      (await request(app).get('/metrics').set('Authorization', `Bearer ${config.METRICS_TOKEN}`))
        .text,
    ).toContain('cravecart_http_requests_total');
    const response = await request(app).get('/api/v1/admin/users');
    expect(response.status).toBe(404);
    expect(response.body.error).not.toHaveProperty('stack');
  });
  it('forwards correlation and returns a structured dependency outage at the gateway', async () => {
    vi.stubEnv('ADMIN_URL', '');
    vi.stubEnv('ADMIN_HOSTPORT', 'cravecart-admin-private:10000');
    const fetcher = vi.fn<typeof fetch>().mockRejectedValue(new Error('amqp://secret@host'));
    const gateway = createApp({ name: 'gateway', config, resources, fetcher });
    const response = await request(gateway).get('/api/v1/platform');
    expect(response.status).toBe(503);
    expect(String(fetcher.mock.calls[0]?.[0])).toBe(
      'http://cravecart-admin-private:10000/api/v1/platform',
    );
    expect(JSON.stringify(response.body)).not.toContain('secret@host');
    expect(fetcher.mock.calls[0]?.[1]?.headers).toHaveProperty(
      'x-request-id',
      response.body.error.requestId,
    );
  });
  it('classifies an invalid upstream response as a dependency failure, not a customer error', async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValue(
        new Response(JSON.stringify({ data: { name: 'wrong-platform' } }), { status: 200 }),
      );
    const gateway = createApp({ name: 'gateway', config, resources, fetcher });
    const response = await request(gateway).get('/api/v1/platform');
    expect(response.status).toBe(503);
    expect(response.body.error.code).toBe('DEPENDENCY_UNAVAILABLE');
  });
});
describe('safety and ownership', () => {
  it('denies a fabricated workspace without matching grants', () => {
    expect(canEnter(null, ['admin'])).toBe(false);
    expect(canEnter({ workspace: 'admin', grants: ['customer'] }, ['admin'])).toBe(false);
    expect(canEnter({ workspace: 'rider', grants: ['rider'] }, ['admin'])).toBe(false);
    expect(canEnter({ workspace: 'rider', grants: ['rider'] }, ['rider'])).toBe(true);
  });
  it('prevents synthetic adapters in production even if toggled on', () => {
    vi.stubEnv('NODE_ENV', 'production');
    expect(() => syntheticAdapters.payment('order001', 100)).toThrow('disabled');
    expect(() => loadConfig({ NODE_ENV: 'production' })).toThrow();
  });
  it('requires encrypted dependency settings for production', () => {
    expect(() =>
      loadConfig({
        NODE_ENV: 'production',
        DEV_ADAPTERS: 'false',
        INTERNAL_TOKEN: 'x'.repeat(40),
        METRICS_TOKEN: 'y'.repeat(40),
        UPLOAD_SCAN_MODE: 'clamav',
        UPLOAD_DIRECTORY: '/var/lib/cravecart/uploads',
        AUTH_SECRET: 'a'.repeat(40),
        AUTH_ENCRYPTION_KEY: 'b'.repeat(40),
        UPLOAD_ENCRYPTION_KEY: 'c'.repeat(40),
      }),
    ).toThrow('TLS');
  });
  it('uses deterministic synthetic outcomes without sending or charging anything', () => {
    expect(syntheticAdapters.payment('order001', 100)).toEqual(
      syntheticAdapters.payment('order001', 100),
    );
    expect(syntheticAdapters.notification('user001', 'order-received').state).toBe('NOT_SENT');
    expect(syntheticAdapters.map().synthetic).toBe(true);
  });
  it('hashes canonical JSON and rejects unknown/secret-bearing events', () => {
    expect(payloadHash({ b: 2, a: 1 })).toBe(payloadHash({ a: 1, b: 2 }));
    expect(payloadHash({ a: 2 })).not.toBe(payloadHash({ a: 1 }));
    expect(() =>
      validateEvent({ eventType: 'payment.captured.v1', data: { otp: '123456' } }),
    ).toThrow();
  });
});

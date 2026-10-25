import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  checkHosting,
  hostedOptions,
  hostedOrigin,
  hostedCheckNames,
} from '../../scripts/check-hosting.mjs';

const options = hostedOptions({
  HOSTED_APP_ORIGIN: 'https://app.example.test',
  HOSTED_API_ORIGIN: 'https://api.example.test',
  HOSTED_REALTIME_ORIGIN: 'https://realtime.example.test',
  HOSTED_EXPECTED_BUILD: 'a'.repeat(64),
});
function fixture(change = () => {}) {
  return async (input, init) => {
    assert.equal(init.method ?? 'GET', 'GET');
    assert.equal(init.redirect, 'error');
    assert.equal(init.headers.Cookie, undefined);
    const url = new URL(input),
      service = url.hostname.split('.')[0] === 'api' ? 'gateway' : 'realtime';
    const headers = {
      'cache-control': 'private, no-store',
      'content-type': 'application/json',
      'x-content-type-options': 'nosniff',
      'x-frame-options': 'DENY',
      'referrer-policy': 'strict-origin-when-cross-origin',
      'permissions-policy': 'geolocation=(self)',
    };
    let status = 200,
      body;
    if (url.pathname === '/health/ready')
      body = { service, status: 'ready', checks: { mongo: true } };
    else if (url.pathname === '/health/release' || url.pathname === '/release.json')
      body = {
        service,
        algorithm: 'cravecart-deployment-v1',
        buildSha256: options.expectedBuild,
        owners: Object.fromEntries(
          ['auth', 'restaurant', 'rider', 'admin', 'realtime', 'utils'].map((name) => [name, true]),
        ),
      };
    else if (url.pathname === '/api/v1/platform')
      body = {
        data: { name: 'CraveCart', market: { country: 'IN', currency: 'INR', scope: 'national' } },
      };
    else if (url.pathname === '/api/v1/payments/capabilities')
      body = { data: { enabled: true, mode: 'test', development: false, gateways: ['razorpay'] } };
    else if (url.pathname === '/api/v1/auth/capabilities')
      body = { data: { developmentDelivery: false, methods: ['email'] } };
    else if (url.pathname.startsWith('/api/')) {
      status = 401;
      body = {};
    } else {
      headers['content-type'] = 'text/html';
      body = '<div id="root"></div>';
    }
    const value = { status, headers, body };
    change(url, value);
    return new Response(typeof value.body === 'string' ? value.body : JSON.stringify(value.body), {
      status: value.status,
      headers: value.headers,
    });
  };
}
test('hosted preflight rejects unsafe origins, missing build identity and unknown gateways', () => {
  for (const url of [
    'http://example.test',
    'https://secret:password@example.test',
    'https://localhost',
    'https://app.example.test/path',
    'https://app.example.test/?token=secret',
  ])
    assert.throws(() => hostedOrigin(url));
  assert.throws(() => hostedOptions({}));
});
test('hosted preflight checks all named boundaries without contacting providers or mutating data', async () => {
  const report = await checkHosting(options, fixture());
  assert.equal(report.passed, true);
  assert.deepEqual(report.checks.map((check) => check.name).sort(), [...hostedCheckNames].sort());
});
test('hosted preflight fails missing safety booleans, wrong builds/mode, cache and auth exposure', async () => {
  for (const change of [
    (url, value) => {
      if (url.pathname.endsWith('/payments/capabilities')) delete value.body.data.development;
    },
    (url, value) => {
      if (url.pathname.endsWith('/payments/capabilities')) value.body.data.mode = 'live';
    },
    (url, value) => {
      if (url.pathname === '/release.json') value.body.buildSha256 = 'b'.repeat(64);
    },
    (url, value) => {
      if (url.pathname === '/') delete value.headers['x-frame-options'];
    },
    (url, value) => {
      if (url.pathname === '/api/v1/auth/me') value.status = 200;
    },
    (url, value) => {
      if (url.pathname === '/health/ready') value.body.checks = {};
    },
  ]) {
    const report = await checkHosting(options, fixture(change));
    assert.equal(report.passed, false);
  }
});

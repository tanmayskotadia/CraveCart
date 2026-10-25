import { mkdir, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
export const hostedCheckNames = [
  'gateway-readiness',
  'gateway-build',
  'realtime-readiness',
  'realtime-build',
  'frontend-build',
  ...[
    '/',
    '/login',
    '/seller/login',
    '/rider/login',
    '/admin/login',
    '/search?city=chennai',
    '/orders',
    '/assistant',
  ].map((path) => `spa:${path}`),
  'same-origin-platform-proxy',
  'configured-payment-mode',
  'real-contact-adapter',
  'anonymous-denied:/api/v1/auth/me',
  'anonymous-denied:/api/v1/admin/commerce/merchants',
];

export function hostedOrigin(value) {
  const url = new URL(value);
  if (
    url.protocol !== 'https:' ||
    url.username ||
    url.password ||
    url.pathname !== '/' ||
    url.search ||
    url.hash ||
    ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) ||
    url.hostname.endsWith('.localhost')
  )
    throw new Error(
      'Provide a controlled HTTPS origin without credentials, paths or query parameters',
    );
  return url.origin;
}
export function hostedOptions(env) {
  const app = hostedOrigin(env.HOSTED_APP_ORIGIN),
    api = hostedOrigin(env.HOSTED_API_ORIGIN),
    realtime = hostedOrigin(env.HOSTED_REALTIME_ORIGIN);
  const expectedBuild = env.HOSTED_EXPECTED_BUILD;
  if (!/^[a-f0-9]{64}$/.test(expectedBuild ?? ''))
    throw new Error('Set HOSTED_EXPECTED_BUILD to the verified buildSha256');
  const mode = env.HOSTED_EXPECTED_MODE ?? 'test';
  if (!['test', 'live'].includes(mode))
    throw new Error('Hosted checks require an explicit test/live mode');
  const gateways = (env.HOSTED_REQUIRED_GATEWAYS ?? 'razorpay').split(',');
  if (
    !gateways.length ||
    gateways.some((value) => !['razorpay', 'stripe'].includes(value)) ||
    new Set(gateways).size !== gateways.length
  )
    throw new Error('Specify a distinct list of supported gateways');
  return { app, api, realtime, expectedBuild, mode, gateways };
}
export async function checkHosting(options, fetcher = fetch) {
  const report = {
    kind: 'hosted-launch-preflight',
    startedAt: new Date().toISOString(),
    options,
    checks: [],
    passed: false,
  };
  const get = async (origin, path) =>
    fetcher(new URL(path, origin), {
      redirect: 'error',
      signal: AbortSignal.timeout(10_000),
      headers: { 'Cache-Control': 'no-cache' },
    });
  const assert = (condition) => {
    if (!condition) throw new Error('Check failed');
  };
  const check = async (name, run) => {
    try {
      await run();
      report.checks.push({ name, passed: true });
    } catch {
      report.checks.push({ name, passed: false });
    }
  };
  for (const [service, origin] of [
    ['gateway', options.api],
    ['realtime', options.realtime],
  ]) {
    await check(`${service}-readiness`, async () => {
      const response = await get(origin, '/health/ready'),
        value = await response.json();
      assert(
        response.status === 200 &&
          value.service === service &&
          value.status === 'ready' &&
          Object.keys(value.checks ?? {}).length > 0 &&
          Object.values(value.checks).every((state) => state === true),
      );
    });
    await check(`${service}-build`, async () => {
      const response = await get(origin, '/health/release'),
        value = await response.json();
      assert(
        response.status === 200 &&
          response.headers.get('cache-control')?.includes('no-store') &&
          value.algorithm === 'cravecart-deployment-v1' &&
          value.service === service &&
          value.buildSha256 === options.expectedBuild,
      );
      if (service === 'gateway')
        assert(
          ['auth', 'restaurant', 'rider', 'admin', 'realtime', 'utils'].every(
            (owner) => value.owners?.[owner] === true,
          ),
        );
    });
  }
  await check('frontend-build', async () => {
    const response = await get(options.app, '/release.json'),
      value = await response.json();
    assert(
      response.status === 200 &&
        response.headers.get('cache-control')?.includes('no-store') &&
        value.algorithm === 'cravecart-deployment-v1' &&
        value.buildSha256 === options.expectedBuild,
    );
  });
  for (const path of [
    '/',
    '/login',
    '/seller/login',
    '/rider/login',
    '/admin/login',
    '/search?city=chennai',
    '/orders',
    '/assistant',
  ]) {
    await check(`spa:${path}`, async () => {
      const response = await get(options.app, path);
      assert(
        response.status === 200 &&
          response.headers.get('content-type')?.includes('text/html') &&
          (await response.text()).includes('id="root"'),
      );
      assert(
        response.headers.get('x-content-type-options') === 'nosniff' &&
          response.headers.get('x-frame-options') === 'DENY' &&
          response.headers.get('referrer-policy') === 'strict-origin-when-cross-origin' &&
          response.headers.get('permissions-policy')?.includes('geolocation=(self)'),
      );
    });
  }
  await check('same-origin-platform-proxy', async () => {
    const response = await get(options.app, '/api/v1/platform'),
      value = (await response.json()).data;
    assert(
      response.status === 200 &&
        response.headers.get('cache-control')?.includes('no-store') &&
        value?.name === 'CraveCart' &&
        value.market?.country === 'IN' &&
        value.market?.currency === 'INR' &&
        value.market?.scope === 'national',
    );
  });
  await check('configured-payment-mode', async () => {
    const response = await get(options.app, '/api/v1/payments/capabilities'),
      value = (await response.json()).data;
    assert(
      response.status === 200 &&
        value?.enabled === true &&
        value.development === false &&
        value.mode === options.mode &&
        Array.isArray(value.gateways) &&
        options.gateways.every((gateway) => value.gateways.includes(gateway)),
    );
  });
  await check('real-contact-adapter', async () => {
    const response = await get(options.app, '/api/v1/auth/capabilities'),
      value = (await response.json()).data;
    assert(
      response.status === 200 &&
        value?.developmentDelivery === false &&
        Array.isArray(value.methods) &&
        value.methods.length > 0 &&
        value.methods.every((method) => ['email', 'phone'].includes(method)),
    );
  });
  for (const path of ['/api/v1/auth/me', '/api/v1/admin/commerce/merchants']) {
    await check(`anonymous-denied:${path}`, async () => {
      const response = await get(options.app, path);
      assert(
        response.status === 401 && response.headers.get('cache-control')?.includes('no-store'),
      );
    });
  }
  report.finishedAt = new Date().toISOString();
  report.passed = report.checks.every((check) => check.passed);
  report.limitation =
    'Read-only checks of build identity, configuration, routing and headers. No OTP, payment, refund, GPS, provider callback or authenticated journey was executed.';
  return report;
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const report = await checkHosting(hostedOptions(process.env));
  await mkdir('.local/hosted-checks', { recursive: true });
  const path = `.local/hosted-checks/${randomUUID()}.json`;
  await writeFile(path, JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify({ ...report, evidence: path }, null, 2));
  if (!report.passed) process.exitCode = 1;
}

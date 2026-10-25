import { test } from 'node:test';
import assert from 'node:assert/strict';
import { probeOptions, runProbe } from '../../scripts/capacity-probe.mjs';

test('probe rejects credentials, paths, unsafe transports, writes and unbounded workloads', () => {
  const env = { CAPACITY_BASE_URL: 'https://staging.example.test' };
  for (const input of [
    { CAPACITY_BASE_URL: 'https://secret:password@example.test' },
    { CAPACITY_BASE_URL: 'https://example.test/secret?token=secret' },
    { CAPACITY_BASE_URL: 'http://example.test' },
    { CAPACITY_BASE_URL: 'ftp://localhost' },
    { CAPACITY_PATH: '/api/v1/orders' },
    { CAPACITY_REQUESTS: '2001' },
    { CAPACITY_CONCURRENCY: '17' },
    { CAPACITY_REQUESTS: 'NaN' },
    { CAPACITY_P95_MS: '0' },
  ])
    assert.throws(() => probeOptions({ ...env, ...input }));
});
test('probe records 429 and network failures, stops at its request bound and fails qualification', async () => {
  const options = probeOptions({
    CAPACITY_BASE_URL: 'http://127.0.0.1:4000',
    CAPACITY_REQUESTS: '7',
    CAPACITY_CONCURRENCY: '3',
  });
  let calls = 0;
  const result = await runProbe(options, async () => {
    calls++;
    if (calls === 2) throw new Error('private transport failure');
    return new Response(null, { status: calls === 3 ? 429 : 200 });
  });
  assert.equal(calls, 7);
  assert.equal(result.completed, 7);
  assert.equal(result.failed, 2);
  assert.equal(result.statusCounts['429'], 1);
  assert.equal(result.passed, false);
  assert.ok(!JSON.stringify(result).includes('private transport failure'));
});
test('probe passes only a complete error-free run within its latency budget', async () => {
  const options = probeOptions({
    CAPACITY_BASE_URL: 'https://staging.example.test',
    CAPACITY_REQUESTS: '4',
  });
  const result = await runProbe(options, async () => new Response(null));
  assert.equal(result.completed, 4);
  assert.equal(result.passed, true);
});

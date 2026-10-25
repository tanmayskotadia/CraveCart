import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { randomUUID } from 'node:crypto';

export function probeOptions(env) {
  const url = new URL(env.CAPACITY_BASE_URL);
  const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  if (
    url.username ||
    url.password ||
    url.pathname !== '/' ||
    url.search ||
    url.hash ||
    !(url.protocol === 'https:' || (loopback && url.protocol === 'http:'))
  )
    throw new Error(
      'Use a controlled HTTPS origin, or HTTP loopback, without credentials or paths',
    );
  const path = env.CAPACITY_PATH ?? '/api/v1/platform';
  if (!['/api/v1/platform', '/health/ready'].includes(path))
    throw new Error('Only read-only readiness/platform probes are supported');
  const integer = (name, fallback, max) => {
    const value = Number(env[name] ?? fallback);
    if (!Number.isSafeInteger(value) || value < 1 || value > max)
      throw new Error(`Invalid ${name}`);
    return value;
  };
  return {
    url: new URL(path, url).href,
    count: integer('CAPACITY_REQUESTS', 100, 2000),
    concurrency: integer('CAPACITY_CONCURRENCY', 4, 16),
    p95BudgetMs: integer('CAPACITY_P95_MS', 1000, 30_000),
  };
}

export async function runProbe(options, fetcher = fetch) {
  const startedAt = new Date().toISOString(),
    start = performance.now();
  const deadline = AbortSignal.timeout(60_000);
  let claimed = 0,
    failed = 0;
  const latencies = [],
    statusCounts = {};
  await Promise.all(
    Array.from({ length: Math.min(options.concurrency, options.count) }, async () => {
      while (claimed < options.count && !deadline.aborted) {
        claimed++;
        const before = performance.now();
        try {
          const response = await fetcher(options.url, {
            method: 'GET',
            redirect: 'error',
            signal: AbortSignal.any([deadline, AbortSignal.timeout(5000)]),
            headers: { 'Cache-Control': 'no-cache' },
          });
          const status = String(response.status);
          statusCounts[status] = (statusCounts[status] ?? 0) + 1;
          // Probes measure response headers; never persist potentially sensitive response bodies.
          await response.body?.cancel();
          if (response.status !== 200) failed++;
        } catch {
          failed++;
          statusCounts.networkError = (statusCounts.networkError ?? 0) + 1;
        }
        latencies.push(performance.now() - before);
      }
    }),
  );
  latencies.sort((a, b) => a - b);
  const p95Ms = latencies[Math.max(0, Math.ceil(latencies.length * 0.95) - 1)] ?? null;
  return {
    kind: 'read-only-transport-probe',
    startedAt,
    finishedAt: new Date().toISOString(),
    ...options,
    completed: latencies.length,
    failed,
    statusCounts,
    elapsedMs: performance.now() - start,
    p95Ms,
    passed:
      latencies.length === options.count &&
      failed === 0 &&
      p95Ms !== null &&
      p95Ms <= options.p95BudgetMs,
    limitation:
      'Response-header latency only. Not authenticated checkout, sustained load, SLO, HA or provider qualification.',
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const result = await runProbe(probeOptions(process.env));
  await mkdir('.local/probes', { recursive: true });
  const path = `.local/probes/${randomUUID()}.json`;
  await writeFile(path, JSON.stringify(result, null, 2) + '\n');
  console.log(JSON.stringify({ ...result, evidence: path }, null, 2));
  if (!result.passed) process.exitCode = 1;
}

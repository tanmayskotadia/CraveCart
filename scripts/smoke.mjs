const requireReady = process.argv.includes('--ready');
for (const [index, service] of [
  'gateway',
  'auth',
  'restaurant',
  'rider',
  'admin',
  'realtime',
  'utils',
].entries()) {
  const base = `http://127.0.0.1:${4000 + index}`;
  const live = await fetch(`${base}/health/live`);
  if (!live.ok) throw new Error(`${service} is not live`);
  const ready = await fetch(`${base}/health/ready`);
  if (requireReady && !ready.ok) throw new Error(`${service} is not ready`);
  console.log(`${service}: live; dependencies ${ready.ok ? 'ready' : 'unavailable'}`);
}
const response = await fetch('http://127.0.0.1:4000/api/v1/platform');
const body = await response.json();
if (
  !response.ok ||
  body.data.market.scope !== 'national' ||
  body.data.market.country !== 'IN' ||
  typeof body.data.capabilities.ordering !== 'boolean' ||
  body.meta.requestId !== response.headers.get('x-request-id')
)
  throw new Error('Gateway platform contract failed');
console.log('Gateway → admin public contract and request correlation passed.');

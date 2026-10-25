const api = new URL(process.env.HOSTED_API_ORIGIN ?? ''),
  app = new URL(process.env.HOSTED_APP_ORIGIN ?? ''),
  realtime = new URL(process.env.HOSTED_REALTIME_ORIGIN ?? '');
for (const url of [api, app, realtime])
  if (
    url.protocol !== 'https:' ||
    url.username ||
    url.password ||
    /localhost|127\.0\.0\.1/.test(url.hostname)
  )
    throw new Error('Hosted checks require controlled HTTPS origins');
const endpoint = async (url) => {
  const response = await fetch(url, { signal: AbortSignal.timeout(20000), redirect: 'error' });
  if (!response.ok)
    throw new Error(`Hosted check failed: ${url.pathname}, HTTP ${response.status}`);
  return response;
};
await endpoint(new URL('/health/ready', api));
await endpoint(new URL('/health/ready', realtime));
await endpoint(app);
const r = await endpoint(new URL('/api/v1/payments/capabilities', app)),
  cap = (await r.json()).data;
if (
  cap.development ||
  !['test', 'live'].includes(cap.mode) ||
  !Array.isArray(cap.gateways) ||
  !cap.gateways.length
)
  throw new Error('Hosted checkout must use qualified gateway adapters');
const methods = await endpoint(new URL('/api/v1/auth/capabilities', app));
const contact = (await methods.json()).data;
if (contact.developmentDelivery || !Array.isArray(contact.methods) || !contact.methods.length)
  throw new Error('Hosted authentication requires a configured real contact adapter');
console.log(
  `Hosted readiness, frontend API proxy, real contact adapters and ${cap.mode} payment configuration passed. Complete multi-role provider/GPS/browser qualification separately.`,
);

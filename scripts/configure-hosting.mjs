import { writeFile } from 'node:fs/promises';
const values = Object.fromEntries(
  process.argv.slice(2).map((value) => {
    const i = value.indexOf('=');
    return [value.slice(0, i), value.slice(i + 1)];
  }),
);
function origin(name) {
  const url = new URL(values[name] ?? '');
  if (
    url.protocol !== 'https:' ||
    url.username ||
    url.password ||
    url.pathname !== '/' ||
    url.search ||
    url.hash ||
    /localhost|127\.0\.0\.1/.test(url.hostname)
  )
    throw new Error(`Provide a controlled HTTPS origin for ${name}`);
  return url.origin;
}
const api = origin('--api'),
  realtime = origin('--realtime'),
  app = origin('--app');
const config = {
  installCommand: 'npm ci --prefix ../..',
  buildCommand: 'npm run build --prefix ../..',
  outputDirectory: 'dist',
  rewrites: [
    { source: '/api/:path*', destination: `${api}/api/:path*` },
    { source: '/((?!api/|assets/|release\\.json$).*)', destination: '/index.html' },
  ],
  headers: [
    { source: '/release.json', headers: [{ key: 'Cache-Control', value: 'no-store' }] },
    {
      source: '/(.*)',
      headers: [
        { key: 'X-Content-Type-Options', value: 'nosniff' },
        { key: 'X-Frame-Options', value: 'DENY' },
        { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
        { key: 'Permissions-Policy', value: 'geolocation=(self), camera=(), microphone=()' },
      ],
    },
    { source: '/api/:path*', headers: [{ key: 'Cache-Control', value: 'private, no-store' }] },
  ],
};
await writeFile('apps/web/vercel.json', JSON.stringify(config, null, 2) + '\n');
console.log(
  `Vercel routes configured for ${app}. Set VITE_REALTIME_ORIGIN=${realtime}; leave VITE_API_ORIGIN unset for same-origin API cookies. Set APP_ORIGIN=${app} in Render. No secrets were written.`,
);

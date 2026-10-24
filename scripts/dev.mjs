import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

try {
  process.loadEnvFile('.env');
} catch {
  /* Optional for the web/API shell; readiness exposes missing infrastructure. */
}
const children = [];
let stopping = false;
function launch(args, env = {}, cwd = process.cwd()) {
  const child = spawn(process.execPath, args, {
    cwd,
    stdio: 'inherit',
    env: { ...process.env, ...env },
  });
  children.push(child);
  child.on('exit', (code) => {
    if (!stopping && code !== 0) stop(code ?? 1);
  });
}
function stop(code = 0) {
  stopping = true;
  for (const child of children) child.kill('SIGTERM');
  process.exitCode = code;
}
for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => stop());
const services = ['auth', 'restaurant', 'rider', 'admin', 'realtime', 'utils'];
if (!existsSync('packages/platform/dist/index.js')) {
  console.error('Run npm run build before npm run dev.');
  process.exit(1);
}
for (const [index, service] of services.entries())
  launch([resolve(`services/${service}/dist/index.js`)], {
    PORT: String(4001 + index),
    SERVICE_NAME: service,
  });
launch([resolve('apps/gateway/dist/index.js')], { PORT: '4000', SERVICE_NAME: 'gateway' });
launch(
  [resolve('node_modules/vite/bin/vite.js'), '--host', '127.0.0.1'],
  { PORT: '5173' },
  resolve('apps/web'),
);

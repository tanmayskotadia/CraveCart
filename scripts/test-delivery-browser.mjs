import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { resolve, sep } from 'node:path';
import { randomUUID } from 'node:crypto';
import { mkdir, realpath, rm } from 'node:fs/promises';
import { MongoClient } from 'mongodb';
import { MongoMemoryReplSet } from 'mongodb-memory-server-core';
const prefix = `cc_ui_${randomUUID().replaceAll('-', '')}`,
  root = resolve('.local', prefix),
  children = [];
await mkdir(root, { recursive: true });
process.env.MONGOMS_DOWNLOAD_DIR = resolve('.local/mongo-binaries');
let replica, mongo;
function launch(args, env, cwd = process.cwd(), inherit = false) {
  const child = spawn(process.execPath, args, {
    cwd,
    env: { ...process.env, ...env },
    stdio: inherit ? 'inherit' : ['ignore', 'ignore', 'pipe'],
  });
  if (!inherit)
    child.stderr.on('data', (data) => {
      const line = String(data);
      if (/Error|error/.test(line)) process.stderr.write(line.slice(0, 500));
    });
  children.push(child);
  return child;
}
const reserves = await Promise.all(
  Array.from({ length: 8 }, async () => {
    const server = createServer();
    await new Promise((r) => server.listen(0, '127.0.0.1', r));
    return server;
  }),
);
const ports = reserves.map((s) => s.address().port);
await Promise.all(reserves.map((s) => new Promise((r) => s.close(r))));
try {
  replica = await MongoMemoryReplSet.create({
    binary: { version: '8.0.17', checkMD5: true },
    replSet: { count: 1, storageEngine: 'wiredTiger' },
  });
  const uri = replica.getUri();
  mongo = new MongoClient(uri);
  await mongo.connect();
  const names = ['gateway', 'auth', 'restaurant', 'rider', 'admin', 'realtime', 'utils'],
    origin = `http://localhost:${ports[7]}`;
  const env = {
    NODE_ENV: 'test',
    LOG_LEVEL: 'silent',
    HOST: '127.0.0.1',
    APP_ORIGIN: origin,
    MONGO_URI: uri,
    MONGO_DB_PREFIX: prefix,
    DEV_ADAPTERS: 'true',
    COMMERCE_MODE: 'development',
    RABBITMQ_URL: 'amqp://127.0.0.1:1',
    REDIS_URL: 'redis://127.0.0.1:1',
    UPLOAD_DIRECTORY: resolve(root, 'uploads'),
    UPLOAD_SCAN_MODE: 'development',
    SMTP_URL: '',
    SMTP_FROM: '',
    TWILIO_ACCOUNT_SID: '',
    TWILIO_AUTH_TOKEN: '',
    TWILIO_FROM_NUMBER: '',
    WEB_PUSH_PUBLIC_KEY: '',
    WEB_PUSH_PRIVATE_KEY: '',
    WEB_PUSH_SUBJECT: '',
    RAZORPAY_KEY_ID: '',
    RAZORPAY_KEY_SECRET: '',
    STRIPE_SECRET_KEY: '',
  };
  for (let i = 1; i < names.length; i++)
    env[`${names[i].toUpperCase()}_URL`] = `http://127.0.0.1:${ports[i]}`;
  for (let i = 0; i < names.length; i++)
    launch([resolve(`${i === 0 ? 'apps/gateway' : 'services/' + names[i]}/dist/index.js`)], {
      ...env,
      PORT: String(ports[i]),
      SERVICE_NAME: names[i],
    });
  const frontendEnv = {
    ...env,
    NODE_ENV: 'production',
    DEV_GATEWAY_ORIGIN: env.GATEWAY_URL ?? `http://127.0.0.1:${ports[0]}`,
    VITE_REALTIME_ORIGIN: `http://localhost:${ports[5]}`,
    VITE_API_ORIGIN: '',
  };
  const webDist = resolve(root, 'webdist');
  const frontendBuild = launch(
    [resolve('node_modules/vite/bin/vite.js'), 'build', '--outDir', webDist],
    frontendEnv,
    resolve('apps/web'),
  );
  const built = await new Promise((done) => frontendBuild.once('exit', done));
  children.splice(children.indexOf(frontendBuild), 1);
  if (built !== 0) throw new Error('Isolated production frontend build failed');
  launch(
    [
      resolve('node_modules/vite/bin/vite.js'),
      'preview',
      '--outDir',
      webDist,
      '--host',
      '127.0.0.1',
      '--port',
      String(ports[7]),
    ],
    frontendEnv,
    resolve('apps/web'),
  );
  for (const port of ports) {
    let up = false;
    for (let n = 0; n < 60; n++) {
      if (children.some((c) => c.exitCode !== null)) throw new Error('A test server stopped');
      try {
        const response = await fetch(
          `http://127.0.0.1:${port}${port === ports[7] ? '/' : '/health/live'}`,
          { signal: AbortSignal.timeout(1000) },
        );
        if (response.ok) {
          up = true;
          break;
        }
      } catch {
        /* Wait only for this isolated test listener. */
      }
      await new Promise((r) => setTimeout(r, 500));
    }
    if (!up) throw new Error('Test server did not start');
  }
  const test = launch(
    [
      resolve('node_modules/@playwright/test/cli.js'),
      'test',
      '--config',
      'playwright.delivery.config.ts',
    ],
    {
      ...env,
      BROWSER_BASE_URL: origin,
      IDENTITY_TEST_MONGO_URI: uri,
      BROWSER_DB_PREFIX: prefix,
      BROWSER_UPLOAD_DIRECTORY: env.UPLOAD_DIRECTORY,
    },
    process.cwd(),
    true,
  );
  process.exitCode = await new Promise((r) => test.once('exit', (code) => r(code ?? 1)));
} finally {
  for (const child of children) if (child.exitCode === null) child.kill();
  await Promise.all(
    children
      .filter((c) => c.exitCode === null)
      .map(
        (c) =>
          new Promise((r) => {
            c.once('exit', r);
            setTimeout(r, 5000).unref();
          }),
      ),
  );
  if (mongo) {
    for (const name of ['gateway', 'auth', 'restaurant', 'rider', 'admin', 'realtime', 'utils'])
      await mongo.db(`${prefix}_${name}`).dropDatabase();
    await mongo.close();
  }
  await replica?.stop();
  const target = await realpath(root),
    parent = await realpath(resolve('.local'));
  if (target.startsWith(parent + sep) && target.endsWith(prefix)) {
    await rm(target, { recursive: true, force: true });
  } else {
    console.error('Unsafe temporary-test cleanup path; cleanup refused.');
    process.exitCode = 1;
  }
}

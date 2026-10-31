import { beforeAll, beforeEach, afterAll, it, expect } from 'vitest';
import { randomBytes, randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import request from 'supertest';
import { MongoMemoryReplSet } from 'mongodb-memory-server-core';
import { MongoClient, type Db } from 'mongodb';
import { loadConfig, type Config } from '@cravecart/config';
import { createApp } from '@cravecart/platform';
import { ensurePersistence } from '@cravecart/persistence';
import { installAuth, adminPermissions } from '../../services/auth/src/router.js';
import { hashAdminPassword, verifyAdminPassword } from '../../services/auth/src/admin-password.js';
import { totp } from '../../services/auth/src/totp.js';

const loginId = `admin-${randomUUID()}@example.test`,
  password = randomBytes(24).toString('base64url');
const userId = randomUUID();
let replica: MongoMemoryReplSet, client: MongoClient, db: Db, config: Config;
let app: ReturnType<typeof createApp>;
const closers: Array<() => Promise<void>> = [];
const login = (body = { loginId, password }, origin = 'http://localhost:5173') =>
  request(app).post('/api/v1/auth/admin/password').set('Origin', origin).send(body);
beforeAll(async () => {
  process.env.MONGOMS_DOWNLOAD_DIR = resolve('.local/mongo-binaries');
  replica = await MongoMemoryReplSet.create({
    binary: { version: '8.0.17', checkMD5: true },
    replSet: { count: 1, storageEngine: 'wiredTiger' },
  });
  client = new MongoClient(replica.getUri());
  await client.connect();
  db = client.db(`admin_password_${randomUUID().replaceAll('-', '')}`);
  await ensurePersistence(db);
  config = loadConfig({
    NODE_ENV: 'test',
    SERVICE_NAME: 'auth',
    ADMIN_LOGIN_ID: loginId,
    ADMIN_PASSWORD_HASH: await hashAdminPassword(password),
  });
  app = createApp({
    name: 'auth',
    config,
    resources: { check: async () => ({ mongo: true }), close: async () => {} },
    configure: (target) =>
      installAuth(target, { config, client, db, onClose: (fn) => closers.push(fn) }),
  });
  await db.collection('users').insertOne({
    _id: userId as never,
    contact: loginId,
    name: 'Synthetic admin',
    roles: ['customer', 'admin'],
    permissions: adminPermissions,
    status: 'ACTIVE',
    createdAt: new Date(),
  });
});
beforeEach(async () => {
  await db.collection('auth_limits').deleteMany({});
  await db
    .collection('users')
    .updateOne(
      { _id: userId as never },
      { $set: { roles: ['customer', 'admin'], status: 'ACTIVE' } },
    );
});
afterAll(async () => {
  for (const close of closers) await close();
  await db?.dropDatabase();
  await client?.close();
  await replica?.stop();
});
it('uses independent salts and rejects incorrect and malformed password hashes', async () => {
  const other = await hashAdminPassword(password);
  expect(other).not.toBe(config.ADMIN_PASSWORD_HASH);
  expect(other).not.toContain(password);
  expect(await verifyAdminPassword(password, other)).toBe(true);
  expect(await verifyAdminPassword('wrong-password', other)).toBe(false);
  expect(await verifyAdminPassword(password, 'malformed')).toBe(false);
});
it('rejects bad credentials, suspended accounts and accounts without admin membership', async () => {
  for (const input of [
    { loginId, password: 'incorrect' },
    { loginId: 'unknown@example.test', password },
  ]) {
    const response = await login(input);
    expect(response.status).toBe(401);
    expect(response.headers['set-cookie']).toBeUndefined();
  }
  await db
    .collection('users')
    .updateOne({ _id: userId as never }, { $set: { roles: ['customer'] } });
  expect((await login()).status).toBe(401);
  await db
    .collection('users')
    .updateOne({ _id: userId as never }, { $set: { roles: ['admin'], status: 'SUSPENDED' } });
  expect((await login()).status).toBe(401);
  expect(await db.collection('sessions').countDocuments()).toBe(0);
});
it('requires origin and bounds repeated password guesses', async () => {
  expect((await login(undefined, 'https://untrusted.example')).status).toBe(403);
  for (let i = 0; i < 8; i++)
    expect((await login({ loginId, password: 'incorrect' })).status).toBe(401);
  expect((await login()).status).toBe(429);
});
it('creates an admin session only after completing the existing authenticator flow', async () => {
  const first = await login();
  expect(first.status).toBe(200);
  expect(first.body.data.enrollmentRequired).toBe(true);
  expect(first.headers['set-cookie']).toBeUndefined();
  expect(await db.collection('sessions').countDocuments()).toBe(0);
  const mfaChallengeId = first.body.data.mfaChallengeId;
  const enrolled = await request(app)
    .post('/api/v1/auth/mfa/enroll')
    .set('Origin', 'http://localhost:5173')
    .send({ mfaChallengeId });
  expect(enrolled.status).toBe(200);
  const result = await request(app)
    .post('/api/v1/auth/mfa/verify')
    .set('Origin', 'http://localhost:5173')
    .send({ mfaChallengeId, code: totp(enrolled.body.data.secret) });
  expect(result.status).toBe(200);
  expect(result.body.data.principal.workspace).toBe('admin');
  expect(result.body.data.principal.mfaEnabled).toBe(true);
  expect(result.headers['set-cookie']).toBeDefined();
  expect(result.body.data.recoveryCodes).toHaveLength(8);
});
it('requires both private settings and advertises no password login when disabled', async () => {
  expect(() => loadConfig({ ADMIN_LOGIN_ID: loginId })).toThrow('both');
  const originalId = config.ADMIN_LOGIN_ID,
    originalHash = config.ADMIN_PASSWORD_HASH;
  try {
    config.ADMIN_LOGIN_ID = '';
    config.ADMIN_PASSWORD_HASH = '';
    expect(
      (await request(app).get('/api/v1/auth/capabilities')).body.data.adminPasswordEnabled,
    ).toBe(false);
    expect((await login()).status).toBe(401);
  } finally {
    config.ADMIN_LOGIN_ID = originalId;
    config.ADMIN_PASSWORD_HASH = originalHash;
  }
});

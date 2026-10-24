import { beforeAll, afterAll, describe, it, expect } from 'vitest';
import { randomUUID } from 'node:crypto';
import { resolve, sep } from 'node:path';
import { rm, mkdir } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { Ajv2020 } from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import request from 'supertest';
import sharp from 'sharp';
import { MongoMemoryReplSet } from 'mongodb-memory-server-core';
import { MongoClient, type Db } from 'mongodb';
import type { Express } from 'express';
import type {
  SessionResponse,
  RestaurantInput,
  MenuItemInput,
  CartLineInput,
  Cart,
} from '@cravecart/contracts';
import { loadConfig } from '@cravecart/config';
import { createApp, type DomainContext } from '@cravecart/platform';
import { ensurePersistence } from '@cravecart/persistence';
import { installAuth, adminPermissions } from '../../services/auth/src/router.js';
import { totp, encodeBase32 } from '../../services/auth/src/totp.js';
import { installApplications as installSeller } from '../../services/restaurant/src/applications.js';
import { installApplications as installRider } from '../../services/rider/src/applications.js';
import { installVerifications } from '../../services/admin/src/verifications.js';
import { installUploads } from '../../services/utils/src/uploads.js';
import { installCatalog } from '../../services/restaurant/src/catalog.js';
import { installZones } from '../../services/admin/src/zones.js';
import { installAddresses } from '../../services/auth/src/addresses.js';

const ajv = new Ajv2020({ strict: false, allErrors: true });
addFormats.default(ajv);
const exported = {
  ...JSON.parse(readFileSync('contracts/identity.openapi.json', 'utf8')),
  ...JSON.parse(readFileSync('contracts/catalog.openapi.json', 'utf8')),
} as Record<
  string,
  Record<string, { responses: Record<string, { content: Record<string, { schema: object }> }> }>
>;
const responseContracts = Object.entries(exported).flatMap(([path, methods]) =>
  Object.entries(methods).map(([method, operation]) => ({
    method,
    path: new RegExp(`^${path.replace(/\{[^}]+\}/g, '[^/]+')}$`),
    responses: Object.fromEntries(
      Object.entries(operation.responses)
        .filter(([, response]) => Boolean(response.content['application/json']))
        .map(([status, response]) => [
          status,
          ajv.compile(response.content['application/json']!.schema),
        ]),
    ),
  })),
);

const prefix = `cci_test_${randomUUID().replaceAll('-', '').slice(0, 20)}`;
const uploadDirectory = resolve('.local', prefix, 'uploads');
const apps: Record<string, Express> = {};
const databases: Record<string, Db> = {};
const closers: Array<() => Promise<void>> = [];
let repl: MongoMemoryReplSet | undefined, client: MongoClient;
let failNextRoleGrant = false;
interface Actor {
  cookies: Map<string, string>;
  csrf: string;
  data: SessionResponse;
}
// JSON fixtures intentionally exercise the public HTTP response contracts.
async function call(
  owner: string,
  method: string,
  path: string,
  actor?: Actor,
  body?: object | string,
  headers: Record<string, string> = {},
) {
  const agent = request(apps[owner]!);
  const action = (agent as unknown as Record<string, (path: string) => request.Test>)[method]!(
    path,
  );
  action.set('Origin', 'http://localhost:5173');
  if (actor) {
    action.set('Cookie', [...actor.cookies].map(([k, v]) => `${k}=${v}`).join('; '));
    action.set('X-CSRF-Token', actor.csrf);
  }
  for (const [key, value] of Object.entries(headers)) action.set(key, value);
  if (body !== undefined) action.send(body);
  const response = await action;
  const contract = responseContracts.find(
    (contract) =>
      contract.method === method && contract.path.test(path.replace('/api/v1', '').split('?')[0]!),
  );
  if (contract) {
    const validate =
      contract.responses[String(response.status)] ??
      (response.status >= 400 ? contract.responses.default : undefined);
    if (validate)
      expect(
        validate(response.body),
        JSON.stringify({ path, status: response.status, errors: validate.errors }),
      ).toBe(true);
  }
  if (actor)
    for (const value of response.headers['set-cookie'] ?? []) {
      const pair = value.split(';')[0]!,
        index = pair.indexOf('=');
      if (pair.slice(index + 1)) actor.cookies.set(pair.slice(0, index), pair.slice(index + 1));
      else actor.cookies.delete(pair.slice(0, index));
    }
  return response;
}
const actor = (): Actor => ({ cookies: new Map(), csrf: '', data: {} as SessionResponse });
function accept(value: Actor, response: request.Response) {
  expect(response.status, JSON.stringify(response.body)).toBe(200);
  value.data = response.body.data;
  value.csrf = value.data.csrfToken;
  return value;
}
const contact = () => `person-${randomUUID()}@example.test`;
async function register(workspace = 'customer') {
  const value = actor();
  const response = await call('auth', 'post', '/api/v1/auth/register', value, {
    contact: contact(),
    name: 'Test Person',
    workspace,
  });
  expect(response.status, JSON.stringify(response.body)).toBe(202);
  const verified = await call('auth', 'post', '/api/v1/auth/otp/verify', value, {
    challengeId: response.body.data.challengeId,
    code: response.body.data.developmentCode,
  });
  return accept(value, verified);
}
async function administrator() {
  const value = actor(),
    email = contact(),
    id = randomUUID();
  await databases.auth!.collection('users').insertOne({
    _id: id as never,
    contact: email,
    name: 'Test Verifier',
    roles: ['customer', 'admin'],
    permissions: adminPermissions,
    status: 'ACTIVE',
    createdAt: new Date(),
  });
  const otp = await call('auth', 'post', '/api/v1/auth/login', value, {
    contact: email,
    workspace: 'admin',
  });
  const first = await call('auth', 'post', '/api/v1/auth/otp/verify', value, {
    challengeId: otp.body.data.challengeId,
    code: otp.body.data.developmentCode,
  });
  expect(first.body.data.enrollmentRequired).toBe(true);
  const challenge = first.body.data.mfaChallengeId;
  const enrollment = await call('auth', 'post', '/api/v1/auth/mfa/enroll', value, {
    mfaChallengeId: challenge,
  });
  expect(enrollment.status).toBe(200);
  const result = await call('auth', 'post', '/api/v1/auth/mfa/verify', value, {
    mfaChallengeId: challenge,
    code: totp(enrollment.body.data.secret),
  });
  accept(value, result);
  return {
    value,
    secret: enrollment.body.data.secret as string,
    recoveryCodes: result.body.data.recoveryCodes as string[],
  };
}
async function upload(value: Actor, kind: 'seller' | 'rider' = 'seller') {
  const bytes = await sharp({ create: { width: 10, height: 10, channels: 3, background: '#fff' } })
    .png()
    .toBuffer();
  const intent = await call('utils', 'post', '/api/v1/uploads/intents', value, {
    filename: 'proof.png',
    size: bytes.length,
    purpose: `${kind}-verification`,
  });
  expect(intent.status, JSON.stringify(intent.body)).toBe(201);
  const content = await call('utils', 'put', intent.body.data.url, value, bytes, {
    'Content-Type': 'application/octet-stream',
    'X-Upload-Token': intent.body.data.uploadToken,
  });
  expect(content.status, JSON.stringify(content.body)).toBe(201);
  const complete = await call(
    'utils',
    'post',
    `/api/v1/uploads/${intent.body.data.uploadId}/complete`,
    value,
    {},
  );
  expect(complete.body.data.status, JSON.stringify(complete.body)).toBe('DEVELOPMENT_REVIEWABLE');
  return intent.body.data.uploadId as string;
}
async function application(value: Actor, kind: 'seller' | 'rider' = 'seller') {
  const document = await upload(value, kind);
  const owner = kind === 'seller' ? 'restaurant' : 'rider';
  const base = kind === 'seller' ? '/api/v1/seller/applications' : '/api/v1/rider/application';
  const created = await call(owner, 'post', base, value, {
    profile: {
      fullName: 'Test Person',
      city: 'chennai',
      address: '123 Example Street, Chennai',
      pincode: '600001',
      ...(kind === 'seller' ? { businessName: 'Example Kitchen' } : { vehicleType: 'bicycle' }),
    },
    documentIds: [document],
  });
  expect(created.status, JSON.stringify(created.body)).toBe(201);
  const submitted = await call(
    owner,
    'post',
    `${base}/${created.body.data.id}/submit`,
    value,
    { expectedVersion: 1 },
    { 'Idempotency-Key': randomUUID() },
  );
  expect(submitted.status, JSON.stringify(submitted.body)).toBe(200);
  return submitted.body.data;
}
beforeAll(async () => {
  await mkdir(uploadDirectory, { recursive: true });
  if (process.env.IDENTITY_TEST_MONGO_URI)
    client = new MongoClient(process.env.IDENTITY_TEST_MONGO_URI);
  else {
    process.env.MONGOMS_DOWNLOAD_DIR = resolve('.local/mongo-binaries');
    repl = await MongoMemoryReplSet.create({
      binary: { version: '8.0.17', checkMD5: true },
      replSet: { count: 1, storageEngine: 'wiredTiger' },
    });
    client = new MongoClient(repl.getUri());
  }
  await client.connect();
  const ports: Record<string, string> = {
    auth: '4001',
    restaurant: '4002',
    rider: '4003',
    admin: '4004',
    utils: '4006',
  };
  const fetcher: typeof fetch = async (input, init) => {
    const url = new URL(String(input));
    if (url.pathname === '/internal/v1/roles/apply' && failNextRoleGrant) {
      failNextRoleGrant = false;
      throw new Error('Injected auth outage');
    }
    const owner = Object.keys(ports).find((key) => ports[key] === url.port);
    if (!owner) throw new Error('Unexpected internal destination');
    const method = (init?.method ?? 'GET').toLowerCase();
    const req = (
      request(apps[owner]!) as unknown as Record<string, (path: string) => request.Test>
    )[method]!(url.pathname + url.search);
    for (const [key, value] of Object.entries(init?.headers ?? {})) req.set(key, String(value));
    if (init?.body) req.send(JSON.parse(String(init.body)));
    const response = await req;
    const headers = new Headers();
    for (const [key, value] of Object.entries(response.headers))
      if (key !== 'set-cookie' && typeof value === 'string') headers.set(key, value);
    return new Response(
      Buffer.isBuffer(response.body)
        ? new Uint8Array(response.body).buffer
        : JSON.stringify(response.body),
      { status: response.status, headers },
    );
  };
  for (const [name, install] of Object.entries({
    auth: installAuth,
    restaurant: installSeller,
    rider: installRider,
    admin: installVerifications,
    utils: installUploads,
  })) {
    const db = client.db(`${prefix}_${name}`);
    databases[name] = db;
    await ensurePersistence(db);
    const config = loadConfig({
      NODE_ENV: 'test',
      SERVICE_NAME: name,
      UPLOAD_DIRECTORY: uploadDirectory,
    });
    const ctx: DomainContext = { config, db, client, fetcher, onClose: (fn) => closers.push(fn) };
    apps[name] = createApp({
      name: name as 'auth',
      config,
      resources: { check: async () => ({ mongo: true }), close: async () => {} },
      configure: (app) => {
        if (name === 'restaurant') installCatalog(app, ctx);
        install(app, ctx);
        if (name === 'auth') installAddresses(app, ctx);
        if (name === 'admin') installZones(app, ctx);
      },
    });
  }
});
afterAll(async () => {
  for (const close of closers) await close();
  for (const db of Object.values(databases)) await db.dropDatabase();
  await client?.close();
  await repl?.stop();
  const target = resolve('.local', prefix);
  if (!target.startsWith(resolve('.local') + sep))
    throw new Error('Invalid test cleanup directory');
  await rm(target, { recursive: true, force: true });
});
describe('verified identity and revocable sessions', () => {
  it('consumes a verified OTP only once under simultaneous requests', async () => {
    const response = await call('auth', 'post', '/api/v1/auth/register', undefined, {
      contact: contact(),
      name: 'Concurrent Person',
    });
    const input = {
      challengeId: response.body.data.challengeId,
      code: response.body.data.developmentCode,
    };
    const results = await Promise.all([
      call('auth', 'post', '/api/v1/auth/otp/verify', actor(), input),
      call('auth', 'post', '/api/v1/auth/otp/verify', actor(), input),
    ]);
    expect(results.map((result) => result.status).sort()).toEqual([200, 401]);
  });
  it('rejects expired OTPs even before TTL cleanup runs', async () => {
    const email = contact();
    const response = await call('auth', 'post', '/api/v1/auth/register', undefined, {
      contact: email,
      name: 'Expired Person',
    });
    await databases
      .auth!.collection('challenges')
      .updateMany({ contact: email }, { $set: { expiresAt: new Date(0) } });
    expect(
      (
        await call('auth', 'post', '/api/v1/auth/otp/verify', undefined, {
          challengeId: response.body.data.challengeId,
          code: response.body.data.developmentCode,
        })
      ).status,
    ).toBe(401);
  });
  it('denies admin reads until MFA enrollment is verified, including customer workspace sessions', async () => {
    const user = await register();
    await databases
      .auth!.collection('users')
      .updateOne(
        { _id: user.data.principal.userId as never },
        { $set: { roles: ['customer', 'admin'], permissions: adminPermissions } },
      );
    const response = await call('admin', 'get', '/api/v1/admin/verifications', user);
    expect(response.status).toBe(403);
    expect(response.body.error.code).toBe('MFA_REQUIRED');
  });
  it('binds contact-change proof to its owner and revokes other sessions', async () => {
    const owner = await register(),
      other = await register(),
      email = contact();
    const request = await call('auth', 'post', '/api/v1/auth/contact-changes', owner, {
      contact: email,
    });
    const path = `/api/v1/auth/contact-changes/${request.body.data.challengeId}/confirm`;
    expect(
      (await call('auth', 'post', path, other, { code: request.body.data.developmentCode })).status,
    ).toBe(404);
    expect(
      (await call('auth', 'post', path, owner, { code: request.body.data.developmentCode })).status,
    ).toBe(200);
    expect((await call('auth', 'get', '/api/v1/auth/me', owner)).body.data.principal.contact).toBe(
      email,
    );
  });
  it('recovers approval after auth fails between the owner decision and role activation', async () => {
    const user = await register('seller'),
      admin = await administrator(),
      app = await application(user);
    failNextRoleGrant = true;
    const decision = await call(
      'admin',
      'post',
      `/api/v1/admin/verifications/${app.id}/decision`,
      admin.value,
      {
        expectedVersion: app.version,
        decision: 'approved',
        reason: 'Verified documents with outage recovery',
      },
      { 'Idempotency-Key': randomUUID() },
    );
    expect(decision.status).toBe(202);
    expect(decision.body.data.state).toBe('PENDING');
    expect(
      (await call('auth', 'get', '/api/v1/auth/me', user)).body.data.principal.roles,
    ).not.toContain('seller');
    const recovered = await call(
      'admin',
      'post',
      `/api/v1/admin/operations/${decision.body.data.operationId}/retry`,
      admin.value,
      {},
    );
    expect(recovered.body.data.state, JSON.stringify(recovered.body)).toBe('APPLIED');
    expect(
      (await call('auth', 'get', '/api/v1/auth/me', user)).body.data.principal.roles,
    ).toContain('seller');
  });
  it('registers only a customer even when starting a seller application', async () => {
    const user = await register('seller');
    expect(user.data.principal.roles).toEqual(['customer']);
    expect(user.data.principal.workspace).toBe('customer');
    expect((await call('restaurant', 'get', '/api/v1/seller/restaurants', user)).status).toBe(403);
  });
  it('forbids public admin signup and client-supplied grants', async () => {
    expect(
      (
        await call('auth', 'post', '/api/v1/auth/register', undefined, {
          contact: contact(),
          name: 'Attacker',
          workspace: 'admin',
        })
      ).status,
    ).toBe(403);
    expect(
      (
        await call('auth', 'post', '/api/v1/auth/register', undefined, {
          contact: contact(),
          name: 'Attacker',
          roles: ['admin'],
        })
      ).status,
    ).toBe(400);
  });
  it('limits OTP guesses and rejects replay and cooldown bypass', async () => {
    const value = actor(),
      body = { contact: contact(), name: 'OTP User', workspace: 'customer' };
    const challenge = await call('auth', 'post', '/api/v1/auth/register', value, body);
    expect((await call('auth', 'post', '/api/v1/auth/register', value, body)).status).toBe(429);
    for (let i = 0; i < 5; i++)
      expect(
        (
          await call('auth', 'post', '/api/v1/auth/otp/verify', value, {
            challengeId: challenge.body.data.challengeId,
            code: '000000',
          })
        ).status,
      ).toBe(401);
    expect(
      (
        await call('auth', 'post', '/api/v1/auth/otp/verify', value, {
          challengeId: challenge.body.data.challengeId,
          code: challenge.body.data.developmentCode,
        })
      ).status,
    ).toBe(401);
  });
  it('rejects login CSRF and cookie mutations without session CSRF proof', async () => {
    const denied = await request(apps.auth!)
      .post('/api/v1/auth/login')
      .set('Origin', 'https://attacker.example')
      .send({ contact: contact() });
    expect(denied.status).toBe(403);
    const user = await register();
    const changed = await call(
      'auth',
      'patch',
      '/api/v1/auth/me',
      { ...user, csrf: 'wrong' },
      { name: 'Not Allowed' },
    );
    expect(changed.status).toBe(403);
  });
  it('rotates refresh tokens and revokes the family when an old refresh is replayed', async () => {
    const user = await register();
    const original = new Map(user.cookies);
    expect((await call('auth', 'post', '/api/v1/auth/refresh', user, {})).status).toBe(200);
    expect(
      (await call('auth', 'post', '/api/v1/auth/refresh', { ...user, cookies: original }, {}))
        .status,
    ).toBe(401);
    expect((await call('auth', 'get', '/api/v1/auth/me', user)).status).toBe(401);
  });
  it('revokes logout immediately and conceals another user session', async () => {
    const a = await register(),
      b = await register();
    expect(
      (await call('auth', 'delete', `/api/v1/auth/sessions/${b.data.principal.sessionId}`, a))
        .status,
    ).toBe(404);
    expect((await call('auth', 'post', '/api/v1/auth/logout', a, {})).status).toBe(200);
    expect((await call('auth', 'get', '/api/v1/auth/me', a)).status).toBe(401);
  });
  it('normalizes contacts and never stores plaintext credentials', async () => {
    const user = await register();
    const session = await databases
      .auth!.collection('sessions')
      .findOne({ userId: user.data.principal.userId });
    expect(session).not.toHaveProperty('accessToken');
    expect(session).not.toHaveProperty('refreshToken');
    expect(session?.accessHash).toHaveLength(64);
    const record = await databases
      .auth!.collection('challenges')
      .findOne({ contact: user.data.principal.contact });
    expect(record).not.toHaveProperty('code');
    expect(record?.codeHash).toHaveLength(64);
  });
});
describe('authenticator and privileged verification', () => {
  it('matches the RFC 6238 SHA-1 vector', () => {
    expect(totp(encodeBase32(Buffer.from('12345678901234567890')), 59000, 8)).toBe('94287082');
  });
  it('requires admin enrollment and rejects reuse of TOTP and recovery codes', async () => {
    const { value, secret, recoveryCodes } = await administrator();
    expect(value.data.principal.mfaEnabled).toBe(true);
    const challenge = await call('auth', 'post', '/api/v1/auth/mfa/challenge', value, {});
    expect(
      (
        await call('auth', 'post', '/api/v1/auth/mfa/verify', value, {
          mfaChallengeId: challenge.body.data.mfaChallengeId,
          code: totp(secret),
        })
      ).status,
    ).toBe(401);
    expect(
      (
        await call('auth', 'post', '/api/v1/auth/mfa/verify', value, {
          mfaChallengeId: challenge.body.data.mfaChallengeId,
          code: recoveryCodes[0],
        })
      ).status,
    ).toBe(200);
    const second = await call('auth', 'post', '/api/v1/auth/mfa/challenge', value, {});
    expect(
      (
        await call('auth', 'post', '/api/v1/auth/mfa/verify', value, {
          mfaChallengeId: second.body.data.mfaChallengeId,
          code: recoveryCodes[0],
        })
      ).status,
    ).toBe(401);
  });
  it('denies customer admin access and forged internal requests', async () => {
    const user = await register();
    expect((await call('admin', 'get', '/api/v1/admin/verifications', user)).status).toBe(403);
    expect(
      (
        await call('auth', 'post', '/internal/v1/roles/apply', undefined, {
          userId: user.data.principal.userId,
          role: 'admin',
        })
      ).status,
    ).toBe(403);
  });
  it('encrypts, quarantines, scans and owner-scopes document access', async () => {
    const a = await register(),
      b = await register();
    const id = await upload(a);
    expect((await call('utils', 'get', `/api/v1/uploads/${id}/access`, b)).status).toBe(403);
    const record = await databases.utils!.collection('uploads').findOne({ _id: id as never });
    expect(record?.status).toBe('DEVELOPMENT_REVIEWABLE');
    expect(record?.tokenHash).toHaveLength(64);
  });
  it('rejects HTML disguised as a verification document', async () => {
    const user = await register();
    const bytes = Buffer.from('<html><script>alert(1)</script></html>');
    const intent = await call('utils', 'post', '/api/v1/uploads/intents', user, {
      filename: 'proof.png',
      size: bytes.length,
      purpose: 'seller-verification',
    });
    expect(
      (
        await call('utils', 'put', intent.body.data.url, user, bytes, {
          'Content-Type': 'application/octet-stream',
          'X-Upload-Token': intent.body.data.uploadToken,
        })
      ).status,
    ).toBe(422);
  });
  it('grants seller access only after a reasoned, MFA-backed approval', async () => {
    const user = await register('seller'),
      admin = await administrator();
    const app = await application(user);
    expect(
      (await call('admin', 'get', '/api/v1/admin/verifications', admin.value)).body.data.some(
        (record: { application: { id: string } }) => record.application.id === app.id,
      ),
    ).toBe(true);
    const key = randomUUID();
    const response = await call(
      'admin',
      'post',
      `/api/v1/admin/verifications/${app.id}/decision`,
      admin.value,
      {
        expectedVersion: app.version,
        decision: 'approved',
        reason: 'Documents and profile verified',
      },
      { 'Idempotency-Key': key },
    );
    expect(response.status, JSON.stringify(response.body)).toBe(202);
    expect(response.body.data.state, JSON.stringify(response.body)).toBe('APPLIED');
    expect(
      (await call('auth', 'get', '/api/v1/auth/me', user)).body.data.principal.roles,
    ).toContain('seller');
    expect(
      (await call('restaurant', 'get', '/api/v1/seller/restaurants', user)).body.data,
    ).toHaveLength(1);
    const duplicate = await call(
      'admin',
      'post',
      `/api/v1/admin/verifications/${app.id}/decision`,
      admin.value,
      {
        expectedVersion: app.version,
        decision: 'approved',
        reason: 'Documents and profile verified',
      },
      { 'Idempotency-Key': key },
    );
    expect(duplicate.body.data.operationId).toBe(response.body.data.operationId);
  });
  it('supports changes requested, editing, resubmission and rider approval', async () => {
    const user = await register('rider'),
      admin = await administrator();
    const app = await application(user, 'rider');
    const decision = await call(
      'admin',
      'post',
      `/api/v1/admin/verifications/${app.id}/decision`,
      admin.value,
      {
        expectedVersion: app.version,
        decision: 'changes-requested',
        reason: 'Please clarify the delivery address',
      },
      { 'Idempotency-Key': randomUUID() },
    );
    expect(decision.body.data.state, JSON.stringify(decision.body)).toBe('APPLIED');
    const records = await call('rider', 'get', '/api/v1/rider/application', user);
    const changed = records.body.data[0];
    const edited = await call('rider', 'patch', `/api/v1/rider/application/${app.id}`, user, {
      expectedVersion: changed.version,
      profile: { ...changed.profile, address: '456 Updated Example Street, Chennai' },
      documentIds: changed.documentIds,
    });
    expect(edited.status).toBe(200);
    const submitted = await call(
      'rider',
      'post',
      `/api/v1/rider/application/${app.id}/submit`,
      user,
      { expectedVersion: edited.body.data.version },
      { 'Idempotency-Key': randomUUID() },
    );
    const approved = await call(
      'admin',
      'post',
      `/api/v1/admin/verifications/${app.id}/decision`,
      admin.value,
      {
        expectedVersion: submitted.body.data.version,
        decision: 'approved',
        reason: 'Updated details have been verified',
      },
      { 'Idempotency-Key': randomUUID() },
    );
    expect(approved.body.data.state, JSON.stringify(approved.body)).toBe('APPLIED');
    expect((await call('rider', 'get', '/api/v1/rider/profile', user)).status).toBe(200);
  });
  it('denies object substitution, self-approval and stale MFA', async () => {
    const user = await register(),
      other = await register(),
      admin = await administrator();
    const app = await application(user);
    expect(
      (
        await call('restaurant', 'patch', `/api/v1/seller/applications/${app.id}`, other, {
          expectedVersion: app.version,
          profile: app.profile,
          documentIds: app.documentIds,
        })
      ).status,
    ).toBe(404);
    const self = await application(admin.value);
    expect(
      (
        await call(
          'admin',
          'post',
          `/api/v1/admin/verifications/${self.id}/decision`,
          admin.value,
          {
            expectedVersion: self.version,
            decision: 'approved',
            reason: 'Attempting self approval',
          },
          { 'Idempotency-Key': randomUUID() },
        )
      ).status,
    ).toBe(403);
    await databases
      .auth!.collection('sessions')
      .updateOne(
        { _id: admin.value.data.principal.sessionId as never },
        { $set: { mfaVerifiedAt: new Date(Date.now() - 360_000) } },
      );
    expect(
      (
        await call(
          'admin',
          'post',
          `/api/v1/admin/verifications/${app.id}/decision`,
          admin.value,
          {
            expectedVersion: app.version,
            decision: 'approved',
            reason: 'Trying stale authentication',
          },
          { 'Idempotency-Key': randomUUID() },
        )
      ).status,
    ).toBe(403);
  });
  it('suspends an account and invalidates its existing session immediately', async () => {
    const user = await register(),
      admin = await administrator();
    const response = await call(
      'admin',
      'post',
      `/api/v1/admin/users/${user.data.principal.userId}/status`,
      admin.value,
      { status: 'SUSPENDED', reason: 'Security review requested' },
    );
    expect(response.status, JSON.stringify(response.body)).toBe(200);
    expect((await call('auth', 'get', '/api/v1/auth/me', user)).status).toBe(401);
    expect(
      (
        await call(
          'admin',
          'post',
          `/api/v1/admin/users/${user.data.principal.userId}/status`,
          admin.value,
          { status: 'ACTIVE', reason: 'Security review completed' },
        )
      ).status,
    ).toBe(200);
    expect((await call('auth', 'get', '/api/v1/auth/me', user)).status).toBe(401);
    expect(
      await databases.admin!.collection('audit').countDocuments({ action: 'user.status-changed' }),
    ).toBeGreaterThan(0);
  });
});

describe('discovery, seller catalog, zones and authoritative carts', () => {
  let admin: Actor,
    seller: Actor,
    otherSeller: Actor,
    customer: Actor,
    restaurantId: string,
    otherRestaurantId: string,
    itemId: string,
    otherItemId: string,
    addressId: string,
    zoneId: string;
  const hours = Array.from({ length: 7 }, (_, day) => ({ day, openMinute: 0, closeMinute: 1440 }));
  const variantId = randomUUID(),
    optionId = randomUUID(),
    groupId = randomUUID();
  const profile: RestaurantInput = {
    name: 'Test Chennai Kitchen',
    description: 'A kitchen used only by isolated tests',
    cuisines: ['Indian', 'South Indian'],
    city: 'chennai',
    address: '123 Example Street, Chennai',
    point: { longitude: 80.27, latitude: 13.08 },
    hours,
    holidays: [],
    imageId: null,
    libraryImage: 'biryani',
    costForTwoMinor: 50000,
    minimumOrderMinor: 0,
    preparationMinutes: 20,
    published: true,
    paused: false,
    pauseReason: '',
  };
  const dish: MenuItemInput = {
    category: 'Main course',
    name: 'Test Vegetable Biryani',
    description: 'Freshly made test fixture',
    priceMinor: 15000,
    diet: 'veg',
    allergens: ['Milk'],
    available: true,
    stock: 10,
    imageId: null,
    libraryImage: 'biryani',
    variants: [{ id: variantId, name: 'Large', priceMinor: 5000, available: true }],
    modifierGroups: [
      {
        id: groupId,
        name: 'Sides',
        min: 1,
        max: 1,
        options: [{ id: optionId, name: 'Raita', priceMinor: 2000, available: true }],
      },
    ],
  };
  const address = {
    label: 'Home',
    recipient: 'Test Customer',
    phone: '9876543210',
    city: 'chennai',
    street: '123 Example Street, Chennai',
    apartment: '2B',
    landmark: 'Test park',
    instructions: 'Call at gate',
    pincode: '600001',
    point: { latitude: 13.081, longitude: 80.271 },
    isDefault: true,
  };
  const line = (quantity = 1): CartLineInput => ({
    itemId,
    variantId,
    optionIds: [optionId],
    quantity,
    instructions: '',
  });
  async function cartInput(lines: CartLineInput[] = [line()], extra: object = {}) {
    const state = await call('restaurant', 'get', '/api/v1/cart', customer);
    return {
      expectedVersion: state.body.data.version,
      restaurantId,
      addressId,
      replace: false,
      lines,
      ...extra,
    };
  }
  async function setupSeller(value: Actor, name: string) {
    const app = await application(value);
    const decision = await call(
      'admin',
      'post',
      `/api/v1/admin/verifications/${app.id}/decision`,
      admin,
      {
        expectedVersion: app.version,
        decision: 'approved',
        reason: 'Catalog test fixture approved',
      },
      { 'Idempotency-Key': randomUUID() },
    );
    expect(decision.body.data.state).toBe('APPLIED');
    const list = await call('restaurant', 'get', '/api/v1/seller/restaurants', value);
    const restaurant = list.body.data[0];
    const created = await call(
      'restaurant',
      'post',
      `/api/v1/seller/restaurants/${restaurant.id}/items`,
      value,
      dish,
      { 'Idempotency-Key': randomUUID() },
    );
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    const catalog = await call(
      'restaurant',
      'get',
      `/api/v1/seller/restaurants/${restaurant.id}/catalog`,
      value,
    );
    const published = await call(
      'restaurant',
      'put',
      `/api/v1/seller/restaurants/${restaurant.id}`,
      value,
      { expectedVersion: catalog.body.data.restaurant.version, restaurant: { ...profile, name } },
    );
    expect(published.status, JSON.stringify(published.body)).toBe(200);
    return { restaurantId: restaurant.id as string, itemId: created.body.data.id as string };
  }
  beforeAll(async () => {
    admin = (await administrator()).value;
    seller = await register('seller');
    otherSeller = await register('seller');
    customer = await register();
    const first = await setupSeller(seller, 'Test Chennai Kitchen');
    restaurantId = first.restaurantId;
    itemId = first.itemId;
    const second = await setupSeller(otherSeller, 'Second Test Kitchen');
    otherRestaurantId = second.restaurantId;
    otherItemId = second.itemId;
    const zone = await call('admin', 'post', '/api/v1/admin/zones', admin, {
      zone: {
        name: 'Chennai test boundary',
        city: 'chennai',
        active: true,
        polygon: {
          type: 'Polygon',
          coordinates: [
            [
              [80.2, 13.0],
              [80.35, 13.0],
              [80.35, 13.2],
              [80.2, 13.2],
              [80.2, 13.0],
            ],
          ],
        },
        hours,
        feePolicyVersion: 1,
        deliveryFeeMinor: 3000,
        travelMinutesMin: 10,
        travelMinutesMax: 25,
      },
      reason: 'Isolated test configuration',
    });
    expect(zone.status, JSON.stringify(zone.body)).toBe(201);
    zoneId = zone.body.data.id;
    const saved = await call('auth', 'post', '/api/v1/addresses', customer, address);
    expect(saved.status, JSON.stringify(saved.body)).toBe(201);
    addressId = saved.body.data.id;
  });
  it('shows only published verified restaurants with deterministic search and real menu data', async () => {
    const search = await call(
      'restaurant',
      'get',
      '/api/v1/restaurants?city=chennai&q=Vegetable&diet=veg&sort=name',
    );
    expect(search.status).toBe(200);
    expect(search.body.data.restaurants).toHaveLength(2);
    expect(search.body.data.restaurants[0].rating).toBeNull();
    expect(
      (await call('restaurant', 'get', '/api/v1/restaurants?city=chennai&q=not-found')).body.data
        .total,
    ).toBe(0);
    expect(
      (await call('restaurant', 'get', '/api/v1/restaurants?city=chennai&minRating=4')).body.data
        .total,
    ).toBe(0);
    expect(
      (await call('restaurant', 'get', '/api/v1/restaurants?city=chennai&maxPrice=10000')).body.data
        .total,
    ).toBe(0);
    const catalog = await call(
      'restaurant',
      'get',
      `/api/v1/seller/restaurants/${restaurantId}/catalog`,
      seller,
    );
    expect(
      (await call('restaurant', 'get', `/api/v1/restaurants/${catalog.body.data.restaurant.slug}`))
        .body.data.items[0].modifierGroups[0].min,
    ).toBe(1);
  });
  it('denies cross-seller settings, menu edits and customer seller access', async () => {
    expect(
      (
        await call(
          'restaurant',
          'get',
          `/api/v1/seller/restaurants/${restaurantId}/catalog`,
          otherSeller,
        )
      ).status,
    ).toBe(404);
    expect(
      (
        await call(
          'restaurant',
          'put',
          `/api/v1/seller/restaurants/${restaurantId}/items/${itemId}`,
          otherSeller,
          { expectedVersion: 1, item: dish },
        )
      ).status,
    ).toBe(404);
    expect((await call('restaurant', 'get', '/api/v1/seller/restaurants', customer)).status).toBe(
      403,
    );
  });
  it('keeps address ownership and exactly one default through edits and deletion', async () => {
    expect((await call('auth', 'delete', `/api/v1/addresses/${addressId}`, seller)).status).toBe(
      404,
    );
    const second = await call('auth', 'post', '/api/v1/addresses', customer, {
      ...address,
      label: 'Work',
    });
    expect(second.status).toBe(201);
    let list = (await call('auth', 'get', '/api/v1/addresses', customer)).body.data;
    expect(list.filter((value: { isDefault: boolean }) => value.isDefault)).toHaveLength(1);
    const initial = list.find((value: { id: string }) => value.id === addressId);
    expect(initial.version).toBe(2);
    expect(
      (
        await call('auth', 'patch', `/api/v1/addresses/${addressId}`, customer, {
          ...address,
          expectedVersion: 1,
        })
      ).status,
    ).toBe(409);
    expect(
      (await call('auth', 'delete', `/api/v1/addresses/${second.body.data.id}`, customer)).status,
    ).toBe(200);
    list = (await call('auth', 'get', '/api/v1/addresses', customer)).body.data;
    expect(list[0].isDefault).toBe(true);
  });
  it('fails closed outside exact polygons and rejects reversed or invalid coordinates', async () => {
    expect(
      (
        await call('admin', 'post', '/api/v1/serviceability', undefined, {
          city: 'chennai',
          point: address.point,
        })
      ).body.data.serviceable,
    ).toBe(true);
    expect(
      (
        await call('admin', 'post', '/api/v1/serviceability', undefined, {
          city: 'chennai',
          point: { longitude: 79, latitude: 13 },
        })
      ).body.data.serviceable,
    ).toBe(false);
    expect(
      (
        await call('admin', 'post', '/api/v1/serviceability', undefined, {
          city: 'mumbai',
          point: address.point,
        })
      ).body.data.serviceable,
    ).toBe(false);
    expect(
      (
        await call('admin', 'post', '/api/v1/serviceability', undefined, {
          city: 'chennai',
          point: { latitude: 80, longitude: 13 },
        })
      ).status,
    ).toBe(400);
    expect((await call('admin', 'get', '/api/v1/admin/zones', customer)).status).toBe(403);
  });
  it('ignores client arithmetic by accepting only IDs/choices and computes integer prices', async () => {
    const result = await call(
      'restaurant',
      'put',
      '/api/v1/cart',
      customer,
      await cartInput([line(2)]),
    );
    expect(result.status, JSON.stringify(result.body)).toBe(200);
    expect(result.body.data.subtotalMinor).toBe(44000);
    expect(result.body.data.checkoutEnabled).toBe(false);
    expect(
      (
        await call('restaurant', 'put', '/api/v1/cart', customer, {
          ...(await cartInput()),
          subtotalMinor: 1,
        })
      ).status,
    ).toBe(400);
    expect((await call('restaurant', 'get', '/api/v1/cart', seller)).body.data.cart).toBeNull();
  });
  it('enforces variants, required modifiers, duplicate choices and stock across separate lines', async () => {
    expect(
      (
        await call(
          'restaurant',
          'put',
          '/api/v1/cart',
          customer,
          await cartInput([{ ...line(), variantId: null }]),
        )
      ).status,
    ).toBe(422);
    expect(
      (
        await call(
          'restaurant',
          'put',
          '/api/v1/cart',
          customer,
          await cartInput([{ ...line(), optionIds: [] }]),
        )
      ).status,
    ).toBe(422);
    expect(
      (
        await call(
          'restaurant',
          'put',
          '/api/v1/cart',
          customer,
          await cartInput([{ ...line(), optionIds: [optionId, optionId] }]),
        )
      ).status,
    ).toBe(400);
    expect(
      (
        await call(
          'restaurant',
          'put',
          '/api/v1/cart',
          customer,
          await cartInput([line(6), { ...line(6), instructions: 'Separate packet' }]),
        )
      ).status,
    ).toBe(409);
    expect(
      (
        await call(
          'restaurant',
          'put',
          '/api/v1/cart',
          customer,
          await cartInput([{ ...line(), itemId: otherItemId }]),
        )
      ).status,
    ).toBe(409);
  });
  it('requires replacement confirmation, rejects stale versions and keeps clear-cart versions monotonic', async () => {
    const snapshot = await cartInput();
    expect((await call('restaurant', 'put', '/api/v1/cart', customer, snapshot)).status).toBe(200);
    expect((await call('restaurant', 'put', '/api/v1/cart', customer, snapshot)).status).toBe(409);
    const replacement = await cartInput([{ ...line(), itemId: otherItemId }], {
      restaurantId: otherRestaurantId,
    });
    expect(
      (await call('restaurant', 'put', '/api/v1/cart', customer, replacement)).body.error.code,
    ).toBe('REPLACE_CART_REQUIRED');
    expect(
      (await call('restaurant', 'put', '/api/v1/cart', customer, { ...replacement, replace: true }))
        .status,
    ).toBe(200);
    const state = (await call('restaurant', 'get', '/api/v1/cart', customer)).body.data;
    expect(
      (
        await call('restaurant', 'delete', '/api/v1/cart', customer, {
          expectedVersion: state.version,
        })
      ).status,
    ).toBe(200);
    const empty = (await call('restaurant', 'get', '/api/v1/cart', customer)).body.data;
    expect(empty.cart).toBeNull();
    expect(empty.version).toBeGreaterThan(state.version);
    expect(
      (
        await call('restaurant', 'put', '/api/v1/cart', customer, {
          ...(await cartInput()),
          expectedVersion: 0,
        })
      ).status,
    ).toBe(409);
  });
  it('revalidates stored carts after menu price, stock or zone configuration changes', async () => {
    expect(
      (await call('restaurant', 'put', '/api/v1/cart', customer, await cartInput())).status,
    ).toBe(200);
    const original = (
      await call('restaurant', 'get', `/api/v1/seller/restaurants/${restaurantId}/catalog`, seller)
    ).body.data.items.find((item: { id: string }) => item.id === itemId);
    const changed = await call(
      'restaurant',
      'put',
      `/api/v1/seller/restaurants/${restaurantId}/items/${itemId}`,
      seller,
      { expectedVersion: original.version, item: { ...dish, priceMinor: 16000 } },
    );
    expect(changed.status).toBe(200);
    let saved = (await call('restaurant', 'get', '/api/v1/cart', customer)).body.data.cart as Cart;
    expect(saved.subtotalMinor).toBe(22000);
    expect(saved.issues[0]).toContain('prices changed');
    expect(
      (await call('restaurant', 'put', '/api/v1/cart', customer, await cartInput())).body.data
        .subtotalMinor,
    ).toBe(23000);
    await databases
      .admin!.collection('zones')
      .updateOne({ _id: zoneId as never }, { $set: { active: false } });
    expect(
      (await call('restaurant', 'put', '/api/v1/cart', customer, await cartInput())).status,
    ).toBe(422);
    saved = (await call('restaurant', 'get', '/api/v1/cart', customer)).body.data.cart;
    expect(saved.issues[0]).toContain('active delivery zone');
    await databases
      .admin!.collection('zones')
      .updateOne({ _id: zoneId as never }, { $set: { active: true } });
  });
  it('makes create-menu commands idempotent and rejects conflicting replay bodies', async () => {
    const key = randomUUID(),
      path = `/api/v1/seller/restaurants/${restaurantId}/items`,
      body = { ...dish, name: 'Idempotent test dish' };
    const a = await call('restaurant', 'post', path, seller, body, { 'Idempotency-Key': key }),
      b = await call('restaurant', 'post', path, seller, body, { 'Idempotency-Key': key });
    expect(a.status).toBe(201);
    expect(b.body.data.id).toBe(a.body.data.id);
    expect(
      (
        await call(
          'restaurant',
          'post',
          path,
          seller,
          { ...body, priceMinor: 1 },
          { 'Idempotency-Key': key },
        )
      ).status,
    ).toBe(409);
  });
  it('stores real scoped favorites and exposes only currently active offers', async () => {
    expect(
      (
        await call('restaurant', 'put', `/api/v1/favorites/${restaurantId}`, customer, {
          favorite: true,
        })
      ).status,
    ).toBe(200);
    expect((await call('restaurant', 'get', '/api/v1/favorites', customer)).body.data).toHaveLength(
      1,
    );
    expect((await call('restaurant', 'get', '/api/v1/favorites', seller)).body.data).toHaveLength(
      0,
    );
    const offer = {
      code: 'TEST10',
      title: 'Test welcome offer',
      percent: 10,
      maxDiscountMinor: 5000,
      minimumSubtotalMinor: 20000,
      startsAt: new Date(Date.now() - 60000).toISOString(),
      endsAt: new Date(Date.now() + 86400000).toISOString(),
      active: true,
    };
    expect(
      (
        await call(
          'restaurant',
          'post',
          `/api/v1/seller/restaurants/${restaurantId}/offers`,
          seller,
          { offer },
          { 'Idempotency-Key': randomUUID() },
        )
      ).status,
    ).toBe(201);
    expect(
      (await call('restaurant', 'get', '/api/v1/offers?city=chennai')).body.data.some(
        (value: { code: string }) => value.code === 'TEST10',
      ),
    ).toBe(true);
    expect((await call('restaurant', 'get', '/api/v1/offers?city=mumbai')).body.data).toHaveLength(
      0,
    );
  });
  it('never serves a verification document through the public media route', async () => {
    const proof = await upload(seller);
    expect((await call('utils', 'get', `/api/v1/media/${proof}`)).status).toBe(404);
  });
  it('allows building toward a minimum subtotal without blocking the first dish', async () => {
    let catalog = (
      await call('restaurant', 'get', `/api/v1/seller/restaurants/${restaurantId}/catalog`, seller)
    ).body.data;
    expect(
      (
        await call('restaurant', 'put', `/api/v1/seller/restaurants/${restaurantId}`, seller, {
          expectedVersion: catalog.restaurant.version,
          restaurant: { ...profile, minimumOrderMinor: 50000 },
        })
      ).status,
    ).toBe(200);
    const result = await call('restaurant', 'put', '/api/v1/cart', customer, await cartInput());
    expect(result.status).toBe(200);
    expect(result.body.data.issues[0]).toContain('minimum items subtotal');
    catalog = (
      await call('restaurant', 'get', `/api/v1/seller/restaurants/${restaurantId}/catalog`, seller)
    ).body.data;
    await call('restaurant', 'put', `/api/v1/seller/restaurants/${restaurantId}`, seller, {
      expectedVersion: catalog.restaurant.version,
      restaurant: profile,
    });
  });
  it('publishes only owned checked catalog images and strips metadata from public output', async () => {
    const bytes = await sharp({
      create: { width: 20, height: 20, channels: 3, background: '#ffccaa' },
    })
      .withMetadata()
      .png()
      .toBuffer();
    expect(
      (
        await call('utils', 'post', '/api/v1/uploads/intents', customer, {
          filename: 'food.png',
          size: bytes.length,
          purpose: 'catalog-image',
        })
      ).status,
    ).toBe(403);
    const intent = await call('utils', 'post', '/api/v1/uploads/intents', seller, {
      filename: 'food.png',
      size: bytes.length,
      purpose: 'catalog-image',
    });
    expect(intent.status).toBe(201);
    const uploadId = intent.body.data.uploadId;
    expect(
      (
        await call('utils', 'put', intent.body.data.url, seller, bytes, {
          'Content-Type': 'application/octet-stream',
          'X-Upload-Token': intent.body.data.uploadToken,
        })
      ).status,
    ).toBe(201);
    expect((await call('utils', 'get', `/api/v1/media/${uploadId}`)).status).toBe(404);
    await call('utils', 'post', `/api/v1/uploads/${uploadId}/complete`, seller, {});
    const catalog = (
      await call('restaurant', 'get', `/api/v1/seller/restaurants/${restaurantId}/catalog`, seller)
    ).body.data;
    const item = catalog.items.find((item: { id: string }) => item.id === itemId);
    expect(
      (
        await call(
          'restaurant',
          'put',
          `/api/v1/seller/restaurants/${restaurantId}/items/${itemId}`,
          seller,
          { expectedVersion: item.version, item: { ...dish, imageId: uploadId } },
        )
      ).status,
    ).toBe(200);
    const image = await call('utils', 'get', `/api/v1/media/${uploadId}`);
    expect(image.status).toBe(200);
    expect(image.headers['content-type']).toContain('image/webp');
    expect((await sharp(image.body).metadata()).exif).toBeUndefined();
    const document = await upload(seller);
    expect(
      (
        await call(
          'restaurant',
          'put',
          `/api/v1/seller/restaurants/${restaurantId}/items/${itemId}`,
          seller,
          { expectedVersion: item.version + 1, item: { ...dish, imageId: document } },
        )
      ).status,
    ).toBe(422);
  });
});

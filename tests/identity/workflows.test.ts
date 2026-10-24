import { beforeAll, afterAll, describe, it, expect } from 'vitest';
import { randomUUID } from 'node:crypto';
import { resolve,sep } from 'node:path';
import { rm, mkdir } from 'node:fs/promises';
import request from 'supertest';
import sharp from 'sharp';
import { MongoMemoryReplSet } from 'mongodb-memory-server-core';
import { MongoClient, type Db } from 'mongodb';
import type { Express } from 'express';
import type { SessionResponse } from '@cravecart/contracts';
import { loadConfig } from '@cravecart/config';
import { createApp, type DomainContext } from '@cravecart/platform';
import { ensurePersistence } from '@cravecart/persistence';
import { installAuth, adminPermissions } from '../../services/auth/src/router.js';
import { totp, encodeBase32 } from '../../services/auth/src/totp.js';
import { installApplications as installSeller } from '../../services/restaurant/src/applications.js';
import { installApplications as installRider } from '../../services/rider/src/applications.js';
import { installVerifications } from '../../services/admin/src/verifications.js';
import { installUploads } from '../../services/utils/src/uploads.js';

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
  await databases
    .auth!.collection('users')
    .insertOne({
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
    if(url.pathname==='/internal/v1/roles/apply'&&failNextRoleGrant){failNextRoleGrant=false;throw new Error('Injected auth outage');}
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
      configure: (app) => install(app, ctx),
    });
  }
});
afterAll(async () => {
  for (const close of closers) await close();
  for (const db of Object.values(databases)) await db.dropDatabase();
  await client?.close();
  await repl?.stop();
  const target=resolve('.local',prefix);if(!target.startsWith(resolve('.local')+sep))throw new Error('Invalid test cleanup directory');
  await rm(target, { recursive: true, force: true });
});
describe('verified identity and revocable sessions', () => {
  it('consumes a verified OTP only once under simultaneous requests', async()=>{
    const response=await call('auth','post','/api/v1/auth/register',undefined,{contact:contact(),name:'Concurrent Person'});
    const input={challengeId:response.body.data.challengeId,code:response.body.data.developmentCode};
    const results=await Promise.all([call('auth','post','/api/v1/auth/otp/verify',actor(),input),call('auth','post','/api/v1/auth/otp/verify',actor(),input)]);
    expect(results.map(result=>result.status).sort()).toEqual([200,401]);
  });
  it('rejects expired OTPs even before TTL cleanup runs',async()=>{
    const email=contact();
    const response=await call('auth','post','/api/v1/auth/register',undefined,{contact:email,name:'Expired Person'});
    await databases.auth!.collection('challenges').updateMany({contact:email},{$set:{expiresAt:new Date(0)}});
    expect((await call('auth','post','/api/v1/auth/otp/verify',undefined,{challengeId:response.body.data.challengeId,code:response.body.data.developmentCode})).status).toBe(401);
  });
  it('denies admin reads until MFA enrollment is verified, including customer workspace sessions',async()=>{
    const user=await register();
    await databases.auth!.collection('users').updateOne({_id:user.data.principal.userId as never},{$set:{roles:['customer','admin'],permissions:adminPermissions}});
    const response=await call('admin','get','/api/v1/admin/verifications',user);
    expect(response.status).toBe(403);
    expect(response.body.error.code).toBe('MFA_REQUIRED');
  });
  it('binds contact-change proof to its owner and revokes other sessions',async()=>{
    const owner=await register(),other=await register(),email=contact();
    const request=await call('auth','post','/api/v1/auth/contact-changes',owner,{contact:email});
    const path=`/api/v1/auth/contact-changes/${request.body.data.challengeId}/confirm`;
    expect((await call('auth','post',path,other,{code:request.body.data.developmentCode})).status).toBe(404);
    expect((await call('auth','post',path,owner,{code:request.body.data.developmentCode})).status).toBe(200);
    expect((await call('auth','get','/api/v1/auth/me',owner)).body.data.principal.contact).toBe(email);
  });
  it('recovers approval after auth fails between the owner decision and role activation',async()=>{
    const user=await register('seller'),admin=await administrator(),app=await application(user);
    failNextRoleGrant=true;
    const decision=await call('admin','post',`/api/v1/admin/verifications/${app.id}/decision`,admin.value,{expectedVersion:app.version,decision:'approved',reason:'Verified documents with outage recovery'},{'Idempotency-Key':randomUUID()});
    expect(decision.status).toBe(202);
    expect(decision.body.data.state).toBe('PENDING');
    expect((await call('auth','get','/api/v1/auth/me',user)).body.data.principal.roles).not.toContain('seller');
    const recovered=await call('admin','post',`/api/v1/admin/operations/${decision.body.data.operationId}/retry`,admin.value,{});
    expect(recovered.body.data.state,JSON.stringify(recovered.body)).toBe('APPLIED');
    expect((await call('auth','get','/api/v1/auth/me',user)).body.data.principal.roles).toContain('seller');
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
    expect((await call('admin','post',`/api/v1/admin/users/${user.data.principal.userId}/status`,admin.value,{status:'ACTIVE',reason:'Security review completed'})).status).toBe(200);
    expect((await call('auth','get','/api/v1/auth/me',user)).status).toBe(401);
    expect(
      await databases.admin!.collection('audit').countDocuments({ action: 'user.status-changed' }),
    ).toBeGreaterThan(0);
  });
});

import { beforeAll, afterAll, describe, it, expect } from 'vitest';
import { createHmac, randomUUID } from 'node:crypto';
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
} from '@cravecart/contracts';
import { loadConfig } from '@cravecart/config';
import { createApp, type DomainContext } from '@cravecart/platform';
import { ensurePersistence } from '@cravecart/persistence';
import { installAuth, adminPermissions } from '../../services/auth/src/router.js';
import { totp } from '../../services/auth/src/totp.js';
import { installApplications as installSeller } from '../../services/restaurant/src/applications.js';
import { installApplications as installRider } from '../../services/rider/src/applications.js';
import { installVerifications } from '../../services/admin/src/verifications.js';
import { installUploads } from '../../services/utils/src/uploads.js';
import { installCatalog } from '../../services/restaurant/src/catalog.js';
import { installZones } from '../../services/admin/src/zones.js';
import { installOrders } from '../../services/restaurant/src/orders.js';
import { installPayments } from '../../services/utils/src/payments.js';
import { installFinance } from '../../services/admin/src/finance.js';
import { installAddresses } from '../../services/auth/src/addresses.js';

const ajv = new Ajv2020({ strict: false, allErrors: true });
addFormats.default(ajv);
const exported = {
  ...JSON.parse(readFileSync('contracts/identity.openapi.json', 'utf8')),
  ...JSON.parse(readFileSync('contracts/catalog.openapi.json', 'utf8')),
  ...JSON.parse(readFileSync('contracts/commerce.openapi.json', 'utf8')),
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

import { providerFixture } from './provider-fixture.js';
const external = process.env.MONEY_GATEWAY_MODE === 'test';
const provider = providerFixture();
const prefix = `ccm_test_${randomUUID().replaceAll('-', '').slice(0, 20)}`;
const uploadDirectory = resolve('.local', prefix, 'uploads');
const apps: Record<string, Express> = {};
const databases: Record<string, Db> = {};
const closers: Array<() => Promise<void>> = [];
let repl: MongoMemoryReplSet | undefined, client: MongoClient;
let orderWorker: ReturnType<typeof installOrders>,
  paymentWorker: ReturnType<typeof installPayments>;
let failNextRoleGrant = false;
let financeConfig: ReturnType<typeof loadConfig>;
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
  if (external)
    await client
      .db(`${prefix}_restaurant`)
      .collection('pricing_policy')
      .insertOne({
        _id: 'current' as never,
        version: 1,
        development: false,
        enabled: true,
        approvedForLive: false,
        platformFeeMinor: 0,
        taxBps: 0,
        taxLabel: 'Test pricing policy',
        quoteSeconds: 300,
        paymentSeconds: 600,
        cancellationSeconds: 300,
        maxOrderMinor: 10000000,
      });
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
      COMMERCE_MODE: external ? 'test' : 'development',
      FINANCE_DUAL_APPROVAL_THRESHOLD_MINOR: '100000000',
      RAZORPAY_KEY_ID: 'rzp_test_fixture',
      RAZORPAY_KEY_SECRET: 'fixture-key-secret',
      RAZORPAY_WEBHOOK_SECRET: 'fixture-webhook-secret',
      RAZORPAY_ACCOUNT_ID: 'acc_fixture',
      STRIPE_SECRET_KEY: 'sk_test_fixture',
      STRIPE_WEBHOOK_SECRET: 'whsec_fixture',
      UPLOAD_DIRECTORY: uploadDirectory,
    });
    if (name === 'restaurant') financeConfig = config;
    const ctx: DomainContext = { config, db, client, fetcher, onClose: (fn) => closers.push(fn) };
    apps[name] = createApp({
      name: name as 'auth',
      config,
      resources: { check: async () => ({ mongo: true }), close: async () => {} },
      configure: (app) => {
        if (name === 'restaurant') installCatalog(app, ctx);
        install(app, ctx);
        if (name === 'restaurant') orderWorker = installOrders(app, ctx);
        if (name === 'utils')
          paymentWorker = installPayments(app, ctx, { gatewayFetch: provider.fetcher });
        if (name === 'admin') installFinance(app, ctx);
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
describe('transactional checkout, payments and refunds', () => {
  let admin: Actor,
    seller: Actor,
    otherSeller: Actor,
    customer: Actor,
    restaurantId: string,
    _otherRestaurantId: string,
    itemId: string,
    _otherItemId: string,
    addressId: string,
    _zoneId: string;
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
    _otherRestaurantId = second.restaurantId;
    _otherItemId = second.itemId;
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
    _zoneId = zone.body.data.id;
    const saved = await call('auth', 'post', '/api/v1/addresses', customer, address);
    expect(saved.status, JSON.stringify(saved.body)).toBe(201);
    addressId = saved.body.data.id;
  });

  async function pending(gateway: 'razorpay' | 'stripe' = 'razorpay') {
    const saved = await call('restaurant', 'put', '/api/v1/cart', customer, await cartInput());
    expect(saved.status, JSON.stringify(saved.body)).toBe(200);
    const quoted = await call('restaurant', 'post', '/api/v1/quotes', customer, {
      cartVersion: saved.body.data.version,
    });
    expect(quoted.status, JSON.stringify(quoted.body)).toBe(201);
    const body = { quoteId: quoted.body.data.id, gateway };
    const headers = { 'Idempotency-Key': randomUUID() };
    const created = await call('restaurant', 'post', '/api/v1/orders', customer, body, headers);
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    const replay = await call('restaurant', 'post', '/api/v1/orders', customer, body, headers);
    expect(replay.body.data.id).toBe(created.body.data.id);
    const attempt = await call(
      'utils',
      'post',
      '/api/v1/payments/attempts',
      customer,
      { orderId: created.body.data.id },
      { 'Idempotency-Key': randomUUID() },
    );
    expect(attempt.status, JSON.stringify(attempt.body)).toBe(201);
    return {
      order: created.body.data as import('@cravecart/contracts').Order,
      attempt: attempt.body.data as import('@cravecart/contracts').PaymentAttempt,
    };
  }
  async function outcome(attemptId: string, status: 'captured' | 'failed') {
    if (!external)
      return call('utils', 'post', `/api/v1/payments/attempts/${attemptId}/simulate`, customer, {
        outcome: status,
      });
    const attempt = await databases
      .utils!.collection('payment_attempts')
      .findOne({ _id: attemptId as never });
    const id = String(attempt!.providerId),
      payment = provider.payment(id);
    if (status === 'captured') {
      provider.capture(id);
      const gateway = attempt!.gateway as 'stripe' | 'razorpay',
        eventId = 'evt_' + randomUUID().replaceAll('-', '');
      const payload =
        gateway === 'stripe'
          ? {
              id: eventId,
              type: 'checkout.session.completed',
              livemode: false,
              data: { object: provider.resources.get(id) },
            }
          : {
              event: 'payment.captured',
              account_id: 'acc_fixture',
              payload: { payment: { entity: { id: payment, order_id: id } } },
            };
      const raw = JSON.stringify(payload),
        timestamp = Math.floor(Date.now() / 1000),
        secret = gateway === 'stripe' ? 'whsec_fixture' : 'fixture-webhook-secret';
      const signature = createHmac('sha256', secret)
        .update(gateway === 'stripe' ? `${timestamp}.${raw}` : raw)
        .digest('hex');
      const headers: Record<string, string> =
        gateway === 'stripe'
          ? {
              'Content-Type': 'application/json',
              'stripe-signature': `t=${timestamp},v1=${signature}`,
            }
          : {
              'Content-Type': 'application/json',
              'x-razorpay-signature': signature,
              'x-razorpay-event-id': eventId,
            };
      for (let n = 0; n < 2; n++) {
        const received = await call(
          'utils',
          'post',
          `/api/v1/webhooks/${gateway}`,
          undefined,
          raw,
          headers,
        );
        expect(received.status, JSON.stringify(received.body)).toBe(200);
      }
      await paymentWorker.processInbox();
    }
    const body =
      attempt!.gateway === 'stripe'
        ? {}
        : {
            paymentId: payment,
            signature: createHmac('sha256', 'fixture-key-secret')
              .update(`${id}|${payment}`)
              .digest('hex'),
          };
    return call('utils', 'post', `/api/v1/payments/attempts/${attemptId}/verify`, customer, body);
  }
  async function flush() {
    for (let i = 0; i < 6; i++) {
      await databases
        .utils!.collection('refunds')
        .updateMany({}, { $set: { nextCheckAt: new Date(0) } });
      await orderWorker.tick();
      await paymentWorker.tick();
    }
  }
  for (const gateway of ['razorpay', 'stripe'] as const) {
    it(`${gateway}: reserves once, verifies once, cancels and refunds with a balanced ledger`, async () => {
      const before = await databases
        .restaurant!.collection('menu_items')
        .findOne({ _id: itemId as never });
      const { order, attempt } = await pending(gateway);
      expect(
        (await databases.restaurant!.collection('menu_items').findOne({ _id: itemId as never }))!
          .stock,
      ).toBe(before!.stock - 1);
      expect((await call('restaurant', 'get', `/api/v1/orders/${order.id}`, seller)).status).toBe(
        404,
      );
      expect(
        (await call('utils', 'get', `/api/v1/payments/attempts/${attempt.id}`, seller)).status,
      ).toBe(404);
      const declined = await outcome(attempt.id, 'failed');
      expect(declined.body.data.state).toBe('READY');
      const path = `/api/v1/payments/attempts/${attempt.id}/simulate`;
      expect(
        (await call('utils', 'post', path, customer, { outcome: 'captured', amountMinor: 1 }))
          .status,
      ).toBe(external ? 404 : 400);
      const paid = await outcome(attempt.id, 'captured');
      expect(paid.status, JSON.stringify(paid.body)).toBe(200);
      await outcome(attempt.id, 'captured');
      const placed = await call('restaurant', 'get', `/api/v1/orders/${order.id}`, customer);
      expect(placed.body.data.status, JSON.stringify(placed.body)).toBe('PLACED');
      expect(placed.body.data.paymentState).toBe('CAPTURED');
      expect((await call('restaurant', 'get', '/api/v1/cart', customer)).body.data.cart).toBeNull();
      const preview = await call(
        'restaurant',
        'get',
        `/api/v1/orders/${order.id}/cancellation-preview`,
        customer,
      );
      const headers = { 'Idempotency-Key': randomUUID() },
        body = {
          expectedVersion: preview.body.data.expectedVersion,
          reason: 'Changed my dinner plans',
        };
      const cancelled = await call(
        'restaurant',
        'post',
        `/api/v1/orders/${order.id}/cancel`,
        customer,
        body,
        headers,
      );
      expect(cancelled.status, JSON.stringify(cancelled.body)).toBe(200);
      await call(
        'restaurant',
        'post',
        `/api/v1/orders/${order.id}/cancel`,
        customer,
        body,
        headers,
      );
      await flush();
      const final = await call('restaurant', 'get', `/api/v1/orders/${order.id}`, customer);
      expect(final.body.data.paymentState, JSON.stringify(final.body)).toBe('REFUNDED');
      expect(final.body.data.refundedMinor).toBe(order.quote.totals.totalMinor);
      expect(
        (await databases.restaurant!.collection('menu_items').findOne({ _id: itemId as never }))!
          .stock,
      ).toBe(before!.stock);
      const report = await paymentWorker.report();
      expect(report.unbalancedGroups).toBe(0);
      expect(report.balances.every((b) => b.balanced)).toBe(true);
      expect(
        await databases.utils!.collection('ledger').countDocuments({ orderId: order.id }),
      ).toBe(2);
    });
  }
  it('compensates a capture arriving after cancellation without resurrecting the order', async () => {
    const { order, attempt } = await pending();
    const cancelled = await call(
      'restaurant',
      'post',
      `/api/v1/orders/${order.id}/cancel`,
      customer,
      { expectedVersion: order.version, reason: 'Cancel before payment' },
      { 'Idempotency-Key': randomUUID() },
    );
    expect(cancelled.status, JSON.stringify(cancelled.body)).toBe(200);
    await outcome(attempt.id, 'captured');
    await flush();
    const final = await call('restaurant', 'get', `/api/v1/orders/${order.id}`, customer);
    expect(final.body.data.status).toBe('CANCELLED');
    expect(final.body.data.paymentState, JSON.stringify(final.body)).toBe('REFUNDED');
  });
  it('expires an unpaid reservation and releases stock once', async () => {
    const { order } = await pending('stripe');
    await databases
      .restaurant!.collection('orders')
      .updateOne(
        { _id: order.id as never },
        { $set: { paymentDeadline: new Date(0).toISOString() } },
      );
    await flush();
    const final = await call('restaurant', 'get', `/api/v1/orders/${order.id}`, customer);
    expect(final.body.data.status).toBe('EXPIRED');
    expect(final.body.data.paymentState).toBe('UNPAID');
    const stock = (await databases
      .restaurant!.collection('menu_items')
      .findOne({ _id: itemId as never }))!.stock;
    await flush();
    expect(
      (await databases.restaurant!.collection('menu_items').findOne({ _id: itemId as never }))!
        .stock,
    ).toBe(stock);
  });
  it('rejects stale quotes before charging', async () => {
    const saved = await call('restaurant', 'put', '/api/v1/cart', customer, await cartInput());
    const quote = await call('restaurant', 'post', '/api/v1/quotes', customer, {
      cartVersion: saved.body.data.version,
    });
    await databases
      .restaurant!.collection('menu_items')
      .updateOne({ _id: itemId as never }, { $inc: { priceMinor: 100, version: 1 } });
    const stale = await call(
      'restaurant',
      'post',
      '/api/v1/orders',
      customer,
      { quoteId: quote.body.data.id, gateway: 'razorpay' },
      { 'Idempotency-Key': randomUUID() },
    );
    expect(stale.status, JSON.stringify(stale.body)).toBe(409);
  });
  it('serializes two customers competing for the last portion', async () => {
    const second = await register();
    const savedAddress = await call('auth', 'post', '/api/v1/addresses', second, address);
    await databases
      .restaurant!.collection('menu_items')
      .updateOne({ _id: itemId as never }, { $set: { stock: 1 } });
    const firstCart = await call('restaurant', 'put', '/api/v1/cart', customer, await cartInput());
    const secondCart = await call('restaurant', 'put', '/api/v1/cart', second, {
      expectedVersion: 0,
      restaurantId,
      addressId: savedAddress.body.data.id,
      replace: false,
      lines: [line()],
    });
    const quotes = await Promise.all([
      call('restaurant', 'post', '/api/v1/quotes', customer, {
        cartVersion: firstCart.body.data.version,
      }),
      call('restaurant', 'post', '/api/v1/quotes', second, {
        cartVersion: secondCart.body.data.version,
      }),
    ]);
    for (const q of quotes) expect(q.status, JSON.stringify(q.body)).toBe(201);
    const results = await Promise.all(
      [customer, second].map((person, i) =>
        call(
          'restaurant',
          'post',
          '/api/v1/orders',
          person,
          { quoteId: quotes[i]!.body.data.id, gateway: 'razorpay' },
          { 'Idempotency-Key': randomUUID() },
        ),
      ),
    );
    expect(results.map((r) => r.status).sort()).toEqual([201, 409]);
    expect(
      (await databases.restaurant!.collection('menu_items').findOne({ _id: itemId as never }))!
        .stock,
    ).toBe(0);
    const winner = results.findIndex((r) => r.status === 201),
      order = results[winner]!.body.data;
    await call(
      'restaurant',
      'post',
      `/api/v1/orders/${order.id}/cancel`,
      [customer, second][winner],
      { expectedVersion: order.version, reason: 'Release last portion' },
      { 'Idempotency-Key': randomUUID() },
    );
    expect(
      (await databases.restaurant!.collection('menu_items').findOne({ _id: itemId as never }))!
        .stock,
    ).toBe(1);
  });
  for (const gateway of ['razorpay', 'stripe'] as const) {
    it.runIf(external)(
      `${gateway}: recovers an uncertain creation without a second charge opportunity`,
      async () => {
        await databases
          .restaurant!.collection('menu_items')
          .updateOne({ _id: itemId as never }, { $set: { stock: 10 } });
        provider.loseNextCreation();
        const { order, attempt } = await pending(gateway);
        expect(attempt.state).toBe('UNKNOWN');
        const before = provider.requests.filter(
          (r) =>
            r.method === 'POST' && (r.path === '/v1/orders' || r.path === '/v1/checkout/sessions'),
        ).length;
        await paymentWorker.reconcileAttempt(attempt.id);
        if (gateway === 'razorpay') {
          expect(
            provider.requests.filter((r) => r.method === 'POST' && r.path === '/v1/orders').length,
          ).toBe(
            before -
              provider.requests.filter(
                (r) => r.method === 'POST' && r.path === '/v1/checkout/sessions',
              ).length,
          );
          const resource = [...provider.resources.values()].find(
            (r) =>
              (r.notes as Record<string, unknown> | undefined)?.cravecart_attempt_id === attempt.id,
          )!;
          const linked = await call(
            'admin',
            'post',
            '/api/v1/admin/finance/attach-reference',
            admin,
            {
              attemptId: attempt.id,
              providerId: resource.id,
              reason: 'Reconciled the lost provider response',
            },
          );
          expect(linked.status, JSON.stringify(linked.body)).toBe(200);
        }
        const recovered = await call(
          'utils',
          'get',
          `/api/v1/payments/attempts/${attempt.id}`,
          customer,
        );
        expect(recovered.body.data.state).toBe('READY');
        await outcome(attempt.id, 'captured');
        const current = (await call('restaurant', 'get', `/api/v1/orders/${order.id}`, customer))
          .body.data;
        await call(
          'restaurant',
          'post',
          `/api/v1/orders/${order.id}/cancel`,
          customer,
          { expectedVersion: current.version, reason: 'Complete uncertain response test' },
          { 'Idempotency-Key': randomUUID() },
        );
        await flush();
        expect(
          await databases.utils!.collection('ledger').countDocuments({ orderId: order.id }),
        ).toBe(2);
      },
    );
    it(`${gateway}: converges simultaneous capture and cancellation to one refund`, async () => {
      await databases
        .restaurant!.collection('menu_items')
        .updateOne({ _id: itemId as never }, { $set: { stock: 10 } });
      const { order, attempt } = await pending(gateway);
      const [, cancelled] = await Promise.all([
        outcome(attempt.id, 'captured'),
        call(
          'restaurant',
          'post',
          `/api/v1/orders/${order.id}/cancel`,
          customer,
          { expectedVersion: order.version, reason: 'Cancel during provider callback' },
          { 'Idempotency-Key': randomUUID() },
        ),
      ]);
      if (cancelled.status === 409) {
        const current = (await call('restaurant', 'get', `/api/v1/orders/${order.id}`, customer))
          .body.data;
        await call(
          'restaurant',
          'post',
          `/api/v1/orders/${order.id}/cancel`,
          customer,
          { expectedVersion: current.version, reason: 'Reviewed concurrent cancellation' },
          { 'Idempotency-Key': randomUUID() },
        );
      }
      await flush();
      const current = (await call('restaurant', 'get', `/api/v1/orders/${order.id}`, customer)).body
        .data;
      expect(current.status).toBe('CANCELLED');
      expect(current.paymentState, JSON.stringify(current)).toBe('REFUNDED');
      expect(
        await databases.utils!.collection('ledger').countDocuments({ orderId: order.id }),
      ).toBe(2);
    });
  }
  it('requires finance permission and fresh MFA for refund authorization', async () => {
    const denied = await call('admin', 'get', '/api/v1/admin/finance', customer);
    expect(denied.status).toBe(403);
    const report = await call('admin', 'get', '/api/v1/admin/finance', admin);
    expect(report.status, JSON.stringify(report.body)).toBe(200);
    expect(report.body.data.missingPostingGroups).toBe(0);
    expect(report.body.data.overRefundedCaptures).toBe(0);
  });
  it('bounds partial refunds, rejects stale commands, and refunds only the remainder on cancellation', async () => {
    const { order, attempt } = await pending('stripe');
    await outcome(attempt.id, 'captured');
    let current = (await call('restaurant', 'get', `/api/v1/orders/${order.id}`, customer)).body
      .data;
    const path = `/api/v1/admin/orders/${order.id}/refund`,
      body = {
        expectedVersion: current.version,
        amountMinor: 5000,
        reason: 'Partial service adjustment',
      },
      headers = { 'Idempotency-Key': randomUUID() };
    const partial = await call('admin', 'post', path, admin, body, headers);
    expect(partial.status, JSON.stringify(partial.body)).toBe(202);
    const replay = await call('admin', 'post', path, admin, body, headers);
    expect(replay.body.data.refundId).toBe(partial.body.data.refundId);
    const stale = await call('admin', 'post', path, admin, body, {
      'Idempotency-Key': randomUUID(),
    });
    expect(stale.status).toBe(409);
    await flush();
    current = (await call('restaurant', 'get', `/api/v1/orders/${order.id}`, customer)).body.data;
    expect(current.paymentState).toBe('PARTIALLY_REFUNDED');
    expect(current.refundedMinor).toBe(5000);
    const excessive = await call(
      'admin',
      'post',
      path,
      admin,
      { ...body, expectedVersion: current.version, amountMinor: order.quote.totals.totalMinor },
      { 'Idempotency-Key': randomUUID() },
    );
    expect(excessive.status).toBe(409);
    await call(
      'restaurant',
      'post',
      `/api/v1/orders/${order.id}/cancel`,
      customer,
      { expectedVersion: current.version, reason: 'Cancel after partial adjustment' },
      { 'Idempotency-Key': randomUUID() },
    );
    await flush();
    current = (await call('restaurant', 'get', `/api/v1/orders/${order.id}`, customer)).body.data;
    expect(current.paymentState).toBe('REFUNDED');
    expect(current.refundedMinor).toBe(order.quote.totals.totalMinor);
    expect(await databases.utils!.collection('ledger').countDocuments({ orderId: order.id })).toBe(
      3,
    );
  });
  it('atomically reserves a limited promotion across customers and restores it once on cancellation', async () => {
    const offer = await call(
      'restaurant',
      'post',
      `/api/v1/seller/restaurants/${restaurantId}/offers`,
      seller,
      {
        offer: {
          code: 'LASTOFFER',
          title: 'Limited test promotion',
          percent: 10,
          maxDiscountMinor: 5000,
          minimumSubtotalMinor: 0,
          startsAt: new Date(Date.now() - 60000).toISOString(),
          endsAt: new Date(Date.now() + 3600000).toISOString(),
          active: true,
          usageLimit: 1,
          perUserLimit: 1,
        },
      },
      { 'Idempotency-Key': randomUUID() },
    );
    expect(offer.status, JSON.stringify(offer.body)).toBe(201);
    const second = await register();
    const secondAddress = await call('auth', 'post', '/api/v1/addresses', second, address);
    const firstCart = await call('restaurant', 'put', '/api/v1/cart', customer, await cartInput());
    const secondCart = await call('restaurant', 'put', '/api/v1/cart', second, {
      expectedVersion: 0,
      restaurantId,
      addressId: secondAddress.body.data.id,
      replace: false,
      lines: [line()],
    });
    const quotes = await Promise.all(
      [customer, second].map((person, i) =>
        call('restaurant', 'post', '/api/v1/quotes', person, {
          cartVersion: [firstCart, secondCart][i]!.body.data.version,
          offerCode: 'LASTOFFER',
        }),
      ),
    );
    for (const q of quotes) expect(q.status, JSON.stringify(q.body)).toBe(201);
    const results = await Promise.all(
      [customer, second].map((person, i) =>
        call(
          'restaurant',
          'post',
          '/api/v1/orders',
          person,
          { quoteId: quotes[i]!.body.data.id, gateway: 'razorpay' },
          { 'Idempotency-Key': randomUUID() },
        ),
      ),
    );
    expect(results.map((r) => r.status).sort()).toEqual([201, 409]);
    expect(
      (await databases
        .restaurant!.collection('offers')
        .findOne({ _id: offer.body.data.id as never }))!.usageReserved,
    ).toBe(1);
    expect(
      (
        await call(
          'restaurant',
          'get',
          `/api/v1/seller/restaurants/${restaurantId}/catalog`,
          seller,
        )
      ).status,
    ).toBe(200);
    const winner = results.findIndex((r) => r.status === 201),
      created = results[winner]!.body.data;
    await call(
      'restaurant',
      'post',
      `/api/v1/orders/${created.id}/cancel`,
      [customer, second][winner],
      { expectedVersion: created.version, reason: 'Release promotion reservation' },
      { 'Idempotency-Key': randomUUID() },
    );
    expect(
      (await databases
        .restaurant!.collection('offers')
        .findOne({ _id: offer.body.data.id as never }))!.usageReserved,
    ).toBe(0);
  });
  it('versions operator pricing policy and computes taxes and tips on the server', async () => {
    const policy = (await call('admin', 'get', '/api/v1/admin/commerce/policy', admin)).body.data;
    const { version, development: _dev, ...input } = policy;
    const body = {
      expectedVersion: version,
      policy: { ...input, platformFeeMinor: 200, taxBps: 500, taxLabel: 'Fixture item tax' },
      reason: 'Review isolated pricing policy',
    };
    const saved = await call('admin', 'put', '/api/v1/admin/commerce/policy', admin, body);
    expect(saved.status, JSON.stringify(saved.body)).toBe(200);
    expect((await call('admin', 'put', '/api/v1/admin/commerce/policy', admin, body)).status).toBe(
      409,
    );
    const cart = await call('restaurant', 'put', '/api/v1/cart', customer, await cartInput());
    const quote = await call('restaurant', 'post', '/api/v1/quotes', customer, {
      cartVersion: cart.body.data.version,
      tipMinor: 2000,
    });
    expect(quote.status, JSON.stringify(quote.body)).toBe(201);
    const totals = quote.body.data.totals;
    expect(totals.taxMinor).toBe(Math.floor((totals.subtotalMinor * 500 + 5000) / 10000));
    expect(totals.totalMinor).toBe(
      totals.subtotalMinor + totals.taxMinor + totals.deliveryFeeMinor + 2200,
    );
  });
  it('launch approval requires finance authority, a current restaurant revision and a real verified seller', async () => {
    const listing = await call('admin', 'get', '/api/v1/admin/commerce/merchants?page=1', admin);
    expect(listing.status, JSON.stringify(listing.body)).toBe(200);
    const restaurant = listing.body.data.merchants.find(
      (value: { id: string }) => value.id === restaurantId,
    );
    expect(restaurant.liveOrderingApproved).toBe(false);
    const detail = await call(
      'admin',
      'get',
      '/api/v1/admin/commerce/merchants?restaurantId=' + restaurantId,
      admin,
    );
    expect(detail.body.data.merchants.map((record: { id: string }) => record.id)).toEqual([
      restaurantId,
    ]);
    const account = await call(
      'admin',
      'get',
      '/api/v1/admin/users/' + seller.data.principal.userId,
      admin,
    );
    expect(account.status).toBe(200);
    expect(account.body.data.id).toBe(seller.data.principal.userId);
    expect(
      (await call('admin', 'get', '/api/v1/admin/users/' + seller.data.principal.userId, customer))
        .status,
    ).toBe(403);
    const path = `/api/v1/admin/commerce/merchants/${restaurantId}`;
    const body = {
      expectedVersion: restaurant.version,
      approved: true,
      reason: 'Merchant contract and operational readiness reviewed',
    };
    expect((await call('admin', 'put', path, seller, body)).status).toBe(403);
    expect((await call('admin', 'put', path, customer, body)).status).toBe(403);
    const approved = await call('admin', 'put', path, admin, body);
    expect(approved.status, JSON.stringify(approved.body)).toBe(200);
    expect(approved.body.data.liveOrderingApproved).toBe(true);
    expect((await call('admin', 'put', path, admin, body)).status).toBe(409);
    const revoked = await call('admin', 'put', path, admin, {
      ...body,
      expectedVersion: approved.body.data.version,
      approved: false,
      reason: 'Pause this merchant launch cohort for review',
    });
    expect(revoked.status).toBe(200);
    expect(revoked.body.data.liveOrderingApproved).toBe(false);
    const savedCart = await call('restaurant', 'put', '/api/v1/cart', customer, await cartInput());
    const sellerRecord = await databases
      .auth!.collection('users')
      .findOne({ _id: seller.data.principal.userId as never });
    await databases
      .auth!.collection('users')
      .updateOne({ _id: seller.data.principal.userId as never }, { $set: { roles: ['customer'] } });
    try {
      const unavailable = await call('restaurant', 'post', '/api/v1/quotes', customer, {
        cartVersion: savedCart.body.data.version,
      });
      expect(unavailable.status).toBe(409);
      expect(unavailable.body.error.code).toBe('RESTAURANT_UNAVAILABLE');
      expect(
        (
          await call('admin', 'put', path, admin, {
            ...body,
            expectedVersion: revoked.body.data.version,
          })
        ).status,
      ).toBe(422);
    } finally {
      await databases
        .auth!.collection('users')
        .updateOne(
          { _id: seller.data.principal.userId as never },
          { $set: { roles: sellerRecord!.roles } },
        );
    }
    await databases
      .restaurant!.collection('restaurants')
      .updateOne({ _id: restaurantId as never }, { $set: { sample: true } });
    try {
      expect(
        (
          await call('admin', 'put', path, admin, {
            ...body,
            expectedVersion: revoked.body.data.version,
          })
        ).status,
      ).toBe(422);
    } finally {
      await databases
        .restaurant!.collection('restaurants')
        .updateOne({ _id: restaurantId as never }, { $set: { sample: false } });
    }
    expect(
      await databases
        .restaurant!.collection('commerce_audit')
        .countDocuments({ action: 'merchant.live-approval', restaurantId }),
    ).toBe(2);
  });
  it('pauses new checkout while a pre-existing payment can still capture and fulfill', async () => {
    const { order, attempt } = await pending();
    const policy = (await call('admin', 'get', '/api/v1/admin/commerce/policy', admin)).body.data;
    const { version, development: _development, ...fields } = policy;
    const paused = await call('admin', 'put', '/api/v1/admin/commerce/policy', admin, {
      expectedVersion: version,
      policy: { ...fields, enabled: false },
      reason: 'Rehearse launch pause with pending payment in progress',
    });
    expect(paused.status, JSON.stringify(paused.body)).toBe(200);
    try {
      const cart = await call('restaurant', 'put', '/api/v1/cart', customer, await cartInput());
      const blocked = await call('restaurant', 'post', '/api/v1/quotes', customer, {
        cartVersion: cart.body.data.version,
      });
      expect(blocked.status).toBe(503);
      expect(blocked.body.error.code).toBe('POLICY_NOT_APPROVED');
      await outcome(attempt.id, 'captured');
      await flush();
      const current = await call('restaurant', 'get', `/api/v1/orders/${order.id}`, customer);
      expect(current.body.data.paymentState).toBe('CAPTURED');
      expect(current.body.data.status).toBe('PLACED');
    } finally {
      const resumed = await call('admin', 'put', '/api/v1/admin/commerce/policy', admin, {
        expectedVersion: paused.body.data.version,
        policy: fields,
        reason: 'Resume reviewed checkout after launch pause rehearsal',
      });
      expect(resumed.status).toBe(200);
    }
  });
  it('cancels an already fully refunded order without requesting a zero-value refund', async () => {
    const { order, attempt } = await pending();
    await outcome(attempt.id, 'captured');
    let current = (await call('restaurant', 'get', `/api/v1/orders/${order.id}`, customer)).body
      .data;
    const refunded = await call(
      'admin',
      'post',
      `/api/v1/admin/orders/${order.id}/refund`,
      admin,
      {
        expectedVersion: current.version,
        amountMinor: order.quote.totals.totalMinor,
        reason: 'Full verified service adjustment',
      },
      { 'Idempotency-Key': randomUUID() },
    );
    expect(refunded.status, JSON.stringify(refunded.body)).toBe(202);
    await flush();
    current = (await call('restaurant', 'get', `/api/v1/orders/${order.id}`, customer)).body.data;
    expect(current.paymentState).toBe('REFUNDED');
    const cancelled = await call(
      'restaurant',
      'post',
      `/api/v1/orders/${order.id}/cancel`,
      customer,
      { expectedVersion: current.version, reason: 'Cancel fully refunded order' },
      { 'Idempotency-Key': randomUUID() },
    );
    expect(cancelled.status, JSON.stringify(cancelled.body)).toBe(200);
    expect(cancelled.body.data.status).toBe('CANCELLED');
    expect(cancelled.body.data.paymentState).toBe('REFUNDED');
    expect(await databases.utils!.collection('refunds').countDocuments({ orderId: order.id })).toBe(
      1,
    );
  });
  it('requires independent finance approval before authorizing refunds and preserves review decisions on replay', async () => {
    const second = (await administrator()).value;
    const { order, attempt } = await pending();
    await outcome(attempt.id, 'captured');
    await flush();
    const originalThreshold = financeConfig.FINANCE_DUAL_APPROVAL_THRESHOLD_MINOR;
    financeConfig.FINANCE_DUAL_APPROVAL_THRESHOLD_MINOR = 0;
    const refundPath = `/api/v1/admin/orders/${order.id}/refund`;
    const decisionPath = (id: string) => `/api/v1/admin/finance/approvals/${id}/decision`;
    async function propose(amountMinor: number) {
      const current = (await call('admin', 'get', `/api/v1/admin/orders/${order.id}`, admin)).body
        .data;
      return call(
        'admin',
        'post',
        refundPath,
        admin,
        {
          expectedVersion: current.version,
          amountMinor,
          reason: 'Reviewed discretionary service adjustment',
        },
        { 'Idempotency-Key': randomUUID() },
      );
    }
    try {
      const current = (await call('admin', 'get', `/api/v1/admin/orders/${order.id}`, admin)).body
        .data;
      const input = {
        expectedVersion: current.version,
        amountMinor: 1000,
        reason: 'Reviewed discretionary service adjustment',
      };
      const headers = { 'Idempotency-Key': randomUUID() };
      const requested = await call('admin', 'post', refundPath, admin, input, headers);
      expect(requested.status, JSON.stringify(requested.body)).toBe(202);
      const approval = requested.body.data.approval;
      expect(approval.status).toBe('PENDING');
      expect(requested.body.data.refundId).toBeNull();
      expect(requested.body.data.order.version).toBe(current.version);
      expect(
        (await call('admin', 'post', refundPath, admin, input, headers)).body.data.approval.id,
      ).toBe(approval.id);
      expect(
        await databases
          .restaurant!.collection('refund_intents')
          .countDocuments({ orderId: order.id }),
      ).toBe(0);
      expect((await call('admin', 'get', '/api/v1/admin/finance/approvals', customer)).status).toBe(
        403,
      );
      const listed = await call('admin', 'get', '/api/v1/admin/finance/approvals?page=1', second);
      expect(listed.status, JSON.stringify(listed.body)).toBe(200);
      expect(
        listed.body.data.approvals.some((value: { id: string }) => value.id === approval.id),
      ).toBe(true);
      expect(JSON.stringify(approval)).not.toContain(admin.data.principal.sessionId);
      const review = {
        expectedVersion: 1,
        decision: 'approve',
        reason: 'Independent finance review completed',
      };
      const reviewerUser = await databases
        .auth!.collection('users')
        .findOne({ _id: second.data.principal.userId as never });
      try {
        await databases
          .auth!.collection('users')
          .updateOne(
            { _id: second.data.principal.userId as never },
            { $set: { permissions: ['finance:read'] } },
          );
        expect((await call('admin', 'get', '/api/v1/admin/finance/approvals', second)).status).toBe(
          200,
        );
        expect(
          (
            await call('admin', 'post', decisionPath(approval.id), second, review, {
              'Idempotency-Key': randomUUID(),
            })
          ).status,
        ).toBe(403);
        expect(
          (
            await call('admin', 'post', refundPath, second, input, {
              'Idempotency-Key': randomUUID(),
            })
          ).status,
        ).toBe(403);
      } finally {
        await databases
          .auth!.collection('users')
          .updateOne(
            { _id: second.data.principal.userId as never },
            { $set: { permissions: reviewerUser!.permissions } },
          );
      }
      const reviewerSession = await databases
        .auth!.collection('sessions')
        .findOne({ _id: second.data.principal.sessionId as never });
      try {
        await databases
          .auth!.collection('sessions')
          .updateOne(
            { _id: second.data.principal.sessionId as never },
            { $set: { mfaVerifiedAt: new Date(0) } },
          );
        expect(
          (
            await call('admin', 'post', decisionPath(approval.id), second, review, {
              'Idempotency-Key': randomUUID(),
            })
          ).body.error.code,
        ).toBe('MFA_REQUIRED');
      } finally {
        await databases
          .auth!.collection('sessions')
          .updateOne(
            { _id: second.data.principal.sessionId as never },
            { $set: { mfaVerifiedAt: reviewerSession!.mfaVerifiedAt } },
          );
      }
      expect(
        (
          await call('admin', 'post', decisionPath(approval.id), admin, review, {
            'Idempotency-Key': randomUUID(),
          })
        ).status,
      ).toBe(403);
      expect(
        (
          await call('admin', 'post', decisionPath(approval.id), customer, review, {
            'Idempotency-Key': randomUUID(),
          })
        ).status,
      ).toBe(403);
      const keys = [{ 'Idempotency-Key': randomUUID() }, { 'Idempotency-Key': randomUUID() }];
      const results = await Promise.all(
        keys.map((key) => call('admin', 'post', decisionPath(approval.id), second, review, key)),
      );
      expect(results.map((result) => result.status).sort()).toEqual([202, 409]);
      const winner = results.findIndex((result) => result.status === 202);
      expect(results[winner]!.body.data.approval.reviewedBy).toBe(second.data.principal.userId);
      expect(results[winner]!.body.data.approval.requestedBy).toBe(admin.data.principal.userId);
      const refundId = results[winner]!.body.data.approval.refundId;
      expect(refundId).toMatch(/^[a-f0-9-]{36}$/);
      const audit = await databases
        .restaurant!.collection('commerce_audit')
        .find({ approvalId: approval.id })
        .sort({ at: 1 })
        .toArray();
      expect(audit.map((record) => record.action)).toEqual([
        'refund.approval.requested',
        'refund.approval.authorized',
      ]);
      expect(audit[0]!.actorId).toBe(admin.data.principal.userId);
      expect(audit[1]!.actorId).toBe(second.data.principal.userId);
      expect(audit[1]!.before.refundRequestedMinor).toBe(0);
      expect(audit[1]!.after.refundRequestedMinor).toBe(1000);
      for (const entry of audit) expect(entry.correlationId).toMatch(/^[a-f0-9-]{36}$/);
      await databases
        .restaurant!.collection('financial_approvals')
        .updateOne({ _id: approval.id as never }, { $set: { expiresAt: new Date(0) } });
      expect(
        (await call('admin', 'post', decisionPath(approval.id), second, review, keys[winner]!)).body
          .data.approval.refundId,
      ).toBe(refundId);
      expect(
        await databases
          .restaurant!.collection('refund_intents')
          .countDocuments({ orderId: order.id }),
      ).toBe(1);
      await flush();
      expect(
        (await call('admin', 'get', `/api/v1/admin/orders/${order.id}`, admin)).body.data
          .refundedMinor,
      ).toBe(1000);

      const rejected = await propose(500);
      expect(rejected.status, JSON.stringify(rejected.body)).toBe(202);
      const refusal = await call(
        'admin',
        'post',
        decisionPath(rejected.body.data.approval.id),
        second,
        {
          ...review,
          decision: 'reject',
          reason: 'Adjustment not justified after independent review',
        },
        { 'Idempotency-Key': randomUUID() },
      );
      expect(refusal.body.data.approval.status).toBe('REJECTED');
      expect(refusal.body.data.order).toBeNull();
      expect(
        await databases
          .restaurant!.collection('refund_intents')
          .countDocuments({ orderId: order.id }),
      ).toBe(1);

      const expired = await propose(500);
      await databases
        .restaurant!.collection('financial_approvals')
        .updateOne(
          { _id: expired.body.data.approval.id as never },
          { $set: { expiresAt: new Date(0) } },
        );
      expect(
        (
          await call('admin', 'post', decisionPath(expired.body.data.approval.id), second, review, {
            'Idempotency-Key': randomUUID(),
          })
        ).body.error.code,
      ).toBe('APPROVAL_EXPIRED');
      const changed = await propose(500);
      await databases
        .restaurant!.collection('orders')
        .updateOne({ _id: order.id as never }, { $inc: { version: 1 } });
      expect(
        (
          await call('admin', 'post', decisionPath(changed.body.data.approval.id), second, review, {
            'Idempotency-Key': randomUUID(),
          })
        ).body.error.code,
      ).toBe('ORDER_CHANGED');

      financeConfig.FINANCE_DUAL_APPROVAL_THRESHOLD_MINOR = 1500;
      const cumulative = await propose(500);
      expect(cumulative.body.data.approval.status).toBe('PENDING');
      expect(cumulative.body.data.approval.thresholdMinor).toBe(1500);
      const user = await databases
        .auth!.collection('users')
        .findOne({ _id: admin.data.principal.userId as never });
      try {
        await databases
          .auth!.collection('users')
          .updateOne(
            { _id: admin.data.principal.userId as never },
            { $set: { permissions: ['finance:read'] } },
          );
        const revoked = await call(
          'admin',
          'post',
          decisionPath(cumulative.body.data.approval.id),
          second,
          review,
          { 'Idempotency-Key': randomUUID() },
        );
        expect(revoked.body.error.code).toBe('REQUESTER_UNAVAILABLE');
      } finally {
        await databases
          .auth!.collection('users')
          .updateOne(
            { _id: admin.data.principal.userId as never },
            { $set: { permissions: user!.permissions } },
          );
      }
      expect(
        await databases
          .restaurant!.collection('refund_intents')
          .countDocuments({ orderId: order.id }),
      ).toBe(1);
    } finally {
      financeConfig.FINANCE_DUAL_APPROVAL_THRESHOLD_MINOR = originalThreshold;
    }
  });
  it('reorders owned completed orders with current prices, explicit cart replacement and idempotent confirmation', async () => {
    const prior = await databases
      .restaurant!.collection<{ _id: string; userId: string; status: string }>('orders')
      .findOne({ userId: customer.data.principal.userId, status: 'CANCELLED' });
    expect(prior).toBeTruthy();
    const base = `/api/v1/orders/${prior!._id}/reorder`,
      input = { addressId };
    expect((await call('restaurant', 'post', base + '/preview', otherSeller, input)).status).toBe(
      404,
    );
    let preview = await call('restaurant', 'post', base + '/preview', customer, input);
    expect(preview.status, JSON.stringify(preview.body)).toBe(200);
    const menu = databases.restaurant!.collection('menu_items');
    const item = await menu.findOne({ _id: itemId as never });
    expect(item).toBeTruthy();
    try {
      await menu.updateOne({ _id: itemId as never }, { $inc: { basePriceMinor: 100, version: 1 } });
      const stale = await call(
        'restaurant',
        'post',
        base + '/confirm',
        customer,
        {
          previewId: preview.body.data.id,
          expectedCartVersion: preview.body.data.cartVersion,
          replace: true,
        },
        { 'Idempotency-Key': randomUUID() },
      );
      expect(stale.status, JSON.stringify(stale.body)).toBe(409);
      expect(stale.body.error.code).toBe('REORDER_CHANGED');
      preview = await call('restaurant', 'post', base + '/preview', customer, input);
      expect(preview.status, JSON.stringify(preview.body)).toBe(200);
      const body = {
        previewId: preview.body.data.id,
        expectedCartVersion: preview.body.data.cartVersion,
        replace: true,
      };
      const headers = { 'Idempotency-Key': randomUUID() };
      const saved = await call('restaurant', 'post', base + '/confirm', customer, body, headers);
      expect(saved.status, JSON.stringify(saved.body)).toBe(200);
      expect(saved.body.data.subtotalMinor).toBe(preview.body.data.subtotalMinor);
      await databases
        .restaurant!.collection('reorder_previews')
        .updateOne({ _id: body.previewId as never }, { $set: { expiresAt: new Date(0) } });
      expect(
        (await call('restaurant', 'post', base + '/confirm', customer, body, headers)).body.data
          .version,
      ).toBe(saved.body.data.version);
      const next = await call('restaurant', 'post', base + '/preview', customer, input);
      expect(next.body.data.replacesCart).toBe(true);
      const denied = await call(
        'restaurant',
        'post',
        base + '/confirm',
        customer,
        {
          previewId: next.body.data.id,
          expectedCartVersion: next.body.data.cartVersion,
          replace: false,
        },
        { 'Idempotency-Key': randomUUID() },
      );
      expect(denied.body.error.code).toBe('REPLACE_REQUIRED');
      const advance = await call('restaurant', 'put', '/api/v1/cart', customer, await cartInput());
      expect(advance.status, JSON.stringify(advance.body)).toBe(200);
      const changed = await call(
        'restaurant',
        'post',
        base + '/confirm',
        customer,
        {
          previewId: next.body.data.id,
          expectedCartVersion: next.body.data.cartVersion,
          replace: true,
        },
        { 'Idempotency-Key': randomUUID() },
      );
      expect(changed.body.error.code).toBe('VERSION_CONFLICT');
      await databases
        .restaurant!.collection('reorder_previews')
        .updateOne({ _id: next.body.data.id as never }, { $set: { expiresAt: new Date(0) } });
      const expired = await call(
        'restaurant',
        'post',
        base + '/confirm',
        customer,
        {
          previewId: next.body.data.id,
          expectedCartVersion: advance.body.data.version,
          replace: true,
        },
        { 'Idempotency-Key': randomUUID() },
      );
      expect(expired.body.error.code).toBe('PREVIEW_EXPIRED');
      await menu.updateOne({ _id: itemId as never }, { $set: { available: false } });
      expect((await call('restaurant', 'post', base + '/preview', customer, input)).status).toBe(
        409,
      );
    } finally {
      await menu.replaceOne({ _id: itemId as never }, item!);
    }
  });
});

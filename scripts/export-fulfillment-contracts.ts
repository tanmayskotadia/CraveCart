import { writeFileSync } from 'node:fs';
import { z } from 'zod';
import {
  fulfillmentSnapshotSchema,
  sellerActionSchema,
  riderAvailabilitySchema,
  locationSampleSchema,
  deliveryCommandSchema,
  deliveryOfferSchema,
  notificationSchema,
  errorSchema,
} from '../packages/contracts/src/index.js';
const paths: Record<string, Record<string, unknown>> = {};
const schema = (value: z.ZodType) =>
  z.toJSONSchema(value, { target: 'draft-2020-12', io: 'input', unrepresentable: 'any' });
const version = z.number().int().positive(),
  _versionBody = z.object({ expectedVersion: version }).strict();
function add(
  owner: string,
  method: string,
  path: string,
  result: z.ZodType,
  body?: z.ZodType,
  options: {
    public?: boolean;
    status?: number;
    idempotent?: boolean;
    query?: z.ZodObject;
    policy?: string;
  } = {},
) {
  const parameters: Array<Record<string, unknown>> = [...path.matchAll(/\{([^}]+)\}/g)].map(
    (match) => ({
      in: 'path',
      name: match[1],
      required: true,
      schema:
        match[1] === 'slug'
          ? { type: 'string', maxLength: 100 }
          : { type: 'string', format: 'uuid' },
    }),
  );
  if (method !== 'get') {
    parameters.push({ in: 'header', name: 'Origin', required: true, schema: { type: 'string' } });
    if (!options.public)
      parameters.push({
        in: 'header',
        name: 'X-CSRF-Token',
        required: true,
        schema: { type: 'string', minLength: 32 },
      });
  }
  if (options.idempotent)
    parameters.push({
      in: 'header',
      name: 'Idempotency-Key',
      required: true,
      schema: { type: 'string', minLength: 16, maxLength: 128 },
    });
  if (options.query) {
    const query = z.toJSONSchema(options.query, {
      target: 'draft-2020-12',
      io: 'output',
      unrepresentable: 'any',
    }) as {
      properties: Record<string, unknown>;
      required?: string[];
    };
    for (const [name, value] of Object.entries(query.properties))
      parameters.push({
        in: 'query',
        name,
        required: !options.query.shape[name]?.isOptional(),
        schema: value,
      });
  }
  const operation = {
    operationId: `fulfillment_${method}_${path.replace(/[^a-zA-Z0-9]/g, '_')}`,
    tags: [owner],
    summary: `${method.toUpperCase()} ${path}`,
    'x-owner': owner,
    'x-contract-status': 'implementation-ready',
    'x-client-generation-ready': true,
    'x-authorization':
      options.policy ??
      (options.public
        ? 'Public capabilities or cryptographically verified provider webhook.'
        : 'Authenticated owner; server checks membership and object ownership. Mutations require origin and session CSRF.'),
    security: options.public ? [] : [{ accessSession: [] }],
    parameters,
    ...(body
      ? {
          requestBody: {
            required: true,
            content: { 'application/json': { schema: schema(body) } },
          },
        }
      : {}),
    responses: {
      [options.status ?? 200]: {
        description:
          'Current server-owned order or financial resource; integer INR minor units. Payment success requires verified provider capture.',
        content: {
          'application/json': {
            schema: schema(
              z
                .object({ data: result, meta: z.object({ requestId: z.string().uuid() }).strict() })
                .strict(),
            ),
          },
        },
      },
      default: {
        description:
          'Structured validation, authentication, ownership, conflict, rate-limit or dependency error.',
        content: { 'application/json': { schema: schema(errorSchema) } },
      },
    },
  };
  (paths[path] ??= {})[method] = operation;
}

const uuid = z.string().uuid(),
  bool = z.boolean(),
  empty = z.object({}).strict(),
  reason = z.string().trim().min(5).max(1000);
const task = z
  .object({
    id: uuid,
    orderId: uuid,
    riderId: uuid,
    state: z.enum(['ACCEPTING', 'ACTIVE', 'ENDED', 'REJECTED']),
    status: z.string(),
    restaurantName: z.string(),
    createdAt: z.string().datetime(),
    endedAt: z.string().datetime().nullable(),
  })
  .strict();
const operation = z
  .object({
    id: uuid,
    taskId: uuid,
    orderId: uuid,
    riderId: uuid,
    kind: z.enum(['assign', 'arrive', 'pickup', 'depart', 'complete']),
    state: z.enum(['PENDING', 'APPLIED', 'REJECTED']),
    attempts: z.number().int(),
    error: z.string().nullable(),
    createdAt: z.string().datetime(),
  })
  .strict();
add(
  'restaurant',
  'get',
  '/seller/restaurants/{restaurantId}/orders',
  z.array(fulfillmentSnapshotSchema),
);
add(
  'restaurant',
  'get',
  '/seller/restaurants/{restaurantId}/orders/{orderId}',
  fulfillmentSnapshotSchema,
);
add(
  'restaurant',
  'post',
  '/seller/restaurants/{restaurantId}/orders/{orderId}/actions',
  fulfillmentSnapshotSchema,
  sellerActionSchema,
  {
    idempotent: true,
    policy:
      'Approved active seller owning the restaurant; expected order version, captured funds and allowlisted transitions. No customer delivery code or private drop-off data is exposed.',
  },
);
add('restaurant', 'get', '/orders/{orderId}/tracking', fulfillmentSnapshotSchema, undefined, {
  policy:
    'Authenticated customer owning the order. Rider location and assignment are revoked after terminal state; delivery code only for the customer after pickup.',
});
add(
  'restaurant',
  'post',
  '/orders/{orderId}/delivery-code',
  fulfillmentSnapshotSchema,
  z.object({ expectedVersion: version }).strict(),
  { idempotent: true },
);
add(
  'rider',
  'get',
  '/rider/availability',
  z
    .object({
      online: bool,
      city: z.string(),
      streamId: uuid.nullable(),
      busy: bool,
      receivedAt: z.string().nullable(),
    })
    .strict(),
);
add(
  'rider',
  'post',
  '/rider/availability',
  z.object({ online: bool, city: z.string(), streamId: uuid }).strict(),
  riderAvailabilitySchema,
);
add(
  'rider',
  'post',
  '/rider/location',
  z.object({ accepted: z.literal(true), receivedAt: z.string().datetime() }).strict(),
  locationSampleSchema,
  {
    policy:
      'Approved active rider, current tracking stream and session. Enforce timestamp, sequence, accuracy, cadence and speed. A location is not delivery proof.',
  },
);
add('rider', 'get', '/rider/offers', z.array(deliveryOfferSchema));
add('rider', 'post', '/rider/offers/{offerId}/accept', operation, empty, {
  status: 202,
  idempotent: true,
  policy:
    'Own unexpired offer; durable exclusive rider/order claim followed by idempotent owner assignment. PENDING is not confirmed assignment.',
});
add(
  'rider',
  'post',
  '/rider/offers/{offerId}/decline',
  z.object({ declined: z.literal(true) }).strict(),
  empty,
);
add('rider', 'get', '/rider/deliveries', z.array(task));
add(
  'rider',
  'get',
  '/rider/deliveries/{deliveryId}',
  z.object({ task, snapshot: fulfillmentSnapshotSchema.nullable() }).strict(),
);
for (const action of ['arrive', 'pickup', 'depart', 'complete'])
  add(
    'rider',
    'post',
    `/rider/deliveries/{deliveryId}/${action}`,
    operation,
    deliveryCommandSchema,
    {
      status: 202,
      idempotent: true,
      policy:
        'Own active task and authoritative assignment/version. Pickup/completion require separate expiring, attempt-limited codes. APPLIED only after Restaurant Service confirms; PENDING/REJECTED remain explicit.',
    },
  );
add('rider', 'get', '/rider/operations/{operationId}', operation);
add(
  'rider',
  'post',
  '/rider/deliveries/{deliveryId}/incidents',
  z.object({ id: uuid, state: z.literal('OPEN') }).strict(),
  z.object({ reason }).strict(),
  { status: 201, idempotent: true },
);
add(
  'admin',
  'post',
  '/admin/orders/{orderId}/dispatch/retry',
  z.object({ queued: z.literal(true) }).strict(),
  z.object({ reason: reason.max(500) }).strict(),
  {
    status: 202,
    policy:
      'dispatch:write and fresh MFA, audited operator reason. Only pre-pickup orders; reset bounded rider search rounds.',
  },
);
add(
  'realtime',
  'post',
  '/realtime/tickets',
  z.object({ ticket: z.string().min(40), expiresAt: z.string().datetime() }).strict(),
  empty,
  {
    status: 201,
    policy:
      'Own authenticated session + CSRF; one-use 60-second opaque ticket. Browser Socket.IO handshake must originate at APP_ORIGIN. Every subscription and snapshot rechecks ownership/session.',
  },
);
add('realtime', 'get', '/notifications', z.array(notificationSchema));
add(
  'realtime',
  'post',
  '/notifications/read',
  z.object({ read: z.literal(true) }).strict(),
  z.object({ id: z.string().min(1).max(200) }).strict(),
);
add(
  'realtime',
  'get',
  '/notifications/push-capabilities',
  z.object({ enabled: bool, publicKey: z.string().nullable() }).strict(),
);
add(
  'realtime',
  'post',
  '/notifications/subscriptions',
  z.object({ subscribed: z.literal(true) }).strict(),
  z
    .object({
      endpoint: z.string().url().max(2000),
      keys: z
        .object({
          p256dh: z
            .string()
            .regex(/^[A-Za-z0-9_-]+$/)
            .min(40)
            .max(200),
          auth: z
            .string()
            .regex(/^[A-Za-z0-9_-]+$/)
            .min(16)
            .max(100),
        })
        .strict(),
    })
    .strict(),
  {
    status: 201,
    policy:
      'Opt-in authenticated browser subscription, bound to its revocable session. Only allowlisted HTTPS push-service endpoints; generic encrypted notifications, bounded retries.',
  },
);
add(
  'realtime',
  'delete',
  '/notifications/subscriptions',
  z.object({ unsubscribed: z.literal(true) }).strict(),
  z.object({ endpoint: z.string().url().max(2000) }).strict(),
);
add('admin','get','/admin/delivery-operations',z.object({tasks:z.array(task),pending:z.array(operation),incidents:z.array(z.object({_id:uuid,deliveryId:uuid,orderId:uuid,riderId:uuid,reason:z.string(),state:z.literal('OPEN'),createdAt:z.string()}).strict())}).strict(),undefined,{policy:'dispatch:read, active operator session; bounded current tasks, pending confirmations and open incidents.'});
add('admin','post','/admin/delivery-incidents/{incidentId}/resolve',z.object({resolved:z.literal(true)}).strict(),z.object({reason:reason.max(500)}).strict(),{status:202,policy:'dispatch:write and fresh MFA, audited resolution. Does not mark delivery complete or change assignment.'});
add('admin','post','/admin/delivery-operations/{operationId}/retry',z.object({queued:z.literal(true)}).strict(),z.object({reason:reason.max(500)}).strict(),{status:202,policy:'dispatch:write and fresh MFA; retries the same encrypted original command identity, not a new pickup/completion proof.'});
writeFileSync('contracts/fulfillment.openapi.json', JSON.stringify(paths, null, 2) + '\n');

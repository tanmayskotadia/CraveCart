import { writeFileSync } from 'node:fs';
import { z } from 'zod';
import {
  quoteInputSchema,
  quoteSchema,
  createOrderSchema,
  orderSchema,
  cancelOrderSchema,
  paymentAttemptSchema,
  refundSchema,
  pricingPolicyInputSchema,
  pricingPolicySchema,
  gatewaySchema,
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
    operationId: `commerce_${method}_${path.replace(/[^a-zA-Z0-9]/g, '_')}`,
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
  reason = z.string().min(5).max(500),
  empty = z.object({}).strict();
const caps = z
  .object({
    enabled: z.boolean(),
    mode: z.enum(['disabled', 'development', 'test', 'live']),
    development: z.boolean(),
    gateways: z.array(gatewaySchema),
  })
  .strict();
add('restaurant', 'post', '/quotes', quoteSchema, quoteInputSchema, { status: 201 });
add('restaurant', 'post', '/orders', orderSchema, createOrderSchema, {
  status: 201,
  idempotent: true,
});
add('restaurant', 'get', '/orders', z.array(orderSchema));
add('restaurant', 'get', '/orders/{orderId}', orderSchema);
add(
  'restaurant',
  'get',
  '/orders/{orderId}/cancellation-preview',
  z
    .object({
      allowed: z.boolean(),
      expectedVersion: version,
      refundAmountMinor: z.number().int().nonnegative(),
      message: z.string(),
    })
    .strict(),
);
add('restaurant', 'post', '/orders/{orderId}/cancel', orderSchema, cancelOrderSchema, {
  idempotent: true,
});
add('utils', 'get', '/payments/capabilities', caps, undefined, { public: true });
add(
  'utils',
  'post',
  '/payments/attempts',
  paymentAttemptSchema,
  z.object({ orderId: uuid }).strict(),
  { status: 201, idempotent: true },
);
add('utils', 'get', '/payments/attempts/{attemptId}', paymentAttemptSchema);
add(
  'utils',
  'post',
  '/payments/attempts/{attemptId}/verify',
  paymentAttemptSchema,
  z.union([
    empty,
    z
      .object({
        paymentId: z.string().min(1).max(150),
        signature: z.string().regex(/^[0-9a-f]{64}$/),
      })
      .strict(),
  ]),
);
add(
  'utils',
  'post',
  '/payments/attempts/{attemptId}/simulate',
  paymentAttemptSchema,
  z.object({ outcome: z.enum(['captured', 'failed']) }).strict(),
  {
    policy:
      'Development mode only, non-production, authenticated owner and CSRF. Never accepts amount or capture proof.',
  },
);
add('utils', 'get', '/refunds', z.array(refundSchema), undefined, {
  query: z.object({ orderId: uuid.optional() }).strict(),
});
for (const gateway of ['razorpay', 'stripe']) {
  const path = `/webhooks/${gateway}`;
  add('utils', 'post', path, z.object({ received: z.literal(true) }).strict(), undefined, {
    public: true,
    policy:
      'Raw body HMAC verification, timestamp/mode/account validation, durable inbox before acknowledgement. No browser session or Origin required.',
  });
  const operation = paths[path]!.post as Record<string, unknown>;
  operation.parameters = [
    {
      in: 'header',
      name: gateway === 'stripe' ? 'Stripe-Signature' : 'X-Razorpay-Signature',
      required: true,
      schema: { type: 'string' },
    },
  ];
  operation.requestBody = {
    required: true,
    content: {
      'application/json': {
        schema: {
          type: 'string',
          format: 'binary',
          description: 'Exact signed raw UTF-8 bytes; do not JSON reserialize.',
        },
      },
    },
  };
}
add('admin', 'get', '/admin/orders', z.array(orderSchema));
add('admin', 'get', '/admin/orders/{orderId}', orderSchema);
add(
  'admin',
  'post',
  '/admin/orders/{orderId}/refund',
  z.object({ refundId: uuid, order: orderSchema }).strict(),
  z.object({ expectedVersion: version, amountMinor: z.number().int().positive(), reason }).strict(),
  {
    idempotent: true,
    status: 202,
    policy:
      'finance:write plus fresh TOTP; server bounds total requested refunds to captured funds.',
  },
);
add('admin', 'get', '/admin/refunds', z.array(refundSchema));
add('admin', 'get', '/admin/refunds/{refundId}', refundSchema);
add('admin', 'get', '/admin/commerce/policy', pricingPolicySchema.nullable());
add(
  'admin',
  'put',
  '/admin/commerce/policy',
  pricingPolicySchema,
  z
    .object({
      expectedVersion: z.number().int().nonnegative(),
      policy: pricingPolicyInputSchema,
      reason,
    })
    .strict(),
  { policy: 'finance:write plus fresh TOTP; compare-and-swap pricing policy and audited reason.' },
);
add(
  'admin',
  'post',
  '/admin/restaurants/{restaurantId}/commerce',
  z.object({ updated: z.literal(true) }).strict(),
  z.object({ approved: z.boolean(), reason }).strict(),
  { policy: 'finance:write plus fresh TOTP; real, verified merchant only.' },
);
add(
  'admin',
  'post',
  '/admin/finance/reconcile',
  z.object({ jobId: uuid, state: z.enum(['PENDING', 'COMPLETED']) }).strict(),
  z.object({ reason }).strict(),
  {
    status: 202,
    policy: 'finance:write plus fresh TOTP; durable provider checks and refund delivery retries.',
  },
);
for (const type of ['payment', 'refund'])
  add(
    'admin',
    'post',
    `/admin/finance/attach-${type === 'refund' ? 'refund-' : ''}reference`,
    z.object({ linked: z.literal(true) }).strict(),
    z
      .object({
        [type === 'refund' ? 'refundId' : 'attemptId']: uuid,
        providerId: z
          .string()
          .regex(/^[A-Za-z0-9_]+$/)
          .max(180),
        reason,
      })
      .strict(),
    {
      policy:
        'finance:write plus fresh TOTP; server verifies resource ownership and exact amount before linking.',
    },
  );
add(
  'admin',
  'get',
  '/admin/finance',
  z
    .object({
      mode: z.string(),
      balances: z.array(
        z
          .object({
            mode: z.string(),
            currency: z.literal('INR'),
            debitMinor: z.number(),
            creditMinor: z.number(),
            accounts: z.record(z.string(), z.number()),
            balanced: z.boolean(),
          })
          .strict(),
      ),
      unbalancedGroups: z.number().int(),
      missingPostingGroups: z.number().int(),
      overRefundedCaptures: z.number().int(),
      ledger: z.array(z.record(z.string(), z.unknown())),
      attempts: z.array(z.record(z.string(), z.unknown())),
      refunds: z.array(refundSchema),
      unmatchedEvents: z.number().int(),
      exceptions: z.array(z.record(z.string(), z.unknown())),
      jobs: z.array(z.record(z.string(), z.unknown())),
      scope: z.string(),
    })
    .strict(),
  undefined,
  {
    policy:
      'finance:read. Current environment balances aggregate all postings; resource lists are bounded to 100.',
  },
);
writeFileSync('contracts/commerce.openapi.json', JSON.stringify(paths, null, 2) + '\n');

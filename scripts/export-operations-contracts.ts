import { writeFileSync } from 'node:fs';
import { z } from 'zod';
import {
  errorSchema,
  pageQuerySchema,
  periodQuerySchema,
  ticketInputSchema,
  ticketSchema,
  ticketDetailSchema,
  messageInputSchema,
  messageSchema,
  ticketActionSchema,
  reviewSchema,
  reviewInputSchema,
  reviewReplySchema,
  reasonSchema,
  staffChangeSchema,
  statementSchema,
  offerInputSchema,
  settingsSchema,
  policyKindSchema,
  publishedPolicySchema,
  policyAdminSchema,
  policyDraftSchema,
  policyPublishSchema,
  privacyRequestInputSchema,
  privacyRequestSchema,
  privacyDecisionSchema,
} from '../packages/contracts/src/index.js';
const paths: Record<string, Record<string, unknown>> = {};
function add(
  owner: string,
  method: string,
  path: string,
  result: z.ZodType,
  body?: z.ZodType,
  query?: z.ZodObject,
  publicRead = false,
) {
  const schema = (s: z.ZodType) =>
    z.toJSONSchema(s, { target: 'draft-2020-12', io: 'input', unrepresentable: 'any' });
  const parameters: Array<Record<string, unknown>> = [...path.matchAll(/\{([^}]+)\}/g)].map(
    (m) => ({
      in: 'path',
      name: m[1],
      required: true,
      schema:
        m[1] === 'kind'
          ? { type: 'string', enum: policyKindSchema.options }
          : m[1] === 'slug'
            ? { type: 'string', maxLength: 100 }
            : { type: 'string', format: 'uuid' },
    }),
  );
  if (method !== 'get')
    parameters.push(
      { in: 'header', name: 'Origin', required: true, schema: { type: 'string' } },
      {
        in: 'header',
        name: 'X-CSRF-Token',
        required: true,
        schema: { type: 'string', minLength: 32 },
      },
      {
        in: 'header',
        name: 'Idempotency-Key',
        required: true,
        schema: { type: 'string', minLength: 16, maxLength: 128 },
      },
    );
  if (query) {
    const doc = schema(query) as { properties: Record<string, unknown> };
    for (const [name, value] of Object.entries(doc.properties))
      parameters.push({
        in: 'query',
        name,
        required: !query.shape[name]?.isOptional(),
        schema: value,
      });
  }
  (paths[path] ??= {})[method] = {
    operationId: 'operations_' + method + '_' + path.replace(/[^a-zA-Z0-9]/g, '_'),
    tags: [owner],
    summary: method.toUpperCase() + ' ' + path,
    'x-owner': owner,
    'x-contract-status': 'implementation-ready',
    'x-client-generation-ready': true,
    'x-authorization': publicRead
      ? 'Published public resources only; historical policies are immutable published revisions.'
      : 'Fresh authenticated role and resource entitlement; administrative mutations require granted permission and fresh MFA. Version and idempotency guards apply.',
    security: publicRead ? [] : [{ accessSession: [] }],
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
      [method === 'post' &&
      (path === '/privacy/requests' ||
        (path.endsWith('/decision') && path.startsWith('/admin/privacy/')))
        ? 202
        : (method === 'post' &&
              [
                '/support/tickets',
                '/orders/{orderId}/reviews',
                '/orders/{orderId}/messages',
              ].includes(path)) ||
            (path.endsWith('/messages') && method === 'post')
          ? 201
          : 200]: {
        description: 'Authoritative resource with explicit scope and state.',
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
        description: 'Structured safe error.',
        content: { 'application/json': { schema: schema(errorSchema) } },
      },
    },
  };
}
const id = z.string().uuid(),
  version = z.number().int().positive(),
  updated = z.object({ updated: z.boolean() }).strict();
const page = <T extends z.ZodRawShape>(fields: T) =>
  z
    .object({ ...fields, total: z.number().int().nonnegative(), page: z.number().int().positive() })
    .strict();
add(
  'admin',
  'get',
  '/policies/{kind}',
  publishedPolicySchema,
  undefined,
  z.object({ revision: z.string().uuid().optional() }).strict(),
  true,
);
add('admin', 'get', '/admin/settings', settingsSchema);
add('auth', 'get', '/privacy/requests', z.array(privacyRequestSchema));
add('auth', 'get', '/privacy/requests/{requestId}/download', z.unknown());
// This endpoint streams a private attachment, not the normal resource envelope.
const download = paths['/privacy/requests/{requestId}/download']!.get as {
  responses: Record<string, unknown>;
};
download.responses['200'] = {
  description:
    'Freshly authenticated account owner only. Encrypted export assembled as a private no-store JSON attachment; expires after seven days.',
  headers: {
    'Content-Disposition': { schema: { type: 'string' } },
    'Cache-Control': { schema: { const: 'private, no-store' } },
  },
  content: {
    'application/json': {
      schema: {
        type: 'object',
        required: ['requestId', 'collectedAt', 'scope', 'parts'],
        properties: {
          requestId: { type: 'string', format: 'uuid' },
          collectedAt: { type: 'string', format: 'date-time' },
          scope: { type: 'string' },
          parts: { type: 'array', items: { type: 'object' } },
        },
      },
    },
  },
};
add('auth', 'post', '/privacy/requests', privacyRequestSchema, privacyRequestInputSchema);
add(
  'auth',
  'post',
  '/privacy/requests/{requestId}/cancel',
  privacyRequestSchema,
  z.object({ expectedVersion: z.number().int().positive() }).strict(),
);
add(
  'admin',
  'get',
  '/admin/privacy/requests',
  z
    .object({
      requests: z.array(privacyRequestSchema),
      total: z.number().int().nonnegative(),
      page: z.number().int().positive(),
      pageSize: z.literal(20),
      retentionConfigured: z.boolean(),
    })
    .strict(),
  undefined,
  z.object({ page: z.coerce.number().int().min(1).max(10000).default(1) }).strict(),
);
add(
  'admin',
  'post',
  '/admin/privacy/requests/{requestId}/decision',
  privacyRequestSchema,
  privacyDecisionSchema,
);
add('admin', 'put', '/admin/settings/policies/{kind}', policyAdminSchema, policyDraftSchema);
add(
  'admin',
  'post',
  '/admin/settings/policies/{kind}/publish',
  policyAdminSchema,
  policyPublishSchema,
);
for (const prefix of ['/support/tickets', '/admin/support/tickets']) {
  add('admin', 'get', prefix, page({ tickets: z.array(ticketSchema) }), undefined, pageQuerySchema);
  add('admin', 'get', prefix + '/{ticketId}', ticketDetailSchema, undefined, pageQuerySchema);
  add('admin', 'post', prefix + '/{ticketId}/messages', messageSchema, messageInputSchema);
  add('admin', 'post', prefix + '/{ticketId}/state', ticketSchema, ticketActionSchema);
}
add('admin', 'post', '/support/tickets', ticketSchema, ticketInputSchema);
add(
  'realtime',
  'get',
  '/orders/{orderId}/messages',
  page({ messages: z.array(messageSchema), version, canMessage: z.boolean() }),
  undefined,
  pageQuerySchema,
);
add('realtime', 'post', '/orders/{orderId}/messages', messageSchema, messageInputSchema);
add(
  'realtime',
  'post',
  '/orders/{orderId}/messages/{messageId}/report',
  z.object({ reported: z.boolean() }).strict(),
  reasonSchema,
);
add(
  'restaurant',
  'get',
  '/orders/{orderId}/reviews',
  z.object({ eligible: z.boolean(), review: reviewSchema.nullable() }).strict(),
);
add('restaurant', 'post', '/orders/{orderId}/reviews', reviewSchema, reviewInputSchema);
add(
  'restaurant',
  'get',
  '/restaurants/{slug}/reviews',
  page({ reviews: z.array(reviewSchema) }),
  undefined,
  pageQuerySchema,
  true,
);
add(
  'restaurant',
  'post',
  '/reviews/{reviewId}/report',
  z.object({ reported: z.boolean() }).strict(),
  reasonSchema,
);
add(
  'restaurant',
  'get',
  '/seller/restaurants/{restaurantId}/reviews',
  page({ reviews: z.array(reviewSchema) }),
  undefined,
  pageQuerySchema,
);
add(
  'restaurant',
  'post',
  '/seller/restaurants/{restaurantId}/reviews/{reviewId}/response',
  reviewSchema,
  reviewReplySchema,
);
add(
  'admin',
  'get',
  '/admin/reviews',
  page({ reviews: z.array(reviewSchema.extend({ reportCount: z.number().int().nonnegative() })) }),
  undefined,
  pageQuerySchema,
);
add(
  'admin',
  'post',
  '/admin/reviews/{reviewId}/moderation',
  updated,
  z.object({ expectedVersion: version, hidden: z.boolean(), ...reasonSchema.shape }).strict(),
);
const member = z
  .object({
    restaurantId: id,
    userId: id,
    role: z.enum(['manager', 'kitchen']),
    active: z.boolean(),
    version,
  })
  .strict();
add('restaurant', 'get', '/seller/restaurants/{restaurantId}/staff', z.array(member));
add(
  'restaurant',
  'put',
  '/seller/restaurants/{restaurantId}/staff/{userId}',
  member,
  z
    .object({
      expectedVersion: z.number().int().nonnegative(),
      role: z.enum(['manager', 'kitchen']),
      active: z.boolean(),
      ...reasonSchema.shape,
    })
    .strict(),
);
const dates = z
  .object({
    from: z.string(),
    to: z.string(),
    page: z.coerce.number().int().min(1).max(10000).default(1),
  })
  .strict();
add(
  'restaurant',
  'get',
  '/seller/restaurants/{restaurantId}/finance',
  statementSchema,
  undefined,
  dates,
);
add('rider', 'get', '/rider/earnings', statementSchema, undefined, dates);
const analytics = z
  .object({
    from: z.string(),
    to: z.string(),
    generatedAt: z.string().datetime(),
    timezone: z.literal('Asia/Kolkata'),
    mode: z.string(),
    byStatus: z.array(
      z
        .object({ status: z.string(), count: z.number().int(), valueMinor: z.number().int() })
        .strict(),
    ),
    popular: z.array(z.object({ name: z.string(), quantity: z.number().int() }).strict()),
    definition: z.string(),
  })
  .strict();
add(
  'restaurant',
  'get',
  '/seller/restaurants/{restaurantId}/analytics',
  analytics,
  undefined,
  periodQuerySchema as unknown as z.ZodObject,
);
add(
  'admin',
  'get',
  '/admin/reports',
  analytics,
  undefined,
  periodQuerySchema as unknown as z.ZodObject,
);
add(
  'admin',
  'post',
  '/admin/reports/export',
  z.object({ exportId: id, report: analytics }).strict(),
  z.object({ from: z.string(), to: z.string(), ...reasonSchema.shape }).strict(),
);
add(
  'restaurant',
  'get',
  '/seller/restaurants/{restaurantId}/history',
  page({
    orders: z.array(
      z
        .object({
          id,
          number: z.string(),
          status: z.string(),
          createdAt: z.string().datetime(),
          totalMinor: z.number().int().nonnegative(),
        })
        .strict(),
    ),
  }),
  undefined,
  pageQuerySchema,
);
add(
  'rider',
  'get',
  '/rider/history',
  page({
    deliveries: z.array(
      z
        .object({
          id,
          orderId: id,
          status: z.string(),
          restaurantName: z.string(),
          createdAt: z.string().datetime(),
          endedAt: z.string().datetime().nullable(),
        })
        .strict(),
    ),
  }),
  undefined,
  pageQuerySchema,
);
add(
  'admin',
  'get',
  '/admin/staff',
  z.array(
    z
      .object({
        id,
        name: z.string(),
        status: z.enum(['ACTIVE', 'SUSPENDED']),
        bundles: z.array(z.string()),
        version: z.number().int().nonnegative(),
        protected: z.boolean(),
      })
      .strict(),
  ),
);
add('admin', 'post', '/admin/staff', updated.extend({ version }), staffChangeSchema);
add(
  'admin',
  'get',
  '/admin/promotions',
  page({
    offers: z.array(
      offerInputSchema.safeExtend({
        id,
        restaurantId: id,
        version,
        usageUsed: z.number().int().optional(),
        usageReserved: z.number().int().optional(),
      }),
    ),
  }),
  undefined,
  pageQuerySchema,
);
add(
  'admin',
  'post',
  '/admin/promotions/{offerId}/state',
  updated,
  z.object({ expectedVersion: version, active: z.boolean(), ...reasonSchema.shape }).strict(),
);
add(
  'admin',
  'get',
  '/admin/audit/operations',
  z
    .object({
      entries: z.array(
        z
          .object({
            id,
            action: z.string(),
            actorId: id,
            reason: z.string(),
            at: z.string(),
            owner: z.string(),
          })
          .passthrough(),
      ),
      page: z.number().int(),
      generatedAt: z.string().datetime(),
      scope: z.string(),
    })
    .strict(),
  undefined,
  pageQuerySchema,
);
add(
  'admin',
  'get',
  '/admin/message-reports',
  page({
    reports: z.array(
      z
        .object({
          id,
          orderId: id,
          messageId: id,
          reason: z.string(),
          at: z.string().datetime(),
          state: z.literal('OPEN'),
          text: z.string(),
        })
        .strict(),
    ),
  }),
  undefined,
  pageQuerySchema,
);
add(
  'admin',
  'post',
  '/admin/message-reports/{reportId}/resolve',
  updated,
  z.object({ hidden: z.boolean(), ...reasonSchema.shape }).strict(),
);
writeFileSync('contracts/operations.openapi.json', JSON.stringify(paths, null, 2) + '\n');

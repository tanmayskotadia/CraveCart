import { writeFileSync } from 'node:fs';
import { z } from 'zod';
import {
  addressInputSchema,
  addressSchema,
  pointSchema,
  zoneInputSchema,
  restaurantInputSchema,
  restaurantSchema,
  menuItemInputSchema,
  menuItemSchema,
  offerInputSchema,
  offerSchema,
  cartInputSchema,
  cartSchema,
  serviceabilitySchema,
  errorSchema,
  uploadIntentSchema,
} from '../packages/contracts/src/index.js';
const paths: Record<string, Record<string, unknown>> = {};
const schema = (value: z.ZodType) =>
  z.toJSONSchema(value, { target: 'draft-2020-12', io: 'input', unrepresentable: 'any' });
const version = z.number().int().positive(),
  versionBody = z.object({ expectedVersion: version }).strict();
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
    operationId: `catalog_${method}_${path.replace(/[^a-zA-Z0-9]/g, '_')}`,
    tags: [owner],
    summary: `${method.toUpperCase()} ${path}`,
    'x-owner': owner,
    'x-contract-status': 'implementation-ready',
    'x-client-generation-ready': true,
    'x-authorization':
      options.policy ??
      (options.public
        ? 'Public published data only. Sample records are excluded in production.'
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
          'Current server-owned resource. Cart prices use integer INR minor units; no checkout quote, reservation or order is created.',
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
add('auth', 'get', '/addresses', z.array(addressSchema));
add('auth', 'post', '/addresses', addressSchema, addressInputSchema, { status: 201 });
add(
  'auth',
  'patch',
  '/addresses/{addressId}',
  addressSchema,
  addressInputSchema.extend({ expectedVersion: version }).strict(),
);
add('auth', 'delete', '/addresses/{addressId}', z.object({ deleted: z.literal(true) }));
add(
  'admin',
  'post',
  '/serviceability',
  serviceabilitySchema,
  z.object({ city: z.string().max(60), point: pointSchema }).strict(),
  {
    public: true,
    policy:
      'Public coordinate check, origin required. City plus exact delivery pin; inactive/missing/closed zones fail closed. This does not activate ordering.',
  },
);
const zoneSchema = zoneInputSchema.safeExtend({
  id: z.string().uuid(),
  version,
  country: z.literal('IN'),
  updatedAt: z.string().datetime(),
  sample: z.boolean().optional(),
});
add('admin', 'get', '/admin/zones', z.array(zoneSchema), undefined, {
  policy: 'Admin zones:read with verified MFA.',
});
const zoneWrite = z
  .object({
    zone: zoneInputSchema,
    reason: z.string().trim().min(5).max(500),
    expectedVersion: version.optional(),
  })
  .strict();
add('admin', 'post', '/admin/zones', zoneSchema, zoneWrite, {
  status: 201,
  policy:
    'Admin zones:write and MFA within five minutes; reason, origin and CSRF required. Polygon and audit commit together.',
});
add(
  'admin',
  'patch',
  '/admin/zones/{zoneId}',
  zoneSchema,
  zoneWrite.safeExtend({ expectedVersion: version }),
  {
    policy:
      'Admin zones:write with fresh MFA, origin and CSRF. Expected version is checked; audit and zone update are transactional.',
  },
);
const catalog = z
  .object({
    restaurant: restaurantSchema,
    items: z.array(menuItemSchema),
    offers: z.array(offerSchema),
  })
  .strict();
add('restaurant', 'get', '/seller/restaurants', z.array(restaurantSchema));
add('restaurant', 'get', '/seller/restaurants/{restaurantId}/catalog', catalog);
add(
  'restaurant',
  'put',
  '/seller/restaurants/{restaurantId}',
  restaurantSchema,
  z.object({ expectedVersion: version, restaurant: restaurantInputSchema }).strict(),
  {
    policy:
      'Verified seller and restaurant owner, expected-version CAS. Publishing requires an available dish, valid pickup pin and hours; uploaded image must be owned and checked.',
  },
);
add(
  'restaurant',
  'post',
  '/seller/restaurants/{restaurantId}/items',
  menuItemSchema,
  menuItemInputSchema,
  { status: 201, idempotent: true },
);
add(
  'restaurant',
  'put',
  '/seller/restaurants/{restaurantId}/items/{itemId}',
  menuItemSchema,
  z.object({ expectedVersion: version, item: menuItemInputSchema }).strict(),
);
add(
  'restaurant',
  'delete',
  '/seller/restaurants/{restaurantId}/items/{itemId}',
  z.object({ deleted: z.literal(true) }),
  versionBody,
);
add(
  'restaurant',
  'post',
  '/seller/restaurants/{restaurantId}/offers',
  offerSchema,
  z.object({ offer: offerInputSchema, expectedVersion: version.optional() }).strict(),
  { status: 201, idempotent: true },
);
add(
  'restaurant',
  'put',
  '/seller/restaurants/{restaurantId}/offers/{offerId}',
  offerSchema,
  z.object({ offer: offerInputSchema, expectedVersion: version }).strict(),
  { idempotent: true },
);
const search = z
  .object({
    city: z.string().max(60),
    q: z.string().max(100).default(''),
    cuisine: z.string().max(40).optional(),
    diet: z.enum(['veg', 'vegan', 'non-veg']).optional(),
    open: z.enum(['true', 'false']).optional(),
    minRating: z.coerce.number().min(0).max(5).default(0),
    maxPrice: z.coerce.number().int().positive().optional(),
    maxMinutes: z.coerce.number().int().positive().optional(),
    sort: z.enum(['name', 'price', 'preparation']).default('name'),
    page: z.coerce.number().int().min(1).max(100).default(1),
  })
  .strict();
add(
  'restaurant',
  'get',
  '/restaurants',
  z.object({
    restaurants: z.array(restaurantSchema),
    total: z.number().int().nonnegative(),
    page: version,
    pageSize: z.literal(12),
    orderingEnabled: z.boolean(),
  }),
  undefined,
  {
    public: true,
    query: search,
    policy:
      'Published restaurants with active seller membership. Bounded city catalog, deterministic sorting/pagination, restaurant/dish search, dietary and price/preparation filters. Ratings remain null until verified reviews exist; no fabricated ETA or rating.',
  },
);
add('restaurant', 'get', '/restaurants/{slug}', catalog, undefined, { public: true });
add('restaurant', 'get', '/offers', z.array(offerSchema), undefined, {
  public: true,
  query: z.object({ city: z.string().max(60) }).strict(),
});
add('restaurant', 'get', '/favorites', z.array(restaurantSchema));
add(
  'restaurant',
  'put',
  '/favorites/{restaurantId}',
  z.object({ favorite: z.boolean() }),
  z.object({ favorite: z.boolean() }).strict(),
);
add(
  'restaurant',
  'get',
  '/cart',
  z.object({ cart: cartSchema.nullable(), version: z.number().int().nonnegative() }).strict(),
);
add('restaurant', 'put', '/cart', cartSchema, cartInputSchema, {
  policy:
    'Owner only. Monotonic expected-version CAS; explicit replacement needed for another restaurant. Server re-reads own address, active shared polygon/hours, menu choices, aggregate stock and integer prices. No reservation or payment.',
});
add('restaurant', 'delete', '/cart', z.object({ cleared: z.literal(true), version }), versionBody, {
  policy:
    'Owner plus CSRF/origin and expected version. A versioned empty tombstone prevents stale writes after clear/recreate.',
});
add(
  'utils',
  'post',
  '/uploads/intents',
  z
    .object({
      uploadId: z.string().uuid(),
      uploadToken: z.string(),
      url: z.string(),
      expiresAt: z.string().datetime(),
      maxBytes: z.literal(5242880),
    })
    .strict(),
  uploadIntentSchema,
  {
    status: 201,
    policy:
      'Authenticated owner, origin and CSRF. Catalog-image purpose requires verified seller membership; verification purposes remain private.',
  },
);
add(
  'utils',
  'post',
  '/uploads/{uploadId}/complete',
  z
    .object({
      uploadId: z.string().uuid(),
      status: z.enum(['CLEAN', 'DEVELOPMENT_REVIEWABLE']),
      scanMethod: z.enum(['development', 'clamav']),
    })
    .strict(),
  z.object({}).strict(),
);
add(
  'utils',
  'get',
  '/uploads/{uploadId}/access',
  z
    .object({
      url: z.string(),
      filename: z.string(),
      mime: z.enum(['image/png', 'image/jpeg', 'application/pdf']),
      status: z.enum(['CLEAN', 'DEVELOPMENT_REVIEWABLE']),
    })
    .strict(),
  undefined,
  {
    policy:
      'Owner or permissioned verifier with fresh MFA and attached application; quarantine never serves content.',
  },
);
function binary(path: string, method: 'get' | 'put', mediaType: string, publicRead = false) {
  add(
    'utils',
    method,
    path,
    z.object({ uploadId: z.string().uuid(), status: z.literal('QUARANTINED') }).strict(),
    undefined,
    {
      public: publicRead,
      status: method === 'put' ? 201 : 200,
      policy: publicRead
        ? 'Only bound, checked catalog-image assets. WebP re-encoding strips metadata; verification documents are never public.'
        : 'Owner or fresh-MFA verifier with attached application for reads; owner plus one-use upload token, CSRF and origin for writes.',
    },
  );
  const operation = paths[path]![method] as {
    parameters: Array<unknown>;
    requestBody?: unknown;
    responses: Record<string, unknown>;
  };
  if (method === 'put') {
    operation.parameters.push({
      in: 'header',
      name: 'X-Upload-Token',
      required: true,
      schema: { type: 'string', minLength: 32 },
    });
    operation.requestBody = {
      required: true,
      content: {
        [mediaType]: { schema: { type: 'string', format: 'binary', maxLength: 5242880 } },
      },
    };
  } else
    operation.responses['200'] = {
      description: publicRead
        ? 'Checked public catalog WebP image.'
        : 'Private audited attachment; no-store and nosniff.',
      content: Object.fromEntries(
        (publicRead ? [mediaType] : ['image/png', 'image/jpeg', 'application/pdf']).map((type) => [
          type,
          { schema: { type: 'string', format: 'binary' } },
        ]),
      ),
    };
}
binary('/uploads/{uploadId}/content', 'put', 'application/octet-stream');
binary('/uploads/{uploadId}/content', 'get', 'application/octet-stream');
binary('/media/{uploadId}', 'get', 'image/webp', true);
writeFileSync('contracts/catalog.openapi.json', JSON.stringify(paths, null, 2) + '\n');

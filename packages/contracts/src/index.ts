import { z } from 'zod';
export { cityDirectory, findCity, nationalMarket, type DiscoveryCity } from './market.js';
export * from './identity.js';
export * from './catalog.js';
export * from './commerce.js';
export * from './fulfillment.js';

export const serviceNames = ['auth', 'restaurant', 'rider', 'admin', 'realtime', 'utils'] as const;
export type ServiceName = (typeof serviceNames)[number];
export const workspaceSchema = z.enum(['customer', 'seller', 'rider', 'admin']);
export type Workspace = z.infer<typeof workspaceSchema>;

export const platformSchema = z
  .object({
    data: z
      .object({
        name: z.literal('CraveCart'),
        market: z
          .object({
            country: z.literal('IN'),
            scope: z.literal('national'),
            currency: z.literal('INR'),
            timezone: z.literal('Asia/Kolkata'),
          })
          .strict(),
        capabilities: z
          .object({
            ordering: z.boolean(),
            authentication: z.boolean(),
            liveTracking: z.literal(false),
            assistant: z.literal(false),
          })
          .strict(),
        serviceability: z.enum(['not-configured', 'coordinate-check-required']),
      })
      .strict(),
    meta: z.object({ requestId: z.string().uuid() }).strict(),
  })
  .strict();
export type PlatformResponse = z.infer<typeof platformSchema>;
export const emptyQuerySchema = z.object({}).strict();

export const errorSchema = z
  .object({
    error: z
      .object({
        code: z.string(),
        message: z.string(),
        requestId: z.string().uuid(),
        retryable: z.boolean(),
      })
      .strict(),
  })
  .strict();

export const domainEventSchema = z
  .object({
    eventId: z.string().uuid(),
    eventType: z.string().regex(/^[a-z]+\.[a-z-]+\.v1$/),
    schemaVersion: z.literal(1),
    occurredAt: z.iso.datetime(),
    producer: z.enum(serviceNames),
    aggregate: z
      .object({
        type: z.string().min(1),
        id: z.string().min(6),
        version: z.number().int().positive(),
      })
      .strict(),
    correlationId: z.string().min(6),
    causationId: z.string().min(6),
    data: z.record(z.string(), z.unknown()),
  })
  .strict();
export type DomainEvent = z.infer<typeof domainEventSchema>;

/** Forward only canonical UUIDs. Never echo arbitrary request header content. */
export function isRequestId(value: unknown): value is string {
  return z.string().uuid().safeParse(value).success;
}
export * from './operations.js';
export * from './assistant.js';

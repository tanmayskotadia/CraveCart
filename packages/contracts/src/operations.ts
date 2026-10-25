import { z } from 'zod';
export const pageQuerySchema = z
  .object({ page: z.coerce.number().int().min(1).max(10000).default(1) })
  .strict();
const day = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine(
    (v) => !Number.isNaN(Date.parse(v)) && new Date(v).toISOString().slice(0, 10) === v,
    'Choose a valid date',
  );
export const periodQuerySchema = z
  .object({ from: day, to: day })
  .strict()
  .refine((v) => {
    const span = Date.parse(v.to) - Date.parse(v.from);
    return span >= 0 && span <= 92 * 86400000;
  }, 'Choose a period of at most 93 days');
export function periodBounds(input: z.infer<typeof periodQuerySchema>) {
  return {
    from: new Date(input.from + 'T00:00:00+05:30').toISOString(),
    to: new Date(Date.parse(input.to + 'T00:00:00+05:30') + 86400000).toISOString(),
  };
}
export const messageInputSchema = z
  .object({
    text: z.string().trim().min(1).max(2000),
    expectedVersion: z.number().int().positive(),
  })
  .strict();
export const ticketInputSchema = z
  .object({
    subject: z.string().trim().min(5).max(120),
    category: z.enum(['order', 'payment', 'account', 'restaurant', 'delivery', 'other']),
    orderId: z.string().uuid().nullable(),
    text: z.string().trim().min(5).max(2000),
  })
  .strict();
export const ticketStateSchema = z.enum([
  'OPEN',
  'AWAITING_CUSTOMER',
  'ESCALATED',
  'RESOLVED',
  'CLOSED',
]);
export const ticketSchema = z
  .object({
    id: z.string().uuid(),
    requesterId: z.string().uuid(),
    subject: z.string(),
    category: ticketInputSchema.shape.category,
    orderId: z.string().uuid().nullable(),
    state: ticketStateSchema,
    version: z.number().int().positive(),
    assignedTo: z.string().uuid().nullable(),
    createdAt: z.string().datetime(),
    updatedAt: z.string().datetime(),
    resolution: z.string().nullable(),
  })
  .strict();
export const messageSchema = z
  .object({
    id: z.string().uuid(),
    sequence: z.number().int().positive(),
    author: z.enum(['requester', 'agent', 'customer', 'rider']),
    text: z.string(),
    at: z.string().datetime(),
  })
  .strict();
export const ticketDetailSchema = z
  .object({
    ticket: ticketSchema,
    messages: z.array(messageSchema),
    total: z.number().int().nonnegative(),
    page: z.number().int().positive(),
  })
  .strict();
export const ticketActionSchema = z
  .object({
    expectedVersion: z.number().int().positive(),
    state: ticketStateSchema,
    reason: z.string().trim().min(5).max(500),
  })
  .strict();
export const reviewInputSchema = z
  .object({ rating: z.number().int().min(1).max(5), text: z.string().trim().min(5).max(1500) })
  .strict();
export const reviewSchema = z
  .object({
    id: z.string().uuid(),
    orderId: z.string().uuid(),
    restaurantId: z.string().uuid(),
    rating: z.number().int().min(1).max(5),
    text: z.string(),
    at: z.string().datetime(),
    version: z.number().int().positive(),
    response: z.string().nullable(),
    moderation: z.enum(['VISIBLE', 'HIDDEN']),
  })
  .strict();
export const reviewReplySchema = z
  .object({
    expectedVersion: z.number().int().positive(),
    text: z.string().trim().min(5).max(1000),
  })
  .strict();
export const reasonSchema = z.object({ reason: z.string().trim().min(5).max(500) }).strict();
export const staffBundles = {
  support: ['support:read', 'support:write'],
  analyst: ['reports:read'],
  finance: ['finance:read'],
  auditor: ['audit:read'],
  operations: ['dispatch:read', 'dispatch:write', 'zones:read'],
} as const;
export const staffChangeSchema = z
  .object({
    userId: z.string().uuid(),
    expectedVersion: z.number().int().nonnegative(),
    bundles: z.array(z.enum(['support', 'analyst', 'finance', 'auditor', 'operations'])).max(5),
    reason: z.string().trim().min(5).max(500),
  })
  .strict();
export type SupportTicket = z.infer<typeof ticketSchema>;
export type OperationMessage = z.infer<typeof messageSchema>;
export type Review = z.infer<typeof reviewSchema>;
export const statementRowSchema = z
  .object({
    orderId: z.string().uuid(),
    number: z.string(),
    status: z.string(),
    createdAt: z.string().datetime(),
    grossMinor: z.number().int().nonnegative(),
    capturedMinor: z.number().int().nonnegative(),
    refundedMinor: z.number().int().nonnegative(),
    tipMinor: z.number().int().nonnegative(),
  })
  .strict();
export const statementSchema = z
  .object({
    from: z.string(),
    to: z.string(),
    generatedAt: z.string().datetime(),
    timezone: z.literal('Asia/Kolkata'),
    currency: z.literal('INR'),
    mode: z.string(),
    rows: z.array(statementRowSchema),
    total: z.number().int().nonnegative(),
    page: z.number().int().positive(),
    totals: z
      .object({
        grossMinor: z.number(),
        capturedMinor: z.number(),
        refundedMinor: z.number(),
        tipMinor: z.number(),
      })
      .strict(),
    settlementStatus: z.literal('UNRECONCILED'),
    commissionMinor: z.null(),
    payableMinor: z.null(),
    notice: z.string(),
  })
  .strict();
export type Statement = z.infer<typeof statementSchema>;

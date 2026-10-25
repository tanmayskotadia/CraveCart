import { z } from 'zod';
export const privacyRequestInputSchema = z
  .object({ kind: z.enum(['export', 'delete']), confirmed: z.literal(true) })
  .strict();
export const privacyDecisionSchema = z
  .object({
    expectedVersion: z.number().int().positive(),
    action: z.enum(['approve', 'reject', 'retry']),
    reason: z.string().trim().min(5).max(500),
  })
  .strict();
export const privacyRequestSchema = z
  .object({
    id: z.string().uuid(),
    userId: z.string().uuid(),
    kind: z.enum(['export', 'delete']),
    status: z.enum([
      'AWAITING_REVIEW',
      'PREFLIGHT',
      'PROCESSING',
      'BLOCKED',
      'READY',
      'COMPLETED_WITH_RETENTION',
      'REJECTED',
      'CANCELLED',
    ]),
    version: z.number().int().positive(),
    requestedAt: z.string().datetime(),
    reviewedBy: z.string().uuid().nullable(),
    reviewReason: z.string().nullable(),
    completedAt: z.string().datetime().nullable(),
    downloadExpiresAt: z.string().datetime().nullable(),
    progress: z.number().int().nonnegative(),
    message: z.string(),
    retained: z.array(z.string()),
  })
  .strict();
export type PrivacyRequest = z.infer<typeof privacyRequestSchema>;

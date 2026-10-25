import { z } from 'zod';
export const policyKindSchema = z.enum(['terms', 'privacy', 'cancellations']);
export const policyContentSchema = z
  .object({
    title: z.string().trim().min(3).max(180),
    body: z.string().trim().min(100).max(50000),
    businessName: z.string().trim().min(2).max(180),
    businessAddress: z.string().trim().min(10).max(1000),
    supportEmail: z.email().max(254),
    grievanceContact: z.string().trim().min(3).max(500),
  })
  .strict();
export const publishedPolicySchema = policyContentSchema
  .extend({
    id: z.string().uuid(),
    kind: policyKindSchema,
    version: z.number().int().positive(),
    publishedAt: z.string().datetime(),
  })
  .strict();
export const policyReferenceSchema = z
  .object({ id: z.string().uuid(), kind: policyKindSchema, version: z.number().int().positive() })
  .strict();
export const policyDraftSchema = z
  .object({
    expectedVersion: z.number().int().nonnegative(),
    content: policyContentSchema,
    reason: z.string().trim().min(5).max(500),
  })
  .strict();
export const policyPublishSchema = z
  .object({
    expectedVersion: z.number().int().positive(),
    reason: z.string().trim().min(5).max(500),
  })
  .strict();
export const policyAdminSchema = z
  .object({
    kind: policyKindSchema,
    version: z.number().int().nonnegative(),
    draft: policyContentSchema.nullable(),
    draftBy: z.string().uuid().nullable(),
    published: publishedPolicySchema.nullable(),
  })
  .strict();
export const settingsSchema = z
  .object({
    policies: z.array(policyAdminSchema),
    commerceMode: z.enum(['disabled', 'development', 'test', 'live']),
    financeThresholdMinor: z.number().int().nonnegative(),
  })
  .strict();
export type PolicyKind = z.infer<typeof policyKindSchema>;
export type PolicyContent = z.infer<typeof policyContentSchema>;
export type PublishedPolicy = z.infer<typeof publishedPolicySchema>;
export type PolicyAdmin = z.infer<typeof policyAdminSchema>;

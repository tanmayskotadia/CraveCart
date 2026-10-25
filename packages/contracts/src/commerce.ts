import { z } from 'zod';
import { addressSchema, cartLineInputSchema, cartSchema } from './catalog.js';
import { policyReferenceSchema } from './settings.js';
export const reorderInputSchema = z.object({ addressId: z.string().uuid() }).strict();
export const reorderConfirmSchema = z
  .object({
    previewId: z.string().uuid(),
    expectedCartVersion: z.number().int().nonnegative(),
    replace: z.boolean(),
  })
  .strict();
export const reorderPreviewSchema = z
  .object({
    id: z.string().uuid(),
    orderId: z.string().uuid(),
    restaurantName: z.string(),
    addressId: z.string().uuid(),
    lines: cartSchema.shape.lines,
    subtotalMinor: z.number().int().nonnegative(),
    issues: z.array(z.string()),
    cartVersion: z.number().int().nonnegative(),
    replacesCart: z.boolean(),
    expiresAt: z.string().datetime(),
  })
  .strict();
export type ReorderPreview = z.infer<typeof reorderPreviewSchema>;
export const financialApprovalSchema = z
  .object({
    id: z.string().uuid(),
    orderId: z.string().uuid(),
    orderNumber: z.string(),
    orderVersion: z.number().int().positive(),
    amountMinor: z.number().int().positive(),
    reason: z.string(),
    requestedBy: z.string().uuid(),
    requestedAt: z.string().datetime(),
    expiresAt: z.string().datetime(),
    status: z.enum(['PENDING', 'AUTHORIZED', 'REJECTED', 'EXPIRED']),
    version: z.number().int().positive(),
    reviewedBy: z.string().uuid().nullable(),
    reviewReason: z.string().nullable(),
    reviewedAt: z.string().datetime().nullable(),
    refundId: z.string().uuid().nullable(),
    thresholdMinor: z.number().int().nonnegative(),
    mode: z.enum(['disabled', 'development', 'test', 'live']),
  })
  .strict();
export const financialApprovalDecisionSchema = z
  .object({
    expectedVersion: z.number().int().positive(),
    decision: z.enum(['approve', 'reject']),
    reason: z.string().trim().min(5).max(500),
  })
  .strict();
export const financialApprovalQuerySchema = z
  .object({ page: z.coerce.number().int().min(1).max(10000).default(1) })
  .strict();
export const financialApprovalListSchema = z
  .object({
    approvals: z.array(financialApprovalSchema),
    page: z.number().int().positive(),
    pageSize: z.literal(20),
    total: z.number().int().nonnegative(),
    thresholdMinor: z.number().int().nonnegative(),
  })
  .strict();
export type FinancialApproval = z.infer<typeof financialApprovalSchema>;
export type FinancialApprovalList = z.infer<typeof financialApprovalListSchema>;
export const gatewaySchema = z.enum(['razorpay', 'stripe']);
export const commerceModeSchema = z.enum(['disabled', 'development', 'test', 'live']);
export type Gateway = z.infer<typeof gatewaySchema>;
export type CommerceMode = z.infer<typeof commerceModeSchema>;
export const minorSchema = z.number().int().min(0).max(100_000_000);
export const pricingPolicyInputSchema = z
  .object({
    enabled: z.boolean(),
    approvedForLive: z.boolean(),
    platformFeeMinor: minorSchema,
    taxBps: z.number().int().min(0).max(10000),
    taxLabel: z.string().trim().min(2).max(100),
    quoteSeconds: z.number().int().min(30).max(900),
    paymentSeconds: z.number().int().min(60).max(1800),
    cancellationSeconds: z.number().int().min(0).max(1800),
    maxOrderMinor: z.number().int().min(100).max(100_000_000),
  })
  .strict();
export const pricingPolicySchema = pricingPolicyInputSchema
  .extend({ version: z.number().int().positive(), development: z.boolean() })
  .strict();
export type PricingPolicy = z.infer<typeof pricingPolicySchema>;
export const merchantLaunchQuerySchema = z
  .object({
    page: z.coerce.number().int().min(1).max(10000).default(1),
    restaurantId: z.string().uuid().optional(),
  })
  .strict();
export const merchantLaunchInputSchema = z
  .object({
    expectedVersion: z.number().int().positive(),
    approved: z.boolean(),
    reason: z.string().trim().min(5).max(500),
  })
  .strict();
export const merchantLaunchRecordSchema = z
  .object({
    id: z.string().uuid(),
    name: z.string(),
    city: z.string(),
    version: z.number().int().positive(),
    published: z.boolean(),
    paused: z.boolean(),
    sample: z.boolean(),
    liveOrderingApproved: z.boolean(),
  })
  .strict();
export const merchantLaunchListSchema = z
  .object({
    merchants: z.array(merchantLaunchRecordSchema),
    page: z.number().int(),
    pageSize: z.literal(20),
    total: z.number().int(),
  })
  .strict();
export type MerchantLaunchRecord = z.infer<typeof merchantLaunchRecordSchema>;
export type MerchantLaunchList = z.infer<typeof merchantLaunchListSchema>;
export const totalsSchema = z
  .object({
    currency: z.literal('INR'),
    subtotalMinor: minorSchema,
    discountMinor: minorSchema,
    deliveryFeeMinor: minorSchema,
    platformFeeMinor: minorSchema,
    taxMinor: minorSchema,
    tipMinor: minorSchema,
    totalMinor: minorSchema,
    taxLabel: z.string(),
  })
  .strict();
export type Totals = z.infer<typeof totalsSchema>;
export const quoteInputSchema = z
  .object({
    cartVersion: z.number().int().positive(),
    offerCode: z
      .string()
      .trim()
      .toUpperCase()
      .regex(/^[A-Z0-9]{3,20}$/)
      .optional(),
    tipMinor: z.number().int().min(0).max(100000).default(0),
  })
  .strict();
export const lineSnapshotSchema = cartLineInputSchema.safeExtend({
  name: z.string(),
  selection: z.array(z.string()),
  unitPriceMinor: minorSchema,
  itemVersion: z.number().int().positive(),
});
export const quoteSchema = z
  .object({
    id: z.string().uuid(),
    cartVersion: z.number().int().positive(),
    restaurant: z
      .object({ id: z.string().uuid(), name: z.string(), slug: z.string(), address: z.string() })
      .strict(),
    address: addressSchema,
    lines: z.array(lineSnapshotSchema),
    totals: totalsSchema,
    offerCode: z.string().nullable(),
    expiresAt: z.string().datetime(),
    policyVersion: z.number().int().positive(),
    zoneVersion: z.number().int().positive(),
    feePolicyVersion: z.number().int().positive(),
    mode: commerceModeSchema,
    development: z.boolean(),
    warnings: z.array(z.string()),
    policies: z.array(policyReferenceSchema).max(3).optional(),
  })
  .strict();
export type Quote = z.infer<typeof quoteSchema>;
export const orderStatusSchema = z.enum([
  'PAYMENT_PENDING',
  'PLACED',
  'ACCEPTED',
  'PREPARING',
  'READY_FOR_PICKUP',
  'PICKED_UP',
  'OUT_FOR_DELIVERY',
  'DELIVERED',
  'REJECTED',
  'CANCELLED',
  'EXPIRED',
]);
export const paymentStateSchema = z.enum([
  'UNPAID',
  'CAPTURED',
  'REFUND_PENDING',
  'PARTIALLY_REFUNDED',
  'REFUNDED',
]);
export const orderSchema = z
  .object({
    id: z.string().uuid(),
    number: z.string(),
    version: z.number().int().positive(),
    status: orderStatusSchema,
    paymentState: paymentStateSchema,
    gateway: gatewaySchema,
    attemptId: z.string().uuid(),
    quote: quoteSchema,
    createdAt: z.string().datetime(),
    paymentDeadline: z.string().datetime(),
    placedAt: z.string().datetime().nullable(),
    cancelledAt: z.string().datetime().nullable(),
    cancellationReason: z.string().nullable(),
    refundRequestedMinor: minorSchema,
    refundedMinor: minorSchema,
    timeline: z.array(
      z.object({ at: z.string().datetime(), status: z.string(), message: z.string() }).strict(),
    ),
  })
  .strict();
export type Order = z.infer<typeof orderSchema>;
export const createOrderSchema = z
  .object({
    quoteId: z.string().uuid(),
    gateway: gatewaySchema,
    acceptedPolicyIds: z.array(z.string().uuid()).max(3).optional(),
  })
  .strict();
export const cancelOrderSchema = z
  .object({
    expectedVersion: z.number().int().positive(),
    reason: z.string().trim().min(5).max(500),
  })
  .strict();
export const paymentAttemptSchema = z
  .object({
    id: z.string().uuid(),
    orderId: z.string().uuid(),
    gateway: gatewaySchema,
    mode: commerceModeSchema,
    state: z.enum(['NEW', 'CREATING', 'READY', 'UNKNOWN', 'CAPTURED', 'CLOSED']),
    amountMinor: minorSchema,
    currency: z.literal('INR'),
    providerId: z.string().nullable(),
    checkoutUrl: z.string().nullable(),
    publicKey: z.string().nullable(),
    lastError: z.string().nullable(),
    reconciliationRequired: z.boolean(),
    createdAt: z.string().datetime(),
    updatedAt: z.string().datetime(),
  })
  .strict();
export type PaymentAttempt = z.infer<typeof paymentAttemptSchema>;
export const refundSchema = z
  .object({
    id: z.string().uuid(),
    orderId: z.string().uuid(),
    gateway: gatewaySchema,
    mode: commerceModeSchema,
    amountMinor: minorSchema,
    currency: z.literal('INR'),
    state: z.enum(['NEW', 'PROCESSING', 'PENDING', 'PROCESSED', 'FAILED', 'UNKNOWN']),
    providerId: z.string().nullable(),
    reason: z.string(),
    createdAt: z.string().datetime(),
    updatedAt: z.string().datetime(),
    lastError: z.string().nullable(),
  })
  .strict();
export type Refund = z.infer<typeof refundSchema>;
export interface PayableOrder {
  orderId: string;
  userId: string;
  attemptId: string;
  gateway: Gateway;
  mode: CommerceMode;
  amountMinor: number;
  currency: 'INR';
  status: z.infer<typeof orderStatusSchema>;
  paymentDeadline: string;
  restaurantName: string;
}
export function calculateTotals(
  subtotalMinor: number,
  discountMinor: number,
  deliveryFeeMinor: number,
  tipMinor: number,
  policy: PricingPolicy,
): Totals {
  const taxable = subtotalMinor - discountMinor;
  if (!Number.isSafeInteger(taxable) || taxable < 0) throw new Error('Invalid price inputs');
  const taxMinor = Math.floor((taxable * policy.taxBps + 5000) / 10000),
    totalMinor = taxable + deliveryFeeMinor + policy.platformFeeMinor + taxMinor + tipMinor;
  return totalsSchema.parse({
    currency: 'INR',
    subtotalMinor,
    discountMinor,
    deliveryFeeMinor,
    platformFeeMinor: policy.platformFeeMinor,
    taxMinor,
    tipMinor,
    totalMinor,
    taxLabel: policy.taxLabel,
  });
}

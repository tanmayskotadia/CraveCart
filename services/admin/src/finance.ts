import express, { type Express } from 'express';
import { z } from 'zod';
import {
  pricingPolicyInputSchema,
  merchantLaunchInputSchema,
  merchantLaunchQuerySchema,
  financialApprovalQuerySchema,
  financialApprovalDecisionSchema,
} from '@cravecart/contracts';
import {
  remoteSession,
  currentPrincipal,
  internalCall,
  checkedId,
  json,
  requireIdempotency,
  type DomainContext,
} from '@cravecart/platform';
export function installFinance(app: Express, ctx: DomainContext) {
  const router = express.Router();
  router.get(
    '/commerce/merchants',
    remoteSession(ctx, { permission: 'finance:read' }),
    async (req, res) => {
      const input = merchantLaunchQuerySchema.parse(req.query);
      json(
        res,
        await internalCall(ctx, 'restaurant', '/internal/v1/commerce/merchants', {
          ...input,
          actorSessionId: currentPrincipal(res).sessionId,
        }),
      );
    },
  );
  router.put(
    '/commerce/merchants/:restaurantId',
    remoteSession(ctx, { permission: 'finance:write', stepUp: true, mutation: true }),
    async (req, res) => {
      const input = merchantLaunchInputSchema.parse(req.body);
      json(
        res,
        await internalCall(ctx, 'restaurant', '/internal/v1/commerce/merchant-approval', {
          ...input,
          restaurantId: checkedId(req.params.restaurantId),
          actorSessionId: currentPrincipal(res).sessionId,
        }),
      );
    },
  );
  router.get('/finance', remoteSession(ctx, { permission: 'finance:read' }), async (_req, res) =>
    json(
      res,
      await internalCall(ctx, 'utils', '/internal/v1/finance/report', {
        actorSessionId: currentPrincipal(res).sessionId,
      }),
    ),
  );
  router.post(
    '/finance/reconcile',
    remoteSession(ctx, { permission: 'finance:write', stepUp: true, mutation: true }),
    async (req, res) => {
      const body = z
        .object({ reason: z.string().trim().min(5).max(500) })
        .strict()
        .parse(req.body);
      const actorSessionId = currentPrincipal(res).sessionId;
      await internalCall(ctx, 'restaurant', '/internal/v1/orders/retry-refunds', {
        ...body,
        actorSessionId,
      });
      json(
        res,
        await internalCall(ctx, 'utils', '/internal/v1/finance/reconcile', {
          ...body,
          actorSessionId,
        }),
        202,
      );
    },
  );
  router.post(
    '/finance/attach-reference',
    remoteSession(ctx, { permission: 'finance:write', stepUp: true, mutation: true }),
    async (req, res) => {
      const body = z
        .object({
          attemptId: z.string().uuid(),
          providerId: z
            .string()
            .regex(/^[A-Za-z0-9_]+$/)
            .max(180),
          reason: z.string().trim().min(5).max(500),
        })
        .strict()
        .parse(req.body);
      json(
        res,
        await internalCall(ctx, 'utils', '/internal/v1/finance/attach-reference', {
          ...body,
          actorSessionId: currentPrincipal(res).sessionId,
        }),
      );
    },
  );
  router.post(
    '/finance/attach-refund-reference',
    remoteSession(ctx, { permission: 'finance:write', stepUp: true, mutation: true }),
    async (req, res) => {
      const body = z
        .object({
          refundId: z.string().uuid(),
          providerId: z
            .string()
            .regex(/^[A-Za-z0-9_]+$/)
            .max(180),
          reason: z.string().min(5).max(500),
        })
        .strict()
        .parse(req.body);
      json(
        res,
        await internalCall(ctx, 'utils', '/internal/v1/finance/attach-refund-reference', {
          ...body,
          actorSessionId: currentPrincipal(res).sessionId,
        }),
      );
    },
  );
  router.get(
    '/commerce/policy',
    remoteSession(ctx, { permission: 'finance:read' }),
    async (_req, res) =>
      json(
        res,
        await internalCall(ctx, 'restaurant', '/internal/v1/commerce/policy-read', {
          actorSessionId: currentPrincipal(res).sessionId,
        }),
      ),
  );
  router.put(
    '/commerce/policy',
    remoteSession(ctx, { permission: 'finance:write', stepUp: true, mutation: true }),
    async (req, res) => {
      const body = z
        .object({
          expectedVersion: z.number().int().min(0),
          policy: pricingPolicyInputSchema,
          reason: z.string().trim().min(5).max(500),
        })
        .strict()
        .parse(req.body);
      json(
        res,
        await internalCall(ctx, 'restaurant', '/internal/v1/commerce/policy', {
          ...body,
          actorSessionId: currentPrincipal(res).sessionId,
        }),
      );
    },
  );
  router.post(
    '/restaurants/:restaurantId/commerce',
    remoteSession(ctx, { permission: 'finance:write', stepUp: true, mutation: true }),
    async (req, res) => {
      const body = z
        .object({ approved: z.boolean(), reason: z.string().trim().min(5).max(500) })
        .strict()
        .parse(req.body);
      json(
        res,
        await internalCall(ctx, 'restaurant', '/internal/v1/commerce/merchant', {
          ...body,
          restaurantId: checkedId(req.params.restaurantId),
          actorSessionId: currentPrincipal(res).sessionId,
        }),
      );
    },
  );
  router.get('/orders', remoteSession(ctx, { permission: 'finance:read' }), async (_req, res) =>
    json(
      res,
      await internalCall(ctx, 'restaurant', '/internal/v1/orders/admin-list', {
        actorSessionId: currentPrincipal(res).sessionId,
      }),
    ),
  );
  router.get(
    '/orders/:orderId',
    remoteSession(ctx, { permission: 'finance:read' }),
    async (req, res) =>
      json(
        res,
        await internalCall(ctx, 'restaurant', '/internal/v1/orders/admin-read', {
          orderId: checkedId(req.params.orderId),
          actorSessionId: currentPrincipal(res).sessionId,
        }),
      ),
  );
  router.post(
    '/orders/:orderId/refund',
    remoteSession(ctx, { permission: 'finance:write', stepUp: true, mutation: true }),
    async (req, res) => {
      const body = z
        .object({
          expectedVersion: z.number().int().positive(),
          amountMinor: z.number().int().positive(),
          reason: z.string().trim().min(5).max(500),
        })
        .strict()
        .parse(req.body);
      json(
        res,
        await internalCall(ctx, 'restaurant', '/internal/v1/orders/admin-refund', {
          ...body,
          orderId: checkedId(req.params.orderId),
          actorSessionId: currentPrincipal(res).sessionId,
          commandId: requireIdempotency(req),
        }),
        202,
      );
    },
  );
  router.get(
    '/finance/approvals',
    remoteSession(ctx, { permission: 'finance:read' }),
    async (req, res) => {
      const query = financialApprovalQuerySchema.parse(req.query);
      json(
        res,
        await internalCall(ctx, 'restaurant', '/internal/v1/orders/financial-approvals/list', {
          actorSessionId: currentPrincipal(res).sessionId,
          ...query,
        }),
      );
    },
  );
  router.post(
    '/finance/approvals/:approvalId/decision',
    remoteSession(ctx, { permission: 'finance:write', stepUp: true, mutation: true }),
    async (req, res) => {
      const body = financialApprovalDecisionSchema.parse(req.body);
      json(
        res,
        await internalCall(ctx, 'restaurant', '/internal/v1/orders/financial-approvals/decide', {
          ...body,
          approvalId: checkedId(req.params.approvalId),
          actorSessionId: currentPrincipal(res).sessionId,
          commandId: requireIdempotency(req),
        }),
        202,
      );
    },
  );
  router.get('/refunds', remoteSession(ctx, { permission: 'finance:read' }), async (_req, res) => {
    const report = await internalCall<{ refunds: unknown[] }>(
      ctx,
      'utils',
      '/internal/v1/finance/report',
      { actorSessionId: currentPrincipal(res).sessionId },
    );
    json(res, report.refunds);
  });
  router.get(
    '/refunds/:refundId',
    remoteSession(ctx, { permission: 'finance:read' }),
    async (req, res) =>
      json(
        res,
        await internalCall(ctx, 'utils', '/internal/v1/finance/refund-read', {
          refundId: checkedId(req.params.refundId),
          actorSessionId: currentPrincipal(res).sessionId,
        }),
      ),
  );
  app.use('/api/v1/admin', router);
}

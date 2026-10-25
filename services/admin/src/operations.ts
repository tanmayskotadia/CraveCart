import type { Express } from 'express';
import { randomUUID } from 'node:crypto';
import { executeOnce } from '@cravecart/persistence';
import { z } from 'zod';
import {
  pageQuerySchema,
  periodQuerySchema,
  staffChangeSchema,
  reasonSchema,
} from '@cravecart/contracts';
import {
  remoteSession,
  currentPrincipal,
  internalCall,
  checkedId,
  requireIdempotency,
  json,
  type DomainContext,
} from '@cravecart/platform';
export function installAdminOperations(app: Express, ctx: DomainContext) {
  app.post(
    '/api/v1/admin/reports/export',
    remoteSession(ctx, { permission: 'reports:read', stepUp: true, mutation: true }),
    async (req, res) => {
      const input = z
          .object({ from: z.string(), to: z.string(), reason: z.string().trim().min(5).max(500) })
          .strict()
          .parse(req.body),
        period = periodQuerySchema.parse({ from: input.from, to: input.to }),
        actor = currentPrincipal(res);
      const report = await internalCall(ctx, 'restaurant', '/internal/v1/operations/report', {
        ...period,
        actorSessionId: actor.sessionId,
      });
      json(
        res,
        await executeOnce(
          ctx.client,
          ctx.db,
          actor.userId + ':report-export',
          requireIdempotency(req),
          input,
          async (session) => {
            const exportId = randomUUID();
            await ctx.db.collection('audit').insertOne(
              {
                id: exportId,
                actorId: actor.userId,
                action: 'report.export',
                reason: input.reason,
                from: period.from,
                to: period.to,
                at: new Date().toISOString(),
                scope: 'Aggregated current-status order report; no personal data',
                requestId: res.locals.requestId,
              },
              { session },
            );
            return { exportId, report };
          },
        ),
      );
    },
  );
  app.get(
    '/api/v1/admin/message-reports',
    remoteSession(ctx, { permission: 'support:read' }),
    async (req, res) => {
      const { page } = pageQuerySchema.parse(req.query);
      json(
        res,
        await internalCall(ctx, 'realtime', '/internal/v1/message-operations/reports', {
          page,
          actorSessionId: currentPrincipal(res).sessionId,
        }),
      );
    },
  );
  app.post(
    '/api/v1/admin/message-reports/:reportId/resolve',
    remoteSession(ctx, { permission: 'support:write', stepUp: true, mutation: true }),
    async (req, res) => {
      const input = z
        .object({ hidden: z.boolean(), ...reasonSchema.shape })
        .strict()
        .parse(req.body);
      json(
        res,
        await internalCall(ctx, 'realtime', '/internal/v1/message-operations/resolve', {
          ...input,
          reportId: checkedId(req.params.reportId),
          actorSessionId: currentPrincipal(res).sessionId,
          commandId: requireIdempotency(req),
        }),
      );
    },
  );
  app.get(
    '/api/v1/admin/reports',
    remoteSession(ctx, { permission: 'reports:read' }),
    async (req, res) => {
      const dates = periodQuerySchema.parse(req.query);
      json(
        res,
        await internalCall(ctx, 'restaurant', '/internal/v1/operations/report', {
          ...dates,
          actorSessionId: currentPrincipal(res).sessionId,
        }),
      );
    },
  );
  app.get(
    '/api/v1/admin/staff',
    remoteSession(ctx, { permission: 'staff:read' }),
    async (_req, res) =>
      json(
        res,
        await internalCall(ctx, 'auth', '/internal/v1/governance/staff', {
          actorSessionId: currentPrincipal(res).sessionId,
        }),
      ),
  );
  app.post(
    '/api/v1/admin/staff',
    remoteSession(ctx, { permission: 'staff:write', stepUp: true, mutation: true }),
    async (req, res) => {
      const input = staffChangeSchema.parse(req.body);
      requireIdempotency(req);
      json(
        res,
        await internalCall(ctx, 'auth', '/internal/v1/governance/staff-change', {
          ...input,
          actorSessionId: currentPrincipal(res).sessionId,
          commandId: req.get('Idempotency-Key'),
        }),
      );
    },
  );
  for (const [resource, permission] of [
    ['reviews', 'support:read'],
    ['promotions', 'promotions:read'],
  ] as const) {
    app.get('/api/v1/admin/' + resource, remoteSession(ctx, { permission }), async (req, res) => {
      const { page } = pageQuerySchema.parse(req.query);
      json(
        res,
        await internalCall(ctx, 'restaurant', '/internal/v1/operations/' + resource, {
          page,
          actorSessionId: currentPrincipal(res).sessionId,
        }),
      );
    });
  }
  app.post(
    '/api/v1/admin/reviews/:reviewId/moderation',
    remoteSession(ctx, { permission: 'support:write', stepUp: true, mutation: true }),
    async (req, res) => {
      const input = z
        .object({
          expectedVersion: z.number().int().positive(),
          hidden: z.boolean(),
          ...reasonSchema.shape,
        })
        .strict()
        .parse(req.body);
      const key = requireIdempotency(req);
      json(
        res,
        await internalCall(ctx, 'restaurant', '/internal/v1/operations/moderate-review', {
          ...input,
          reviewId: checkedId(req.params.reviewId),
          actorSessionId: currentPrincipal(res).sessionId,
          commandId: key,
        }),
      );
    },
  );
  app.post(
    '/api/v1/admin/promotions/:offerId/state',
    remoteSession(ctx, { permission: 'promotions:write', stepUp: true, mutation: true }),
    async (req, res) => {
      const input = z
        .object({
          expectedVersion: z.number().int().positive(),
          active: z.boolean(),
          ...reasonSchema.shape,
        })
        .strict()
        .parse(req.body);
      const key = requireIdempotency(req);
      json(
        res,
        await internalCall(ctx, 'restaurant', '/internal/v1/operations/promotion-state', {
          ...input,
          offerId: checkedId(req.params.offerId),
          actorSessionId: currentPrincipal(res).sessionId,
          commandId: key,
        }),
      );
    },
  );
  app.get(
    '/api/v1/admin/audit/operations',
    remoteSession(ctx, { permission: 'audit:read' }),
    async (req, res) => {
      const { page } = pageQuerySchema.parse(req.query),
        body = { actorSessionId: currentPrincipal(res).sessionId, page };
      const [restaurant, auth, local] = await Promise.all([
        internalCall<Array<Record<string, unknown>>>(
          ctx,
          'restaurant',
          '/internal/v1/operations/audit',
          body,
        ),
        internalCall<Array<Record<string, unknown>>>(
          ctx,
          'auth',
          '/internal/v1/governance/governance-audit',
          body,
        ),
        ctx.db
          .collection('audit')
          .find({}, { projection: { _id: 0 } })
          .sort({ at: -1, id: -1 })
          .skip((page - 1) * 25)
          .limit(25)
          .toArray(),
      ]);
      const entries = [
        ...restaurant.map((x) => ({ ...x, owner: 'restaurant' })),
        ...auth.map((x) => ({ ...x, owner: 'auth' })),
        ...local.map((x) => ({ ...x, owner: 'admin' })),
      ].sort((a, b) =>
        String((b as Record<string, unknown>).at).localeCompare(
          String((a as Record<string, unknown>).at),
        ),
      );
      json(res, {
        entries,
        page,
        generatedAt: new Date().toISOString(),
        scope:
          'Each page merges up to 25 entries per owner; audit is recorded at the service that commits the change. No public export of message content or private documents.',
      });
    },
  );
}

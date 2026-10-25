import type { Express } from 'express';
import { z } from 'zod';
import {
  remoteSession,
  currentPrincipal,
  checkedId,
  internalCall,
  json,
  type DomainContext,
} from '@cravecart/platform';
export function installDeliveryOperations(app: Express, ctx: DomainContext) {
  app.get(
    '/api/v1/admin/delivery-operations',
    remoteSession(ctx, { permission: 'dispatch:read' }),
    async (_req, res) =>
      json(
        res,
        await internalCall(ctx, 'rider', '/internal/v1/delivery/operations', {
          actorSessionId: currentPrincipal(res).sessionId,
        }),
      ),
  );
  for (const [route, path, idName] of [
    [
      '/api/v1/admin/delivery-incidents/:incidentId/resolve',
      '/internal/v1/delivery/resolve-incident',
      'incidentId',
    ],
    [
      '/api/v1/admin/delivery-operations/:operationId/retry',
      '/internal/v1/delivery/retry-operation',
      'operationId',
    ],
  ] as const)
    app.post(
      route,
      remoteSession(ctx, { permission: 'dispatch:write', stepUp: true, mutation: true }),
      async (req, res) => {
        const body = z
          .object({ reason: z.string().trim().min(5).max(500) })
          .strict()
          .parse(req.body);
        json(
          res,
          await internalCall(ctx, 'rider', path, {
            ...body,
            [idName]: checkedId(req.params[idName]),
            actorSessionId: currentPrincipal(res).sessionId,
          }),
          202,
        );
      },
    );
  app.post(
    '/api/v1/admin/orders/:orderId/dispatch/retry',
    remoteSession(ctx, { permission: 'dispatch:write', stepUp: true, mutation: true }),
    async (req, res) => {
      const body = z
          .object({ reason: z.string().trim().min(5).max(500) })
          .strict()
          .parse(req.body),
        input = {
          ...body,
          orderId: checkedId(req.params.orderId),
          actorSessionId: currentPrincipal(res).sessionId,
        };
      await internalCall(ctx, 'restaurant', '/internal/v1/fulfillment/retry-dispatch', input);
      json(res, await internalCall(ctx, 'rider', '/internal/v1/delivery/retry', input), 202);
    },
  );
}

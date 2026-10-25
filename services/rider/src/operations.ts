import type { Express } from 'express';
import { z } from 'zod';
import { pageQuerySchema, periodQuerySchema } from '@cravecart/contracts';
import {
  remoteSession,
  currentPrincipal,
  internalCall,
  json,
  type DomainContext,
} from '@cravecart/platform';
export function installRiderOperations(app: Express, ctx: DomainContext) {
  app.get('/api/v1/rider/history', remoteSession(ctx, { role: 'rider' }), async (req, res) => {
    const { page } = pageQuerySchema.parse(req.query),
      filter = { riderId: currentPrincipal(res).userId, state: { $in: ['ENDED', 'REJECTED'] } };
    json(res, {
      deliveries: (
        await ctx.db
          .collection('deliveries')
          .find(filter, {
            projection: {
              _id: 1,
              orderId: 1,
              status: 1,
              restaurantName: 1,
              createdAt: 1,
              endedAt: 1,
            },
          })
          .sort({ createdAt: -1, _id: -1 })
          .skip((page - 1) * 25)
          .limit(25)
          .toArray()
      ).map(({ _id, ...v }) => ({ id: String(_id), ...v })),
      total: await ctx.db.collection('deliveries').countDocuments(filter),
      page,
    });
  });
  app.get('/api/v1/rider/earnings', remoteSession(ctx, { role: 'rider' }), async (req, res) => {
    const { page, ...dates } = z
      .object({
        from: z.string(),
        to: z.string(),
        page: z.coerce.number().int().min(1).max(10000).default(1),
      })
      .strict()
      .parse(req.query);
    const period = periodQuerySchema.parse(dates);
    json(
      res,
      await internalCall(ctx, 'restaurant', '/internal/v1/operations/rider-statement', {
        ...period,
        page,
        sessionId: currentPrincipal(res).sessionId,
      }),
    );
  });
}

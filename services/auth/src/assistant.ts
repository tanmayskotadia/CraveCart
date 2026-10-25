import express, { type Express } from 'express';
import { z } from 'zod';
import { type Principal } from '@cravecart/contracts';
import { internalOnly, internalCall, json, type DomainContext } from '@cravecart/platform';
export function installAssistantIdentity(app: Express, ctx: DomainContext) {
  const router = express.Router();
  router.use(internalOnly(ctx, ['restaurant']));
  router.post('/default-address', async (req, res) => {
    const { sessionId } = z.object({ sessionId: z.string().uuid() }).strict().parse(req.body),
      actor = await internalCall<Principal>(ctx, 'auth', '/internal/v1/sessions/inspect', {
        sessionId,
      });
    const value = await ctx.db
      .collection('addresses')
      .findOne({ userId: actor.userId, isDefault: true });
    json(res, value ? { id: String(value._id), label: value.label, city: value.city } : null);
  });
  app.use('/internal/v1/assistant-identity', router);
}

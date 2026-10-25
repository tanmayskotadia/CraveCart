import express, { type Express } from 'express';
import { z } from 'zod';
import type { Principal } from '@cravecart/contracts';
import { randomUUID } from 'node:crypto';
import { pageQuerySchema, messageInputSchema, reasonSchema } from '@cravecart/contracts';
import {
  remoteSession,
  currentPrincipal,
  internalCall,
  requireIdempotency,
  checkedId,
  HttpError,
  json,
  lazyIndexes,
  internalOnly,
  requirePermission,
  type DomainContext,
} from '@cravecart/platform';
import { executeOnce } from '@cravecart/persistence';
type Context = {
  orderId: string;
  customerId: string;
  riderId: string | null;
  role: string;
  canMessage: boolean;
};
export function installMessaging(app: Express, ctx: DomainContext) {
  const { db, client } = ctx,
    threads = db.collection<{ _id: string; version: number }>('order_threads'),
    messages = db.collection<{
      _id: string;
      orderId: string;
      sequence: number;
      author: 'customer' | 'rider';
      text: string;
      at: string;
      hidden?: boolean;
    }>('order_messages');
  const ready = lazyIndexes(async () => {
    await messages.createIndex({ orderId: 1, sequence: 1 }, { unique: true });
    await db.collection('message_limits').createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 });
  });
  async function context(orderId: string, sessionId: string) {
    const value = await internalCall<Context>(
      ctx,
      'restaurant',
      '/internal/v1/operations/order-context',
      { orderId, sessionId },
    );
    if (!['customer', 'rider'].includes(value.role))
      throw new HttpError(
        403,
        'FORBIDDEN',
        'Order messages belong to the customer and assigned rider',
      );
    return value;
  }
  app.get('/api/v1/orders/:orderId/messages', remoteSession(ctx), async (req, res) => {
    await ready();
    const id = checkedId(req.params.orderId),
      value = await context(id, currentPrincipal(res).sessionId),
      { page } = pageQuerySchema.parse(req.query);
    const thread = await threads.findOne({ _id: id });
    json(res, {
      version: thread?.version ?? 1,
      canMessage: value.canMessage,
      messages: (
        await messages
          .find({ orderId: id })
          .sort({ sequence: 1 })
          .skip((page - 1) * 50)
          .limit(50)
          .toArray()
      ).map(({ _id, orderId: _o, hidden, ...m }) => ({
        id: _id,
        ...m,
        text: hidden ? 'Message removed after review.' : m.text,
      })),
      total: await messages.countDocuments({ orderId: id }),
      page,
    });
  });
  app.post(
    '/api/v1/orders/:orderId/messages',
    remoteSession(ctx, { mutation: true }),
    async (req, res) => {
      await ready();
      const input = messageInputSchema.parse(req.body),
        id = checkedId(req.params.orderId),
        actor = currentPrincipal(res),
        value = await context(id, actor.sessionId);
      if (!value.canMessage)
        throw new HttpError(
          409,
          'CONVERSATION_CLOSED',
          'Messaging is available only during an assigned active delivery',
        );
      const bucket = actor.userId + ':' + Math.floor(Date.now() / 60000),
        limit = await db
          .collection('message_limits')
          .findOneAndUpdate(
            { _id: bucket as never },
            { $inc: { count: 1 }, $setOnInsert: { expiresAt: new Date(Date.now() + 3600000) } },
            { upsert: true, returnDocument: 'after' },
          );
      if (limit!.count > 30)
        throw new HttpError(429, 'MESSAGE_RATE_LIMIT', 'Please wait before sending more messages');
      json(
        res,
        await executeOnce(
          client,
          db,
          actor.userId + ':order-message:' + id,
          requireIdempotency(req),
          input,
          async (session) => {
            const thread = await threads.findOne({ _id: id }, { session });
            if ((thread?.version ?? 1) !== input.expectedVersion)
              throw new HttpError(
                409,
                'VERSION_CONFLICT',
                'New messages arrived; reload before sending',
              );
            const message = {
              _id: randomUUID(),
              orderId: id,
              sequence: input.expectedVersion + 1,
              author: value.role as 'customer' | 'rider',
              text: input.text,
              at: new Date().toISOString(),
            };
            await threads.updateOne(
              { _id: id },
              { $set: { version: input.expectedVersion + 1 } },
              { upsert: true, session },
            );
            await messages.insertOne(message, { session });
            const { _id, orderId: _o, ...m } = message;
            return { id: _id, ...m };
          },
        ),
        201,
      );
    },
  );
  app.post(
    '/api/v1/orders/:orderId/messages/:messageId/report',
    remoteSession(ctx, { mutation: true }),
    async (req, res) => {
      const input = reasonSchema.parse(req.body),
        id = checkedId(req.params.orderId),
        messageId = checkedId(req.params.messageId),
        actor = currentPrincipal(res);
      await context(id, actor.sessionId);
      if (!(await messages.findOne({ _id: messageId, orderId: id })))
        throw new HttpError(404, 'MESSAGE_NOT_FOUND', 'Message not found');
      await db.collection('message_reports').updateOne(
        { _id: (messageId + ':' + actor.userId) as never },
        {
          $setOnInsert: {
            id: randomUUID(),
            state: 'OPEN',
            orderId: id,
            messageId,
            userId: actor.userId,
            reason: input.reason,
            at: new Date().toISOString(),
          },
        },
        { upsert: true },
      );
      json(res, { reported: true });
    },
  );
  const internal = express.Router();
  internal.use(internalOnly(ctx, ['admin']));
  internal.post('/reports', async (req, res) => {
    const input = z
      .object({ actorSessionId: z.string().uuid(), page: z.number().int().min(1).max(10000) })
      .strict()
      .parse(req.body);
    const actor = await internalCall<Principal>(ctx, 'auth', '/internal/v1/sessions/inspect', {
      sessionId: input.actorSessionId,
    });
    requirePermission(actor, 'support:read');
    const reports = await db
      .collection('message_reports')
      .find({ state: 'OPEN' }, { projection: { _id: 0, userId: 0 } })
      .sort({ at: 1, id: 1 })
      .skip((input.page - 1) * 25)
      .limit(25)
      .toArray();
    json(res, {
      reports: await Promise.all(
        reports.map(async (r) => ({
          ...r,
          text: (await messages.findOne({ _id: r.messageId }))?.text ?? 'Message unavailable',
        })),
      ),
      total: await db.collection('message_reports').countDocuments({ state: 'OPEN' }),
      page: input.page,
    });
  });
  internal.post('/resolve', async (req, res) => {
    const input = z
      .object({
        actorSessionId: z.string().uuid(),
        reportId: z.string().uuid(),
        hidden: z.boolean(),
        reason: z.string().trim().min(5).max(500),
        commandId: z.string().min(16).max(128),
      })
      .strict()
      .parse(req.body);
    const actor = await internalCall<Principal>(ctx, 'auth', '/internal/v1/sessions/inspect', {
      sessionId: input.actorSessionId,
    });
    requirePermission(actor, 'support:write', true);
    json(
      res,
      await executeOnce(
        client,
        db,
        actor.userId + ':message-moderation',
        input.commandId,
        input,
        async (session) => {
          const report = await db
            .collection('message_reports')
            .findOne({ id: input.reportId, state: 'OPEN' }, { session });
          if (!report) throw new HttpError(409, 'REPORT_CHANGED', 'Report was already resolved');
          await messages.updateOne(
            { _id: report.messageId },
            { $set: { hidden: input.hidden } },
            { session },
          );
          await db
            .collection('message_reports')
            .updateMany(
              { messageId: report.messageId, state: 'OPEN' },
              { $set: { state: 'RESOLVED', resolution: input.reason, resolvedBy: actor.userId } },
              { session },
            );
          await db.collection('message_audit').insertOne(
            {
              id: randomUUID(),
              action: 'message.moderate',
              actorId: actor.userId,
              reason: input.reason,
              messageId: report.messageId,
              hidden: input.hidden,
              at: new Date().toISOString(),
            },
            { session },
          );
          return { updated: true };
        },
      ),
    );
  });
  app.use('/internal/v1/message-operations', internal);
}

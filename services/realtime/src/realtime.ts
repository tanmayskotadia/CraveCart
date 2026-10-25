import type { Express } from 'express';
import { installRealtimePrivacy } from './privacy.js';
import { z } from 'zod';
import type { Principal, FulfillmentSnapshot, DeliveryNotification } from '@cravecart/contracts';
import {
  remoteSession,
  currentPrincipal,
  internalCall,
  json,
  hash,
  opaque,
  HttpError,
  type DomainContext,
  lazyIndexes,
} from '@cravecart/platform';
export function installRealtime(app: Express, ctx: DomainContext) {
  installRealtimePrivacy(app, ctx);
  const { db } = ctx,
    tickets = db.collection<{
      _id: string;
      userId: string;
      sessionId: string;
      usedAt: Date | null;
      createdAt: Date;
      expiresAt: Date;
    }>('socket_tickets');
  const ready = lazyIndexes(async () => {
    await tickets.createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 });
    await tickets.createIndex({ userId: 1, createdAt: 1 });
  });
  const inspect = (sessionId: string) =>
    internalCall<Principal>(ctx, 'auth', '/internal/v1/sessions/inspect', { sessionId });
  const snapshot = (orderId: string, sessionId: string) =>
    internalCall<FulfillmentSnapshot>(ctx, 'restaurant', '/internal/v1/fulfillment/snapshot', {
      orderId,
      sessionId,
    });
  app.post('/api/v1/realtime/tickets', remoteSession(ctx, { mutation: true }), async (req, res) => {
    await ready();
    z.object({}).strict().parse(req.body);
    const principal = currentPrincipal(res);
    if (
      (await tickets.countDocuments({
        userId: principal.userId,
        createdAt: { $gt: new Date(Date.now() - 60000) },
      })) >= 20
    )
      throw new HttpError(429, 'TICKET_LIMIT', 'Wait before opening another live connection');
    const ticket = opaque(),
      expiresAt = new Date(Date.now() + 60000);
    await tickets.insertOne({
      _id: hash(ticket),
      userId: principal.userId,
      sessionId: principal.sessionId,
      usedAt: null,
      createdAt: new Date(),
      expiresAt,
    });
    json(res, { ticket, expiresAt: expiresAt.toISOString() }, 201);
  });
  app.get('/api/v1/notifications', remoteSession(ctx), async (_req, res) => {
    const userId = currentPrincipal(res).userId;
    const values = await Promise.all(
      ['restaurant', 'rider'].map((owner) =>
        internalCall<DeliveryNotification[]>(
          ctx,
          owner as 'rider',
          '/internal/v1/' +
            (owner === 'restaurant' ? 'fulfillment' : 'delivery') +
            '/notifications',
          { userId },
        ),
      ),
    );
    json(
      res,
      values
        .flat()
        .sort((a, b) => b.at.localeCompare(a.at) || b.id.localeCompare(a.id))
        .slice(0, 100),
    );
  });
  app.post(
    '/api/v1/notifications/read',
    remoteSession(ctx, { mutation: true }),
    async (req, res) => {
      const input = z
        .object({ id: z.string().min(1).max(200) })
        .strict()
        .parse(req.body);
      await Promise.all(
        ['restaurant', 'rider'].map((owner) =>
          internalCall(
            ctx,
            owner as 'rider',
            '/internal/v1/' +
              (owner === 'restaurant' ? 'fulfillment' : 'delivery') +
              '/notifications',
            { userId: currentPrincipal(res).userId, readId: input.id },
          ),
        ),
      );
      json(res, { read: true });
    },
  );
  ctx.onSocket?.((io) => {
    io.use(async (socket, next) => {
      try {
        await ready();
        if (socket.handshake.headers.origin !== ctx.config.APP_ORIGIN)
          throw new Error('Origin denied');
        const { ticket } = z
          .object({ ticket: z.string().min(40).max(100) })
          .strict()
          .parse(socket.handshake.auth);
        const record = await tickets.findOneAndUpdate(
          { _id: hash(ticket), usedAt: null, expiresAt: { $gt: new Date() } },
          { $set: { usedAt: new Date() } },
          { returnDocument: 'after' },
        );
        if (!record) throw new Error('Ticket expired or used');
        const principal = await inspect(record.sessionId);
        if (principal.userId !== record.userId) throw new Error('Session changed');
        socket.data.sessionId = record.sessionId;
        next();
      } catch {
        next(new Error('Sign in again to open live updates'));
      }
    });
    io.on('connection', (socket) => {
      let orderId: string | null = null,
        busy = false,
        messages = 0;
      let lastVersion = -1;
      socket.on('delivery:subscribe', async (input: unknown, ack?: (value: unknown) => void) => {
        try {
          if (++messages > 20) throw new Error('Subscription rate exceeded');
          const parsed = z.object({ orderId: z.string().uuid() }).strict().parse(input);
          const value = await snapshot(parsed.orderId, socket.data.sessionId);
          orderId = parsed.orderId;
          lastVersion = value.version;
          socket.emit('delivery:snapshot', value);
          if (typeof ack === 'function') ack({ subscribed: true });
        } catch {
          orderId = null;
          if (typeof ack === 'function') ack({ subscribed: false });
          socket.emit('delivery:forbidden', {
            message: 'This delivery is unavailable to this account.',
          });
        }
      });
      const timer = setInterval(() => {
        if (busy) return;
        busy = true;
        void (async () => {
          try {
            await inspect(socket.data.sessionId);
            if (orderId) {
              const value = await snapshot(orderId, socket.data.sessionId);
              if (value.version >= lastVersion) {
                lastVersion = value.version;
                socket.emit('delivery:snapshot', value);
              }
            }
          } catch {
            socket.emit('delivery:forbidden', {
              message: 'Access changed. Refresh your delivery.',
            });
            socket.disconnect(true);
          } finally {
            busy = false;
          }
        })();
      }, 3000);
      timer.unref();
      const reset = setInterval(() => {
        messages = 0;
      }, 60000);
      reset.unref();
      socket.on('disconnect', () => {
        clearInterval(timer);
        clearInterval(reset);
      });
    });
  });
  return { snapshot };
}

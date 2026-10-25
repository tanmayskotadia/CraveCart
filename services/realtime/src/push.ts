import type { Express } from 'express';
import { z } from 'zod';
import webpush from 'web-push';
import type { DeliveryNotification } from '@cravecart/contracts';
import {
  remoteSession,
  currentPrincipal,
  hash,
  json,
  HttpError,
  internalCall,
  lazyIndexes,
  type DomainContext,
} from '@cravecart/platform';
export function allowedPushEndpoint(value: string) {
  try {
    const url = new URL(value);
    return (
      url.protocol === 'https:' &&
      !url.username &&
      !url.password &&
      !url.port &&
      (['fcm.googleapis.com', 'updates.push.services.mozilla.com', 'web.push.apple.com'].includes(
        url.hostname,
      ) ||
        url.hostname.endsWith('.notify.windows.com'))
    );
  } catch {
    return false;
  }
}
export function installPush(
  app: Express,
  ctx: DomainContext,
  send: typeof webpush.sendNotification = webpush.sendNotification,
) {
  const { config, db } = ctx,
    enabled = !!(
      config.WEB_PUSH_PUBLIC_KEY &&
      config.WEB_PUSH_PRIVATE_KEY &&
      config.WEB_PUSH_SUBJECT
    );
  if (enabled)
    webpush.setVapidDetails(
      config.WEB_PUSH_SUBJECT!,
      config.WEB_PUSH_PUBLIC_KEY!,
      config.WEB_PUSH_PRIVATE_KEY!,
    );
  const subscriptions = db.collection<{
    _id: string;
    userId: string;
    sessionId: string;
    endpoint: string;
    keys: { p256dh: string; auth: string };
    nextAt: Date;
    leaseUntil: Date;
    failures: number;
  }>('push_subscriptions');
  const sent = db.collection<{ _id: string; state: string; attempts: number }>('push_deliveries');
  const ready = lazyIndexes(async () => {
    await subscriptions.createIndex({ userId: 1 });
    await subscriptions.createIndex({ nextAt: 1, leaseUntil: 1 });
  });
  app.get('/api/v1/notifications/push-capabilities', remoteSession(ctx), (_req, res) =>
    json(res, { enabled, publicKey: enabled ? config.WEB_PUSH_PUBLIC_KEY : null }),
  );
  app.post(
    '/api/v1/notifications/subscriptions',
    remoteSession(ctx, { mutation: true }),
    async (req, res) => {
      if (!enabled)
        throw new HttpError(503, 'PUSH_UNAVAILABLE', 'Push notifications are unavailable');
      await ready();
      const input = z
        .object({
          endpoint: z.string().url().max(2000),
          keys: z
            .object({
              p256dh: z
                .string()
                .regex(/^[A-Za-z0-9_-]+$/)
                .min(40)
                .max(200),
              auth: z
                .string()
                .regex(/^[A-Za-z0-9_-]+$/)
                .min(16)
                .max(100),
            })
            .strict(),
        })
        .strict()
        .parse(req.body);
      if (!allowedPushEndpoint(input.endpoint))
        throw new HttpError(422, 'PUSH_ENDPOINT_DENIED', 'Unsupported push service');
      const id = hash(input.endpoint);
      await subscriptions.updateOne(
        { _id: id },
        {
          $set: {
            ...input,
            userId: currentPrincipal(res).userId,
            sessionId: currentPrincipal(res).sessionId,
            nextAt: new Date(0),
            leaseUntil: new Date(0),
            failures: 0,
          },
        },
        { upsert: true },
      );
      json(res, { subscribed: true }, 201);
    },
  );
  app.delete(
    '/api/v1/notifications/subscriptions',
    remoteSession(ctx, { mutation: true }),
    async (req, res) => {
      const input = z
        .object({ endpoint: z.string().url().max(2000) })
        .strict()
        .parse(req.body);
      await subscriptions.deleteOne({
        _id: hash(input.endpoint),
        userId: currentPrincipal(res).userId,
      });
      json(res, { unsubscribed: true });
    },
  );
  let busy = false;
  async function tick() {
    if (!enabled || busy) return;
    busy = true;
    try {
      await ready();
      const subscription = await subscriptions.findOneAndUpdate(
        { nextAt: { $lte: new Date() }, leaseUntil: { $lte: new Date() }, failures: { $lt: 5 } },
        { $set: { leaseUntil: new Date(Date.now() + 30000) } },
        { returnDocument: 'after' },
      );
      if (!subscription) return;
      try {
        const principal = await internalCall<{ userId: string }>(
          ctx,
          'auth',
          '/internal/v1/sessions/inspect',
          { sessionId: subscription.sessionId },
        );
        if (principal.userId !== subscription.userId) {
          await subscriptions.deleteOne({ _id: subscription._id });
          return;
        }
        const values = (
          await Promise.all(
            ['restaurant', 'rider'].map((owner) =>
              internalCall<DeliveryNotification[]>(
                ctx,
                owner as 'restaurant',
                `/internal/v1/${owner === 'restaurant' ? 'fulfillment' : 'delivery'}/notifications`,
                { userId: subscription.userId },
              ),
            ),
          )
        )
          .flat()
          .filter((n) => !n.readAt && Date.now() - Date.parse(n.at) < 3600000)
          .sort((a, b) => b.at.localeCompare(a.at))
          .slice(0, 5);
        for (const note of values) {
          const id = hash(`${subscription._id}:${note.id}`),
            old = await sent.findOne({ _id: id });
          if (old?.state === 'SENT' || (old?.attempts ?? 0) >= 5) continue;
          await sent.updateOne(
            { _id: id },
            { $inc: { attempts: 1 }, $setOnInsert: { state: 'PENDING' } },
            { upsert: true },
          );
          await send(
            { endpoint: subscription.endpoint, keys: subscription.keys },
            JSON.stringify({
              id: note.id,
              title: 'CraveCart update',
              body: 'Open your account to see your latest order or delivery update.',
              href: note.href,
            }),
            { TTL: 60, timeout: 10000 },
          );
          await sent.updateOne({ _id: id }, { $set: { state: 'SENT' } });
        }
        await subscriptions.updateOne({ _id: subscription._id }, { $set: { failures: 0 } });
      } catch (error) {
        const status = (error as { statusCode?: number }).statusCode;
        if (
          status === 404 ||
          status === 410 ||
          (error instanceof HttpError && error.status === 401)
        )
          await subscriptions.deleteOne({ _id: subscription._id });
        else await subscriptions.updateOne({ _id: subscription._id }, { $inc: { failures: 1 } });
      } finally {
        await subscriptions.updateOne(
          { _id: subscription._id },
          { $set: { leaseUntil: new Date(0), nextAt: new Date(Date.now() + 15000) } },
        );
      }
    } finally {
      busy = false;
    }
  }
  const timer = setInterval(() => void tick().catch(() => {}), 5000);
  timer.unref();
  ctx.onClose?.(async () => clearInterval(timer));
  return { tick };
}

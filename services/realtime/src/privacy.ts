import type { Express } from 'express';
import { installPrivacyOwner, type DomainContext } from '@cravecart/platform';
export function installRealtimePrivacy(app: Express, ctx: DomainContext) {
  installPrivacyOwner(app, ctx, 'realtime', {
    datasets: [
      {
        name: 'own_delivery_messages',
        collection: 'order_messages',
        subjectField: 'authorId',
        fields: ['orderId', 'sequence', 'author', 'text', 'at'],
      },
    ],
    preflight: async () => [],
    erase: async (userId, session) => {
      await ctx.db.collection('push_subscriptions').deleteMany({ userId }, { session });
      await ctx.db.collection('socket_tickets').deleteMany({ userId }, { session });
      await ctx.db
        .collection('order_messages')
        .updateMany(
          { authorId: userId },
          { $set: { text: 'Message removed after account closure', hidden: true } },
          { session },
        );
      return ['Minimal delivery conversation/thread and moderation audit identifiers'];
    },
    minimizeRetained: async (userId, session) => {
      await ctx.db
        .collection('message_reports')
        .updateMany({ reporterId: userId }, { $unset: { reason: '' } }, { session });
    },
  });
}

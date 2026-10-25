import type { Express } from 'express';
import { installPrivacyOwner, type DomainContext } from '@cravecart/platform';
export function installRestaurantPrivacy(app: Express, ctx: DomainContext) {
  installPrivacyOwner(app, ctx, 'restaurant', {
    datasets: [
      {
        name: 'orders',
        collection: 'orders',
        subjectField: 'userId',
        fields: [
          'id',
          'number',
          'status',
          'paymentState',
          'gateway',
          'quote',
          'createdAt',
          'placedAt',
          'cancelledAt',
          'cancellationReason',
          'refundRequestedMinor',
          'refundedMinor',
          'timeline',
        ],
      },
      {
        name: 'reviews',
        collection: 'reviews',
        subjectField: 'userId',
        fields: ['orderId', 'restaurantId', 'rating', 'text', 'at', 'moderation', 'reply'],
      },
      {
        name: 'favorites',
        collection: 'favorites',
        subjectField: 'userId',
        fields: ['restaurantId'],
      },
      {
        name: 'restaurant_profile',
        collection: 'restaurants',
        subjectField: 'userId',
        fields: [
          'name',
          'description',
          'address',
          'city',
          'point',
          'cuisines',
          'hours',
          'published',
          'paused',
          'createdAt',
        ],
      },
      {
        name: 'policy_acceptances',
        collection: 'policy_acceptances',
        subjectField: 'userId',
        fields: ['quoteId', 'policies', 'acceptedAt'],
      },
    ],
    preflight: async (userId) => {
      const blockers: string[] = [];
      if (
        await ctx.db
          .collection('orders')
          .findOne({ userId, status: { $nin: ['DELIVERED', 'CANCELLED', 'REJECTED', 'EXPIRED'] } })
      )
        blockers.push('An order still needs payment, fulfilment or cancellation resolution.');
      if (await ctx.db.collection('restaurants').findOne({ userId }))
        blockers.push(
          'Restaurant owners require reviewed business offboarding and settlement before account closure.',
        );
      if (
        await ctx.db
          .collection('refund_intents')
          .findOne({ userId, state: { $ne: 'ACKNOWLEDGED' } })
      ) {
        const pending = await ctx.db
          .collection('orders')
          .findOne({ userId, $expr: { $gt: ['$refundRequestedMinor', '$refundedMinor'] } });
        if (pending) blockers.push('A refund is still awaiting provider resolution.');
      }
      return blockers;
    },
    erase: async (userId, session) => {
      await ctx.db.collection('carts').deleteMany({ _id: userId as never }, { session });
      for (const collection of ['favorites', 'reorder_previews'])
        await ctx.db.collection(collection).deleteMany({ userId }, { session });
      await ctx.db
        .collection('reviews')
        .updateMany(
          { userId },
          {
            $set: {
              text: 'Review removed after account closure',
              authorName: 'Deleted account',
              moderation: 'HIDDEN',
            },
            $unset: { reply: '' },
          },
          { session },
        );
      await ctx.db.collection('restaurant_staff').deleteMany({ userId }, { session });
      return [
        'Order/payment snapshots including delivery details, refund evidence, consent and legally relevant verification records',
      ];
    },
    minimizeRetained: async (userId, session) => {
      await ctx.db
        .collection('orders')
        .updateMany(
          { userId, status: { $in: ['DELIVERED', 'CANCELLED', 'REJECTED', 'EXPIRED'] } },
          {
            $set: { privacyErased: true },
            $unset: { 'quote.address': '', cancellationReason: '' },
          },
          { session },
        );
      await ctx.db
        .collection('applications')
        .updateMany(
          { userId },
          {
            $set: {
              'profile.fullName': 'Deleted account',
              'profile.address': 'Removed after retention',
              documentIds: [],
            },
            $unset: { 'profile.vehicleRegistration': '' },
          },
          { session },
        );
    },
  });
}

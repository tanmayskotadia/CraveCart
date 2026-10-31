import type { Express } from 'express';
import { installPrivacyOwner, type DomainContext } from '@cravecart/platform';
export function installRiderPrivacy(app: Express, ctx: DomainContext) {
  installPrivacyOwner(app, ctx, 'rider', {
    datasets: [
      {
        name: 'rider_application',
        collection: 'applications',
        subjectField: 'userId',
        fields: ['kind', 'status', 'profile', 'createdAt', 'updatedAt', 'reason'],
      },
      {
        name: 'delivery_history',
        collection: 'deliveries',
        subjectField: 'riderId',
        fields: ['orderId', 'status', 'state', 'createdAt', 'completedAt'],
      },
      {
        name: 'location_samples',
        collection: 'location_history',
        subjectField: 'riderId',
        fields: ['point', 'capturedAt', 'accuracy', 'receivedAt'],
      },
    ],
    preflight: async (userId) =>
      (await ctx.db
        .collection('deliveries')
        .findOne({ riderId: userId, state: { $in: ['ACCEPTING', 'ACTIVE'] } }))
        ? ['An active delivery or assignment must be resolved before rider offboarding.']
        : [],
    erase: async (userId, session) => {
      await ctx.db.collection('availability').deleteMany({ _id: userId as never }, { session });
      for (const collection of ['location_history', 'task_locations', 'offers'])
        await ctx.db.collection(collection).deleteMany({ riderId: userId }, { session });
      await ctx.db.collection('delivery_notifications').deleteMany({ userId }, { session });
      await ctx.db
        .collection('applications')
        .updateMany(
          { userId, status: { $ne: 'APPROVED' } },
          { $set: { status: 'REJECTED', reason: 'Account closure' }, $inc: { version: 1 } },
          { session },
        );
      return ['Completed delivery financial/proof audit and rider verification evidence'];
    },
    minimizeRetained: async (userId, session) => {
      await ctx.db
        .collection('delivery_operations')
        .deleteMany({ riderId: userId, state: { $in: ['APPLIED', 'REJECTED'] } }, { session });
      await ctx.db.collection('applications').updateMany(
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
      await ctx.db
        .collection('deliveries')
        .updateMany(
          { riderId: userId },
          { $unset: { pickup: '', dropoff: '', customerPhone: '', riderName: '' } },
          { session },
        );
    },
  });
}

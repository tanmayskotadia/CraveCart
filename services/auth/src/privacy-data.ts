import type { Express } from 'express';
import { installPrivacyOwner, type DomainContext } from '@cravecart/platform';
export function installAuthPrivacyData(app: Express, ctx: DomainContext) {
  installPrivacyOwner(app, ctx, 'auth', {
    datasets: [
      {
        name: 'profile',
        collection: 'users',
        subjectField: '_id',
        fields: ['name', 'contact', 'roles', 'status', 'createdAt'],
      },
      {
        name: 'addresses',
        collection: 'addresses',
        subjectField: 'userId',
        fields: [
          'label',
          'street',
          'city',
          'pincode',
          'phone',
          'recipientName',
          'point',
          'instructions',
          'isDefault',
          'createdAt',
          'updatedAt',
        ],
      },
    ],
    preflight: async (userId) => {
      const user = await ctx.db.collection('users').findOne({ _id: userId as never });
      const blockers: string[] = [];
      if (user?.roles?.includes('admin'))
        blockers.push('Privileged staff accounts require reviewed governance offboarding first.');
      if (
        await ctx.db
          .collection('privacy_requests')
          .findOne({ userId, kind: 'export', status: 'PROCESSING' })
      )
        blockers.push(
          'An account export is still processing. Complete or cancel it before closure.',
        );
      return blockers;
    },
    erase: async (userId, session) => {
      const user = await ctx.db.collection('users').findOne({ _id: userId as never }, { session });
      await ctx.db.collection('addresses').deleteMany({ userId }, { session });
      await ctx.db
        .collection('sessions')
        .updateMany(
          { userId },
          { $set: { revokedAt: new Date() }, $unset: { accessHash: '' } },
          { session },
        );
      await ctx.db.collection('refresh_tokens').deleteMany({ userId }, { session });
      await ctx.db.collection('mfa_challenges').deleteMany({ userId }, { session });
      if (user?.contact)
        await ctx.db.collection('challenges').deleteMany({ contact: user.contact }, { session });
      return ['Minimal request/review and account-closure audit identifiers'];
    },
    minimizeRetained: async (userId, session) => {
      await ctx.db
        .collection('privacy_audit')
        .updateMany({ userId }, { $unset: { reason: '' } }, { session });
    },
  });
}

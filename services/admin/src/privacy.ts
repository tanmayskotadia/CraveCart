import type { Express } from 'express';
import { z } from 'zod';
import { privacyDecisionSchema } from '@cravecart/contracts';
import {
  installPrivacyOwner,
  remoteSession,
  currentPrincipal,
  internalCall,
  requireIdempotency,
  checkedId,
  json,
  type DomainContext,
} from '@cravecart/platform';
export function installAdminPrivacy(app: Express, ctx: DomainContext) {
  installPrivacyOwner(app, ctx, 'admin', {
    datasets: [
      {
        name: 'support_tickets',
        collection: 'support_tickets',
        subjectField: 'requesterId',
        fields: ['subject', 'category', 'orderId', 'state', 'createdAt', 'updatedAt', 'resolution'],
      },
      {
        name: 'own_support_messages',
        collection: 'support_messages',
        subjectField: 'authorId',
        fields: ['ticketId', 'sequence', 'author', 'text', 'at'],
      },
    ],
    preflight: async () => [],
    erase: async (userId, session) => {
      await ctx.db
        .collection('support_tickets')
        .updateMany(
          { requesterId: userId },
          { $set: { state: 'CLOSED' }, $inc: { version: 1 } },
          { session },
        );
      return ['Support/dispute case, verification and moderation evidence'];
    },
    minimizeRetained: async (userId, session) => {
      const ids = (
        await ctx.db
          .collection('support_tickets')
          .find({ requesterId: userId }, { session, projection: { _id: 1 } })
          .toArray()
      ).map((row) => String(row._id));
      await ctx.db
        .collection('support_messages')
        .updateMany(
          { $or: [{ ticketId: { $in: ids } }, { authorId: userId }] },
          { $set: { text: 'Message removed after retention' } },
          { session },
        );
      await ctx.db
        .collection('support_tickets')
        .updateMany(
          { requesterId: userId },
          { $set: { subject: 'Closed account support case', resolution: null } },
          { session },
        );
      await ctx.db
        .collection('verification_cases')
        .updateMany(
          { 'application.userId': userId },
          {
            $set: {
              'application.profile.fullName': 'Deleted account',
              'application.profile.address': 'Removed after retention',
              'application.documentIds': [],
            },
            $unset: { 'application.profile.vehicleRegistration': '' },
          },
          { session },
        );
      await ctx.db
        .collection('verification_operations')
        .updateMany(
          { 'result.userId': userId },
          {
            $set: {
              'result.profile.fullName': 'Deleted account',
              'result.profile.address': 'Removed after retention',
              'result.documentIds': [],
            },
            $unset: { 'result.profile.vehicleRegistration': '' },
          },
          { session },
        );
    },
  });
  app.get(
    '/api/v1/admin/privacy/requests',
    remoteSession(ctx, { permission: 'users:read' }),
    async (req, res) => {
      const { page } = z
        .object({ page: z.coerce.number().int().min(1).max(10000).default(1) })
        .strict()
        .parse(req.query);
      json(
        res,
        await internalCall(ctx, 'auth', '/internal/v1/privacy/admin-list', {
          actorSessionId: currentPrincipal(res).sessionId,
          page,
        }),
      );
    },
  );
  app.post(
    '/api/v1/admin/privacy/requests/:requestId/decision',
    remoteSession(ctx, { permission: 'users:write', stepUp: true, mutation: true }),
    async (req, res) => {
      json(
        res,
        await internalCall(ctx, 'auth', '/internal/v1/privacy/admin-decision', {
          ...privacyDecisionSchema.parse(req.body),
          requestId: checkedId(req.params.requestId),
          actorSessionId: currentPrincipal(res).sessionId,
          commandId: requireIdempotency(req),
        }),
        202,
      );
    },
  );
}

import type { Express } from 'express';
import express from 'express';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { staffChangeSchema, staffBundles, type Principal } from '@cravecart/contracts';
import {
  internalOnly,
  internalCall,
  requirePermission,
  HttpError,
  json,
  type DomainContext,
} from '@cravecart/platform';
import { executeOnce } from '@cravecart/persistence';
import type { IdentityUser } from './router.js';
export function installGovernance(app: Express, ctx: DomainContext) {
  const router = express.Router(),
    { db, client } = ctx,
    users = db.collection<IdentityUser & { staffVersion?: number; staffBundles?: string[] }>(
      'users',
    );
  router.use(internalOnly(ctx, ['admin']));
  async function actor(sessionId: string, permission: string, stepUp = false) {
    const principal = await internalCall<Principal>(ctx, 'auth', '/internal/v1/sessions/inspect', {
      sessionId,
    });
    requirePermission(principal, permission, stepUp);
    return principal;
  }
  router.post('/staff', async (req, res) => {
    const input = z.object({ actorSessionId: z.string().uuid() }).strict().parse(req.body);
    await actor(input.actorSessionId, 'staff:read');
    json(
      res,
      (await users.find({ roles: 'admin' }).sort({ createdAt: 1 }).limit(100).toArray()).map(
        (u) => ({
          id: u._id,
          name: u.name,
          status: u.status,
          bundles: u.staffBundles ?? [],
          version: u.staffVersion ?? 0,
          protected: u.permissions.includes('staff:write'),
        }),
      ),
    );
  });
  router.post('/staff-change', async (req, res) => {
    const { actorSessionId, commandId, ...input } = z
      .object({
        actorSessionId: z.string().uuid(),
        commandId: z.string().min(16).max(128),
        ...staffChangeSchema.shape,
      })
      .strict()
      .parse(req.body);
    const principal = await actor(actorSessionId, 'staff:write', true);
    if (principal.userId === input.userId)
      throw new HttpError(
        409,
        'SELF_CHANGE_DENIED',
        'You cannot change your own administrative access',
      );
    json(
      res,
      await executeOnce(
        client,
        db,
        principal.userId + ':staff',
        commandId,
        input,
        async (session) => {
          const user = await users.findOne({ _id: input.userId, status: 'ACTIVE' }, { session });
          if (!user)
            throw new HttpError(
              404,
              'USER_NOT_FOUND',
              'Choose an existing active verified account',
            );
          if (user.permissions.includes('staff:write'))
            throw new HttpError(
              409,
              'PROTECTED_OPERATOR',
              'Bootstrap governance accounts cannot be changed here',
            );
          if ((user.staffVersion ?? 0) !== input.expectedVersion)
            throw new HttpError(409, 'VERSION_CONFLICT', 'Staff access changed; reload');
          const permissions = [...new Set(input.bundles.flatMap((b) => [...staffBundles[b]]))];
          const roles = [
            ...user.roles.filter((r) => r !== 'admin'),
            ...(permissions.length ? ['admin' as const] : []),
          ];
          await users.updateOne(
            { _id: user._id },
            {
              $set: {
                permissions,
                roles,
                staffBundles: [...new Set(input.bundles)],
                staffVersion: input.expectedVersion + 1,
              },
            },
            { session },
          );
          await db
            .collection('sessions')
            .updateMany({ userId: user._id }, { $set: { revokedAt: new Date() } }, { session });
          await db.collection('governance_audit').insertOne(
            {
              id: randomUUID(),
              action: 'staff.access',
              actorId: principal.userId,
              userId: user._id,
              reason: input.reason,
              before: user.permissions,
              after: permissions,
              at: new Date().toISOString(),
            },
            { session },
          );
          return { updated: true, version: input.expectedVersion + 1 };
        },
      ),
    );
  });
  router.post('/governance-audit', async (req, res) => {
    const input = z
      .object({ actorSessionId: z.string().uuid(), page: z.number().int().min(1).max(10000) })
      .strict()
      .parse(req.body);
    await actor(input.actorSessionId, 'audit:read');
    json(
      res,
      await db
        .collection('governance_audit')
        .find({}, { projection: { _id: 0 } })
        .sort({ at: -1, id: -1 })
        .skip((input.page - 1) * 25)
        .limit(25)
        .toArray(),
    );
  });
  app.use('/internal/v1/governance', router);
}

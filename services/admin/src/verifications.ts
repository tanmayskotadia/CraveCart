import express, { type Express } from 'express';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { decisionSchema, type Application } from '@cravecart/contracts';
import {
  remoteSession,
  currentPrincipal,
  HttpError,
  checkedId,
  internalCall,
  json,
  requireIdempotency,
  lazyIndexes,
  type DomainContext,
} from '@cravecart/platform';
import { executeOnce, enqueueEvent } from '@cravecart/persistence';

interface Case {
  _id: string;
  application: Application;
  updatedAt: Date;
  activeOperationId?: string;
}
interface Operation {
  _id: string;
  applicationId: string;
  kind: 'seller' | 'rider';
  expectedVersion: number;
  decision: 'approved' | 'rejected' | 'changes-requested';
  reason: string;
  requestedBy: string;
  actorUserId: string;
  actorSessionId: string;
  state: 'PENDING' | 'APPLIED' | 'FAILED';
  createdAt: Date;
  updatedAt: Date;
  attempts: number;
  nextAttemptAt: Date;
  leaseUntil: Date;
  requiresMfa: boolean;
  error?: string;
  result?: Application;
}
export function installVerifications(app: Express, ctx: DomainContext) {
  const { db, client } = ctx;
  const cases = db.collection<Case>('verification_cases'),
    operations = db.collection<Operation>('verification_operations');
  const ready = lazyIndexes(async () => {
    await cases.createIndex({ 'application.status': 1, updatedAt: -1 });
    await operations.createIndex({ state: 1, nextAttemptAt: 1, leaseUntil: 1 });
    await db.collection('audit').createIndex({ applicationId: 1, at: -1 });
  });
  const audit = async (
    action: string,
    actorId: string,
    applicationId: string,
    reason: string,
    data: unknown,
  ) => {
    await db
      .collection('audit')
      .insertOne({
        id: randomUUID(),
        action,
        actorId,
        applicationId,
        reason,
        data,
        at: new Date(),
      });
  };
  async function sync(applicationId?: string) {
    const all = (
      await Promise.all([
        internalCall<Application[]>(
          ctx,
          'restaurant',
          '/internal/v1/applications/list',
          applicationId ? { applicationId } : {},
        ),
        internalCall<Application[]>(
          ctx,
          'rider',
          '/internal/v1/applications/list',
          applicationId ? { applicationId } : {},
        ),
      ])
    ).flat();
    for (const application of all)
      await cases.updateOne(
        { _id: application.id },
        { $set: { application, updatedAt: new Date() } },
        { upsert: true },
      );
    return all;
  }
  async function attempt(id: string) {
    const operation = await operations.findOneAndUpdate(
      {
        _id: id,
        state: 'PENDING',
        leaseUntil: { $lte: new Date() },
        attempts: { $lt: 5 },
        requiresMfa: false,
      },
      { $set: { leaseUntil: new Date(Date.now() + 30_000) }, $inc: { attempts: 1 } },
      { returnDocument: 'after' },
    );
    if (!operation) return;
    try {
      const result = await internalCall<Application>(
        ctx,
        operation.kind === 'seller' ? 'restaurant' : 'rider',
        '/internal/v1/applications/decide',
        {
          applicationId: operation.applicationId,
          operationId: operation._id,
          expectedVersion: operation.expectedVersion,
          decision: operation.decision,
          reason: operation.reason,
          actorUserId: operation.actorUserId,
          actorSessionId: operation.actorSessionId,
        },
      );
      await operations.updateOne(
        { _id: id },
        {
          $set: { state: 'APPLIED', result, updatedAt: new Date(), leaseUntil: new Date(0) },
          $unset: { error: '' },
        },
      );
      await cases.updateOne(
        { _id: operation.applicationId, activeOperationId: id },
        { $set: { application: result, updatedAt: new Date() }, $unset: { activeOperationId: '' } },
      );
      await audit(
        'verification.applied',
        operation.actorUserId,
        operation.applicationId,
        operation.reason,
        { operationId: id, status: result.status, version: result.version },
      );
    } catch (error) {
      const known = error instanceof HttpError;
      const requiresMfa =
        known && ['MFA_REQUIRED', 'APPROVER_UNAVAILABLE', 'UNAUTHENTICATED'].includes(error.code);
      const conflict = known && [404, 409, 422].includes(error.status);
      const state = conflict ? 'FAILED' : 'PENDING';
      await operations.updateOne(
        { _id: id },
        {
          $set: {
            state,
            requiresMfa,
            error: known ? error.code : 'DEPENDENCY_UNAVAILABLE',
            updatedAt: new Date(),
            leaseUntil: new Date(0),
            nextAttemptAt: new Date(Date.now() + Math.min(60_000, 2000 * 2 ** operation.attempts)),
          },
        },
      );
      if (conflict)
        await cases.updateOne(
          { _id: operation.applicationId, activeOperationId: id },
          { $unset: { activeOperationId: '' } },
        );
      await audit(
        'verification.pending-or-failed',
        operation.actorUserId,
        operation.applicationId,
        operation.reason,
        { operationId: id, state, error: known ? error.code : 'DEPENDENCY_UNAVAILABLE' },
      );
    }
  }
  let work: Promise<void> | undefined;
  let busy = false;
  const timer = setInterval(() => {
    if (busy) return;
    busy = true;
    work = (async () => {
      try {
        await ready();
        const operation = await operations.findOne({
          state: 'PENDING',
          requiresMfa: false,
          attempts: { $lt: 5 },
          nextAttemptAt: { $lte: new Date() },
          leaseUntil: { $lte: new Date() },
        });
        if (operation) await attempt(operation._id);
      } catch {
        /* Readiness and durable operation state expose dependency outages. */
      } finally {
        busy = false;
      }
    })();
  }, 5000);
  timer.unref();
  ctx.onClose?.(async () => {
    clearInterval(timer);
    await work;
  });
  const router = express.Router();
  router.use(async (_req, _res, next) => {
    try {
      await ready();
      next();
    } catch (error) {
      next(error);
    }
  });
  router.get(
    '/verifications',
    remoteSession(ctx, { permission: 'verifications:read' }),
    async (req, res) => {
      const query = z
        .object({
          status: z.enum(['SUBMITTED', 'APPROVED', 'REJECTED', 'CHANGES_REQUESTED']).optional(),
          kind: z.enum(['seller', 'rider']).optional(),
        })
        .strict()
        .parse(req.query);
      await sync();
      const records = await cases
        .find({
          ...(query.status ? { 'application.status': query.status } : {}),
          ...(query.kind ? { 'application.kind': query.kind } : {}),
        })
        .sort({ updatedAt: -1 })
        .limit(100)
        .toArray();
      json(
        res,
        records.map((record) => ({
          application: record.application,
          operationId: record.activeOperationId ?? null,
        })),
      );
    },
  );
  router.get(
    '/verifications/:applicationId',
    remoteSession(ctx, { permission: 'verifications:read' }),
    async (req, res) => {
      const id = checkedId(req.params.applicationId);
      await sync(id);
      const record = await cases.findOne({ _id: id });
      if (!record) throw new HttpError(404, 'NOT_FOUND', 'Verification not found');
      const operation = record.activeOperationId
        ? await operations.findOne({ _id: record.activeOperationId })
        : await operations.findOne({ applicationId: id }, { sort: { createdAt: -1 } });
      json(res, {
        application: record.application,
        operation: operation ? present(operation) : null,
        audit: await db
          .collection('audit')
          .find({ applicationId: id }, { projection: { _id: 0 } })
          .sort({ at: -1 })
          .limit(30)
          .toArray(),
      });
    },
  );
  router.post(
    '/verifications/:applicationId/decision',
    remoteSession(ctx, { permission: 'verifications:write', stepUp: true, mutation: true }),
    async (req, res) => {
      const id = checkedId(req.params.applicationId),
        input = decisionSchema.parse(req.body),
        principal = currentPrincipal(res);
      await sync(id);
      const record = await cases.findOne({ _id: id });
      if (!record) throw new HttpError(404, 'NOT_FOUND', 'Verification not found');
      if (record.application.userId === principal.userId)
        throw new HttpError(403, 'SELF_APPROVAL_DENIED', 'You cannot approve your own application');
      const created = await executeOnce(
        client,
        db,
        `${principal.userId}:verification:${id}`,
        requireIdempotency(req),
        input,
        async (session) => {
          const operationId = randomUUID();
          const claimed = await cases.updateOne(
            {
              _id: id,
              'application.version': input.expectedVersion,
              'application.status': 'SUBMITTED',
              activeOperationId: { $exists: false },
            },
            { $set: { activeOperationId: operationId } },
            { session },
          );
          if (!claimed.modifiedCount)
            throw new HttpError(
              409,
              'APPLICATION_CONFLICT',
              'A review is already pending or this application changed',
            );
          const now = new Date();
          await operations.insertOne(
            {
              _id: operationId,
              applicationId: id,
              kind: record.application.kind,
              ...input,
              requestedBy: principal.userId,
              actorUserId: principal.userId,
              actorSessionId: principal.sessionId,
              state: 'PENDING',
              createdAt: now,
              updatedAt: now,
              attempts: 0,
              nextAttemptAt: new Date(0),
              leaseUntil: new Date(0),
              requiresMfa: false,
            },
            { session },
          );
          await db
            .collection('audit')
            .insertOne(
              {
                id: randomUUID(),
                action: 'verification.requested',
                actorId: principal.userId,
                applicationId: id,
                reason: input.reason,
                data: { operationId, before: record.application.status, decision: input.decision },
                at: now,
              },
              { session },
            );
          await enqueueEvent(db, session, {
            eventId: randomUUID(),
            eventType: 'verification.decided.v1',
            schemaVersion: 1,
            occurredAt: now.toISOString(),
            producer: 'admin',
            aggregate: { type: 'verification', id, version: input.expectedVersion },
            correlationId: String(res.locals.requestId),
            causationId: operationId,
            data: {
              applicationId: id,
              decisionId: operationId,
              applicantType: record.application.kind,
              decision: input.decision,
              reason: input.reason,
            },
          });
          return { operationId };
        },
      );
      await attempt(created.operationId);
      const operation = await operations.findOne({ _id: created.operationId });
      json(res, present(operation!), 202);
    },
  );
  router.get(
    '/operations/:operationId',
    remoteSession(ctx, { permission: 'verifications:read' }),
    async (req, res) => {
      const operation = await operations.findOne({ _id: checkedId(req.params.operationId) });
      if (!operation) throw new HttpError(404, 'NOT_FOUND', 'Operation not found');
      json(res, present(operation));
    },
  );
  router.post(
    '/operations/:operationId/retry',
    remoteSession(ctx, { permission: 'verifications:write', stepUp: true, mutation: true }),
    async (req, res) => {
      const principal = currentPrincipal(res),
        id = checkedId(req.params.operationId);
      const operation = await operations.findOne({ _id: id });
      if (!operation) throw new HttpError(404, 'NOT_FOUND', 'Operation not found');
      const record = await cases.findOne({ _id: operation.applicationId });
      if (record?.application.userId === principal.userId)
        throw new HttpError(403, 'SELF_APPROVAL_DENIED', 'You cannot review your own application');
      if (operation.state === 'APPLIED') {
        json(res, present(operation));
        return;
      }
      if(record?.activeOperationId&&record.activeOperationId!==id)throw new HttpError(409,'OPERATION_CONFLICT','A different review is pending');
      await operations.updateOne(
        { _id: id, state: { $ne:'APPLIED' } },
        {
          $set: {
            state:'PENDING',
            actorUserId: principal.userId,
            actorSessionId: principal.sessionId,
            requiresMfa: false,
            attempts: 0,
            nextAttemptAt: new Date(0),
            leaseUntil: new Date(0),
          },
        },
      );
      await cases.updateOne({_id:operation.applicationId},{$set:{activeOperationId:id}});
      await audit(
        'verification.retry-authorized',
        principal.userId,
        operation.applicationId,
        operation.reason,
        { operationId: id, originalRequester: operation.requestedBy },
      );
      await attempt(id);
      json(res, present((await operations.findOne({ _id: id }))!), 202);
    },
  );
  router.get('/users', remoteSession(ctx, { permission: 'users:read' }), async (_req, res) =>
    json(
      res,
      await internalCall(ctx, 'auth', '/internal/v1/users/list', {
        actorSessionId: currentPrincipal(res).sessionId,
      }),
    ),
  );
  router.post(
    '/users/:userId/status',
    remoteSession(ctx, { permission: 'users:write', stepUp: true, mutation: true }),
    async (req, res) => {
      const body = z
        .object({
          status: z.enum(['ACTIVE', 'SUSPENDED']),
          reason: z.string().trim().min(5).max(1000),
        })
        .strict()
        .parse(req.body);
      const userId = checkedId(req.params.userId);
      await audit('user.status-change-requested',currentPrincipal(res).userId,userId,body.reason,{status:body.status});
      await internalCall(ctx, 'auth', '/internal/v1/users/status', {
        ...body,
        userId,
        actorSessionId: currentPrincipal(res).sessionId,
      });
      await audit('user.status-changed', currentPrincipal(res).userId, userId, body.reason, {
        status: body.status,
      });
      json(res, { updated: true });
    },
  );
  router.get('/audit', remoteSession(ctx, { permission: 'audit:read' }), async (_req, res) =>
    json(
      res,
      await db
        .collection('audit')
        .find({}, { projection: { _id: 0 } })
        .sort({ at: -1 })
        .limit(100)
        .toArray(),
    ),
  );
  router.get(
    '/dashboard',
    remoteSession(ctx, { permission: 'verifications:read' }),
    async (_req, res) => {
      await sync();
      json(res, {
        submitted: await cases.countDocuments({ 'application.status': 'SUBMITTED' }),
        pendingOperations: await operations.countDocuments({ state: 'PENDING' }),
        approved: await cases.countDocuments({ 'application.status': 'APPROVED' }),
      });
    },
  );
  app.use('/api/v1/admin', router);
}
function present(operation: Operation) {
  return {
    operationId: operation._id,
    applicationId: operation.applicationId,
    state: operation.state,
    requiresMfa: operation.requiresMfa,
    error: operation.error ?? null,
    attempts: operation.attempts,
    result: operation.result ?? null,
    updatedAt: operation.updatedAt.toISOString(),
  };
}

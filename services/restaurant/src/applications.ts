import express, { type Express } from 'express';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import {
  applicationSaveSchema,
  applicationUpdateSchema,
  applicationSubmitSchema,
  findCity,
  type Application,
} from '@cravecart/contracts';
import {
  remoteSession,
  currentPrincipal,
  HttpError,
  checkedId,
  internalOnly,
  internalCall,
  json,
  requireIdempotency,
  lazyIndexes,
  type DomainContext,
} from '@cravecart/platform';
import { executeOnce, enqueueEvent } from '@cravecart/persistence';

const kind = 'seller' as 'seller' | 'rider';
const producer = 'restaurant' as 'restaurant' | 'rider';
interface ApplicationRecord extends Omit<Application, 'id'> {
  _id: string;
  lastDecisionId?: string;
  actorSessionId?: string;
}
function present(record: ApplicationRecord): Application {
  const {
    _id,
    userId,
    kind,
    status,
    version,
    profile,
    documentIds,
    createdAt,
    updatedAt,
    reason,
    grantState,
  } = record;
  return {
    id: _id,
    userId,
    kind,
    status,
    version,
    profile,
    documentIds,
    createdAt,
    updatedAt,
    ...(reason ? { reason } : {}),
    ...(grantState ? { grantState } : {}),
  };
}

export function installApplications(app: Express, ctx: DomainContext) {
  const { db, client } = ctx;
  const applications = db.collection<ApplicationRecord>('applications');
  const base = kind === 'seller' ? '/api/v1/seller/applications' : '/api/v1/rider/application';
  const ready = lazyIndexes(async () => {
    await applications.createIndex({ userId: 1 }, { unique: true });
    await applications.createIndex({ status: 1, updatedAt: -1 });
    await db.collection('internal_nonces').createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 });
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
  router.get('/', remoteSession(ctx), async (_req, res) =>
    json(
      res,
      (await applications.find({ userId: currentPrincipal(res).userId }).toArray()).map(present),
    ),
  );
  router.post('/', remoteSession(ctx, { mutation: true }), async (req, res) => {
    const body = applicationSaveSchema.parse(req.body);
    if (!findCity(body.profile.city))
      throw new HttpError(422, 'INVALID_CITY', 'Choose a supported discovery city');
    const userId = currentPrincipal(res).userId;
    if (await applications.findOne({ userId }))
      throw new HttpError(409, 'APPLICATION_EXISTS', 'Continue your existing application');
    const now = new Date().toISOString();
    const record: ApplicationRecord = {
      _id: randomUUID(),
      userId,
      kind,
      status: 'DRAFT',
      version: 1,
      ...body,
      createdAt: now,
      updatedAt: now,
      grantState: 'NOT_REQUESTED',
    };
    try {
      await applications.insertOne(record);
    } catch (error) {
      if (error && typeof error === 'object' && 'code' in error && error.code === 11000)
        throw new HttpError(409, 'APPLICATION_EXISTS', 'Continue your existing application');
      throw error;
    }
    json(res, present(record), 201);
  });
  async function owned(req: express.Request, userId: string) {
    const record = await applications.findOne({ _id: checkedId(req.params.applicationId), userId });
    if (!record) throw new HttpError(404, 'NOT_FOUND', 'Application not found');
    return record;
  }
  router.patch('/:applicationId', remoteSession(ctx, { mutation: true }), async (req, res) => {
    const body = applicationUpdateSchema.parse(req.body);
    if (!findCity(body.profile.city))
      throw new HttpError(422, 'INVALID_CITY', 'Choose a supported discovery city');
    const record = await owned(req, currentPrincipal(res).userId);
    const changed = await applications.findOneAndUpdate(
      {
        _id: record._id,
        version: body.expectedVersion,
        status: { $in: ['DRAFT', 'CHANGES_REQUESTED', 'REJECTED'] },
      },
      {
        $set: {
          profile: body.profile,
          documentIds: body.documentIds,
          status: 'DRAFT',
          updatedAt: new Date().toISOString(),
        },
        $unset: { reason: '' },
        $inc: { version: 1 },
      },
      { returnDocument: 'after' },
    );
    if (!changed)
      throw new HttpError(
        409,
        'APPLICATION_CONFLICT',
        'The application changed or cannot be edited. Refresh before trying again',
      );
    json(res, present(changed));
  });
  router.post(
    '/:applicationId/submit',
    remoteSession(ctx, { mutation: true }),
    async (req, res) => {
      const { expectedVersion } = applicationSubmitSchema.parse(req.body);
      const record = await owned(req, currentPrincipal(res).userId);
      if (kind === 'seller' && !record.profile.businessName)
        throw new HttpError(422, 'BUSINESS_NAME_REQUIRED', 'Enter the restaurant or business name');
      if (
        kind === 'rider' &&
        (!record.profile.vehicleType ||
          (record.profile.vehicleType !== 'bicycle' && !record.profile.vehicleRegistration))
      )
        throw new HttpError(422, 'VEHICLE_REQUIRED', 'Enter your vehicle details');
      await internalCall(ctx, 'utils', '/internal/v1/uploads/bind', {
        userId: record.userId,
        applicationId: record._id,
        documentIds: record.documentIds,
      });
      const result = await executeOnce(
        client,
        db,
        `${record.userId}:application-submit`,
        requireIdempotency(req),
        { applicationId: record._id, expectedVersion },
        async (session) => {
          const changed = await applications.findOneAndUpdate(
            {
              _id: record._id,
              userId: record.userId,
              version: expectedVersion,
              status: { $in: ['DRAFT', 'CHANGES_REQUESTED', 'REJECTED'] },
            },
            {
              $set: { status: 'SUBMITTED', updatedAt: new Date().toISOString() },
              $unset: { reason: '' },
              $inc: { version: 1 },
            },
            { returnDocument: 'after', session },
          );
          if (!changed)
            throw new HttpError(
              409,
              'APPLICATION_CONFLICT',
              'The application changed or was already submitted',
            );
          await enqueueEvent(db, session, {
            eventId: randomUUID(),
            eventType: `${kind}.application-submitted.v1`,
            schemaVersion: 1,
            occurredAt: new Date().toISOString(),
            producer,
            aggregate: { type: 'application', id: changed._id, version: changed.version },
            correlationId: String(res.locals.requestId),
            causationId: changed._id,
            data:
              kind === 'seller'
                ? { applicationId: changed._id, userId: changed.userId }
                : { applicationId: changed._id, riderId: changed.userId },
          });
          return present(changed);
        },
      );
      json(res, result);
    },
  );
  app.use(base, router);
  if (kind === 'seller')
    app.get(
      '/api/v1/seller/restaurants',
      remoteSession(ctx, { role: 'seller' }),
      async (_req, res) =>
        json(
          res,
          (
            await applications
              .find({
                userId: currentPrincipal(res).userId,
                status: 'APPROVED',
                grantState: 'APPLIED',
              })
              .toArray()
          ).map((record) => ({
            id: record._id,
            name: record.profile.businessName,
            city: record.profile.city,
            verification: 'APPROVED',
            orderingEnabled: false,
          })),
        ),
    );
  else
    app.get('/api/v1/rider/profile', remoteSession(ctx, { role: 'rider' }), async (_req, res) => {
      const record = await applications.findOne({
        userId: currentPrincipal(res).userId,
        status: 'APPROVED',
        grantState: 'APPLIED',
      });
      if (!record) throw new HttpError(404, 'NOT_FOUND', 'Approved rider profile not found');
      json(res, {
        id: record._id,
        ...record.profile,
        verification: 'APPROVED',
        dispatchEnabled: false,
      });
    });
  const internal = express.Router();
  internal.use('/applications', internalOnly(ctx, ['admin']));
  internal.post('/applications/list', async (req, res) => {
    await ready();
    const body = z.object({ applicationId: z.string().uuid().optional() }).strict().parse(req.body);
    json(
      res,
      (
        await applications
          .find(body.applicationId ? { _id: body.applicationId } : { status: { $ne: 'DRAFT' } })
          .sort({ updatedAt: -1 })
          .limit(100)
          .toArray()
      ).map(present),
    );
  });
  internal.post('/applications/decide', async (req, res) => {
    await ready();
    const body = z
      .object({
        applicationId: z.string().uuid(),
        operationId: z.string().uuid(),
        expectedVersion: z.number().int().positive(),
        decision: z.enum(['approved', 'rejected', 'changes-requested']),
        reason: z.string().min(5).max(1000),
        actorUserId: z.string().uuid(),
        actorSessionId: z.string().uuid(),
      })
      .strict()
      .parse(req.body);
    let record = await applications.findOne({ _id: body.applicationId });
    if (!record) throw new HttpError(404, 'NOT_FOUND', 'Application not found');
    if (record.userId === body.actorUserId)
      throw new HttpError(403, 'SELF_APPROVAL_DENIED', 'You cannot review your own application');
    if (record.lastDecisionId !== body.operationId) {
      const transaction = client.startSession();
      try {
        record =
          (await transaction.withTransaction(async () => {
            const changed = await applications.findOneAndUpdate(
              { _id: body.applicationId, version: body.expectedVersion, status: 'SUBMITTED' },
              {
                $set: {
                  status:
                    body.decision === 'approved'
                      ? 'APPROVED'
                      : body.decision === 'rejected'
                        ? 'REJECTED'
                        : 'CHANGES_REQUESTED',
                  reason: body.reason,
                  grantState: body.decision === 'approved' ? 'PENDING' : 'NOT_REQUESTED',
                  lastDecisionId: body.operationId,
                  actorSessionId: body.actorSessionId,
                  updatedAt: new Date().toISOString(),
                },
                $inc: { version: 1 },
              },
              { returnDocument: 'after', session: transaction },
            );
            if (!changed)
              throw new HttpError(
                409,
                'APPLICATION_CONFLICT',
                'This application was already reviewed or changed',
              );
            await enqueueEvent(db, transaction, {
              eventId: randomUUID(),
              eventType: 'verification.applied.v1',
              schemaVersion: 1,
              occurredAt: new Date().toISOString(),
              producer,
              aggregate: { type: 'application', id: changed._id, version: changed.version },
              correlationId: body.operationId,
              causationId: body.operationId,
              data: {
                applicationId: changed._id,
                decisionId: body.operationId,
                applicantType: kind,
              },
            });
            return changed;
          })) ?? null;
      } finally {
        await transaction.endSession();
      }
    }
    if (!record) throw new Error('Decision did not complete');
    if (record.status === 'APPROVED' && record.grantState !== 'APPLIED') {
      await internalCall(ctx, 'auth', '/internal/v1/roles/apply', {
        grantId: body.operationId,
        userId: record.userId,
        role: kind,
        actorSessionId: body.actorSessionId,
        applicationId: record._id,
      });
      await applications.updateOne(
        { _id: record._id, lastDecisionId: body.operationId },
        { $set: { grantState: 'APPLIED' } },
      );
      record.grantState = 'APPLIED';
    }
    json(res, present(record));
  });
  app.use('/internal/v1', internal);
}

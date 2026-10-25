import express, { type Express } from 'express';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { createClient } from 'redis';
import {
  locationSampleSchema,
  riderAvailabilitySchema,
  deliveryCommandSchema,
  distanceMeters,
  findCity,
  type LocationSample,
  type FulfillmentSnapshot,
  type DeliveryOffer,
} from '@cravecart/contracts';
import {
  remoteSession,
  currentPrincipal,
  internalCall,
  internalOnly,
  HttpError,
  json,
  checkedId,
  requireIdempotency,
  lazyIndexes,
  seal,
  unseal,
  type DomainContext,
} from '@cravecart/platform';
import { executeOnce } from '@cravecart/persistence';
interface Profile {
  _id: string;
  name: string;
  online: boolean;
  city: string;
  busy: string | null;
  streamId: string;
  sessionId: string;
  point?: { type: 'Point'; coordinates: [number, number] };
  sample?: LocationSample;
  receivedAt?: string;
  lastAssignedAt: string;
}
interface Offer extends Omit<DeliveryOffer, 'id'> {
  _id: string;
  riderId: string;
  generation: number;
  createdAt: string;
}
interface Task {
  _id: string;
  orderId: string;
  riderId: string;
  state: 'ACCEPTING' | 'ACTIVE' | 'ENDED' | 'REJECTED';
  status: string;
  restaurantName: string;
  createdAt: string;
  endedAt: string | null;
  nextSyncAt?: Date;
}
interface Operation {
  _id: string;
  taskId: string;
  orderId: string;
  riderId: string;
  kind: 'assign' | 'arrive' | 'pickup' | 'depart' | 'complete';
  payload: string;
  state: 'PENDING' | 'APPLIED' | 'REJECTED';
  attempts: number;
  nextAttemptAt: Date;
  leaseUntil: Date;
  error: string | null;
  createdAt: string;
}
interface Round {
  _id: string;
  round: number;
  generation: number;
  nextAt: Date;
  state: 'SEARCHING' | 'ASSIGNED' | 'NO_RIDER';
}
export function installDeliveries(app: Express, ctx: DomainContext) {
  const { db, client, config } = ctx,
    profiles = db.collection<Profile>('availability'),
    offers = db.collection<Offer>('offers'),
    tasks = db.collection<Task>('deliveries'),
    operations = db.collection<Operation>('delivery_operations'),
    rounds = db.collection<Round>('dispatch_rounds');
  const notifications = db.collection<{
    _id: string;
    userId: string;
    title: string;
    href: string;
    at: string;
    readAt: string | null;
  }>('delivery_notifications');
  const ready = lazyIndexes(async () => {
    await profiles.createIndex({ point: '2dsphere' });
    await profiles.createIndex({ online: 1, city: 1, busy: 1 });
    await offers.createIndex({ riderId: 1, state: 1, expiresAt: 1 });
    await tasks.createIndex(
      { orderId: 1 },
      { unique: true, partialFilterExpression: { state: { $in: ['ACCEPTING', 'ACTIVE'] } } },
    );
    await tasks.createIndex(
      { riderId: 1 },
      { unique: true, partialFilterExpression: { state: { $in: ['ACCEPTING', 'ACTIVE'] } } },
    );
    await db
      .collection('location_history')
      .createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 });
    await operations.createIndex({ state: 1, nextAttemptAt: 1, leaseUntil: 1 });
  });
  const cache = createClient({
    url: config.REDIS_URL,
    socket: { connectTimeout: 1500, reconnectStrategy: () => false },
  });
  cache.on('error', () => {});
  let cacheConnecting: Promise<unknown> | undefined;
  async function cacheLocation(assignmentId: string, value: unknown) {
    try {
      if (!cache.isOpen) {
        cacheConnecting ??= cache.connect().finally(() => {
          cacheConnecting = undefined;
        });
        await cacheConnecting;
      }
      await cache.set(`delivery:${assignmentId}:location`, JSON.stringify(value), { EX: 30 });
    } catch {
      /* MongoDB remains the durable fallback; infrastructure readiness reports Redis failure. */
    }
  }
  ctx.onClose?.(async () => {
    if (cache.isOpen) await cache.close().catch(() => {});
  });
  const publicOffer = ({ _id, riderId: _r, generation: _g, createdAt: _at, ...value }: Offer) => ({
    id: _id,
    ...value,
  });
  const publicTask = ({ _id, nextSyncAt: _next, ...record }: Task) => ({ id: _id, ...record });
  const publicOperation = ({
    _id,
    payload: _p,
    leaseUntil: _l,
    nextAttemptAt: _n,
    ...value
  }: Operation) => ({ id: _id, ...value });
  const now = () => new Date().toISOString();
  async function active(userId: string) {
    return tasks.findOne({ riderId: userId, state: { $in: ['ACCEPTING', 'ACTIVE'] } });
  }
  async function eligible(userId: string) {
    const result = await internalCall<{ activeUserIds: string[] }>(
      ctx,
      'auth',
      '/internal/v1/memberships/check',
      { userIds: [userId], role: 'rider' },
    );
    if (!result.activeUserIds.includes(userId))
      throw new HttpError(403, 'RIDER_INACTIVE', 'Approved active rider access is required');
  }
  async function finishTask(task: Task, status: string) {
    const session = client.startSession();
    try {
      await session.withTransaction(async () => {
        await tasks.updateOne(
          { _id: task._id, state: { $in: ['ACTIVE', 'ACCEPTING'] } },
          { $set: { state: 'ENDED', status, endedAt: now() } },
          { session },
        );
        await profiles.updateOne(
          { _id: task.riderId, busy: task._id },
          { $set: { busy: null, lastAssignedAt: now() } },
          { session },
        );
        await offers.updateMany(
          { orderId: task.orderId, state: 'OPEN' },
          { $set: { state: 'WITHDRAWN' } },
          { session },
        );
      });
    } finally {
      await session.endSession();
    }
  }
  async function reconcile(id?: string) {
    await ready();
    const operation = await operations.findOneAndUpdate(
      {
        ...(id ? { _id: id } : {}),
        state: 'PENDING',
        attempts: { $lt: 12 },
        leaseUntil: { $lte: new Date() },
        nextAttemptAt: { $lte: new Date() },
      },
      { $set: { leaseUntil: new Date(Date.now() + 30000) }, $inc: { attempts: 1 } },
      { returnDocument: 'after' },
    );
    if (!operation) return;
    try {
      await eligible(operation.riderId);
      const payload = JSON.parse(
        unseal(Buffer.from(operation.payload, 'base64'), config.AUTH_ENCRYPTION_KEY).toString(),
      );
      await internalCall(
        ctx,
        'restaurant',
        operation.kind === 'assign'
          ? '/internal/v1/fulfillment/assignment'
          : '/internal/v1/fulfillment/command',
        payload,
      );
      const session = client.startSession();
      try {
        await session.withTransaction(async () => {
          await operations.updateOne(
            { _id: operation._id },
            { $set: { state: 'APPLIED', error: null } },
            { session },
          );
          if (operation.kind === 'assign') {
            await tasks.updateOne(
              { _id: operation.taskId },
              { $set: { state: 'ACTIVE', status: 'ASSIGNED' } },
              { session },
            );
            await offers.updateMany(
              { orderId: operation.orderId, riderId: operation.riderId, state: 'ACCEPTING' },
              { $set: { state: 'ACCEPTED' } },
              { session },
            );
            await offers.updateMany(
              { orderId: operation.orderId, state: 'OPEN' },
              { $set: { state: 'WITHDRAWN' } },
              { session },
            );
            await rounds.updateOne(
              { _id: operation.orderId },
              { $set: { state: 'ASSIGNED' } },
              { session },
            );
          }
        });
      } finally {
        await session.endSession();
      }
      if (operation.kind === 'complete') {
        const task = await tasks.findOne({ _id: operation.taskId });
        if (task) await finishTask(task, 'DELIVERED');
      }
    } catch (error) {
      const deterministic =
        error instanceof HttpError && [400, 403, 404, 409, 422].includes(error.status);
      if (deterministic) {
        await operations.updateOne(
          { _id: operation._id },
          { $set: { state: 'REJECTED', error: error.code } },
        );
        if (operation.kind === 'assign') {
          await tasks.updateOne(
            { _id: operation.taskId },
            { $set: { state: 'REJECTED', endedAt: now() } },
          );
          await profiles.updateOne(
            { _id: operation.riderId, busy: operation.taskId },
            { $set: { busy: null } },
          );
        }
      } else
        await operations.updateOne(
          { _id: operation._id },
          { $set: { error: 'OWNER_CONFIRMATION_PENDING' } },
        );
    } finally {
      await operations.updateOne(
        { _id: operation._id },
        {
          $set: {
            leaseUntil: new Date(0),
            nextAttemptAt: new Date(Date.now() + Math.min(60000, 1000 * 2 ** operation.attempts)),
          },
        },
      );
    }
  }
  const router = express.Router();
  router.use(remoteSession(ctx, { role: 'rider' }));
  router.use(async (_req, _res, next) => {
    try {
      await ready();
      next();
    } catch (e) {
      next(e);
    }
  });
  router.get('/availability', async (_req, res) => {
    const userId = currentPrincipal(res).userId,
      profile = await profiles.findOne({ _id: userId });
    json(res, {
      online: profile?.online ?? false,
      city: profile?.city ?? '',
      streamId: profile?.streamId ?? null,
      busy: !!profile?.busy,
      receivedAt: profile?.receivedAt ?? null,
    });
  });
  router.post(
    '/availability',
    remoteSession(ctx, { role: 'rider', mutation: true }),
    async (req, res) => {
      const input = riderAvailabilitySchema.parse(req.body),
        principal = currentPrincipal(res);
      if (!findCity(input.city))
        throw new HttpError(422, 'UNKNOWN_CITY', 'Choose a supported city');
      await eligible(principal.userId);
      const session = client.startSession();
      let streamId = '';
      try {
        await session.withTransaction(async () => {
          const old = await profiles.findOne({ _id: principal.userId }, { session });
          if (old?.busy && !input.online)
            throw new HttpError(
              409,
              'ACTIVE_DELIVERY',
              'Finish or resolve your active delivery before going offline',
            );
          streamId = randomUUID();
          await profiles.updateOne(
            { _id: principal.userId },
            {
              $set: {
                name: principal.name,
                city: input.city,
                online: input.online,
                streamId,
                sessionId: principal.sessionId,
                ...(old?.sessionId !== principal.sessionId
                  ? { sample: undefined, receivedAt: undefined }
                  : {}),
              },
              $setOnInsert: { busy: null, lastAssignedAt: new Date(0).toISOString() },
            },
            { upsert: true, session },
          );
          if (!input.online)
            await offers.updateMany(
              { riderId: principal.userId, state: 'OPEN' },
              { $set: { state: 'WITHDRAWN' } },
              { session },
            );
        });
      } finally {
        await session.endSession();
      }
      json(res, { online: input.online, city: input.city, streamId });
    },
  );
  router.post(
    '/location',
    remoteSession(ctx, { role: 'rider', mutation: true }),
    async (req, res) => {
      const sample = locationSampleSchema.parse(req.body),
        principal = currentPrincipal(res),
        profile = await profiles.findOne({ _id: principal.userId });
      if (
        !profile?.online ||
        profile.sessionId !== principal.sessionId ||
        profile.streamId !== sample.streamId
      )
        throw new HttpError(
          409,
          'TRACKING_SESSION_CHANGED',
          'Start sharing from this signed-in device',
        );
      const age = Date.now() - Date.parse(sample.capturedAt);
      if (age > 60000 || age < -5000)
        throw new HttpError(422, 'STALE_LOCATION', 'Use a current location sample');
      if (profile.sample) {
        const elapsed =
          (Date.parse(sample.capturedAt) - Date.parse(profile.sample.capturedAt)) / 1000;
        if (
          elapsed <= 0 ||
          (profile.sample.streamId === sample.streamId &&
            sample.sequence <= profile.sample.sequence)
        )
          throw new HttpError(
            409,
            'LOCATION_OUT_OF_ORDER',
            'Location is older than the last sample',
          );
        if (elapsed < 2)
          throw new HttpError(429, 'LOCATION_TOO_FAST', 'Wait before sending another sample');
        if (elapsed < 300 && distanceMeters(profile.sample.point, sample.point) / elapsed > 50)
          throw new HttpError(
            422,
            'IMPLAUSIBLE_LOCATION',
            'Location moved too quickly; obtain an accurate fix',
          );
      }
      const receivedAt = now(),
        changed = await profiles.updateOne(
          {
            _id: principal.userId,
            streamId: sample.streamId,
            ...(profile.sample ? { 'sample.capturedAt': profile.sample.capturedAt } : {}),
          },
          {
            $set: {
              sample,
              receivedAt,
              point: {
                type: 'Point',
                coordinates: [sample.point.longitude, sample.point.latitude],
              },
            },
          },
        );
      if (!changed.modifiedCount)
        throw new HttpError(409, 'LOCATION_OUT_OF_ORDER', 'A newer location already arrived');
      const task = await active(principal.userId);
      if (task) {
        const entitled = await internalCall<{ active: boolean }>(
          ctx,
          'restaurant',
          '/internal/v1/fulfillment/assignment-state',
          { orderId: task.orderId, assignmentId: task._id },
        );
        if (entitled.active) {
          const value = {
            point: sample.point,
            accuracy: sample.accuracy,
            capturedAt: sample.capturedAt,
            receivedAt,
          };
          await db
            .collection('task_locations')
            .updateOne(
              { _id: task._id as never },
              { $set: { ...value, orderId: task.orderId, riderId: principal.userId } },
              { upsert: true },
            );
          void cacheLocation(task._id, value);
          if (sample.sequence % 5 === 0)
            await db.collection('location_history').insertOne({
              ...value,
              assignmentId: task._id,
              expiresAt: new Date(Date.now() + 7 * 86400000),
            });
        }
      }
      json(res, { accepted: true, receivedAt });
    },
  );
  router.get('/offers', async (_req, res) => {
    const userId = currentPrincipal(res).userId;
    await offers.updateMany(
      { riderId: userId, state: 'OPEN', expiresAt: { $lte: now() } },
      { $set: { state: 'EXPIRED' } },
    );
    json(
      res,
      (
        await offers
          .find({
            riderId: userId,
            state: { $in: ['OPEN', 'ACCEPTING'] },
            expiresAt: { $gt: now() },
          })
          .sort({ createdAt: -1 })
          .limit(20)
          .toArray()
      ).map(publicOffer),
    );
  });
  router.post(
    '/offers/:offerId/decline',
    remoteSession(ctx, { role: 'rider', mutation: true }),
    async (req, res) => {
      z.object({}).strict().parse(req.body);
      const result = await offers.updateOne(
        {
          _id: checkedId(req.params.offerId),
          riderId: currentPrincipal(res).userId,
          state: 'OPEN',
        },
        { $set: { state: 'DECLINED' } },
      );
      if (!result.modifiedCount) throw new HttpError(409, 'OFFER_CHANGED', 'Offer already changed');
      json(res, { declined: true });
    },
  );
  router.post(
    '/offers/:offerId/accept',
    remoteSession(ctx, { role: 'rider', mutation: true }),
    async (req, res) => {
      z.object({}).strict().parse(req.body);
      const principal = currentPrincipal(res),
        id = checkedId(req.params.offerId);
      await eligible(principal.userId);
      const operationId = await executeOnce(
        client,
        db,
        `accept-offer:${principal.userId}`,
        requireIdempotency(req),
        { offerId: id },
        async (session) => {
          const offer = await offers.findOne(
              { _id: id, riderId: principal.userId, state: 'OPEN', expiresAt: { $gt: now() } },
              { session },
            ),
            profile = await profiles.findOne(
              { _id: principal.userId, online: true, busy: null },
              { session },
            );
          if (
            !offer ||
            !profile ||
            !profile.receivedAt ||
            Date.now() - Date.parse(profile.receivedAt) > 60000
          )
            throw new HttpError(
              409,
              'OFFER_UNAVAILABLE',
              'Offer expired, rider is busy, or location is stale',
            );
          const taskId = randomUUID(),
            opId = randomUUID();
          await profiles.updateOne(
            { _id: principal.userId, busy: null },
            { $set: { busy: taskId } },
            { session },
          );
          await offers.updateOne({ _id: id }, { $set: { state: 'ACCEPTING' } }, { session });
          await tasks.insertOne(
            {
              _id: taskId,
              orderId: offer.orderId,
              riderId: principal.userId,
              state: 'ACCEPTING',
              status: 'ASSIGNING',
              restaurantName: offer.restaurantName,
              createdAt: now(),
              endedAt: null,
            },
            { session },
          );
          const payload = {
            orderId: offer.orderId,
            assignmentId: taskId,
            riderId: principal.userId,
            riderName: principal.name,
            commandId: opId,
          };
          await operations.insertOne(
            {
              _id: opId,
              taskId,
              orderId: offer.orderId,
              riderId: principal.userId,
              kind: 'assign',
              payload: seal(
                Buffer.from(JSON.stringify(payload)),
                config.AUTH_ENCRYPTION_KEY,
              ).toString('base64'),
              state: 'PENDING',
              attempts: 0,
              nextAttemptAt: new Date(0),
              leaseUntil: new Date(0),
              error: null,
              createdAt: now(),
            },
            { session },
          );
          return opId;
        },
      );
      await reconcile(operationId);
      json(res, publicOperation((await operations.findOne({ _id: operationId }))!), 202);
    },
  );
  router.get('/deliveries', async (_req, res) =>
    json(
      res,
      (
        await tasks
          .find({ riderId: currentPrincipal(res).userId })
          .sort({ createdAt: -1 })
          .limit(100)
          .toArray()
      ).map(publicTask),
    ),
  );
  router.get('/deliveries/:deliveryId', async (req, res) => {
    const task = await tasks.findOne({
      _id: checkedId(req.params.deliveryId),
      riderId: currentPrincipal(res).userId,
    });
    if (!task) throw new HttpError(404, 'DELIVERY_NOT_FOUND', 'Delivery not found');
    if (task.state !== 'ACTIVE') {
      json(res, { task: publicTask(task), snapshot: null });
      return;
    }
    const snapshot = await internalCall<FulfillmentSnapshot>(
      ctx,
      'restaurant',
      '/internal/v1/fulfillment/task',
      { orderId: task.orderId, riderId: task.riderId },
    );
    json(res, { task: publicTask(task), snapshot });
  });
  for (const action of ['arrive', 'pickup', 'depart', 'complete'] as const)
    router.post(
      `/deliveries/:deliveryId/${action}`,
      remoteSession(ctx, { role: 'rider', mutation: true }),
      async (req, res) => {
        const input = deliveryCommandSchema.parse(req.body),
          principal = currentPrincipal(res),
          task = await tasks.findOne({
            _id: checkedId(req.params.deliveryId),
            riderId: principal.userId,
          });
        if (!task) throw new HttpError(404, 'DELIVERY_NOT_FOUND', 'Delivery not found');
        const opId = await executeOnce(
          client,
          db,
          `delivery:${task._id}:${action}`,
          requireIdempotency(req),
          input,
          async (session) => {
            const current = await tasks.findOne({ _id: task._id, state: 'ACTIVE' }, { session });
            if (!current) throw new HttpError(409, 'DELIVERY_ENDED', 'This delivery has ended');
            const id = randomUUID(),
              payload = {
                ...input,
                orderId: task.orderId,
                assignmentId: task._id,
                riderId: task.riderId,
                action,
                commandId: id,
              };
            await operations.insertOne(
              {
                _id: id,
                taskId: task._id,
                orderId: task.orderId,
                riderId: task.riderId,
                kind: action,
                payload: seal(
                  Buffer.from(JSON.stringify(payload)),
                  config.AUTH_ENCRYPTION_KEY,
                ).toString('base64'),
                state: 'PENDING',
                attempts: 0,
                nextAttemptAt: new Date(0),
                leaseUntil: new Date(0),
                error: null,
                createdAt: now(),
              },
              { session },
            );
            return id;
          },
        );
        await reconcile(opId);
        json(res, publicOperation((await operations.findOne({ _id: opId }))!), 202);
      },
    );
  router.get('/operations/:operationId', async (req, res) => {
    const record = await operations.findOne({
      _id: checkedId(req.params.operationId),
      riderId: currentPrincipal(res).userId,
    });
    if (!record) throw new HttpError(404, 'OPERATION_NOT_FOUND', 'Operation not found');
    json(res, publicOperation(record));
  });
  router.post(
    '/deliveries/:deliveryId/incidents',
    remoteSession(ctx, { role: 'rider', mutation: true }),
    async (req, res) => {
      const input = z
          .object({ reason: z.string().trim().min(5).max(1000) })
          .strict()
          .parse(req.body),
        task = await tasks.findOne({
          _id: checkedId(req.params.deliveryId),
          riderId: currentPrincipal(res).userId,
          state: 'ACTIVE',
        });
      if (!task) throw new HttpError(404, 'DELIVERY_NOT_FOUND', 'Active delivery not found');
      const result = await executeOnce(
        client,
        db,
        `incident:${task._id}`,
        requireIdempotency(req),
        input,
        async (session) => {
          const id = randomUUID();
          await db.collection('delivery_incidents').insertOne(
            {
              _id: id as never,
              deliveryId: task._id,
              orderId: task.orderId,
              riderId: task.riderId,
              ...input,
              state: 'OPEN',
              createdAt: now(),
            },
            { session },
          );
          return { id, state: 'OPEN' };
        },
      );
      json(res, result, 201);
    },
  );
  app.use('/api/v1/rider', router);
  const internal = express.Router();
  internal.use(internalOnly(ctx, ['restaurant', 'realtime', 'admin']));
  internal.post('/location', async (req, res) => {
    const input = z
      .object({ orderId: z.string().uuid(), assignmentId: z.string().uuid() })
      .strict()
      .parse(req.body);
    const entitled = await internalCall<{ active: boolean }>(
      ctx,
      'restaurant',
      '/internal/v1/fulfillment/assignment-state',
      input,
    );
    if (!entitled.active) {
      json(res, null);
      return;
    }
    const value = await db
      .collection('task_locations')
      .findOne({ _id: input.assignmentId as never, orderId: input.orderId });
    json(
      res,
      value
        ? {
            point: value.point,
            accuracy: value.accuracy,
            capturedAt: value.capturedAt,
            receivedAt: value.receivedAt,
          }
        : null,
    );
  });
  internal.post('/notifications', async (req, res) => {
    if (res.locals.caller !== 'realtime')
      throw new HttpError(403, 'SERVICE_DENIED', 'Service denied');
    const input = z
      .object({ userId: z.string().uuid(), readId: z.string().max(200).optional() })
      .strict()
      .parse(req.body);
    if (input.readId)
      await notifications.updateOne(
        { _id: input.readId, userId: input.userId },
        { $set: { readAt: now() } },
      );
    json(
      res,
      (await notifications.find({ userId: input.userId }).sort({ at: -1 }).limit(50).toArray()).map(
        ({ _id, userId: _uid, ...n }) => ({ id: _id, ...n }),
      ),
    );
  });
  async function operator(sessionId: string, write = false) {
    const principal = await internalCall<import('@cravecart/contracts').Principal>(
      ctx,
      'auth',
      '/internal/v1/sessions/inspect',
      { sessionId },
    );
    const { requirePermission } = await import('@cravecart/platform');
    requirePermission(principal, write ? 'dispatch:write' : 'dispatch:read', write);
    return principal;
  }
  internal.post('/operations', async (req, res) => {
    if (res.locals.caller !== 'admin') throw new HttpError(403, 'SERVICE_DENIED', 'Service denied');
    const input = z.object({ actorSessionId: z.string().uuid() }).strict().parse(req.body);
    await operator(input.actorSessionId);
    json(res, {
      tasks: (
        await tasks
          .find({ state: { $in: ['ACCEPTING', 'ACTIVE'] } })
          .sort({ createdAt: 1 })
          .limit(100)
          .toArray()
      ).map(publicTask),
      pending: (
        await operations.find({ state: 'PENDING' }).sort({ createdAt: 1 }).limit(100).toArray()
      ).map(publicOperation),
      incidents: await db
        .collection('delivery_incidents')
        .find({ state: 'OPEN' })
        .sort({ createdAt: 1 })
        .limit(100)
        .toArray(),
    });
  });
  internal.post('/resolve-incident', async (req, res) => {
    if (res.locals.caller !== 'admin') throw new HttpError(403, 'SERVICE_DENIED', 'Service denied');
    const input = z
      .object({
        actorSessionId: z.string().uuid(),
        incidentId: z.string().uuid(),
        reason: z.string().min(5).max(500),
      })
      .strict()
      .parse(req.body);
    const principal = await operator(input.actorSessionId, true);
    const session = client.startSession();
    try {
      await session.withTransaction(async () => {
        const changed = await db.collection('delivery_incidents').updateOne(
          { _id: input.incidentId as never, state: 'OPEN' },
          {
            $set: {
              state: 'RESOLVED',
              resolution: input.reason,
              resolvedAt: now(),
              resolvedBy: principal.userId,
            },
          },
          { session },
        );
        if (!changed.modifiedCount)
          throw new HttpError(409, 'INCIDENT_CHANGED', 'Incident is already resolved or missing');
        await db.collection('dispatch_audit').insertOne(
          {
            actorId: principal.userId,
            action: 'incident-resolved',
            incidentId: input.incidentId,
            reason: input.reason,
            at: now(),
          },
          { session },
        );
      });
    } finally {
      await session.endSession();
    }
    json(res, { resolved: true });
  });
  internal.post('/retry-operation', async (req, res) => {
    if (res.locals.caller !== 'admin') throw new HttpError(403, 'SERVICE_DENIED', 'Service denied');
    const input = z
      .object({
        actorSessionId: z.string().uuid(),
        operationId: z.string().uuid(),
        reason: z.string().min(5).max(500),
      })
      .strict()
      .parse(req.body);
    const principal = await operator(input.actorSessionId, true);
    const session = client.startSession();
    try {
      await session.withTransaction(async () => {
        const changed = await operations.updateOne(
          { _id: input.operationId, state: 'PENDING' },
          { $set: { attempts: 0, nextAttemptAt: new Date(0) } },
          { session },
        );
        if (!changed.matchedCount)
          throw new HttpError(409, 'OPERATION_CHANGED', 'Only a pending operation can be retried');
        await db.collection('dispatch_audit').insertOne(
          {
            actorId: principal.userId,
            action: 'operation-retry',
            operationId: input.operationId,
            reason: input.reason,
            at: now(),
          },
          { session },
        );
      });
    } finally {
      await session.endSession();
    }
    json(res, { queued: true });
  });
  internal.post('/retry', async (req, res) => {
    if (res.locals.caller !== 'admin') throw new HttpError(403, 'SERVICE_DENIED', 'Service denied');
    const input = z
      .object({
        orderId: z.string().uuid(),
        actorSessionId: z.string().uuid(),
        reason: z.string().min(5).max(500),
      })
      .strict()
      .parse(req.body);
    const principal = await internalCall<import('@cravecart/contracts').Principal>(
      ctx,
      'auth',
      '/internal/v1/sessions/inspect',
      { sessionId: input.actorSessionId },
    );
    const { requirePermission } = await import('@cravecart/platform');
    requirePermission(principal, 'dispatch:write', true);
    await rounds.updateOne(
      { _id: input.orderId, state: 'NO_RIDER' },
      { $set: { round: 0, nextAt: new Date(0), state: 'SEARCHING' }, $inc: { generation: 1 } },
    );
    await db
      .collection('dispatch_audit')
      .insertOne({ ...input, actorId: principal.userId, at: now() });
    json(res, { queued: true });
  });
  app.use('/internal/v1/delivery', internal);
  async function dispatch() {
    await ready();
    const candidates = await internalCall<
      Array<{
        orderId: string;
        restaurantName: string;
        city: string;
        pickup: { latitude: number; longitude: number };
      }>
    >(ctx, 'restaurant', '/internal/v1/fulfillment/candidates', {});
    for (const candidate of candidates) {
      const state = await rounds.findOne({ _id: candidate.orderId });
      if (
        state?.state === 'ASSIGNED' ||
        state?.state === 'NO_RIDER' ||
        (state && state.nextAt > new Date())
      )
        continue;
      const current = await rounds.findOneAndUpdate(
        {
          _id: candidate.orderId,
          ...(state ? { round: state.round, nextAt: { $lte: new Date() } } : {}),
        },
        {
          $set: { state: 'SEARCHING', nextAt: new Date(Date.now() + 25000) },
          $inc: { round: 1 },
          $setOnInsert: { generation: 0 },
        },
        { upsert: !state, returnDocument: 'after' },
      );
      if (!current) continue;
      if (current.round > 3) {
        await rounds.updateOne({ _id: candidate.orderId }, { $set: { state: 'NO_RIDER' } });
        await internalCall(ctx, 'restaurant', '/internal/v1/fulfillment/no-rider', {
          orderId: candidate.orderId,
        });
        continue;
      }
      const previous = (
          await offers
            .find({ orderId: candidate.orderId, generation: current.generation })
            .toArray()
        ).map((o) => o.riderId),
        radius = [3000, 6000, 10000][current.round - 1]!;
      const nearby = await profiles
        .find({
          online: true,
          busy: null,
          city: candidate.city,
          receivedAt: { $gte: new Date(Date.now() - 60000).toISOString() },
          _id: { $nin: previous },
          point: {
            $near: {
              $geometry: {
                type: 'Point',
                coordinates: [candidate.pickup.longitude, candidate.pickup.latitude],
              },
              $maxDistance: radius,
            },
          },
        })
        .limit(10)
        .toArray();
      nearby.sort((a, b) => {
        const da = distanceMeters(a.sample!.point, candidate.pickup),
          db = distanceMeters(b.sample!.point, candidate.pickup);
        return (
          Math.round(da / 1000) - Math.round(db / 1000) ||
          a.lastAssignedAt.localeCompare(b.lastAssignedAt)
        );
      });
      for (const profile of nearby.slice(0, 3)) {
        try {
          await eligible(profile._id);
        } catch {
          continue;
        }
        const id = randomUUID(),
          at = now(),
          session = client.startSession();
        try {
          await session.withTransaction(async () => {
            await offers.insertOne(
              {
                _id: id,
                orderId: candidate.orderId,
                riderId: profile._id,
                restaurantName: candidate.restaurantName,
                pickup: candidate.pickup,
                distanceMeters: Math.round(distanceMeters(profile.sample!.point, candidate.pickup)),
                expiresAt: new Date(Date.now() + 20000).toISOString(),
                state: 'OPEN',
                round: current.round,
                generation: current.generation,
                createdAt: at,
              },
              { session },
            );
            await notifications.insertOne(
              {
                _id: `offer:${id}`,
                userId: profile._id,
                title: `Delivery offer from ${candidate.restaurantName}`,
                href: '/rider/offers',
                at,
                readAt: null,
              },
              { session },
            );
          });
        } finally {
          await session.endSession();
        }
      }
    }
  }
  let busy = false;
  async function tick() {
    if (busy) return;
    busy = true;
    try {
      await ready();
      await reconcile();
      const currentTasks = await tasks
        .find({
          state: 'ACTIVE',
          $or: [{ nextSyncAt: { $exists: false } }, { nextSyncAt: { $lte: new Date() } }],
        })
        .sort({ nextSyncAt: 1 })
        .limit(20)
        .toArray();
      for (const task of currentTasks) {
        const state = await internalCall<{ active: boolean; status: string }>(
          ctx,
          'restaurant',
          '/internal/v1/fulfillment/assignment-state',
          { orderId: task.orderId, assignmentId: task._id },
        );
        if (!state.active) await finishTask(task, state.status);
        else
          await tasks.updateOne(
            { _id: task._id },
            { $set: { status: state.status, nextSyncAt: new Date(Date.now() + 10000) } },
          );
      }
      await dispatch();
    } finally {
      busy = false;
    }
  }
  const timer = setInterval(() => void tick().catch(() => {}), 3000);
  timer.unref();
  ctx.onClose?.(async () => clearInterval(timer));
  return { tick, dispatch, reconcile };
}

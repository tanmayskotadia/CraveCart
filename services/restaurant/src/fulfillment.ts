import express, { type Express } from 'express';
import { randomUUID, randomInt } from 'node:crypto';
import { z } from 'zod';
import type { ClientSession } from 'mongodb';
import {
  sellerActionSchema,
  fulfillmentSnapshotSchema,
  type FulfillmentSnapshot,
} from '@cravecart/contracts';
import {
  remoteSession,
  currentPrincipal,
  internalOnly,
  internalCall,
  checkedId,
  HttpError,
  json,
  lazyIndexes,
  requireIdempotency,
  mac,
  equal,
  seal,
  unseal,
  type DomainContext,
} from '@cravecart/platform';
import { executeOnce } from '@cravecart/persistence';
import type { installOrders, OrderRecord } from './orders.js';
type Ops = ReturnType<typeof installOrders>;
type Order = OrderRecord;
interface Proof {
  hash: string;
  encrypted: string;
  nonce: string;
  expiresAt: string;
  attempts: number;
}
interface State {
  _id: string;
  preparationMinutes: number | null;
  acceptedAt: string | null;
  readyAt: string | null;
  deliveredAt: string | null;
  dispatchState: FulfillmentSnapshot['dispatchState'];
  assignment: FulfillmentSnapshot['assignment'];
  pickupProof: Proof | null;
  deliveryProof: Proof | null;
}
const active: Order['status'][] = ['ACCEPTED', 'PREPARING', 'READY_FOR_PICKUP'];
const terminal = ['CANCELLED', 'EXPIRED', 'REJECTED', 'DELIVERED'];
export function installFulfillment(app: Express, ctx: DomainContext, ops: Ops) {
  const { db, client, config } = ctx,
    states = db.collection<State>('fulfillment'),
    locks = db.collection<{ _id: string; orderId: string; assignmentId: string }>('rider_locks');
  const notes = db.collection<{
    _id: string;
    userId: string;
    title: string;
    href: string;
    at: string;
    readAt: string | null;
  }>('delivery_notifications');
  const ready = lazyIndexes(async () => {
    await states.createIndex(
      { 'assignment.id': 1 },
      { unique: true, partialFilterExpression: { 'assignment.id': { $type: 'string' } } },
    );
    await notes.createIndex({ userId: 1, at: -1 });
  });
  function initial(id: string): State {
    return {
      _id: id,
      preparationMinutes: null,
      acceptedAt: null,
      readyAt: null,
      deliveredAt: null,
      dispatchState: 'WAITING',
      assignment: null,
      pickupProof: null,
      deliveryProof: null,
    };
  }
  function proof(): Proof {
    const code = String(randomInt(100000, 1000000)),
      nonce = randomUUID();
    return {
      hash: mac(config.AUTH_SECRET, `${nonce}:${code}`),
      nonce,
      encrypted: seal(Buffer.from(code), config.AUTH_ENCRYPTION_KEY).toString('base64'),
      expiresAt: new Date(Date.now() + 3600000).toISOString(),
      attempts: 0,
    };
  }
  function reveal(value: Proof | null) {
    return value && value.expiresAt > new Date().toISOString() && value.attempts < 5
      ? unseal(Buffer.from(value.encrypted, 'base64'), config.AUTH_ENCRYPTION_KEY).toString()
      : null;
  }
  async function order(id: string, session?: ClientSession) {
    const value = await ops.orders.findOne(
      { _id: id, 'quote.mode': config.COMMERCE_MODE },
      { session },
    );
    if (!value) throw new HttpError(404, 'ORDER_NOT_FOUND', 'Order not found');
    return value;
  }
  async function seller(id: string, userId: string) {
    return restaurantAccess(ctx, id, userId, 'kitchen');
  }
  async function notify(value: Order, session: ClientSession) {
    const merchant = await db
      .collection('restaurants')
      .findOne({ _id: value.quote.restaurant.id as never }, { session });
    for (const [userId, href, role] of [
      [value.userId, `/orders/${value.id}/track`, 'customer'],
      [
        merchant?.userId ? String(merchant.userId) : '',
        `/seller/restaurants/${value.quote.restaurant.id}/orders/${value.id}`,
        'seller',
      ],
    ]) {
      if (!userId) continue;
      await notes.updateOne(
        { _id: `${value.id}:${value.version}:${role}` },
        {
          $setOnInsert: {
            userId,
            title: `${value.quote.restaurant.name}: ${value.status.replaceAll('_', ' ').toLowerCase()}`,
            href,
            at: new Date().toISOString(),
            readAt: null,
          },
        },
        { upsert: true, session },
      );
    }
  }
  async function change(
    value: Order,
    state: State,
    status: Order['status'],
    message: string,
    session: ClientSession,
  ) {
    value.status = status;
    value.version++;
    value.timeline.push({ at: new Date().toISOString(), status, message });
    await ops.orders.replaceOne({ _id: value._id }, value, { session });
    await states.replaceOne({ _id: value._id }, state, { upsert: true, session });
    await ops.event(
      session,
      value,
      `order.${({ READY_FOR_PICKUP: 'ready', PICKED_UP: 'picked-up', OUT_FOR_DELIVERY: 'out-for-delivery' } as Record<string, string>)[status] ?? status.toLowerCase()}.v1`,
      undefined,
      ['PICKED_UP', 'OUT_FOR_DELIVERY', 'DELIVERED'].includes(status)
        ? {
            deliveryId: state.assignment!.id,
            riderId: state.assignment!.riderId,
            operationId: randomUUID(),
          }
        : {},
    );
    await notify(value, session);
  }
  async function snapshot(
    value: Order,
    viewer: { userId: string; role: 'customer' | 'seller' | 'rider' | 'admin' },
    session?: ClientSession,
  ): Promise<FulfillmentSnapshot> {
    const state = (await states.findOne({ _id: value._id }, { session })) ?? initial(value._id);
    if (viewer.role === 'customer' && value.userId !== viewer.userId)
      throw new HttpError(404, 'ORDER_NOT_FOUND', 'Order not found');
    if (viewer.role === 'seller') await seller(value.quote.restaurant.id, viewer.userId);
    if (
      viewer.role === 'rider' &&
      (!state.assignment ||
        state.assignment.riderId !== viewer.userId ||
        terminal.includes(value.status))
    )
      throw new HttpError(404, 'DELIVERY_NOT_FOUND', 'Active delivery not found');
    const merchant = await db
      .collection('restaurants')
      .findOne({ _id: value.quote.restaurant.id as never }, { session });
    let latest: FulfillmentSnapshot['latestLocation'] = null;
    if (state.assignment && !terminal.includes(value.status) && viewer.role !== 'seller') {
      try {
        latest = await internalCall(ctx, 'rider', '/internal/v1/delivery/location', {
          orderId: value.id,
          assignmentId: state.assignment.id,
        });
      } catch {
        /* A missing location never invents a rider position. */
      }
    }
    const dropAllowed =
      (viewer.role === 'customer' || viewer.role === 'admin' || viewer.role === 'rider') &&
      !terminal.includes(value.status);
    return fulfillmentSnapshotSchema.parse({
      mode: value.quote.mode,
      orderId: value.id,
      number: value.number,
      version: value.version,
      status: value.status,
      paymentState: value.paymentState,
      restaurantId: value.quote.restaurant.id,
      restaurantName: value.quote.restaurant.name,
      pickup: {
        address: value.quote.restaurant.address,
        point: merchant?.point ?? { latitude: 0, longitude: 0 },
      },
      items: value.quote.lines.map(({ name, quantity, selection }) => ({
        name,
        quantity,
        selection,
      })),
      preparationMinutes: state.preparationMinutes,
      acceptedAt: state.acceptedAt,
      readyAt: state.readyAt,
      deliveredAt: state.deliveredAt,
      assignment: terminal.includes(value.status) ? null : state.assignment,
      dispatchState: terminal.includes(value.status) ? 'CLOSED' : state.dispatchState,
      pickupCode:
        viewer.role === 'seller' && value.status === 'READY_FOR_PICKUP'
          ? reveal(state.pickupProof)
          : null,
      deliveryCode:
        viewer.role === 'customer' && ['PICKED_UP', 'OUT_FOR_DELIVERY'].includes(value.status)
          ? reveal(state.deliveryProof)
          : null,
      proofExpiresAt:
        viewer.role === 'seller'
          ? (state.pickupProof?.expiresAt ?? null)
          : viewer.role === 'customer'
            ? (state.deliveryProof?.expiresAt ?? null)
            : null,
      dropoff: dropAllowed
        ? (({ street, apartment, landmark, instructions, recipient, phone, point }) => ({
            street,
            apartment,
            landmark,
            instructions,
            recipient,
            phone,
            point,
          }))(value.quote.address)
        : null,
      latestLocation: latest,
      trackingStale: !latest || Date.now() - Date.parse(latest.receivedAt) > 20000,
      timeline: value.timeline,
    });
  }
  const router = express.Router();
  router.use(remoteSession(ctx, { role: 'seller' }));
  router.get('/:restaurantId/orders', async (req, res) => {
    await ready();
    await seller(checkedId(req.params.restaurantId), currentPrincipal(res).userId);
    const scope = {
      'quote.restaurant.id': req.params.restaurantId,
      'quote.mode': config.COMMERCE_MODE,
    };
    const active = await ops.orders
      .find({
        ...scope,
        status: {
          $in: [
            'PLACED',
            'ACCEPTED',
            'PREPARING',
            'READY_FOR_PICKUP',
            'PICKED_UP',
            'OUT_FOR_DELIVERY',
          ],
        },
      })
      .sort({ createdAt: 1 })
      .limit(100)
      .toArray();
    const recent =
      active.length < 100
        ? await ops.orders
            .find({ ...scope, status: { $in: ['DELIVERED', 'REJECTED', 'CANCELLED'] } })
            .sort({ createdAt: -1 })
            .limit(100 - active.length)
            .toArray()
        : [];
    const records = [...active, ...recent];
    json(
      res,
      await Promise.all(
        records.map((o) => snapshot(o, { userId: currentPrincipal(res).userId, role: 'seller' })),
      ),
    );
  });
  router.get('/:restaurantId/orders/:orderId', async (req, res) => {
    await seller(checkedId(req.params.restaurantId), currentPrincipal(res).userId);
    const value = await order(checkedId(req.params.orderId));
    if (value.quote.restaurant.id !== req.params.restaurantId)
      throw new HttpError(404, 'ORDER_NOT_FOUND', 'Order not found');
    json(res, await snapshot(value, { role: 'seller', userId: currentPrincipal(res).userId }));
  });
  router.post(
    '/:restaurantId/orders/:orderId/actions',
    remoteSession(ctx, { role: 'seller', mutation: true }),
    async (req, res) => {
      await ready();
      const input = sellerActionSchema.parse(req.body),
        userId = currentPrincipal(res).userId,
        id = checkedId(req.params.orderId);
      await seller(checkedId(req.params.restaurantId), userId);
      await executeOnce(
        client,
        db,
        `seller-order:${id}`,
        requireIdempotency(req),
        input,
        async (session) => {
          const value = await order(id, session),
            state = (await states.findOne({ _id: id }, { session })) ?? initial(id);
          if (value.quote.restaurant.id !== req.params.restaurantId)
            throw new HttpError(404, 'ORDER_NOT_FOUND', 'Order not found');
          if (value.version !== input.expectedVersion)
            throw new HttpError(409, 'ORDER_CHANGED', 'Refresh the order before acting');
          if (
            input.action !== 'reject' &&
            (!value.captureRef || value.refundRequestedMinor >= value.quote.totals.totalMinor)
          )
            throw new HttpError(
              409,
              'PAYMENT_REVIEW_REQUIRED',
              'A fully refunded order cannot be prepared or handed over',
            );
          if (input.action === 'reject') {
            if (!['PLACED', ...active].includes(value.status) || !input.reason)
              throw new HttpError(
                409,
                'REJECTION_UNAVAILABLE',
                'A reason is required and food already picked up cannot be rejected',
              );
            await ops.release(value, session);
            if (value.refundRequestedMinor < value.quote.totals.totalMinor)
              await ops.authorizeRefund(
                value,
                value.quote.totals.totalMinor - value.refundRequestedMinor,
                input.reason,
                session,
              );
            if (state.assignment)
              await locks.deleteOne(
                { _id: state.assignment.riderId, assignmentId: state.assignment.id },
                { session },
              );
            state.dispatchState = 'CLOSED';
            await change(
              value,
              state,
              'REJECTED',
              `Restaurant rejected the order: ${input.reason}`,
              session,
            );
          } else if (input.action === 'accept' && value.status === 'PLACED') {
            state.preparationMinutes = input.preparationMinutes ?? 25;
            state.acceptedAt = new Date().toISOString();
            state.dispatchState = 'SEARCHING';
            await change(value, state, 'ACCEPTED', 'Restaurant accepted your order.', session);
          } else if (input.action === 'preparing' && value.status === 'ACCEPTED')
            await change(value, state, 'PREPARING', 'The kitchen is preparing your food.', session);
          else if (input.action === 'ready' && ['ACCEPTED', 'PREPARING'].includes(value.status)) {
            state.readyAt = new Date().toISOString();
            state.pickupProof = proof();
            await change(
              value,
              state,
              'READY_FOR_PICKUP',
              'Food is packed and ready for pickup.',
              session,
            );
          } else if (input.action === 'renew-pickup-code' && value.status === 'READY_FOR_PICKUP') {
            state.pickupProof = proof();
            await change(
              value,
              state,
              value.status,
              'Restaurant renewed the pickup verification code.',
              session,
            );
          } else
            throw new HttpError(
              409,
              'INVALID_TRANSITION',
              'This action is not available in the current state',
            );
          return { applied: true };
        },
      );
      json(res, await snapshot(await order(id), { role: 'seller', userId }));
    },
  );
  app.use('/api/v1/seller/restaurants', router);
  app.get('/api/v1/orders/:orderId/tracking', remoteSession(ctx), async (req, res) =>
    json(
      res,
      await snapshot(await order(checkedId(req.params.orderId)), {
        role: 'customer',
        userId: currentPrincipal(res).userId,
      }),
    ),
  );
  app.post(
    '/api/v1/orders/:orderId/delivery-code',
    remoteSession(ctx, { mutation: true }),
    async (req, res) => {
      const id = checkedId(req.params.orderId),
        userId = currentPrincipal(res).userId,
        input = z.object({ expectedVersion: z.number().int().positive() }).strict().parse(req.body);
      await executeOnce(
        client,
        db,
        `renew-delivery-code:${id}`,
        requireIdempotency(req),
        input,
        async (session) => {
          const value = await order(id, session);
          if (value.userId !== userId)
            throw new HttpError(404, 'ORDER_NOT_FOUND', 'Order not found');
          if (
            !['PICKED_UP', 'OUT_FOR_DELIVERY'].includes(value.status) ||
            value.version !== input.expectedVersion
          )
            throw new HttpError(409, 'ORDER_CHANGED', 'Code cannot be renewed in this state');
          const state = (await states.findOne({ _id: id }, { session }))!;
          state.deliveryProof = proof();
          await change(
            value,
            state,
            value.status,
            'Customer renewed the delivery verification code.',
            session,
          );
          return { applied: true };
        },
      );
      json(res, await snapshot(await order(id), { role: 'customer', userId }));
    },
  );
  const internal = express.Router();
  internal.use(internalOnly(ctx, ['rider', 'realtime', 'admin']));
  internal.use(async (_req, _res, next) => {
    try {
      await ready();
      next();
    } catch (e) {
      next(e);
    }
  });
  internal.post('/candidates', async (req, res) => {
    if (res.locals.caller !== 'rider') throw new HttpError(403, 'SERVICE_DENIED', 'Service denied');
    z.object({}).strict().parse(req.body);
    const values = await ops.orders
      .find({
        status: { $in: active },
        captureRef: { $type: 'string' },
        'quote.mode': config.COMMERCE_MODE,
      })
      .sort({ placedAt: 1 })
      .limit(50)
      .toArray();
    const result = [];
    for (const value of values) {
      const state = await states.findOne({ _id: value.id });
      if (
        state?.assignment ||
        state?.dispatchState === 'NO_RIDER' ||
        value.refundRequestedMinor >= value.quote.totals.totalMinor
      )
        continue;
      const merchant = await db
        .collection('restaurants')
        .findOne({ _id: value.quote.restaurant.id as never });
      if (merchant)
        result.push({
          orderId: value.id,
          version: value.version,
          restaurantName: value.quote.restaurant.name,
          city: merchant.city,
          pickup: merchant.point,
          acceptedAt: state?.acceptedAt,
          preparationMinutes: state?.preparationMinutes,
        });
    }
    json(res, result);
  });
  internal.post('/assignment', async (req, res) => {
    if (res.locals.caller !== 'rider') throw new HttpError(403, 'SERVICE_DENIED', 'Service denied');
    const input = z
      .object({
        orderId: z.string().uuid(),
        assignmentId: z.string().uuid(),
        riderId: z.string().uuid(),
        riderName: z.string().min(1).max(80),
        commandId: z.string().min(16),
      })
      .strict()
      .parse(req.body);
    const membership = await internalCall<{ activeUserIds: string[] }>(
      ctx,
      'auth',
      '/internal/v1/memberships/check',
      { userIds: [input.riderId], role: 'rider' },
    );
    if (!membership.activeUserIds.includes(input.riderId))
      throw new HttpError(403, 'RIDER_INACTIVE', 'Approved active rider access is required');
    await executeOnce(
      client,
      db,
      `assignment:${input.orderId}`,
      input.commandId,
      { assignmentId: input.assignmentId, riderId: input.riderId },
      async (session) => {
        const value = await order(input.orderId, session),
          state = (await states.findOne({ _id: value.id }, { session })) ?? initial(value.id);
        if (
          !active.includes(value.status) ||
          !value.captureRef ||
          value.refundRequestedMinor >= value.quote.totals.totalMinor ||
          state.assignment
        )
          throw new HttpError(
            409,
            'ASSIGNMENT_UNAVAILABLE',
            'Order is not available for assignment',
          );
        if (await locks.findOne({ _id: input.riderId }, { session }))
          throw new HttpError(409, 'RIDER_BUSY', 'Rider already has an active delivery');
        await locks.insertOne(
          { _id: input.riderId, orderId: value.id, assignmentId: input.assignmentId },
          { session },
        );
        state.assignment = {
          id: input.assignmentId,
          riderId: input.riderId,
          riderName: input.riderName,
          version: 1,
          assignedAt: new Date().toISOString(),
          arrived: false,
        };
        state.dispatchState = 'ASSIGNED';
        value.version++;
        value.timeline.push({
          at: new Date().toISOString(),
          status: value.status,
          message: 'A delivery partner has been assigned.',
        });
        await ops.orders.replaceOne({ _id: value.id }, value, { session });
        await states.replaceOne({ _id: value.id }, state, { upsert: true, session });
        await notify(value, session);
        return { applied: true };
      },
    );
    json(res, await snapshot(await order(input.orderId), { role: 'rider', userId: input.riderId }));
  });
  internal.post('/task', async (req, res) => {
    const input = z
      .object({ orderId: z.string().uuid(), riderId: z.string().uuid() })
      .strict()
      .parse(req.body);
    if (res.locals.caller !== 'rider') throw new HttpError(403, 'SERVICE_DENIED', 'Service denied');
    json(res, await snapshot(await order(input.orderId), { role: 'rider', userId: input.riderId }));
  });
  internal.post('/assignment-state', async (req, res) => {
    const input = z
      .object({ orderId: z.string().uuid(), assignmentId: z.string().uuid() })
      .strict()
      .parse(req.body);
    if (res.locals.caller !== 'rider') throw new HttpError(403, 'SERVICE_DENIED', 'Service denied');
    const value = await order(input.orderId),
      state = await states.findOne({ _id: value.id });
    json(res, {
      active:
        !!state?.assignment &&
        state.assignment.id === input.assignmentId &&
        !terminal.includes(value.status),
      status: value.status,
      version: value.version,
    });
  });
  internal.post('/command', async (req, res) => {
    if (res.locals.caller !== 'rider') throw new HttpError(403, 'SERVICE_DENIED', 'Service denied');
    const input = z
      .object({
        orderId: z.string().uuid(),
        assignmentId: z.string().uuid(),
        riderId: z.string().uuid(),
        action: z.enum(['arrive', 'pickup', 'depart', 'complete']),
        expectedVersion: z.number().int().positive(),
        code: z
          .string()
          .regex(/^\d{6}$/)
          .optional(),
        commandId: z.string().min(16),
      })
      .strict()
      .parse(req.body);
    const { commandId: _command, ...commandPayload } = input;
    const result = await executeOnce(
      client,
      db,
      `delivery-command:${input.orderId}`,
      input.commandId,
      commandPayload,
      async (session) => {
        const value = await order(input.orderId, session),
          state = await states.findOne({ _id: value.id }, { session });
        if (
          !state?.assignment ||
          state.assignment.id !== input.assignmentId ||
          state.assignment.riderId !== input.riderId ||
          terminal.includes(value.status)
        )
          throw new HttpError(409, 'ASSIGNMENT_REVOKED', 'Assignment is no longer active');
        if (value.version !== input.expectedVersion)
          throw new HttpError(409, 'ORDER_CHANGED', 'Refresh the delivery before acting');
        if (input.action === 'arrive' && active.includes(value.status)) {
          state.assignment.arrived = true;
          state.assignment.version++;
          await change(
            value,
            state,
            value.status,
            'Delivery partner arrived at the restaurant.',
            session,
          );
          return { applied: true };
        }
        if (input.action === 'depart' && value.status === 'PICKED_UP') {
          await change(
            value,
            state,
            'OUT_FOR_DELIVERY',
            'Your delivery partner is on the way.',
            session,
          );
          return { applied: true };
        }
        const validStage =
          input.action === 'pickup'
            ? value.status === 'READY_FOR_PICKUP'
            : input.action === 'complete' &&
              ['PICKED_UP', 'OUT_FOR_DELIVERY'].includes(value.status);
        if (!validStage)
          throw new HttpError(409, 'INVALID_TRANSITION', 'Delivery action is not available');
        if (
          input.action === 'pickup' &&
          value.refundRequestedMinor >= value.quote.totals.totalMinor
        )
          throw new HttpError(
            409,
            'PAYMENT_REVIEW_REQUIRED',
            'The order was fully refunded; contact the restaurant or operator',
          );
        const p = input.action === 'pickup' ? state.pickupProof : state.deliveryProof;
        if (!p || p.expiresAt <= new Date().toISOString() || p.attempts >= 5)
          return { applied: false, error: 'PROOF_EXPIRED' };
        p.attempts++;
        if (!input.code || !equal(p.hash, mac(config.AUTH_SECRET, `${p.nonce}:${input.code}`))) {
          await states.replaceOne({ _id: value.id }, state, { session });
          return { applied: false, error: 'INVALID_PROOF' };
        }
        if (input.action === 'pickup') {
          state.pickupProof = null;
          state.deliveryProof = proof();
          await change(
            value,
            state,
            'PICKED_UP',
            'Food pickup was verified by the restaurant.',
            session,
          );
        } else {
          state.deliveryProof = null;
          state.deliveredAt = new Date().toISOString();
          state.dispatchState = 'CLOSED';
          await locks.deleteOne(
            { _id: input.riderId, assignmentId: input.assignmentId },
            { session },
          );
          await change(
            value,
            state,
            'DELIVERED',
            'Delivery confirmed with the customer verification code.',
            session,
          );
        }
        return { applied: true };
      },
    );
    if (!result.applied)
      throw new HttpError(
        409,
        result.error ?? 'INVALID_PROOF',
        'Verification code is incorrect, expired or locked. Ask the entitled party to renew it.',
      );
    json(res, { applied: true });
  });
  internal.post('/snapshot', async (req, res) => {
    if (res.locals.caller !== 'realtime')
      throw new HttpError(403, 'SERVICE_DENIED', 'Service denied');
    const input = z
      .object({ orderId: z.string().uuid(), sessionId: z.string().uuid() })
      .strict()
      .parse(req.body);
    const principal = await internalCall<import('@cravecart/contracts').Principal>(
      ctx,
      'auth',
      '/internal/v1/sessions/inspect',
      { sessionId: input.sessionId },
    );
    const value = await order(input.orderId);
    const state = await states.findOne({ _id: value.id });
    let role: 'customer' | 'seller' | 'rider' = 'customer';
    if (value.userId !== principal.userId) {
      if (state?.assignment?.riderId === principal.userId && principal.roles.includes('rider'))
        role = 'rider';
      else if (principal.roles.includes('seller')) role = 'seller';
      else throw new HttpError(404, 'ORDER_NOT_FOUND', 'Order not found');
    }
    json(res, await snapshot(value, { userId: principal.userId, role }));
  });
  internal.post('/no-rider', async (req, res) => {
    if (res.locals.caller !== 'rider') throw new HttpError(403, 'SERVICE_DENIED', 'Service denied');
    const { orderId } = z.object({ orderId: z.string().uuid() }).strict().parse(req.body);
    await states.updateOne(
      { _id: orderId, assignment: null },
      { $set: { dispatchState: 'NO_RIDER' } },
    );
    json(res, { recorded: true });
  });
  internal.post('/retry-dispatch', async (req, res) => {
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
    const value = await order(input.orderId);
    if (!active.includes(value.status))
      throw new HttpError(409, 'DISPATCH_UNAVAILABLE', 'Only a pre-pickup order can be dispatched');
    await states.updateOne(
      { _id: value.id, assignment: null },
      { $set: { dispatchState: 'SEARCHING' } },
    );
    await db.collection('commerce_audit').insertOne({
      actorId: principal.userId,
      action: 'dispatch-retry',
      orderId: value.id,
      reason: input.reason,
      at: new Date(),
    });
    json(res, { queued: true });
  });
  internal.post('/notifications', async (req, res) => {
    if (res.locals.caller !== 'realtime')
      throw new HttpError(403, 'SERVICE_DENIED', 'Service denied');
    const input = z
      .object({ userId: z.string().uuid(), readId: z.string().max(200).optional() })
      .strict()
      .parse(req.body);
    if (input.readId)
      await notes.updateOne(
        { _id: input.readId, userId: input.userId },
        { $set: { readAt: new Date().toISOString() } },
      );
    json(
      res,
      (
        await notes.find({ userId: input.userId }).sort({ at: -1, _id: -1 }).limit(50).toArray()
      ).map(({ _id, userId: _uid, ...n }) => ({ id: _id, ...n })),
    );
  });
  app.use('/internal/v1/fulfillment', internal);
  // Order creation/placement predates fulfillment. Derive missing notifications durably on a sweep.
  let working = false;
  async function tick() {
    if (working) return;
    working = true;
    try {
      await ready();
      const recent = await ops.orders
        .find({
          'quote.mode': config.COMMERCE_MODE,
          status: { $nin: ['PAYMENT_PENDING', 'EXPIRED'] },
        })
        .sort({ createdAt: -1 })
        .limit(100)
        .toArray();
      for (const value of recent) {
        const session = client.startSession();
        try {
          await session.withTransaction(() => notify(value, session));
        } finally {
          await session.endSession();
        }
      }
    } finally {
      working = false;
    }
  }
  const timer = setInterval(() => void tick().catch(() => {}), 5000);
  timer.unref();
  ctx.onClose?.(async () => clearInterval(timer));
  return { snapshot, tick };
}
import { restaurantAccess } from './access.js';

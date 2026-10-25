import express, { type Express } from 'express';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import {
  type Principal,
  type Review,
  pageQuerySchema,
  periodQuerySchema,
  periodBounds,
  reviewInputSchema,
  reviewReplySchema,
  reasonSchema,
} from '@cravecart/contracts';
import {
  remoteSession,
  currentPrincipal,
  internalCall,
  internalOnly,
  requirePermission,
  requireIdempotency,
  checkedId,
  HttpError,
  json,
  lazyIndexes,
  type DomainContext,
} from '@cravecart/platform';
import { executeOnce } from '@cravecart/persistence';
import { restaurantAccess } from './access.js';
import type { OrderRecord } from './orders.js';
type StoredReview = Review & { _id: string; userId: string; reports: string[]; mode: string };
export function installRestaurantOperations(app: Express, ctx: DomainContext) {
  const { db, client, config } = ctx,
    reviews = db.collection<StoredReview>('reviews'),
    orders = db.collection<OrderRecord>('orders');
  const ready = lazyIndexes(async () => {
    await reviews.createIndex({ orderId: 1 }, { unique: true });
    await reviews.createIndex({ restaurantId: 1, moderation: 1, at: -1 });
    await db
      .collection('restaurant_staff')
      .createIndex({ restaurantId: 1, userId: 1 }, { unique: true });
    await orders.createIndex({ 'quote.restaurant.id': 1, 'quote.mode': 1, createdAt: -1 });
  });
  const audit = async (
    action: string,
    actorId: string,
    reason: string,
    values: object,
    session?: import('mongodb').ClientSession,
  ) =>
    db
      .collection('operations_audit')
      .insertOne(
        { id: randomUUID(), action, actorId, reason, ...values, at: new Date().toISOString() },
        { session },
      );
  const publicReview = (r: StoredReview) => {
    const { _id: _id, userId: _u, reports: _r, mode: _m, ...result } = r;
    return result;
  };
  app.get('/api/v1/orders/:orderId/reviews', remoteSession(ctx), async (req, res) => {
    const order = await orders.findOne({
      _id: checkedId(req.params.orderId),
      userId: currentPrincipal(res).userId,
      'quote.mode': config.COMMERCE_MODE,
    });
    if (!order) throw new HttpError(404, 'ORDER_NOT_FOUND', 'Order not found');
    const review = await reviews.findOne({ orderId: order.id });
    json(res, {
      eligible: order.status === 'DELIVERED' && !review,
      review: review ? publicReview(review) : null,
    });
  });
  app.post(
    '/api/v1/orders/:orderId/reviews',
    remoteSession(ctx, { mutation: true }),
    async (req, res) => {
      await ready();
      const input = reviewInputSchema.parse(req.body),
        id = checkedId(req.params.orderId),
        userId = currentPrincipal(res).userId;
      const result = await executeOnce(
        client,
        db,
        userId + ':review:' + id,
        requireIdempotency(req),
        input,
        async (session) => {
          const order = await orders.findOne(
            { _id: id, userId, 'quote.mode': config.COMMERCE_MODE },
            { session },
          );
          if (!order) throw new HttpError(404, 'ORDER_NOT_FOUND', 'Order not found');
          if (order.status !== 'DELIVERED')
            throw new HttpError(409, 'NOT_DELIVERED', 'Only delivered orders can be reviewed');
          if (await reviews.findOne({ orderId: id }, { session }))
            throw new HttpError(409, 'REVIEW_EXISTS', 'This order already has a review');
          const review: StoredReview = {
            _id: randomUUID(),
            id: '',
            orderId: id,
            restaurantId: order.quote.restaurant.id,
            ...input,
            at: new Date().toISOString(),
            version: 1,
            response: null,
            moderation: 'VISIBLE',
            userId,
            reports: [],
            mode: config.COMMERCE_MODE,
          };
          review.id = review._id;
          await reviews.insertOne(review, { session });
          return publicReview(review);
        },
      );
      json(res, result, 201);
    },
  );
  app.get('/api/v1/restaurants/:slug/reviews', async (req, res) => {
    const restaurant = await db.collection('restaurants').findOne({
      slug: z.string().max(100).parse(req.params.slug),
      published: true,
      ...(config.NODE_ENV === 'production' ? { sample: { $ne: true } } : {}),
    });
    if (!restaurant) throw new HttpError(404, 'RESTAURANT_NOT_FOUND', 'Restaurant not found');
    const active = await internalCall<{ activeUserIds: string[] }>(
      ctx,
      'auth',
      '/internal/v1/memberships/check',
      { role: 'seller', userIds: [restaurant.userId] },
    );
    if (!active.activeUserIds.includes(String(restaurant.userId)))
      throw new HttpError(404, 'RESTAURANT_NOT_FOUND', 'Restaurant not found');
    const { page } = pageQuerySchema.parse(req.query),
      filter = {
        restaurantId: String(restaurant._id),
        moderation: 'VISIBLE' as const,
        mode: config.COMMERCE_MODE,
      };
    json(res, {
      reviews: (
        await reviews
          .find(filter)
          .sort({ at: -1, _id: -1 })
          .skip((page - 1) * 25)
          .limit(25)
          .toArray()
      ).map(publicReview),
      total: await reviews.countDocuments(filter),
      page,
    });
  });
  app.post(
    '/api/v1/reviews/:reviewId/report',
    remoteSession(ctx, { mutation: true }),
    async (req, res) => {
      await ready();
      const input = reasonSchema.parse(req.body),
        id = checkedId(req.params.reviewId),
        userId = currentPrincipal(res).userId;
      const result = await executeOnce(
        client,
        db,
        userId + ':review-report:' + id,
        requireIdempotency(req),
        input,
        async (session) => {
          const review = await reviews.findOne({ _id: id }, { session });
          if (!review) throw new HttpError(404, 'REVIEW_NOT_FOUND', 'Review not found');
          await reviews.updateOne({ _id: id }, { $addToSet: { reports: userId } }, { session });
          await audit('review.report', userId, input.reason, { reviewId: id }, session);
          return { reported: true };
        },
      );
      json(res, result);
    },
  );
  const seller = express.Router();
  seller.use(remoteSession(ctx, { role: 'seller' }));
  seller.get('/:restaurantId/reviews', async (req, res) => {
    await restaurantAccess(ctx, checkedId(req.params.restaurantId), currentPrincipal(res).userId);
    const { page } = pageQuerySchema.parse(req.query),
      filter = { restaurantId: String(req.params.restaurantId), mode: config.COMMERCE_MODE };
    json(res, {
      reviews: (
        await reviews
          .find(filter)
          .sort({ at: -1, _id: -1 })
          .skip((page - 1) * 25)
          .limit(25)
          .toArray()
      ).map(publicReview),
      total: await reviews.countDocuments(filter),
      page,
    });
  });
  seller.post(
    '/:restaurantId/reviews/:reviewId/response',
    remoteSession(ctx, { role: 'seller', mutation: true }),
    async (req, res) => {
      const input = reviewReplySchema.parse(req.body),
        restaurantId = checkedId(req.params.restaurantId),
        id = checkedId(req.params.reviewId),
        userId = currentPrincipal(res).userId;
      await restaurantAccess(ctx, restaurantId, userId);
      json(
        res,
        await executeOnce(
          client,
          db,
          userId + ':review-response:' + id,
          requireIdempotency(req),
          input,
          async (session) => {
            const result = await reviews.findOneAndUpdate(
              { _id: id, restaurantId, version: input.expectedVersion, mode: config.COMMERCE_MODE },
              { $set: { response: input.text }, $inc: { version: 1 } },
              { session, returnDocument: 'after' },
            );
            if (!result)
              throw new HttpError(
                409,
                'VERSION_CONFLICT',
                'Review changed; reload before replying',
              );
            await audit(
              'review.response',
              userId,
              'Restaurant response',
              { reviewId: id },
              session,
            );
            return publicReview(result);
          },
        ),
      );
    },
  );
  seller.get('/:restaurantId/staff', async (req, res) => {
    const id = checkedId(req.params.restaurantId);
    await restaurantAccess(ctx, id, currentPrincipal(res).userId, 'owner');
    json(
      res,
      await db
        .collection('restaurant_staff')
        .find({ restaurantId: id }, { projection: { _id: 0 } })
        .sort({ userId: 1 })
        .limit(50)
        .toArray(),
    );
  });
  seller.put(
    '/:restaurantId/staff/:userId',
    remoteSession(ctx, { role: 'seller', mutation: true }),
    async (req, res) => {
      await ready();
      const restaurantId = checkedId(req.params.restaurantId),
        userId = checkedId(req.params.userId),
        actor = currentPrincipal(res).userId;
      await restaurantAccess(ctx, restaurantId, actor, 'owner');
      if (userId === actor)
        throw new HttpError(
          409,
          'SELF_CHANGE_DENIED',
          'The owner cannot be replaced through team access',
        );
      const input = z
        .object({
          expectedVersion: z.number().int().nonnegative(),
          role: z.enum(['manager', 'kitchen']),
          active: z.boolean(),
          reason: z.string().trim().min(5).max(500),
        })
        .strict()
        .parse(req.body);
      if (input.active) {
        const eligible = await internalCall<{ activeUserIds: string[] }>(
          ctx,
          'auth',
          '/internal/v1/memberships/check',
          { role: 'seller', userIds: [userId] },
        );
        if (!eligible.activeUserIds.includes(userId))
          throw new HttpError(
            422,
            'MEMBER_NOT_VERIFIED',
            'Team members must have an approved seller account',
          );
      }
      json(
        res,
        await executeOnce(
          client,
          db,
          actor + ':staff:' + restaurantId + ':' + userId,
          requireIdempotency(req),
          input,
          async (session) => {
            const members = db.collection('restaurant_staff'),
              before = await members.findOne({ restaurantId, userId }, { session });
            if ((before?.version ?? 0) !== input.expectedVersion)
              throw new HttpError(409, 'VERSION_CONFLICT', 'Team access changed');
            if (!before && (await members.countDocuments({ restaurantId }, { session })) >= 50)
              throw new HttpError(409, 'STAFF_LIMIT', 'At most 50 team records per restaurant');
            const value = {
              restaurantId,
              userId,
              role: input.role,
              active: input.active,
              version: input.expectedVersion + 1,
            };
            await members.updateOne(
              { restaurantId, userId },
              { $set: value },
              { upsert: true, session },
            );
            await audit(
              'restaurant.staff',
              actor,
              input.reason,
              {
                restaurantId,
                userId,
                before: before ? { role: before.role, active: before.active } : null,
                after: value,
              },
              session,
            );
            return value;
          },
        ),
      );
    },
  );
  async function statement(
    filter: object,
    period: z.infer<typeof periodQuerySchema>,
    page: number,
  ) {
    const bounds = periodBounds(period),
      scope = {
        ...filter,
        'quote.mode': config.COMMERCE_MODE,
        createdAt: { $gte: bounds.from, $lt: bounds.to },
      };
    const totals = (
      await orders
        .aggregate([
          { $match: scope },
          {
            $group: {
              _id: null,
              grossMinor: { $sum: '$quote.totals.totalMinor' },
              capturedMinor: {
                $sum: {
                  $cond: [{ $ifNull: ['$captureRef', false] }, '$quote.totals.totalMinor', 0],
                },
              },
              refundedMinor: { $sum: '$refundedMinor' },
              tipMinor: {
                $sum: { $cond: [{ $eq: ['$status', 'DELIVERED'] }, '$quote.totals.tipMinor', 0] },
              },
            },
          },
        ])
        .toArray()
    )[0];
    const rows = (
      await orders
        .find(scope)
        .sort({ createdAt: -1, _id: -1 })
        .skip((page - 1) * 25)
        .limit(25)
        .toArray()
    ).map((o) => ({
      orderId: o.id,
      number: o.number,
      status: o.status,
      createdAt: o.createdAt,
      grossMinor: o.quote.totals.totalMinor,
      capturedMinor: o.captureRef ? o.quote.totals.totalMinor : 0,
      refundedMinor: o.refundedMinor,
      tipMinor: o.status === 'DELIVERED' ? o.quote.totals.tipMinor : 0,
    }));
    return {
      ...period,
      generatedAt: new Date().toISOString(),
      timezone: 'Asia/Kolkata' as const,
      currency: 'INR' as const,
      mode: config.COMMERCE_MODE,
      rows,
      total: await orders.countDocuments(scope),
      page,
      totals: {
        grossMinor: totals?.grossMinor ?? 0,
        capturedMinor: totals?.capturedMinor ?? 0,
        refundedMinor: totals?.refundedMinor ?? 0,
        tipMinor: totals?.tipMinor ?? 0,
      },
      settlementStatus: 'UNRECONCILED' as const,
      commissionMinor: null,
      payableMinor: null,
      notice:
        'Order-created-date cohort; captured and refunded values reflect current verified state. Gross includes unsuccessful orders and all checkout components. Tips are delivered-order amounts, before refund allocation. Commission, rider fees and bank settlement are not configured; these figures are not a payable or payout statement.',
    };
  }
  seller.get('/:restaurantId/finance', async (req, res) => {
    const restaurantId = checkedId(req.params.restaurantId);
    await restaurantAccess(ctx, restaurantId, currentPrincipal(res).userId, 'owner');
    const { page, ...dates } = z
      .object({
        from: z.string(),
        to: z.string(),
        page: z.coerce.number().int().min(1).max(10000).default(1),
      })
      .strict()
      .parse(req.query);
    json(
      res,
      await statement(
        { 'quote.restaurant.id': restaurantId },
        periodQuerySchema.parse(dates),
        page,
      ),
    );
  });
  async function analytics(filter: object, period: z.infer<typeof periodQuerySchema>) {
    const bounds = periodBounds(period),
      scope = {
        ...filter,
        'quote.mode': config.COMMERCE_MODE,
        createdAt: { $gte: bounds.from, $lt: bounds.to },
      };
    const byStatus = await orders
      .aggregate([
        { $match: scope },
        {
          $group: {
            _id: '$status',
            count: { $sum: 1 },
            valueMinor: { $sum: '$quote.totals.totalMinor' },
          },
        },
        { $sort: { _id: 1 } },
      ])
      .toArray();
    const popular = await orders
      .aggregate([
        { $match: { ...scope, status: 'DELIVERED' } },
        { $unwind: '$quote.lines' },
        { $group: { _id: '$quote.lines.name', quantity: { $sum: '$quote.lines.quantity' } } },
        { $sort: { quantity: -1, _id: 1 } },
        { $limit: 10 },
      ])
      .toArray();
    return {
      ...period,
      generatedAt: new Date().toISOString(),
      timezone: 'Asia/Kolkata',
      mode: config.COMMERCE_MODE,
      byStatus: byStatus.map((x) => ({ status: x._id, count: x.count, valueMinor: x.valueMinor })),
      popular: popular.map((x) => ({ name: x._id, quantity: x.quantity })),
      definition:
        'Orders created during the selected India calendar dates, grouped by current status. Values include all checkout components; not platform revenue. Popular dishes count delivered quantities.',
    };
  }
  seller.get('/:restaurantId/analytics', async (req, res) => {
    const restaurantId = checkedId(req.params.restaurantId);
    await restaurantAccess(ctx, restaurantId, currentPrincipal(res).userId);
    json(
      res,
      await analytics({ 'quote.restaurant.id': restaurantId }, periodQuerySchema.parse(req.query)),
    );
  });
  seller.get('/:restaurantId/history', async (req, res) => {
    const restaurantId = checkedId(req.params.restaurantId);
    await restaurantAccess(ctx, restaurantId, currentPrincipal(res).userId, 'kitchen');
    const { page } = pageQuerySchema.parse(req.query),
      scope = { 'quote.restaurant.id': restaurantId, 'quote.mode': config.COMMERCE_MODE };
    json(res, {
      orders: (
        await orders
          .find(scope)
          .sort({ createdAt: -1, _id: -1 })
          .skip((page - 1) * 25)
          .limit(25)
          .toArray()
      ).map((o) => ({
        id: o.id,
        number: o.number,
        status: o.status,
        createdAt: o.createdAt,
        totalMinor: o.quote.totals.totalMinor,
      })),
      total: await orders.countDocuments(scope),
      page,
    });
  });
  app.use('/api/v1/seller/restaurants', seller);
  const internal = express.Router();
  internal.use(internalOnly(ctx, ['admin', 'realtime', 'rider']));
  internal.post('/order-context', async (req, res) => {
    const input = z
      .object({ sessionId: z.string().uuid(), orderId: z.string().uuid() })
      .strict()
      .parse(req.body);
    const actor = await internalCall<Principal>(ctx, 'auth', '/internal/v1/sessions/inspect', {
      sessionId: input.sessionId,
    });
    const order = await orders.findOne({ _id: input.orderId, 'quote.mode': config.COMMERCE_MODE });
    if (!order) throw new HttpError(404, 'ORDER_NOT_FOUND', 'Order not found');
    const state = await db.collection('fulfillment').findOne({ _id: input.orderId as never });
    let role = 'customer';
    if (order.userId !== actor.userId) {
      if (actor.roles.includes('rider') && state?.assignment?.riderId === actor.userId)
        role = 'rider';
      else if (actor.roles.includes('seller')) {
        await restaurantAccess(ctx, order.quote.restaurant.id, actor.userId, 'kitchen');
        role = 'seller';
      } else throw new HttpError(404, 'ORDER_NOT_FOUND', 'Order not found');
    }
    json(res, {
      orderId: order.id,
      number: order.number,
      status: order.status,
      role,
      customerId: order.userId,
      riderId: state?.assignment?.riderId ?? null,
      canMessage:
        ['PICKED_UP', 'OUT_FOR_DELIVERY', 'READY_FOR_PICKUP', 'ACCEPTED', 'PREPARING'].includes(
          order.status,
        ) && !!state?.assignment,
    });
  });
  async function admin(input: unknown, permission: string, stepUp = false) {
    const value = z.object({ actorSessionId: z.string().uuid() }).passthrough().parse(input);
    const actor = await internalCall<Principal>(ctx, 'auth', '/internal/v1/sessions/inspect', {
      sessionId: value.actorSessionId,
    });
    requirePermission(actor, permission, stepUp);
    return actor;
  }
  internal.post('/report', async (req, res) => {
    const body = z
      .object({ actorSessionId: z.string().uuid(), from: z.string(), to: z.string() })
      .strict()
      .parse(req.body);
    await admin(body, 'reports:read');
    json(res, await analytics({}, periodQuerySchema.parse({ from: body.from, to: body.to })));
  });
  internal.post('/rider-statement', async (req, res) => {
    if (res.locals.caller !== 'rider') throw new HttpError(403, 'SERVICE_DENIED', 'Service denied');
    const input = z
      .object({
        sessionId: z.string().uuid(),
        from: z.string(),
        to: z.string(),
        page: z.number().int().min(1).max(10000),
      })
      .strict()
      .parse(req.body);
    const actor = await internalCall<Principal>(ctx, 'auth', '/internal/v1/sessions/inspect', {
      sessionId: input.sessionId,
    });
    if (!actor.roles.includes('rider'))
      throw new HttpError(403, 'FORBIDDEN', 'Rider access required');
    const ids = (
      await db
        .collection('fulfillment')
        .find({ 'assignment.riderId': actor.userId }, { projection: { _id: 1 } })
        .limit(10001)
        .toArray()
    ).map((x) => String(x._id));
    if (ids.length > 10000)
      throw new HttpError(422, 'REPORT_TOO_LARGE', 'Ask support for an archival statement');
    const result = await statement(
      { _id: { $in: ids } },
      periodQuerySchema.parse({ from: input.from, to: input.to }),
      input.page,
    );
    json(res, {
      ...result,
      rows: result.rows.map((r) => ({ ...r, grossMinor: 0, capturedMinor: 0, refundedMinor: 0 })),
      totals: { ...result.totals, grossMinor: 0, capturedMinor: 0, refundedMinor: 0 },
      notice:
        'Delivered-order tips recorded for your own assigned deliveries, before refund allocation. Rider base fees, adjustments and bank settlement require an approved compensation policy. No payout or net earnings are inferred from customer delivery charges.',
    });
  });
  internal.post('/reviews', async (req, res) => {
    await admin(req.body, 'support:read');
    const body = z
      .object({ actorSessionId: z.string().uuid(), page: z.number().int().min(1).max(10000) })
      .strict()
      .parse(req.body);
    const filter = { mode: config.COMMERCE_MODE };
    json(res, {
      reviews: (
        await reviews
          .find(filter)
          .sort({ at: -1, _id: -1 })
          .skip((body.page - 1) * 25)
          .limit(25)
          .toArray()
      ).map((r) => ({ ...publicReview(r), reportCount: r.reports.length })),
      total: await reviews.countDocuments(filter),
      page: body.page,
    });
  });
  internal.post('/moderate-review', async (req, res) => {
    const body = z
        .object({
          actorSessionId: z.string().uuid(),
          reviewId: z.string().uuid(),
          expectedVersion: z.number().int().positive(),
          hidden: z.boolean(),
          reason: z.string().trim().min(5).max(500),
          commandId: z.string().min(16).max(128),
        })
        .strict()
        .parse(req.body),
      actor = await admin(body, 'support:write', true);
    json(
      res,
      await executeOnce(
        client,
        db,
        actor.userId + ':moderate-review',
        body.commandId,
        body,
        async (session) => {
          const before = await reviews.findOneAndUpdate(
            { _id: body.reviewId, version: body.expectedVersion, mode: config.COMMERCE_MODE },
            { $set: { moderation: body.hidden ? 'HIDDEN' : 'VISIBLE' }, $inc: { version: 1 } },
            { session, returnDocument: 'before' },
          );
          if (!before) throw new HttpError(409, 'VERSION_CONFLICT', 'Review changed; reload');
          await audit(
            'review.moderate',
            actor.userId,
            body.reason,
            {
              reviewId: body.reviewId,
              before: before.moderation,
              after: body.hidden ? 'HIDDEN' : 'VISIBLE',
            },
            session,
          );
          return { updated: true };
        },
      ),
    );
  });
  internal.post('/promotions', async (req, res) => {
    const body = z
      .object({ actorSessionId: z.string().uuid(), page: z.number().int().min(1).max(10000) })
      .strict()
      .parse(req.body);
    await admin(body, 'promotions:read');
    json(res, {
      offers: (
        await db
          .collection('offers')
          .find({})
          .sort({ _id: 1 })
          .skip((body.page - 1) * 25)
          .limit(25)
          .toArray()
      ).map(({ _id, ...o }) => ({ id: String(_id), ...o })),
      total: await db.collection('offers').countDocuments({}),
      page: body.page,
    });
  });
  internal.post('/promotion-state', async (req, res) => {
    const input = z
        .object({
          actorSessionId: z.string().uuid(),
          offerId: z.string().uuid(),
          expectedVersion: z.number().int().positive(),
          active: z.boolean(),
          reason: z.string().trim().min(5).max(500),
          commandId: z.string().min(16).max(128),
        })
        .strict()
        .parse(req.body),
      actor = await admin(input, 'promotions:write', true);
    json(
      res,
      await executeOnce(
        client,
        db,
        actor.userId + ':promotion-state',
        input.commandId,
        input,
        async (session) => {
          const before = await db
            .collection('offers')
            .findOneAndUpdate(
              { _id: input.offerId as never, version: input.expectedVersion },
              { $set: { active: input.active }, $inc: { version: 1 } },
              { session, returnDocument: 'before' },
            );
          if (!before) throw new HttpError(409, 'VERSION_CONFLICT', 'Promotion changed; reload');
          await audit(
            'promotion.state',
            actor.userId,
            input.reason,
            { offerId: input.offerId, before: before.active, after: input.active },
            session,
          );
          return { updated: true };
        },
      ),
    );
  });
  internal.post('/audit', async (req, res) => {
    const input = z
      .object({ actorSessionId: z.string().uuid(), page: z.number().int().min(1).max(10000) })
      .strict()
      .parse(req.body);
    await admin(input, 'audit:read');
    json(
      res,
      await db
        .collection('operations_audit')
        .find({}, { projection: { _id: 0 } })
        .sort({ at: -1, id: -1 })
        .skip((input.page - 1) * 25)
        .limit(25)
        .toArray(),
    );
  });
  app.use('/internal/v1/operations', internal);
}

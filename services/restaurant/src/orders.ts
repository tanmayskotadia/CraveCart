import express, { type Express, type Response } from 'express';
import { randomUUID } from 'node:crypto';
import type { ClientSession } from 'mongodb';
import { z } from 'zod';
import {
  quoteInputSchema,
  createOrderSchema,
  cancelOrderSchema,
  pricingPolicyInputSchema,
  merchantLaunchInputSchema,
  merchantLaunchRecordSchema,
  merchantLaunchQuerySchema,
  calculateTotals,
  isOpen,
  type PricingPolicy,
  type Quote,
  type Order,
  type Cart,
  type MenuItemInput,
  type RestaurantInput,
  type Offer,
  type Address,
  type Gateway,
  type PayableOrder,
} from '@cravecart/contracts';
import {
  currentPrincipal,
  remoteSession,
  internalOnly,
  internalCall,
  checkedId,
  HttpError,
  json,
  requireIdempotency,
  lazyIndexes,
  type DomainContext,
} from '@cravecart/platform';
import { executeOnce, payloadHash, enqueueEvent } from '@cravecart/persistence';
import { priceLine } from './catalog.js';

interface QuoteRecord extends Quote {
  _id: string;
  userId: string;
  digest: string;
  restaurantVersion: number;
  offerId: string | null;
  offerVersion: number | null;
  policy: PricingPolicy;
  zoneId: string;
}
export interface OrderRecord extends Order {
  _id: string;
  userId: string;
  quoteId: string;
  reservationState: 'HELD' | 'COMMITTED' | 'RELEASED';
  stock: Array<{ id: string; quantity: number; tracked: boolean }>;
  offerId: string | null;
  captureRef?: string;
  cancellationSeconds: number;
}
interface RefundIntent {
  _id: string;
  mode: Quote['mode'];
  orderId: string;
  attemptId: string;
  userId: string;
  amountMinor: number;
  reason: string;
  state: 'NEW' | 'SENT';
  attempts: number;
  leaseUntil: Date;
  nextAttemptAt: Date;
  createdAt: string;
}
type RestaurantRecord = RestaurantInput & {
  _id: string;
  userId: string;
  version: number;
  slug: string;
  sample: boolean;
  liveOrderingApproved?: boolean;
};
type ItemRecord = MenuItemInput & {
  _id: string;
  restaurantId: string;
  version: number;
  deleted: boolean;
};
type OfferRecord = Omit<Offer, 'id'> & {
  _id: string;
  usageUsed?: number;
  usageReserved?: number;
  usageLimit?: number | null;
  perUserLimit?: number | null;
};
const developmentPolicy: PricingPolicy = {
  enabled: true,
  approvedForLive: false,
  platformFeeMinor: 0,
  taxBps: 0,
  taxLabel: 'Development test policy (not a tax determination)',
  quoteSeconds: 300,
  paymentSeconds: 600,
  cancellationSeconds: 300,
  maxOrderMinor: 10000000,
  version: 1,
  development: true,
};
export function installOrders(app: Express, ctx: DomainContext) {
  const { db, client, config } = ctx,
    quotes = db.collection<QuoteRecord>('quotes'),
    orders = db.collection<OrderRecord>('orders'),
    refunds = db.collection<RefundIntent>('refund_intents'),
    menu = db.collection<ItemRecord>('menu_items'),
    restaurants = db.collection<RestaurantRecord>('restaurants'),
    offers = db.collection<OfferRecord>('offers');
  const policyCollection = db.collection<PricingPolicy & { _id: string }>('pricing_policy');
  const ready = lazyIndexes(async () => {
    const previousIndex = (
      await orders
        .listIndexes()
        .toArray()
        .catch(() => [])
    ).find(
      (index) =>
        index.name === 'userId_1' &&
        index.unique &&
        index.partialFilterExpression?.status === 'PAYMENT_PENDING',
    );
    if (previousIndex) await orders.dropIndex('userId_1');
    await orders.createIndex(
      { userId: 1, 'quote.mode': 1 },
      { unique: true, partialFilterExpression: { status: 'PAYMENT_PENDING' } },
    );
    await orders.createIndex({ quoteId: 1 }, { unique: true });
    await orders.createIndex({ status: 1, paymentDeadline: 1 });
    await orders.createIndex({ userId: 1, createdAt: -1 });
    await quotes.createIndex({ userId: 1, expiresAt: 1 });
    await refunds.createIndex({ state: 1, nextAttemptAt: 1 });
    if (
      config.COMMERCE_MODE === 'development' &&
      config.NODE_ENV !== 'production' &&
      config.DEV_ADAPTERS === 'true'
    )
      await policyCollection.updateOne(
        { _id: 'current' },
        { $setOnInsert: { _id: 'current', ...developmentPolicy } },
        { upsert: true },
      );
  });
  function presentQuote(record: QuoteRecord): Quote {
    const {
      _id: _id,
      userId: _userId,
      digest: _digest,
      restaurantVersion: _rv,
      offerId: _oid,
      offerVersion: _ov,
      policy: _policy,
      zoneId: _zone,
      ...quote
    } = record;
    return quote;
  }
  function present(record: OrderRecord): Order {
    const {
      _id: _id,
      userId: _userId,
      quoteId: _quoteId,
      reservationState: _rs,
      stock: _stock,
      offerId: _oid,
      captureRef: _ref,
      cancellationSeconds: _seconds,
      ...order
    } = record;
    return order;
  }
  async function loadPolicy() {
    await ready();
    if (config.COMMERCE_MODE === 'disabled')
      throw new HttpError(503, 'CHECKOUT_DISABLED', 'Checkout is not enabled');
    const policy = await policyCollection.findOne({ _id: 'current' });
    if (
      !policy?.enabled ||
      (config.COMMERCE_MODE === 'live' && (!policy.approvedForLive || policy.development))
    )
      throw new HttpError(
        503,
        'POLICY_NOT_APPROVED',
        'Checkout requires an approved pricing policy',
      );
    return policy;
  }
  async function getOwned(id: string, userId: string) {
    const order = await orders.findOne({ _id: id, userId, 'quote.mode': config.COMMERCE_MODE });
    if (!order) throw new HttpError(404, 'NOT_FOUND', 'Order not found');
    return order;
  }
  async function event(
    session: ClientSession,
    order: OrderRecord,
    type: string,
    res?: Response,
    extra: Record<string, unknown> = {},
  ) {
    await enqueueEvent(db, session, {
      eventId: randomUUID(),
      eventType: type,
      schemaVersion: 1,
      occurredAt: new Date().toISOString(),
      producer: 'restaurant',
      aggregate: { type: 'order', id: order._id, version: order.version },
      correlationId: String(res?.locals.requestId ?? order._id),
      causationId: order._id,
      data: { orderId: order._id, restaurantId: order.quote.restaurant.id, ...extra },
    });
  }
  async function compute(
    userId: string,
    input: z.infer<typeof quoteInputSchema>,
  ): Promise<QuoteRecord> {
    const policy = await loadPolicy(),
      cart = await db.collection<Cart & { _id: string }>('carts').findOne({ _id: userId });
    if (!cart?.lines.length || cart.version !== input.cartVersion)
      throw new HttpError(409, 'CART_CHANGED', 'Your cart changed. Review it before checkout');
    const restaurant = await restaurants.findOne({ _id: cart.restaurantId, published: true });
    if (
      !restaurant ||
      restaurant.paused ||
      !isOpen(restaurant.hours, new Date(), restaurant.holidays)
    )
      throw new HttpError(409, 'RESTAURANT_UNAVAILABLE', 'Restaurant is closed or unavailable');
    if (config.COMMERCE_MODE === 'live' && (restaurant.sample || !restaurant.liveOrderingApproved))
      throw new HttpError(
        403,
        'MERCHANT_NOT_APPROVED',
        'This restaurant is not approved for live checkout',
      );
    const membership = await internalCall<{ activeUserIds: string[] }>(
      ctx,
      'auth',
      '/internal/v1/memberships/check',
      { userIds: [restaurant.userId], role: 'seller' },
    );
    if (!membership.activeUserIds.includes(restaurant.userId))
      throw new HttpError(409, 'RESTAURANT_UNAVAILABLE', 'Restaurant is unavailable');
    const address = await internalCall<Address>(ctx, 'auth', '/internal/v1/addresses/get', {
      userId,
      addressId: cart.addressId,
    });
    if (address.city !== restaurant.city)
      throw new HttpError(422, 'CITY_MISMATCH', 'Choose an address in this city');
    const service = await internalCall<{
      serviceable: boolean;
      zones: Array<{
        id: string;
        version: number;
        feePolicyVersion: number;
        deliveryFeeMinor: number;
      }>;
    }>(ctx, 'admin', '/internal/v1/zones/check', {
      city: restaurant.city,
      point: address.point,
      pickupPoint: restaurant.point,
    });
    const zone = service.zones[0];
    if (!service.serviceable || !zone)
      throw new HttpError(
        422,
        'NOT_SERVICEABLE',
        'The pickup and delivery pins do not share an open operating zone',
      );
    const records = await menu
      .find({
        _id: { $in: cart.lines.map((line) => line.itemId) },
        restaurantId: restaurant._id,
        deleted: false,
      })
      .toArray();
    const lines = cart.lines.map((line) => {
      const item = records.find((value) => value._id === line.itemId);
      if (!item) throw new HttpError(409, 'ITEM_UNAVAILABLE', 'A dish was removed');
      return priceLine(
        { ...item, id: item._id },
        {
          itemId: line.itemId,
          variantId: line.variantId,
          optionIds: line.optionIds,
          quantity: line.quantity,
          instructions: line.instructions,
        },
      );
    });
    for (const item of records)
      if (
        item.stock !== null &&
        lines
          .filter((line) => line.itemId === item._id)
          .reduce((sum, line) => sum + line.quantity, 0) > item.stock
      )
        throw new HttpError(
          409,
          'STOCK_UNAVAILABLE',
          `${item.name} is unavailable in the requested quantity`,
        );
    const subtotal = lines.reduce((sum, line) => sum + line.quantity * line.unitPriceMinor, 0);
    if (subtotal < restaurant.minimumOrderMinor)
      throw new HttpError(422, 'MINIMUM_ORDER', 'Add more items to meet the restaurant minimum');
    let offer: OfferRecord | null = null,
      discount = 0;
    const now = new Date().toISOString();
    if (input.offerCode) {
      offer = await offers.findOne({
        restaurantId: restaurant._id,
        code: input.offerCode,
        active: true,
        startsAt: { $lte: now },
        endsAt: { $gt: now },
      });
      if (!offer || subtotal < offer.minimumSubtotalMinor)
        throw new HttpError(
          422,
          'OFFER_INELIGIBLE',
          'This offer is unavailable or its minimum spend is not met',
        );
      const usage = await db
        .collection('promotion_usage')
        .findOne({ _id: `${offer._id}:${userId}` as never });
      if (
        (offer.usageLimit != null &&
          (offer.usageUsed ?? 0) + (offer.usageReserved ?? 0) >= offer.usageLimit) ||
        (offer.perUserLimit != null &&
          Number(usage?.used ?? 0) + Number(usage?.reserved ?? 0) >= offer.perUserLimit)
      )
        throw new HttpError(409, 'OFFER_LIMIT', 'The offer usage limit has been reached');
      discount = Math.min(Math.floor((subtotal * offer.percent) / 100), offer.maxDiscountMinor);
    }
    const totals = calculateTotals(
      subtotal,
      discount,
      zone.deliveryFeeMinor,
      input.tipMinor,
      policy,
    );
    if (totals.totalMinor < 100 || totals.totalMinor > policy.maxOrderMinor)
      throw new HttpError(
        422,
        'ORDER_AMOUNT_LIMIT',
        'The order total is outside the configured checkout limits',
      );
    const id = randomUUID(),
      quote: QuoteRecord = {
        _id: id,
        id,
        userId,
        cartVersion: cart.version,
        restaurant: {
          id: restaurant._id,
          name: restaurant.name,
          slug: restaurant.slug,
          address: restaurant.address,
        },
        address,
        lines,
        totals,
        offerCode: offer?.code ?? null,
        offerId: offer?._id ?? null,
        offerVersion: offer?.version ?? null,
        restaurantVersion: restaurant.version,
        policy: {
          enabled: policy.enabled,
          approvedForLive: policy.approvedForLive,
          platformFeeMinor: policy.platformFeeMinor,
          taxBps: policy.taxBps,
          taxLabel: policy.taxLabel,
          quoteSeconds: policy.quoteSeconds,
          paymentSeconds: policy.paymentSeconds,
          cancellationSeconds: policy.cancellationSeconds,
          maxOrderMinor: policy.maxOrderMinor,
          version: policy.version,
          development: policy.development,
        },
        policyVersion: policy.version,
        zoneId: zone.id,
        zoneVersion: zone.version,
        feePolicyVersion: zone.feePolicyVersion,
        mode: config.COMMERCE_MODE,
        development: config.COMMERCE_MODE !== 'live',
        warnings:
          config.COMMERCE_MODE === 'live'
            ? []
            : ['Test checkout — no real delivery or live charge.'],
        expiresAt: new Date(Date.now() + policy.quoteSeconds * 1000).toISOString(),
        digest: '',
      };
    quote.digest = payloadHash({
      cartVersion: cart.version,
      restaurantVersion: restaurant.version,
      address,
      lines,
      totals,
      policy: quote.policy,
      zone,
      offerId: quote.offerId,
      offerVersion: quote.offerVersion,
      mode: quote.mode,
    });
    return quote;
  }
  async function promotion(
    order: OrderRecord,
    from: 'HELD' | 'COMMITTED',
    release: boolean,
    session: ClientSession,
  ) {
    if (!order.offerId) return;
    const counters =
      from === 'HELD'
        ? release
          ? { usageReserved: -1 }
          : { usageReserved: -1, usageUsed: 1 }
        : { usageUsed: -1 };
    await offers.updateOne({ _id: order.offerId }, { $inc: counters }, { session });
    await db
      .collection<{ _id: string; reserved: number; used: number }>('promotion_usage')
      .updateOne(
        { _id: `${order.offerId}:${order.userId}` },
        {
          $inc:
            from === 'HELD'
              ? release
                ? { reserved: -1 }
                : { reserved: -1, used: 1 }
              : { used: -1 },
        },
        { session },
      );
  }
  async function release(order: OrderRecord, session: ClientSession) {
    if (order.reservationState === 'RELEASED') return;
    for (const line of order.stock)
      if (line.tracked)
        await menu.updateOne(
          { _id: line.id, stock: { $ne: null } },
          { $inc: { stock: line.quantity } },
          { session },
        );
    await promotion(order, order.reservationState, true, session);
    order.reservationState = 'RELEASED';
  }
  async function authorizeRefund(
    order: OrderRecord,
    amount: number,
    reason: string,
    session: ClientSession,
  ) {
    if (amount <= 0 || order.refundRequestedMinor + amount > order.quote.totals.totalMinor)
      throw new HttpError(409, 'REFUND_LIMIT', 'Refunds cannot exceed the captured order amount');
    const id = randomUUID();
    await refunds.insertOne(
      {
        _id: id,
        orderId: order._id,
        attemptId: order.attemptId,
        userId: order.userId,
        amountMinor: amount,
        reason,
        mode: order.quote.mode,
        state: 'NEW',
        attempts: 0,
        leaseUntil: new Date(0),
        nextAttemptAt: new Date(0),
        createdAt: new Date().toISOString(),
      },
      { session },
    );
    order.refundRequestedMinor += amount;
    order.paymentState = 'REFUND_PENDING';
    await enqueueEvent(db, session, {
      eventId: randomUUID(),
      eventType: 'order.refund-requested.v1',
      schemaVersion: 1,
      occurredAt: new Date().toISOString(),
      producer: 'restaurant',
      aggregate: { type: 'order', id: order._id, version: order.version },
      correlationId: order._id,
      causationId: id,
      data: {
        refundId: id,
        orderId: order._id,
        restaurantId: order.quote.restaurant.id,
        amountMinor: amount,
        currency: 'INR',
      },
    });
    return id;
  }
  // Provider outcomes are applied only through signed Utils commands and idempotent receipts.
  async function applyCapture(input: {
    orderId: string;
    attemptId: string;
    gateway: Gateway;
    paymentRef: string;
    amountMinor: number;
    currency: string;
    mode: string;
  }) {
    const before = await orders.findOne({ _id: input.orderId });
    if (before?.quote.mode !== config.COMMERCE_MODE)
      throw new HttpError(409, 'ENVIRONMENT_MISMATCH', 'Order environment is not active');
    if (!before) throw new HttpError(404, 'NOT_FOUND', 'Order not found');
    let canFulfill = true;
    if (before.status === 'PAYMENT_PENDING' && before.paymentDeadline > new Date().toISOString()) {
      const restaurant = await restaurants.findOne({ _id: before.quote.restaurant.id });
      if (
        !restaurant ||
        restaurant.paused ||
        !restaurant.published ||
        !isOpen(restaurant.hours, new Date(), restaurant.holidays)
      )
        canFulfill = false;
      const buyer = await internalCall<{ activeUserIds: string[] }>(
        ctx,
        'auth',
        '/internal/v1/memberships/check',
        { userIds: [before.userId], role: 'customer' },
      );
      if (!buyer.activeUserIds.includes(before.userId)) canFulfill = false;
      if (restaurant) {
        const seller = await internalCall<{ activeUserIds: string[] }>(
          ctx,
          'auth',
          '/internal/v1/memberships/check',
          { userIds: [restaurant.userId], role: 'seller' },
        );
        if (!seller.activeUserIds.includes(restaurant.userId)) canFulfill = false;
      }
      if (restaurant) {
        const check = await internalCall<{ serviceable: boolean }>(
          ctx,
          'admin',
          '/internal/v1/zones/check',
          {
            city: before.quote.address.city,
            point: before.quote.address.point,
            pickupPoint: restaurant.point,
          },
        );
        canFulfill &&= check.serviceable;
      }
    }
    const session = client.startSession();
    let decision = 'APPLIED';
    try {
      await session.withTransaction(async () => {
        const order = await orders.findOne({ _id: input.orderId }, { session });
        if (
          !order ||
          order.attemptId !== input.attemptId ||
          order.gateway !== input.gateway ||
          order.quote.mode !== input.mode ||
          order.quote.totals.totalMinor !== input.amountMinor ||
          input.currency !== 'INR'
        )
          throw new HttpError(409, 'PAYMENT_MISMATCH', 'Payment does not match this order');
        if (order.captureRef) {
          decision = order.captureRef === input.paymentRef ? 'APPLIED' : 'EXTRA_CAPTURE';
          return;
        }
        order.captureRef = input.paymentRef;
        order.version++;
        order.paymentState = 'CAPTURED';
        if (
          order.status === 'PAYMENT_PENDING' &&
          order.paymentDeadline > new Date().toISOString() &&
          canFulfill
        ) {
          order.status = 'PLACED';
          order.placedAt = new Date().toISOString();
          await promotion(order, 'HELD', false, session);
          order.reservationState = 'COMMITTED';
          order.timeline.push({
            at: order.placedAt,
            status: 'PLACED',
            message: 'Payment verified; order placed.',
          });
          await db.collection<Cart & { _id: string }>('carts').updateOne(
            { _id: order.userId, version: order.quote.cartVersion },
            {
              $set: { lines: [], subtotalMinor: 0, updatedAt: order.placedAt },
              $inc: { version: 1 },
            },
            { session },
          );
          await event(session, order, 'order.placed.v1');
        } else {
          if (order.status === 'PAYMENT_PENDING') {
            order.status = 'EXPIRED';
            await release(order, session);
          }
          await authorizeRefund(
            order,
            order.quote.totals.totalMinor,
            'Automatic compensation: payment arrived after checkout could be fulfilled',
            session,
          );
          order.timeline.push({
            at: new Date().toISOString(),
            status: 'REFUND_PENDING',
            message:
              'Payment verified after cancellation/expiry or area closure; refund requested.',
          });
          decision = 'REFUND_PENDING';
        }
        await orders.replaceOne({ _id: order._id }, order, { session });
      });
    } finally {
      await session.endSession();
    }
    return { decision };
  }
  const router = express.Router();
  router.use(async (_req, _res, next) => {
    try {
      await ready();
      next();
    } catch (error) {
      next(error);
    }
  });
  router.post('/quotes', remoteSession(ctx, { mutation: true }), async (req, res) => {
    const quote = await compute(currentPrincipal(res).userId, quoteInputSchema.parse(req.body));
    await quotes.insertOne(quote);
    json(res, presentQuote(quote), 201);
  });
  router.post('/orders', remoteSession(ctx, { mutation: true }), async (req, res) => {
    const input = createOrderSchema.parse(req.body),
      userId = currentPrincipal(res).userId,
      key = requireIdempotency(req);
    const original = await quotes.findOne({ _id: input.quoteId, userId });
    if (!original) throw new HttpError(404, 'NOT_FOUND', 'Quote not found');
    // A successful replay remains valid even after the quote has expired or the cart has cleared.
    const existing = await orders.findOne({ quoteId: original._id, userId });
    if (existing) {
      if (existing.gateway !== input.gateway)
        throw new HttpError(409, 'GATEWAY_LOCKED', 'An order already uses this quote and gateway');
      json(res, present(existing), 201);
      return;
    }
    if (original.expiresAt <= new Date().toISOString())
      throw new HttpError(409, 'QUOTE_EXPIRED', 'Refresh the quote and review its prices');
    const current = await compute(userId, {
      cartVersion: original.cartVersion,
      offerCode: original.offerCode ?? undefined,
      tipMinor: original.totals.tipMinor,
    });
    if (current.digest !== original.digest)
      throw new HttpError(
        409,
        'QUOTE_CHANGED',
        'Menu, address, offer or fees changed. Refresh and review the new quote',
      );
    const capabilities = await internalCall<{ mode: string; gateways: Gateway[] }>(
      ctx,
      'utils',
      '/internal/v1/payments/capabilities',
      {},
    );
    if (capabilities.mode !== original.mode || !capabilities.gateways.includes(input.gateway))
      throw new HttpError(
        503,
        'GATEWAY_UNAVAILABLE',
        'This gateway is unavailable for the current environment',
      );
    try {
      const result = await executeOnce(
        client,
        db,
        `${userId}:place-order`,
        key,
        input,
        async (session) => {
          if (
            !(await db
              .collection('carts')
              .findOne({ _id: userId as never, version: original.cartVersion }, { session }))
          )
            throw new HttpError(409, 'CART_CHANGED', 'Your cart changed');
          const restaurant = await restaurants.findOne(
            {
              _id: original.restaurant.id,
              version: original.restaurantVersion,
              published: true,
              paused: false,
            },
            { session },
          );
          const policy = await policyCollection.findOne(
            { _id: 'current', version: original.policyVersion, enabled: true },
            { session },
          );
          if (!restaurant || !policy || !isOpen(restaurant.hours, new Date(), restaurant.holidays))
            throw new HttpError(409, 'QUOTE_CHANGED', 'Restaurant or pricing policy changed');
          const stock: Array<{ id: string; quantity: number; tracked: boolean }> = [];
          for (const id of [...new Set(original.lines.map((line) => line.itemId))]) {
            const quantity = original.lines
                .filter((line) => line.itemId === id)
                .reduce((sum, line) => sum + line.quantity, 0),
              version = original.lines.find((line) => line.itemId === id)!.itemVersion;
            const item = await menu.findOne(
              { _id: id, restaurantId: restaurant._id, version, available: true, deleted: false },
              { session },
            );
            if (!item)
              throw new HttpError(409, 'STOCK_UNAVAILABLE', 'A dish changed or is sold out');
            if (item.stock !== null) {
              const held = await menu.updateOne(
                { _id: id, version, stock: { $gte: quantity } },
                { $inc: { stock: -quantity } },
                { session },
              );
              if (!held.modifiedCount)
                throw new HttpError(
                  409,
                  'STOCK_UNAVAILABLE',
                  'The last portions were reserved by another order',
                );
            }
            stock.push({ id, quantity, tracked: item.stock !== null });
          }
          if (original.offerId) {
            const offer = await offers.findOne(
              {
                _id: original.offerId,
                version: original.offerVersion!,
                active: true,
                startsAt: { $lte: new Date().toISOString() },
                endsAt: { $gt: new Date().toISOString() },
              },
              { session },
            );
            if (
              !offer ||
              (offer.usageLimit != null &&
                (offer.usageUsed ?? 0) + (offer.usageReserved ?? 0) >= offer.usageLimit)
            )
              throw new HttpError(409, 'OFFER_LIMIT', 'Offer changed or reached its limit');
            const usage = db.collection<{ _id: string; reserved: number; used: number }>(
                'promotion_usage',
              ),
              record = await usage.findOne({ _id: `${offer._id}:${userId}` }, { session });
            if (
              offer.perUserLimit != null &&
              (record?.reserved ?? 0) + (record?.used ?? 0) >= offer.perUserLimit
            )
              throw new HttpError(409, 'OFFER_LIMIT', 'Your offer usage limit was reached');
            await offers.updateOne({ _id: offer._id }, { $inc: { usageReserved: 1 } }, { session });
            await usage.updateOne(
              { _id: `${offer._id}:${userId}` },
              { $inc: { reserved: 1 }, $setOnInsert: { used: 0 } },
              { upsert: true, session },
            );
          }
          const id = randomUUID(),
            now = new Date().toISOString(),
            order: OrderRecord = {
              _id: id,
              id,
              number: `CC-${id.slice(0, 8).toUpperCase()}`,
              userId,
              quoteId: original._id,
              version: 1,
              status: 'PAYMENT_PENDING',
              paymentState: 'UNPAID',
              gateway: input.gateway,
              attemptId: randomUUID(),
              quote: presentQuote(original),
              createdAt: now,
              paymentDeadline: new Date(
                Date.now() + original.policy.paymentSeconds * 1000,
              ).toISOString(),
              placedAt: null,
              cancelledAt: null,
              cancellationReason: null,
              refundRequestedMinor: 0,
              refundedMinor: 0,
              timeline: [
                {
                  at: now,
                  status: 'PAYMENT_PENDING',
                  message: 'Items reserved while you complete payment.',
                },
              ],
              reservationState: 'HELD',
              stock,
              offerId: original.offerId,
              cancellationSeconds: original.policy.cancellationSeconds,
            };
          await orders.insertOne(order, { session });
          await event(session, order, 'order.payment-pending.v1', res);
          return present(order);
        },
      );
      json(res, result, 201);
    } catch (error) {
      if (error && typeof error === 'object' && 'code' in error && error.code === 11000)
        throw new HttpError(
          409,
          'PENDING_ORDER_EXISTS',
          'Finish or cancel your pending order from My orders before starting another',
        );
      throw error;
    }
  });
  router.get('/orders', remoteSession(ctx), async (_req, res) =>
    json(
      res,
      (
        await orders
          .find({ userId: currentPrincipal(res).userId, 'quote.mode': config.COMMERCE_MODE })
          .sort({ createdAt: -1, _id: 1 })
          .limit(100)
          .toArray()
      ).map(present),
    ),
  );
  router.get('/orders/:orderId', remoteSession(ctx), async (req, res) =>
    json(res, present(await getOwned(checkedId(req.params.orderId), currentPrincipal(res).userId))),
  );
  function cancellation(order: OrderRecord) {
    return order.status === 'PAYMENT_PENDING' || order.status === 'PLACED';
  }
  async function allowedCancellation(order: OrderRecord) {
    return (
      order.status === 'PAYMENT_PENDING' ||
      (order.status === 'PLACED' &&
        !!order.placedAt &&
        Date.now() <= Date.parse(order.placedAt) + order.cancellationSeconds * 1000)
    );
  }
  router.get('/orders/:orderId/cancellation-preview', remoteSession(ctx), async (req, res) => {
    const order = await getOwned(checkedId(req.params.orderId), currentPrincipal(res).userId),
      allowed = await allowedCancellation(order);
    json(res, {
      allowed,
      expectedVersion: order.version,
      refundAmountMinor:
        allowed && order.paymentState !== 'UNPAID'
          ? order.quote.totals.totalMinor - order.refundRequestedMinor
          : 0,
      message: allowed
        ? 'Confirm cancellation. Any captured payment is refunded only after provider verification.'
        : 'This order is outside the customer cancellation window.',
    });
  });
  router.post(
    '/orders/:orderId/cancel',
    remoteSession(ctx, { mutation: true }),
    async (req, res) => {
      const input = cancelOrderSchema.parse(req.body),
        userId = currentPrincipal(res).userId,
        id = checkedId(req.params.orderId),
        before = await getOwned(id, userId),
        allowed = await allowedCancellation(before);
      const result = await executeOnce(
        client,
        db,
        `${userId}:cancel:${id}`,
        requireIdempotency(req),
        input,
        async (session) => {
          const order = await orders.findOne({ _id: id, userId }, { session });
          if (!order) throw new HttpError(404, 'NOT_FOUND', 'Order not found');
          if (order.status === 'CANCELLED') return present(order);
          if (
            !allowed ||
            !(await allowedCancellation(order)) ||
            !cancellation(order) ||
            order.version !== input.expectedVersion
          )
            throw new HttpError(
              409,
              'CANCELLATION_CHANGED',
              'Order state or cancellation eligibility changed. Review it again',
            );
          order.status = 'CANCELLED';
          order.cancelledAt = new Date().toISOString();
          order.cancellationReason = input.reason;
          order.version++;
          await release(order, session);
          if (order.captureRef && order.refundRequestedMinor < order.quote.totals.totalMinor)
            await authorizeRefund(
              order,
              order.quote.totals.totalMinor - order.refundRequestedMinor,
              input.reason,
              session,
            );
          order.timeline.push({
            at: order.cancelledAt,
            status: 'CANCELLED',
            message:
              order.paymentState === 'UNPAID'
                ? 'Cancelled; any later captured payment will be compensated.'
                : order.paymentState === 'REFUNDED'
                  ? 'Cancelled; payment was already refunded.'
                  : 'Cancelled; refund processing requested.',
          });
          await orders.replaceOne({ _id: id }, order, { session });
          await event(session, order, 'order.cancelled.v1', res);
          return present(order);
        },
      );
      json(res, result);
    },
  );
  app.use('/api/v1', router);
  const internal = express.Router();
  internal.use(
    [
      '/orders/payable',
      '/orders/payment',
      '/orders/refund-applied',
      '/orders/admin-list',
      '/orders/admin-read',
      '/orders/retry-refunds',
      '/orders/admin-refund',
      '/commerce',
    ],
    internalOnly(ctx, ['utils', 'admin']),
  );
  internal.use(async (_req, _res, next) => {
    try {
      await ready();
      next();
    } catch (error) {
      next(error);
    }
  });
  internal.post('/orders/payable', async (req, res) => {
    if (res.locals.caller !== 'utils') throw new HttpError(403, 'SERVICE_DENIED', 'Service denied');
    const input = z
        .object({ orderId: z.string().uuid(), userId: z.string().uuid().optional() })
        .strict()
        .parse(req.body),
      order = await orders.findOne({
        _id: input.orderId,
        ...(input.userId ? { userId: input.userId } : {}),
      });
    if (!order) throw new HttpError(404, 'NOT_FOUND', 'Order not found');
    const value: PayableOrder = {
      orderId: order._id,
      userId: order.userId,
      attemptId: order.attemptId,
      gateway: order.gateway,
      mode: order.quote.mode,
      amountMinor: order.quote.totals.totalMinor,
      currency: 'INR',
      status: order.status,
      paymentDeadline: order.paymentDeadline,
      restaurantName: order.quote.restaurant.name,
    };
    json(res, value);
  });
  internal.post('/orders/payment', async (req, res) => {
    if (res.locals.caller !== 'utils') throw new HttpError(403, 'SERVICE_DENIED', 'Service denied');
    const input = z
      .object({
        orderId: z.string().uuid(),
        attemptId: z.string().uuid(),
        gateway: z.enum(['razorpay', 'stripe']),
        paymentRef: z.string().min(1).max(150),
        amountMinor: z.number().int().positive(),
        currency: z.literal('INR'),
        mode: z.string(),
      })
      .strict()
      .parse(req.body);
    json(res, await applyCapture(input));
  });
  internal.post('/orders/refund-applied', async (req, res) => {
    if (res.locals.caller !== 'utils') throw new HttpError(403, 'SERVICE_DENIED', 'Service denied');
    const input = z
      .object({
        orderId: z.string().uuid(),
        refundId: z.string().uuid(),
        amountMinor: z.number().int().positive(),
      })
      .strict()
      .parse(req.body);
    const session = client.startSession();
    try {
      await session.withTransaction(async () => {
        if (
          await db
            .collection('refund_receipts')
            .findOne({ _id: input.refundId as never }, { session })
        )
          return;
        const intent = await refunds.findOne(
            { _id: input.refundId, orderId: input.orderId, amountMinor: input.amountMinor },
            { session },
          ),
          order = await orders.findOne({ _id: input.orderId }, { session });
        if (
          !intent ||
          !order ||
          order.refundedMinor + input.amountMinor > order.refundRequestedMinor
        )
          throw new HttpError(409, 'REFUND_MISMATCH', 'Refund does not match an authorized amount');
        await db
          .collection<{ _id: string }>('refund_receipts')
          .insertOne({ _id: input.refundId }, { session });
        order.refundedMinor += input.amountMinor;
        order.paymentState =
          order.refundedMinor === order.quote.totals.totalMinor
            ? 'REFUNDED'
            : order.refundedMinor === order.refundRequestedMinor
              ? 'PARTIALLY_REFUNDED'
              : 'REFUND_PENDING';
        order.version++;
        order.timeline.push({
          at: new Date().toISOString(),
          status: order.paymentState,
          message: 'Refund verified with the payment provider.',
        });
        await orders.replaceOne({ _id: order._id }, order, { session });
      });
    } finally {
      await session.endSession();
    }
    json(res, { applied: true });
  });
  const launchRecord = (record: RestaurantRecord) =>
    merchantLaunchRecordSchema.parse({
      id: record._id,
      name: record.name,
      city: record.city,
      version: record.version,
      published: record.published,
      paused: record.paused,
      sample: Boolean(record.sample),
      liveOrderingApproved: record.liveOrderingApproved === true,
    });
  internal.post('/commerce/merchants', async (req, res) => {
    if (res.locals.caller !== 'admin') throw new HttpError(403, 'SERVICE_DENIED', 'Service denied');
    const input = merchantLaunchQuerySchema
      .extend({ actorSessionId: z.string().uuid() })
      .parse(req.body);
    await verifyAdmin(input.actorSessionId, false);
    const filter = input.restaurantId ? { _id: input.restaurantId } : {};
    const [records, total] = await Promise.all([
      restaurants
        .find(filter)
        .sort({ _id: 1 })
        .skip((input.page - 1) * 20)
        .limit(20)
        .toArray(),
      restaurants.countDocuments(filter),
    ]);
    json(res, { merchants: records.map(launchRecord), total, page: input.page, pageSize: 20 });
  });
  internal.post('/commerce/merchant-approval', async (req, res) => {
    if (res.locals.caller !== 'admin') throw new HttpError(403, 'SERVICE_DENIED', 'Service denied');
    const input = merchantLaunchInputSchema
      .extend({ restaurantId: z.string().uuid(), actorSessionId: z.string().uuid() })
      .parse(req.body);
    await verifyAdmin(input.actorSessionId);
    const original = await restaurants.findOne({ _id: input.restaurantId });
    if (!original) throw new HttpError(404, 'NOT_FOUND', 'Restaurant not found');
    if (input.approved) {
      if (original.sample || !original.published || original.paused)
        throw new HttpError(
          422,
          'MERCHANT_NOT_READY',
          'Review a published, available restaurant with real merchant details',
        );
      const members = await internalCall<{ activeUserIds: string[] }>(
        ctx,
        'auth',
        '/internal/v1/memberships/check',
        { userIds: [original.userId], role: 'seller' },
      );
      if (!members.activeUserIds.includes(original.userId))
        throw new HttpError(
          422,
          'MERCHANT_NOT_READY',
          'The restaurant owner must be an active verified seller',
        );
    }
    const session = client.startSession();
    try {
      let result: RestaurantRecord | null = null;
      await session.withTransaction(async () => {
        result = await restaurants.findOneAndUpdate(
          { _id: input.restaurantId, version: input.expectedVersion },
          { $set: { liveOrderingApproved: input.approved }, $inc: { version: 1 } },
          { session, returnDocument: 'after' },
        );
        if (!result)
          throw new HttpError(
            409,
            'VERSION_CONFLICT',
            'Restaurant changed. Reload and review again.',
          );
        await db.collection('commerce_audit').insertOne(
          {
            id: randomUUID(),
            actorSessionId: input.actorSessionId,
            action: 'merchant.live-approval',
            restaurantId: input.restaurantId,
            approved: input.approved,
            reason: input.reason,
            version: result.version,
            at: new Date(),
          },
          { session },
        );
      });
      json(res, launchRecord(result!));
    } finally {
      await session.endSession();
    }
  });
  internal.post('/commerce/policy', async (req, res) => {
    if (res.locals.caller !== 'admin') throw new HttpError(403, 'SERVICE_DENIED', 'Service denied');
    const input = z
      .object({
        actorSessionId: z.string().uuid(),
        expectedVersion: z.number().int().min(0),
        policy: pricingPolicyInputSchema,
        reason: z.string().trim().min(5).max(500),
      })
      .strict()
      .parse(req.body);
    await verifyAdmin(input.actorSessionId);
    const session = client.startSession();
    let value: PricingPolicy | undefined;
    try {
      await session.withTransaction(async () => {
        const old = await policyCollection.findOne({ _id: 'current' }, { session });
        if ((old?.version ?? 0) !== input.expectedVersion)
          throw new HttpError(409, 'VERSION_CONFLICT', 'Policy changed');
        value = {
          ...input.policy,
          version: input.expectedVersion + 1,
          development: config.COMMERCE_MODE === 'development',
        };
        await policyCollection.replaceOne({ _id: 'current' }, value, { upsert: true, session });
        await db.collection('commerce_audit').insertOne(
          {
            id: randomUUID(),
            actorSessionId: input.actorSessionId,
            action: 'policy.updated',
            reason: input.reason,
            version: value.version,
            at: new Date(),
          },
          { session },
        );
      });
    } finally {
      await session.endSession();
    }
    json(res, value);
  });
  internal.post('/commerce/policy-read', async (req, res) => {
    if (res.locals.caller !== 'admin') throw new HttpError(403, 'SERVICE_DENIED', 'Service denied');
    await verifyAdmin(
      z.object({ actorSessionId: z.string().uuid() }).parse(req.body).actorSessionId,
      false,
    );
    const record = await policyCollection.findOne({ _id: 'current' });
    if (!record) {
      json(res, null);
      return;
    }
    const { _id: _id, ...value } = record;
    json(res, value);
  });
  async function verifyAdmin(sessionId: string, write = true) {
    const principal = await internalCall<import('@cravecart/contracts').Principal>(
      ctx,
      'auth',
      '/internal/v1/sessions/inspect',
      { sessionId },
    );
    const { requirePermission } = await import('@cravecart/platform');
    requirePermission(principal, write ? 'finance:write' : 'finance:read', write);
    return principal;
  }
  internal.post('/orders/admin-list', async (req, res) => {
    if (res.locals.caller !== 'admin') throw new HttpError(403, 'SERVICE_DENIED', 'Service denied');
    await verifyAdmin(
      z.object({ actorSessionId: z.string().uuid() }).strict().parse(req.body).actorSessionId,
      false,
    );
    json(
      res,
      (
        await orders
          .find({ 'quote.mode': config.COMMERCE_MODE })
          .sort({ createdAt: -1 })
          .limit(100)
          .toArray()
      ).map(present),
    );
  });
  internal.post('/orders/admin-read', async (req, res) => {
    if (res.locals.caller !== 'admin') throw new HttpError(403, 'SERVICE_DENIED', 'Service denied');
    const input = z
      .object({ actorSessionId: z.string().uuid(), orderId: z.string().uuid() })
      .strict()
      .parse(req.body);
    await verifyAdmin(input.actorSessionId, false);
    const order = await orders.findOne({ _id: input.orderId, 'quote.mode': config.COMMERCE_MODE });
    if (!order) throw new HttpError(404, 'ORDER_NOT_FOUND', 'Order not found');
    json(res, present(order));
  });
  internal.post('/orders/retry-refunds', async (req, res) => {
    if (res.locals.caller !== 'admin') throw new HttpError(403, 'SERVICE_DENIED', 'Service denied');
    const input = z
      .object({ actorSessionId: z.string().uuid(), reason: z.string().min(5).max(500) })
      .strict()
      .parse(req.body);
    const principal = await verifyAdmin(input.actorSessionId);
    const result = await refunds.updateMany(
      { state: 'NEW', mode: config.COMMERCE_MODE },
      { $set: { attempts: 0, nextAttemptAt: new Date(0) } },
    );
    await db.collection('commerce_audit').insertOne({
      actorId: principal.userId,
      action: 'refund-delivery-retry',
      reason: input.reason,
      at: new Date(),
    });
    json(res, { retried: result.modifiedCount });
  });
  internal.post('/orders/admin-refund', async (req, res) => {
    if (res.locals.caller !== 'admin') throw new HttpError(403, 'SERVICE_DENIED', 'Service denied');
    const input = z
      .object({
        actorSessionId: z.string().uuid(),
        orderId: z.string().uuid(),
        expectedVersion: z.number().int().positive(),
        amountMinor: z.number().int().positive(),
        reason: z.string().trim().min(5).max(500),
        commandId: z.string().min(16),
      })
      .strict()
      .parse(req.body);
    const principal = await verifyAdmin(input.actorSessionId);
    const result = await executeOnce(
      client,
      db,
      `admin-refund:${input.orderId}`,
      input.commandId,
      {
        orderId: input.orderId,
        expectedVersion: input.expectedVersion,
        amountMinor: input.amountMinor,
        reason: input.reason,
      },
      async (session) => {
        const order = await orders.findOne(
          { _id: input.orderId, version: input.expectedVersion },
          { session },
        );
        if (!order || !order.captureRef)
          throw new HttpError(
            409,
            'REFUND_UNAVAILABLE',
            'Order changed or has no verified capture',
          );
        order.version++;
        const refundId = await authorizeRefund(order, input.amountMinor, input.reason, session);
        await orders.replaceOne({ _id: order._id }, order, { session });
        await db.collection('commerce_audit').insertOne(
          {
            id: randomUUID(),
            actorId: principal.userId,
            action: 'refund.authorized',
            orderId: order._id,
            amountMinor: input.amountMinor,
            reason: input.reason,
            at: new Date(),
          },
          { session },
        );
        return { refundId, order: present(order) };
      },
    );
    json(res, result, 202);
  });
  internal.post('/commerce/merchant', async (req, res) => {
    if (res.locals.caller !== 'admin') throw new HttpError(403, 'SERVICE_DENIED', 'Service denied');
    const input = z
      .object({
        actorSessionId: z.string().uuid(),
        restaurantId: z.string().uuid(),
        approved: z.boolean(),
        reason: z.string().min(5).max(500),
      })
      .strict()
      .parse(req.body);
    const principal = await verifyAdmin(input.actorSessionId),
      session = client.startSession();
    try {
      await session.withTransaction(async () => {
        const result = await restaurants.updateOne(
          { _id: input.restaurantId, sample: false },
          { $set: { liveOrderingApproved: input.approved }, $inc: { version: 1 } },
          { session },
        );
        if (!result.matchedCount)
          throw new HttpError(404, 'NOT_FOUND', 'Real restaurant not found');
        await db.collection('commerce_audit').insertOne(
          {
            id: randomUUID(),
            actorId: principal.userId,
            action: 'merchant.commerce-approved',
            restaurantId: input.restaurantId,
            approved: input.approved,
            reason: input.reason,
            at: new Date(),
          },
          { session },
        );
      });
    } finally {
      await session.endSession();
    }
    json(res, { updated: true });
  });
  app.use('/internal/v1', internal);
  const hints = db.collection<{ _id: string; orderId: string }>('payment_hints');
  ctx.subscribe?.(['payment.captured.v1', 'refund.succeeded.v1'], async (event, session) => {
    if (typeof event.data.orderId !== 'string') throw new Error('Missing order ID');
    await hints.updateOne(
      { _id: event.eventId },
      { $setOnInsert: { orderId: event.data.orderId } },
      { upsert: true, session },
    );
  });
  let busy = false,
    work: Promise<void> | undefined;
  async function tick() {
    if (busy) return;
    busy = true;
    try {
      await ready();
      const hint = await hints.findOne({});
      if (hint) {
        try {
          await internalCall(ctx, 'utils', '/internal/v1/payments/reconcile-order', {
            orderId: hint.orderId,
          });
          await hints.deleteOne({ _id: hint._id });
        } catch {
          /* Retain the wake-up; signed recovery and periodic sweeps converge. */
        }
      }
      const overdue = await orders.findOne({
        'quote.mode': config.COMMERCE_MODE,
        status: 'PAYMENT_PENDING',
        paymentDeadline: { $lte: new Date().toISOString() },
      });
      if (overdue) {
        try {
          await internalCall(ctx, 'utils', '/internal/v1/payments/reconcile-order', {
            orderId: overdue._id,
          });
        } catch {
          /* The fixed deadline wins; a later verified capture is compensated. */
        }
        const session = client.startSession();
        try {
          await session.withTransaction(async () => {
            const order = await orders.findOne(
              {
                _id: overdue._id,
                status: 'PAYMENT_PENDING',
                paymentDeadline: { $lte: new Date().toISOString() },
              },
              { session },
            );
            if (!order) return;
            order.status = 'EXPIRED';
            order.version++;
            await release(order, session);
            order.timeline.push({
              at: new Date().toISOString(),
              status: 'EXPIRED',
              message:
                'Payment deadline passed; reservations released. Any late capture is refunded.',
            });
            await orders.replaceOne({ _id: order._id }, order, { session });
            await event(session, order, 'order.cancelled.v1');
          });
        } finally {
          await session.endSession();
        }
      }
      const intent = await refunds.findOneAndUpdate(
        {
          state: 'NEW',
          mode: config.COMMERCE_MODE,
          leaseUntil: { $lte: new Date() },
          nextAttemptAt: { $lte: new Date() },
          attempts: { $lt: 12 },
        },
        { $set: { leaseUntil: new Date(Date.now() + 30000) }, $inc: { attempts: 1 } },
        { returnDocument: 'after' },
      );
      if (intent) {
        try {
          await internalCall(ctx, 'utils', '/internal/v1/refunds/authorize', {
            refundId: intent._id,
            orderId: intent.orderId,
            attemptId: intent.attemptId,
            userId: intent.userId,
            amountMinor: intent.amountMinor,
            reason: intent.reason,
          });
          await refunds.updateOne(
            { _id: intent._id },
            { $set: { state: 'SENT', leaseUntil: new Date(0) } },
          );
        } catch {
          await refunds.updateOne(
            { _id: intent._id },
            {
              $set: {
                leaseUntil: new Date(0),
                nextAttemptAt: new Date(Date.now() + Math.min(60000, 2000 * 2 ** intent.attempts)),
              },
            },
          );
        }
      }
    } catch {
      /* Durable records remain available for retry and reconciliation. */
    } finally {
      busy = false;
    }
  }
  const timer = setInterval(() => {
    work = tick();
  }, 3000);
  timer.unref();
  ctx.onClose?.(async () => {
    clearInterval(timer);
    await work;
  });
  return { tick, applyCapture, orders, present, release, authorizeRefund, event };
}

import { randomUUID } from 'node:crypto';
import type { Express } from 'express';
import { cartInputSchema, type Cart, type CartLineInput } from '@cravecart/contracts';
import {
  remoteSession,
  currentPrincipal,
  checkedId,
  HttpError,
  json,
  requireIdempotency,
  lazyIndexes,
  type DomainContext,
} from '@cravecart/platform';
import { executeOnce, payloadHash } from '@cravecart/persistence';
import {
  reorderInputSchema,
  reorderConfirmSchema,
  reorderPreviewSchema,
} from '@cravecart/contracts';
import type { installCatalog } from './catalog.js';
import type { OrderRecord } from './orders.js';

interface Preview {
  _id: string;
  userId: string;
  orderId: string;
  restaurantId: string;
  addressId: string;
  lines: CartLineInput[];
  digest: string;
  expiresAt: Date;
}
export function installReorder(
  app: Express,
  ctx: DomainContext,
  catalog: Pick<ReturnType<typeof installCatalog>, 'saveCart' | 'validateCart'>,
) {
  const { db, client } = ctx;
  const previews = db.collection<Preview>('reorder_previews');
  const ready = lazyIndexes(async () => {
    await previews.createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 });
  });
  async function source(id: string, userId: string) {
    const order = await db
      .collection<OrderRecord>('orders')
      .findOne({ _id: id, userId, 'quote.mode': ctx.config.COMMERCE_MODE });
    if (!order) throw new HttpError(404, 'NOT_FOUND', 'Order not found');
    if (!['DELIVERED', 'CANCELLED', 'REJECTED', 'EXPIRED'].includes(order.status))
      throw new HttpError(
        409,
        'ORDER_ACTIVE',
        'Finish or resolve the existing order before reordering',
      );
    return order;
  }
  app.post(
    '/api/v1/orders/:orderId/reorder/preview',
    remoteSession(ctx, { mutation: true }),
    async (req, res) => {
      await ready();
      const userId = currentPrincipal(res).userId,
        orderId = checkedId(req.params.orderId);
      const input = reorderInputSchema.parse(req.body),
        order = await source(orderId, userId);
      // Copy selections only: old prices, fees, promotions, tips and payment references are never reused.
      const lines = order.quote.lines.map(
        ({ itemId, variantId, optionIds, quantity, instructions }) => ({
          itemId,
          variantId,
          optionIds,
          quantity,
          instructions,
        }),
      );
      const valid = await catalog.validateCart(
        order.quote.restaurant.id,
        input.addressId,
        userId,
        lines,
      );
      const cart = await db.collection<Cart & { _id: string }>('carts').findOne({ _id: userId });
      const preview: Preview = {
        _id: randomUUID(),
        userId,
        orderId,
        restaurantId: order.quote.restaurant.id,
        addressId: input.addressId,
        lines,
        digest: payloadHash(valid),
        expiresAt: new Date(Date.now() + 5 * 60_000),
      };
      await previews.insertOne(preview);
      json(
        res,
        reorderPreviewSchema.parse({
          id: preview._id,
          orderId,
          restaurantName: valid.record.name,
          addressId: input.addressId,
          lines: valid.priced,
          subtotalMinor: valid.subtotalMinor,
          issues: valid.minimumIssue ? [valid.minimumIssue] : [],
          cartVersion: cart?.version ?? 0,
          replacesCart: Boolean(cart?.lines.length),
          expiresAt: preview.expiresAt.toISOString(),
        }),
      );
    },
  );
  app.post(
    '/api/v1/orders/:orderId/reorder/confirm',
    remoteSession(ctx, { mutation: true }),
    async (req, res) => {
      await ready();
      const userId = currentPrincipal(res).userId,
        orderId = checkedId(req.params.orderId);
      const input = reorderConfirmSchema.parse(req.body);
      const result = await executeOnce(
        client,
        db,
        `reorder:${userId}:${orderId}`,
        requireIdempotency(req),
        input,
        async (session) => {
          await source(orderId, userId);
          const preview = await previews.findOne(
            { _id: input.previewId, userId, orderId },
            { session },
          );
          if (!preview || preview.expiresAt <= new Date())
            throw new HttpError(409, 'PREVIEW_EXPIRED', 'Review a fresh reorder preview');
          const current = await catalog.validateCart(
            preview.restaurantId,
            preview.addressId,
            userId,
            preview.lines,
          );
          if (payloadHash(current) !== preview.digest)
            throw new HttpError(
              409,
              'REORDER_CHANGED',
              'The menu, address or delivery area changed. Review a fresh preview.',
            );
          const cart = await db
            .collection<Cart & { _id: string }>('carts')
            .findOne({ _id: userId }, { session });
          if (cart?.lines.length && !input.replace)
            throw new HttpError(
              409,
              'REPLACE_REQUIRED',
              'Confirm replacement of the existing cart',
            );
          return catalog.saveCart(
            cartInputSchema.parse({
              expectedVersion: input.expectedCartVersion,
              replace: input.replace,
              restaurantId: preview.restaurantId,
              addressId: preview.addressId,
              lines: preview.lines,
            }),
            userId,
            session,
            current.subtotalMinor,
          );
        },
      );
      json(res, result);
    },
  );
}

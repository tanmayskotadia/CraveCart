import express, { type Express, type Response } from 'express';
import { randomUUID } from 'node:crypto';
import type { ClientSession } from 'mongodb';
import { z } from 'zod';
import {
  restaurantInputSchema,
  restaurantSchema,
  menuItemInputSchema,
  offerInputSchema,
  cartInputSchema,
  findCity,
  isOpen,
  type RestaurantInput,
  type Restaurant,
  type MenuItemInput,
  type MenuItem,
  type Offer,
  type Address,
  type Cart,
  type CartLine,
  type CartLineInput,
} from '@cravecart/contracts';
import {
  remoteSession,
  currentPrincipal,
  checkedId,
  HttpError,
  json,
  lazyIndexes,
  internalCall,
  requireIdempotency,
  type DomainContext,
} from '@cravecart/platform';
import { executeOnce, enqueueEvent } from '@cravecart/persistence';
import { restaurantAccess } from './access.js';

type StoredRestaurant = RestaurantInput & {
  _id: string;
  userId: string;
  slug: string;
  version: number;
  sample: boolean;
  updatedAt: string;
};
type StoredItem = MenuItemInput & {
  _id: string;
  restaurantId: string;
  version: number;
  deleted: boolean;
};
type StoredOffer = Omit<Offer, 'id'> & { _id: string };
type StoredCart = Omit<Cart, 'issues' | 'checkoutEnabled'> & { _id: string };
interface Serviceability {
  serviceable: boolean;
  reason: string;
  zones: Array<{
    id: string;
    deliveryFeeMinor: number;
    travelMinutesMin: number;
    travelMinutesMax: number;
    version: number;
    feePolicyVersion: number;
  }>;
}
function presentItem(item: StoredItem): MenuItem {
  return {
    id: item._id,
    restaurantId: item.restaurantId,
    version: item.version,
    ...menuItemInputSchema.strip().parse(item),
  };
}
function presentRestaurant(record: StoredRestaurant): Restaurant {
  return restaurantSchema.strip().parse({
    ...record,
    id: record._id,
    open: !record.paused && isOpen(record.hours, new Date(), record.holidays),
    rating: null,
    ratingCount: 0,
  });
}
function presentOffer(offer: StoredOffer): Offer {
  return {
    id: offer._id,
    restaurantId: offer.restaurantId,
    version: offer.version,
    ...offerInputSchema.strip().parse(offer),
  };
}
export function priceLine(item: MenuItem, line: CartLineInput): CartLine {
  if (!item.available || item.stock === 0 || (item.stock !== null && line.quantity > item.stock))
    throw new HttpError(409, 'ITEM_UNAVAILABLE', `${item.name} is unavailable in this quantity`);
  let unit = item.priceMinor;
  const selected: string[] = [];
  if (item.variants.length) {
    const variant = item.variants.find(
      (option) => option.id === line.variantId && option.available,
    );
    if (!variant)
      throw new HttpError(422, 'VARIANT_REQUIRED', `Choose an available size for ${item.name}`);
    unit += variant.priceMinor;
    selected.push(variant.name);
  } else if (line.variantId)
    throw new HttpError(422, 'INVALID_VARIANT', 'This dish has no variants');
  const allOptions = item.modifierGroups.flatMap((group) => group.options);
  if (
    line.optionIds.some((id) => !allOptions.some((option) => option.id === id && option.available))
  )
    throw new HttpError(422, 'INVALID_MODIFIER', 'An add-on is no longer available');
  for (const group of item.modifierGroups) {
    const options = group.options.filter((option) => line.optionIds.includes(option.id));
    if (options.length < group.min || options.length > group.max)
      throw new HttpError(
        422,
        'MODIFIER_LIMIT',
        `Choose ${group.min}–${group.max} options from ${group.name}`,
      );
    for (const option of options) {
      unit += option.priceMinor;
      selected.push(option.name);
    }
  }
  return {
    ...line,
    optionIds: [...line.optionIds].sort(),
    name: item.name,
    selection: selected,
    unitPriceMinor: unit,
    itemVersion: item.version,
  };
}
export function installCatalog(app: Express, ctx: DomainContext) {
  function configCheckout() {
    return ctx.config.COMMERCE_MODE !== 'disabled';
  }
  const { db, client } = ctx,
    restaurants = db.collection<StoredRestaurant>('restaurants'),
    items = db.collection<StoredItem>('menu_items'),
    offers = db.collection<StoredOffer>('offers'),
    carts = db.collection<StoredCart>('carts'),
    favorites = db.collection<{ _id: string; userId: string; restaurantId: string }>('favorites');
  const ready = lazyIndexes(async () => {
    await restaurants.createIndex({ slug: 1 }, { unique: true });
    await restaurants.createIndex({ city: 1, published: 1 });
    await items.createIndex({ restaurantId: 1, deleted: 1 });
    await offers.createIndex({ restaurantId: 1, code: 1 }, { unique: true });
    await favorites.createIndex({ userId: 1 });
  });
  app.use(
    [
      '/api/v1/restaurants',
      '/api/v1/seller/restaurants',
      '/api/v1/cart',
      '/api/v1/favorites',
      '/api/v1/offers',
    ],
    async (_req, _res, next) => {
      try {
        await ready();
        next();
      } catch (error) {
        next(error);
      }
    },
  );
  async function provision(userId: string) {
    const approved = await db
      .collection('applications')
      .find({ userId, status: 'APPROVED', grantState: 'APPLIED' })
      .limit(20)
      .toArray();
    for (const application of approved) {
      const profile = application.profile;
      await restaurants.updateOne(
        { _id: String(application._id) },
        {
          $setOnInsert: {
            _id: String(application._id),
            userId,
            slug: `${String(profile.businessName)
              .toLowerCase()
              .replace(/[^a-z0-9]+/g, '-')
              .slice(0, 55)}-${String(application._id).slice(0, 8)}`,
            name: profile.businessName,
            description: '',
            cuisines: ['Indian'],
            city: profile.city,
            address: profile.address,
            point: { longitude: 0, latitude: 0 },
            hours: [],
            holidays: [],
            imageId: null,
            libraryImage: 'indian-feast',
            costForTwoMinor: 50000,
            minimumOrderMinor: 0,
            preparationMinutes: 25,
            published: false,
            paused: false,
            pauseReason: '',
            version: 1,
            sample: false,
            updatedAt: new Date().toISOString(),
          },
        },
        { upsert: true },
      );
    }
  }
  async function owned(id: string, userId: string, session?: ClientSession) {
    await restaurantAccess(ctx, id, userId);
    const record = await restaurants.findOne({ _id: id }, { session });
    if (!record) throw new HttpError(404, 'NOT_FOUND', 'Restaurant not found');
    return record;
  }
  async function withRatings(records: Restaurant[]) {
    const ratings = await db
      .collection('reviews')
      .aggregate([
        {
          $match: {
            restaurantId: { $in: records.map((r) => r.id) },
            moderation: 'VISIBLE',
            mode: ctx.config.COMMERCE_MODE,
          },
        },
        { $group: { _id: '$restaurantId', rating: { $avg: '$rating' }, count: { $sum: 1 } } },
      ])
      .toArray();
    return records.map((r) => {
      const rating = ratings.find((x) => x._id === r.id);
      return {
        ...r,
        rating: rating ? Math.round(rating.rating * 10) / 10 : null,
        ratingCount: rating?.count ?? 0,
      };
    });
  }
  async function visible(city?: string, ids?: string[]) {
    const records = await restaurants
      .find({
        published: true,
        ...(city ? { city } : {}),
        ...(ids ? { _id: { $in: ids } } : {}),
        ...(ctx.config.NODE_ENV === 'production' ? { sample: { $ne: true } } : {}),
      })
      .sort({ _id: 1 })
      .limit(501)
      .toArray();
    if (records.length > 500)
      throw new HttpError(
        503,
        'CATALOG_CAPACITY',
        'This catalog needs a larger search index before it can serve this area',
      );
    if (!records.length) return [];
    const result = await internalCall<{ activeUserIds: string[] }>(
      ctx,
      'auth',
      '/internal/v1/memberships/check',
      { userIds: [...new Set(records.map((record) => record.userId))] },
    );
    return records.filter((record) => result.activeUserIds.includes(record.userId));
  }
  async function publicRecord(slug: string) {
    const record = await restaurants.findOne({ slug, published: true });
    if (
      !record ||
      !(await visible(record.city, [record._id])).some((value) => value._id === record._id)
    )
      throw new HttpError(404, 'NOT_FOUND', 'This restaurant is unavailable');
    return record;
  }
  async function bindImage(imageId: string | null, userId: string) {
    if (imageId)
      await internalCall(ctx, 'utils', '/internal/v1/uploads/catalog-bind', {
        uploadId: imageId,
        userId,
      });
  }
  async function changed(restaurantId: string, res: Response, session: ClientSession) {
    const record = await restaurants.findOneAndUpdate(
      { _id: restaurantId },
      { $inc: { version: 1 }, $set: { updatedAt: new Date().toISOString() } },
      { session, returnDocument: 'after' },
    );
    if (!record) throw new HttpError(404, 'NOT_FOUND', 'Restaurant not found');
    await enqueueEvent(db, session, {
      eventId: randomUUID(),
      eventType: 'menu.updated.v1',
      schemaVersion: 1,
      occurredAt: new Date().toISOString(),
      producer: 'restaurant',
      aggregate: { type: 'restaurant', id: restaurantId, version: record.version },
      correlationId: String(res.locals.requestId),
      causationId: String(res.locals.requestId),
      data: { restaurantId, catalogVersion: record.version },
    });
  }
  const seller = express.Router();
  seller.use(remoteSession(ctx, { role: 'seller' }));
  seller.get('/', async (_req, res) => {
    await provision(currentPrincipal(res).userId);
    const memberships = await db
      .collection('restaurant_staff')
      .find({ userId: currentPrincipal(res).userId, active: true })
      .limit(50)
      .toArray();
    const memberIds = memberships.map((m) => m.restaurantId);
    json(
      res,
      (
        await restaurants
          .find({ $or: [{ userId: currentPrincipal(res).userId }, { _id: { $in: memberIds } }] })
          .sort({ _id: 1 })
          .toArray()
      ).map((r) => ({
        ...presentRestaurant(r),
        access:
          r.userId === currentPrincipal(res).userId
            ? 'owner'
            : memberships.find((m) => m.restaurantId === r._id)?.role,
      })),
    );
  });
  seller.get('/:restaurantId/catalog', async (req, res) => {
    const record = await owned(checkedId(req.params.restaurantId), currentPrincipal(res).userId);
    json(res, {
      restaurant: presentRestaurant(record),
      items: (
        await items
          .find({ restaurantId: record._id, deleted: false })
          .sort({ category: 1, name: 1, _id: 1 })
          .toArray()
      ).map(presentItem),
      offers: (await offers.find({ restaurantId: record._id }).sort({ _id: 1 }).toArray()).map(
        presentOffer,
      ),
    });
  });
  seller.put(
    '/:restaurantId',
    remoteSession(ctx, { role: 'seller', mutation: true }),
    async (req, res) => {
      const { expectedVersion, restaurant } = z
          .object({
            expectedVersion: z.number().int().positive(),
            restaurant: restaurantInputSchema,
          })
          .strict()
          .parse(req.body),
        id = checkedId(req.params.restaurantId),
        userId = currentPrincipal(res).userId;
      await owned(id, userId);
      if (!findCity(restaurant.city))
        throw new HttpError(422, 'INVALID_CITY', 'Choose a supported city');
      if (
        restaurant.published &&
        (!restaurant.hours.length ||
          !(await items.countDocuments({ restaurantId: id, deleted: false, available: true })))
      )
        throw new HttpError(
          422,
          'CATALOG_INCOMPLETE',
          'Set opening hours and add an available dish before publishing',
        );
      await bindImage(restaurant.imageId, userId);
      const session = client.startSession();
      let updated: StoredRestaurant | null = null;
      try {
        await session.withTransaction(async () => {
          updated = await restaurants.findOneAndUpdate(
            { _id: id, version: expectedVersion },
            { $set: { ...restaurant, updatedAt: new Date().toISOString() }, $inc: { version: 1 } },
            { session, returnDocument: 'after' },
          );
          if (!updated)
            throw new HttpError(
              409,
              'VERSION_CONFLICT',
              'Restaurant changed; reload before saving',
            );
          await enqueueEvent(db, session, {
            eventId: randomUUID(),
            eventType: 'menu.updated.v1',
            schemaVersion: 1,
            occurredAt: new Date().toISOString(),
            producer: 'restaurant',
            aggregate: { type: 'restaurant', id, version: updated.version },
            correlationId: String(res.locals.requestId),
            causationId: id,
            data: { restaurantId: id, catalogVersion: updated.version },
          });
        });
      } finally {
        await session.endSession();
      }
      json(res, presentRestaurant(updated!));
    },
  );
  seller.post(
    '/:restaurantId/items',
    remoteSession(ctx, { role: 'seller', mutation: true }),
    async (req, res) => {
      const input = menuItemInputSchema.parse(req.body),
        id = checkedId(req.params.restaurantId),
        userId = currentPrincipal(res).userId;
      await owned(id, userId);
      await bindImage(input.imageId, userId);
      const result = await executeOnce(
        client,
        db,
        `${userId}:menu-create:${id}`,
        requireIdempotency(req),
        input,
        async (session) => {
          if (
            (await items.countDocuments({ restaurantId: id, deleted: false }, { session })) >= 200
          )
            throw new HttpError(409, 'MENU_LIMIT', 'Keep at most 200 dishes per restaurant');
          const record = {
            ...input,
            _id: randomUUID(),
            restaurantId: id,
            version: 1,
            deleted: false,
          };
          await items.insertOne(record, { session });
          await changed(id, res, session);
          return presentItem(record);
        },
      );
      json(res, result, 201);
    },
  );
  seller.put(
    '/:restaurantId/items/:itemId',
    remoteSession(ctx, { role: 'seller', mutation: true }),
    async (req, res) => {
      const { expectedVersion, item } = z
          .object({ expectedVersion: z.number().int().positive(), item: menuItemInputSchema })
          .strict()
          .parse(req.body),
        id = checkedId(req.params.restaurantId),
        itemId = checkedId(req.params.itemId),
        userId = currentPrincipal(res).userId;
      await owned(id, userId);
      await bindImage(item.imageId, userId);
      const session = client.startSession();
      let result: StoredItem | null = null;
      try {
        await session.withTransaction(async () => {
          result = await items.findOneAndUpdate(
            { _id: itemId, restaurantId: id, version: expectedVersion, deleted: false },
            { $set: item, $inc: { version: 1 } },
            { session, returnDocument: 'after' },
          );
          if (!result)
            throw new HttpError(409, 'VERSION_CONFLICT', 'Dish changed; reload before saving');
          await changed(id, res, session);
        });
      } finally {
        await session.endSession();
      }
      json(res, presentItem(result!));
    },
  );
  seller.delete(
    '/:restaurantId/items/:itemId',
    remoteSession(ctx, { role: 'seller', mutation: true }),
    async (req, res) => {
      const { expectedVersion } = z
          .object({ expectedVersion: z.number().int().positive() })
          .strict()
          .parse(req.body),
        id = checkedId(req.params.restaurantId);
      await owned(id, currentPrincipal(res).userId);
      const session = client.startSession();
      try {
        await session.withTransaction(async () => {
          const changedItem = await items.updateOne(
            {
              _id: checkedId(req.params.itemId),
              restaurantId: id,
              version: expectedVersion,
              deleted: false,
            },
            { $set: { deleted: true, available: false }, $inc: { version: 1 } },
            { session },
          );
          if (!changedItem.modifiedCount)
            throw new HttpError(409, 'VERSION_CONFLICT', 'Dish changed or was removed');
          await changed(id, res, session);
        });
      } finally {
        await session.endSession();
      }
      json(res, { deleted: true });
    },
  );
  for (const method of ['post', 'put'] as const)
    seller[method](
      method === 'post' ? '/:restaurantId/offers' : '/:restaurantId/offers/:offerId',
      remoteSession(ctx, { role: 'seller', mutation: true }),
      async (req, res) => {
        const { offer, expectedVersion } = z
            .object({
              offer: offerInputSchema,
              expectedVersion: z.number().int().positive().optional(),
            })
            .strict()
            .parse(req.body),
          id = checkedId(req.params.restaurantId),
          userId = currentPrincipal(res).userId;
        await owned(id, userId);
        if (method === 'put' && !expectedVersion)
          throw new HttpError(400, 'VERSION_REQUIRED', 'Reload the offer before saving');
        try {
          const result = await executeOnce(
            client,
            db,
            `${userId}:offer:${id}`,
            requireIdempotency(req),
            { ...req.body, offerId: req.params.offerId ?? null },
            async (session) => {
              let value: StoredOffer | null;
              if (method === 'post') {
                if ((await offers.countDocuments({ restaurantId: id }, { session })) >= 30)
                  throw new HttpError(409, 'OFFER_LIMIT', 'Keep at most 30 offers');
                value = { ...offer, _id: randomUUID(), restaurantId: id, version: 1 };
                await offers.insertOne(value, { session });
              } else
                value = await offers.findOneAndUpdate(
                  {
                    _id: checkedId(req.params.offerId),
                    restaurantId: id,
                    version: expectedVersion,
                  },
                  { $set: offer, $inc: { version: 1 } },
                  { session, returnDocument: 'after' },
                );
              if (!value) throw new HttpError(409, 'VERSION_CONFLICT', 'Offer changed');
              await changed(id, res, session);
              return presentOffer(value);
            },
          );
          json(res, result, method === 'post' ? 201 : 200);
        } catch (error) {
          if (error && typeof error === 'object' && 'code' in error && error.code === 11000)
            throw new HttpError(409, 'OFFER_EXISTS', 'This offer code already exists');
          throw error;
        }
      },
    );
  app.use('/api/v1/seller/restaurants', seller);
  app.get('/api/v1/restaurants', async (req, res) => {
    const query = z
      .object({
        city: z.string().max(60),
        q: z.string().trim().max(100).default(''),
        cuisine: z.string().max(40).optional(),
        diet: z.enum(['veg', 'vegan', 'non-veg']).optional(),
        open: z.enum(['true', 'false']).optional(),
        minRating: z.coerce.number().min(0).max(5).default(0),
        maxPrice: z.coerce.number().int().positive().optional(),
        maxMinutes: z.coerce.number().int().positive().optional(),
        sort: z.enum(['name', 'price', 'preparation']).default('name'),
        page: z.coerce.number().int().min(1).max(100).default(1),
      })
      .strict()
      .parse(req.query);
    if (!findCity(query.city)) throw new HttpError(422, 'INVALID_CITY', 'Choose a supported city');
    let records = await withRatings((await visible(query.city)).map(presentRestaurant));
    const menu = await items
        .find({ restaurantId: { $in: records.map((record) => record.id) }, deleted: false })
        .toArray(),
      search = query.q.toLocaleLowerCase('en-IN');
    records = records.filter(
      (record) =>
        (!query.minRating || (record.rating !== null && record.rating >= query.minRating)) &&
        (!query.q ||
          `${record.name} ${record.cuisines.join(' ')}`
            .toLocaleLowerCase('en-IN')
            .includes(search) ||
          menu.some(
            (item) =>
              item.restaurantId === record.id &&
              item.name.toLocaleLowerCase('en-IN').includes(search),
          )) &&
        (!query.cuisine ||
          record.cuisines.some(
            (cuisine) => cuisine.toLowerCase() === query.cuisine!.toLowerCase(),
          )) &&
        (!query.diet ||
          menu.some(
            (item) =>
              item.restaurantId === record.id &&
              (query.diet === 'veg'
                ? ['veg', 'vegan'].includes(item.diet)
                : item.diet === query.diet) &&
              item.available,
          )) &&
        (query.open !== 'true' || record.open) &&
        (!query.maxPrice || record.costForTwoMinor <= query.maxPrice) &&
        (!query.maxMinutes || record.preparationMinutes <= query.maxMinutes),
    );
    records.sort(
      (a, b) =>
        (query.sort === 'price'
          ? a.costForTwoMinor - b.costForTwoMinor
          : query.sort === 'preparation'
            ? a.preparationMinutes - b.preparationMinutes
            : a.name.localeCompare(b.name)) || a.id.localeCompare(b.id),
    );
    json(res, {
      restaurants: records.slice((query.page - 1) * 12, query.page * 12),
      total: records.length,
      page: query.page,
      pageSize: 12,
      orderingEnabled: ctx.config.COMMERCE_MODE !== 'disabled',
    });
  });
  app.get('/api/v1/restaurants/:slug', async (req, res) => {
    const record = await publicRecord(z.string().max(100).parse(req.params.slug)),
      now = new Date().toISOString();
    json(res, {
      restaurant: (await withRatings([presentRestaurant(record)]))[0],
      items: (
        await items
          .find({ restaurantId: record._id, deleted: false })
          .sort({ category: 1, name: 1, _id: 1 })
          .toArray()
      ).map(presentItem),
      offers: (
        await offers
          .find({
            restaurantId: record._id,
            active: true,
            startsAt: { $lte: now },
            endsAt: { $gt: now },
          })
          .sort({ code: 1 })
          .toArray()
      ).map(presentOffer),
    });
  });
  app.get('/api/v1/offers', async (req, res) => {
    const { city } = z
        .object({ city: z.string().max(60) })
        .strict()
        .parse(req.query),
      records = await visible(city),
      now = new Date().toISOString();
    json(
      res,
      (
        await offers
          .find({
            restaurantId: { $in: records.map((record) => record._id) },
            active: true,
            startsAt: { $lte: now },
            endsAt: { $gt: now },
          })
          .limit(100)
          .toArray()
      ).map((offer) => ({
        ...presentOffer(offer),
        restaurantSlug: records.find((record) => record._id === offer.restaurantId)!.slug,
        restaurantName: records.find((record) => record._id === offer.restaurantId)!.name,
      })),
    );
  });
  app.get('/api/v1/favorites', remoteSession(ctx), async (_req, res) => {
    const ids = (
      await favorites
        .find({ userId: currentPrincipal(res).userId })
        .limit(100)
        .toArray()
    ).map((value) => value.restaurantId);
    json(res, (await visible(undefined, ids)).map(presentRestaurant));
  });
  app.put(
    '/api/v1/favorites/:restaurantId',
    remoteSession(ctx, { mutation: true }),
    async (req, res) => {
      const { favorite } = z.object({ favorite: z.boolean() }).strict().parse(req.body),
        restaurantId = checkedId(req.params.restaurantId),
        userId = currentPrincipal(res).userId,
        id = `${userId}:${restaurantId}`;
      if (favorite) {
        if (
          !(await visible(undefined, [restaurantId])).some((record) => record._id === restaurantId)
        )
          throw new HttpError(404, 'NOT_FOUND', 'Restaurant unavailable');
        if (
          (await favorites.countDocuments({ userId })) >= 100 &&
          !(await favorites.findOne({ _id: id }))
        )
          throw new HttpError(409, 'FAVORITE_LIMIT', 'Keep at most 100 favorites');
        await favorites.updateOne(
          { _id: id },
          { $set: { userId, restaurantId } },
          { upsert: true },
        );
      } else await favorites.deleteOne({ _id: id });
      json(res, { favorite });
    },
  );
  async function validateCart(
    restaurantId: string,
    addressId: string,
    userId: string,
    lines: CartLineInput[],
  ) {
    const record = await restaurants.findOne({ _id: restaurantId, published: true });
    if (
      !record ||
      !(await visible(record.city, [record._id])).some((value) => value._id === record._id)
    )
      throw new HttpError(409, 'RESTAURANT_UNAVAILABLE', 'Restaurant is no longer available');
    if (!presentRestaurant(record).open)
      throw new HttpError(
        409,
        'RESTAURANT_CLOSED',
        'This restaurant is closed or temporarily paused',
      );
    const address = await internalCall<Address>(ctx, 'auth', '/internal/v1/addresses/get', {
      userId,
      addressId,
    });
    if (address.city !== record.city)
      throw new HttpError(422, 'CITY_MISMATCH', 'Choose an address in this restaurant’s city');
    const service = await internalCall<Serviceability>(ctx, 'admin', '/internal/v1/zones/check', {
      city: record.city,
      point: address.point,
      pickupPoint: record.point,
    });
    if (!service.serviceable)
      throw new HttpError(
        422,
        'NOT_SERVICEABLE',
        'This address and restaurant do not share an active delivery zone',
      );
    const menu = await items
      .find({ restaurantId, deleted: false, _id: { $in: lines.map((line) => line.itemId) } })
      .toArray();
    const priced = lines.map((line) => {
      const item = menu.find((item) => item._id === line.itemId);
      if (!item) throw new HttpError(409, 'ITEM_UNAVAILABLE', 'A dish was removed from the menu');
      return priceLine(presentItem(item), line);
    });
    for (const item of menu)
      if (
        item.stock !== null &&
        priced
          .filter((line) => line.itemId === item._id)
          .reduce((sum, line) => sum + line.quantity, 0) > item.stock
      )
        throw new HttpError(
          409,
          'ITEM_UNAVAILABLE',
          'Selected quantities exceed the currently displayed stock',
        );
    const subtotalMinor = priced.reduce(
      (sum, line) => sum + line.quantity * line.unitPriceMinor,
      0,
    );
    const minimumIssue =
      subtotalMinor < record.minimumOrderMinor
        ? `Add ₹${((record.minimumOrderMinor - subtotalMinor) / 100).toFixed(2)} more to meet this restaurant’s minimum items subtotal.`
        : null;
    return { record, priced, subtotalMinor, minimumIssue };
  }
  app.get('/api/v1/cart', remoteSession(ctx), async (_req, res) => {
    const userId = currentPrincipal(res).userId,
      cart = await carts.findOne({ _id: userId });
    if (!cart || !cart.lines.length) {
      json(res, { cart: null, version: cart?.version ?? 0 });
      return;
    }
    const issues: string[] = [];
    try {
      const current = await validateCart(cart.restaurantId, cart.addressId, userId, cart.lines);
      if (current.minimumIssue) issues.push(current.minimumIssue);
      if (
        current.priced.some(
          (line, index) =>
            line.unitPriceMinor !== cart.lines[index]!.unitPriceMinor ||
            line.itemVersion !== cart.lines[index]!.itemVersion,
        )
      )
        issues.push('Menu or prices changed. Review the dishes and save your cart again.');
    } catch (error) {
      if (error instanceof HttpError) issues.push(error.message);
      else throw error;
    }
    const { _id: _id, ...value } = cart;
    json(res, {
      cart: { ...value, issues, checkoutEnabled: configCheckout() },
      version: value.version,
    });
  });
  async function saveCart(input:z.infer<typeof cartInputSchema>,userId:string,session?:ClientSession,expectedSubtotalMinor?:number) {
    const { record, priced, subtotalMinor, minimumIssue } = await validateCart(
        input.restaurantId,
        input.addressId,
        userId,
        input.lines,
      );
    if(expectedSubtotalMinor!==undefined&&subtotalMinor!==expectedSubtotalMinor)throw new HttpError(409,'PRICE_CHANGED','The cart price changed; review a new proposal');
    const old = await carts.findOne({ _id: userId },{session});
    if ((old?.version ?? 0) !== input.expectedVersion)
      throw new HttpError(
        409,
        'VERSION_CONFLICT',
        'Your cart changed in another tab. Reload it before saving',
      );
    if (old?.lines.length && old.restaurantId !== input.restaurantId && !input.replace)
      throw new HttpError(
        409,
        'REPLACE_CART_REQUIRED',
        'Your cart has dishes from another restaurant. Confirm replacement first',
      );
    const value = {
      restaurantId: record._id,
      restaurantName: record.name,
      addressId: input.addressId,
      lines: priced,
      subtotalMinor,
      currency: 'INR' as const,
      version: input.expectedVersion + 1,
      updatedAt: new Date().toISOString(),
    };
    if (old) {
      const changed = await carts.updateOne(
        { _id: userId, version: input.expectedVersion },
        { $set: value },
        { session },
      );
      if (!changed.modifiedCount)
        throw new HttpError(409, 'VERSION_CONFLICT', 'Your cart changed. Reload it before saving');
    } else
      try {
        await carts.insertOne({ _id: userId, ...value },{session});
      } catch (error) {
        if (error && typeof error === 'object' && 'code' in error && error.code === 11000)
          throw new HttpError(
            409,
            'VERSION_CONFLICT',
            'Your cart changed. Reload it before saving',
          );
        throw error;
      }
    return {
      ...value,
      issues: minimumIssue ? [minimumIssue] : [],
      checkoutEnabled: configCheckout(),
    };
  }
  app.put('/api/v1/cart', remoteSession(ctx, { mutation: true }), async (req, res) => {
    json(res,await saveCart(cartInputSchema.parse(req.body),currentPrincipal(res).userId));
  });
  app.delete('/api/v1/cart', remoteSession(ctx, { mutation: true }), async (req, res) => {
    const { expectedVersion } = z
      .object({ expectedVersion: z.number().int().positive() })
      .strict()
      .parse(req.body);
    if (
      !(
        await carts.updateOne(
          { _id: currentPrincipal(res).userId, version: expectedVersion },
          {
            $set: { lines: [], subtotalMinor: 0, updatedAt: new Date().toISOString() },
            $inc: { version: 1 },
          },
        )
      ).modifiedCount
    )
      throw new HttpError(409, 'VERSION_CONFLICT', 'Cart changed. Reload before clearing it');
    json(res, { cleared: true, version: expectedVersion + 1 });
  });
  return {saveCart,validateCart};
}

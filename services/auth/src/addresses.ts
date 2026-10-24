import express, { type Express } from 'express';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { addressInputSchema, findCity, type Address } from '@cravecart/contracts';
import {
  remoteSession,
  currentPrincipal,
  checkedId,
  HttpError,
  json,
  lazyIndexes,
  type DomainContext,
} from '@cravecart/platform';

export function installAddresses(app: Express, ctx: DomainContext) {
  const collection = ctx.db.collection<Address & { _id: string; userId: string }>('addresses');
  const ready = lazyIndexes(async () => {
    await collection.createIndex(
      { userId: 1, isDefault: 1 },
      { unique: true, partialFilterExpression: { isDefault: true } },
    );
  });
  const present = ({
    _id: _id,
    userId: _userId,
    ...address
  }: Address & { _id: string; userId: string }) => address;
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
      (
        await collection
          .find({ userId: currentPrincipal(res).userId })
          .sort({ isDefault: -1, _id: 1 })
          .toArray()
      ).map(present),
    ),
  );
  router.post('/', remoteSession(ctx, { mutation: true }), async (req, res) => {
    const input = addressInputSchema.parse(req.body),
      userId = currentPrincipal(res).userId;
    if (!findCity(input.city)) throw new HttpError(422, 'INVALID_CITY', 'Choose a supported city');
    const session = ctx.client.startSession();
    let result: Address | undefined;
    try {
      await session.withTransaction(async () => {
        const count = await collection.countDocuments({ userId }, { session });
        if (count >= 20)
          throw new HttpError(409, 'ADDRESS_LIMIT', 'Keep at most 20 saved addresses');
        const isDefault = input.isDefault || count === 0;
        if (isDefault)
          await collection.updateMany(
            { userId, isDefault: true },
            { $set: { isDefault: false }, $inc: { version: 1 } },
            { session },
          );
        const id = randomUUID();
        result = { ...input, id, version: 1, isDefault };
        await collection.insertOne({ ...result, _id: id, userId }, { session });
      });
    } finally {
      await session.endSession();
    }
    json(res, result, 201);
  });
  router.patch('/:addressId', remoteSession(ctx, { mutation: true }), async (req, res) => {
    const { expectedVersion, ...input } = addressInputSchema
        .extend({ expectedVersion: z.number().int().positive() })
        .strict()
        .parse(req.body),
      userId = currentPrincipal(res).userId,
      id = checkedId(req.params.addressId);
    if (!findCity(input.city)) throw new HttpError(422, 'INVALID_CITY', 'Choose a supported city');
    const session = ctx.client.startSession();
    let result: Address | undefined;
    try {
      await session.withTransaction(async () => {
        const old = await collection.findOne({ _id: id, userId }, { session });
        if (!old) throw new HttpError(404, 'NOT_FOUND', 'Address not found');
        if (old.version !== expectedVersion)
          throw new HttpError(409, 'VERSION_CONFLICT', 'Address changed; reload before saving');
        if (old.isDefault && !input.isDefault)
          throw new HttpError(422, 'DEFAULT_REQUIRED', 'Choose another default address first');
        if (input.isDefault)
          await collection.updateMany(
            { userId, _id: { $ne: id }, isDefault: true },
            { $set: { isDefault: false }, $inc: { version: 1 } },
            { session },
          );
        const changed = await collection.findOneAndUpdate(
          { _id: id, userId, version: expectedVersion },
          { $set: input, $inc: { version: 1 } },
          { session, returnDocument: 'after' },
        );
        if (!changed) throw new HttpError(409, 'VERSION_CONFLICT', 'Address changed');
        result = present(changed);
      });
    } finally {
      await session.endSession();
    }
    json(res, result);
  });
  router.delete('/:addressId', remoteSession(ctx, { mutation: true }), async (req, res) => {
    const id = checkedId(req.params.addressId),
      userId = currentPrincipal(res).userId;
    const session = ctx.client.startSession();
    try {
      await session.withTransaction(async () => {
        const old = await collection.findOneAndDelete({ _id: id, userId }, { session });
        if (!old) throw new HttpError(404, 'NOT_FOUND', 'Address not found');
        if (old.isDefault) {
          const next = await collection.findOne({ userId }, { session, sort: { _id: 1 } });
          if (next)
            await collection.updateOne(
              { _id: next._id },
              { $set: { isDefault: true }, $inc: { version: 1 } },
              { session },
            );
        }
      });
    } finally {
      await session.endSession();
    }
    json(res, { deleted: true });
  });
  app.use('/api/v1/addresses', router);
}

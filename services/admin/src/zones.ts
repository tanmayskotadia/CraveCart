import express, { type Express } from 'express';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import {
  zoneInputSchema,
  pointSchema,
  findCity,
  isOpen,
  type ZoneInput,
} from '@cravecart/contracts';
import {
  remoteSession,
  internalOnly,
  currentPrincipal,
  checkedId,
  HttpError,
  json,
  lazyIndexes,
  requireOrigin,
  type DomainContext,
} from '@cravecart/platform';

type ZoneRecord = ZoneInput & { _id: string; version: number; country: 'IN'; updatedAt: string };
export function installZones(app: Express, ctx: DomainContext) {
  const zones = ctx.db.collection<ZoneRecord>('zones');
  const ready = lazyIndexes(async () => {
    await zones.createIndex({ polygon: '2dsphere' });
    await zones.createIndex({ city: 1, active: 1 });
  });
  const present = ({ _id, ...zone }: ZoneRecord) => ({ id: _id, ...zone });
  async function check(input: {
    city: string;
    point: z.infer<typeof pointSchema>;
    pickupPoint?: z.infer<typeof pointSchema>;
  }) {
    await ready();
    const geometry = (point: z.infer<typeof pointSchema>) => ({
      $geoIntersects: {
        $geometry: { type: 'Point', coordinates: [point.longitude, point.latitude] },
      },
    });
    const records = await zones
      .find({
        country: 'IN',
        city: input.city,
        active: true,
        ...(ctx.config.NODE_ENV === 'production' ? { sample: { $ne: true } } : {}),
        $and: [
          { polygon: geometry(input.point) },
          ...(input.pickupPoint ? [{ polygon: geometry(input.pickupPoint) }] : []),
        ],
      })
      .sort({ _id: 1 })
      .limit(50)
      .toArray();
    const open = records.filter((zone) => isOpen(zone.hours));
    return {
      serviceable: open.length > 0,
      reason: open.length
        ? 'AVAILABLE'
        : records.length
          ? 'OUTSIDE_OPERATING_HOURS'
          : 'OUTSIDE_CONFIGURED_ZONE',
      zones: open.map((zone) => ({
        id: zone._id,
        name: zone.name,
        city: zone.city,
        version: zone.version,
        feePolicyVersion: zone.feePolicyVersion,
        deliveryFeeMinor: zone.deliveryFeeMinor,
        travelMinutesMin: zone.travelMinutesMin,
        travelMinutesMax: zone.travelMinutesMax,
      })),
    };
  }
  app.post('/api/v1/serviceability', async (req, res) => {
    requireOrigin(req, ctx.config);
    const input = z
      .object({ city: z.string().max(60), point: pointSchema })
      .strict()
      .parse(req.body);
    json(res, await check(input));
  });
  app.post('/internal/v1/zones/check', internalOnly(ctx, ['restaurant']), async (req, res) => {
    const input = z
      .object({ city: z.string().max(60), point: pointSchema, pickupPoint: pointSchema.optional() })
      .strict()
      .parse(req.body);
    json(res, await check(input));
  });
  const router = express.Router();
  router.get('/', remoteSession(ctx, { permission: 'zones:read' }), async (_req, res) => {
    await ready();
    json(res, (await zones.find({}).sort({ city: 1, _id: 1 }).limit(200).toArray()).map(present));
  });
  const writeSchema = z
    .object({
      zone: zoneInputSchema,
      reason: z.string().trim().min(5).max(500),
      expectedVersion: z.number().int().positive().optional(),
    })
    .strict();
  for (const method of ['post', 'patch'] as const)
    router[method](
      method === 'post' ? '/' : '/:zoneId',
      remoteSession(ctx, { permission: 'zones:write', stepUp: true, mutation: true }),
      async (req, res) => {
        await ready();
        const input = writeSchema.parse(req.body);
        if (!findCity(input.zone.city))
          throw new HttpError(422, 'INVALID_CITY', 'Choose a supported city');
        if (method === 'patch' && !input.expectedVersion)
          throw new HttpError(400, 'VERSION_REQUIRED', 'Reload the zone before saving');
        const id = method === 'post' ? randomUUID() : checkedId(req.params.zoneId),
          session = ctx.client.startSession();
        let result: unknown;
        try {
          await session.withTransaction(async () => {
            const fields = {
              ...input.zone,
              country: 'IN' as const,
              updatedAt: new Date().toISOString(),
            };
            if (method === 'post') {
              const record = { ...fields, _id: id, version: 1 };
              await zones.insertOne(record, { session });
              result = present(record);
            } else {
              const record = await zones.findOneAndUpdate(
                { _id: id, version: input.expectedVersion },
                { $set: fields, $inc: { version: 1 } },
                { session, returnDocument: 'after' },
              );
              if (!record)
                throw new HttpError(409, 'VERSION_CONFLICT', 'Zone changed or no longer exists');
              result = present(record);
            }
            await ctx.db.collection('audit').insertOne(
              {
                id: randomUUID(),
                actorId: currentPrincipal(res).userId,
                action: 'zone.updated',
                applicationId: id,
                reason: input.reason,
                at: new Date(),
                data: {
                  version: input.expectedVersion ?? 0,
                  city: fields.city,
                  active: fields.active,
                },
              },
              { session },
            );
          });
        } catch (error) {
          if (
            error &&
            typeof error === 'object' &&
            'code' in error &&
            [16755, 2].includes(Number(error.code))
          )
            throw new HttpError(422, 'INVALID_POLYGON', 'Use a valid non-intersecting polygon');
          throw error;
        } finally {
          await session.endSession();
        }
        json(res, result, method === 'post' ? 201 : 200);
      },
    );
  app.use('/api/v1/admin/zones', router);
}

import { z } from 'zod';
import { orderStatusSchema, paymentStateSchema, commerceModeSchema } from './commerce.js';
export const coordinatesSchema = z
  .object({ latitude: z.number().min(6).max(38), longitude: z.number().min(68).max(98) })
  .strict();
export const locationSampleSchema = z
  .object({
    point: coordinatesSchema,
    accuracy: z.number().min(0).max(100),
    capturedAt: z.string().datetime(),
    sequence: z.number().int().nonnegative(),
    streamId: z.string().uuid(),
  })
  .strict();
export type LocationSample = z.infer<typeof locationSampleSchema>;
export const sellerActionSchema = z
  .object({
    expectedVersion: z.number().int().positive(),
    action: z.enum(['accept', 'reject', 'preparing', 'ready', 'renew-pickup-code']),
    preparationMinutes: z.number().int().min(5).max(120).optional(),
    reason: z.string().trim().min(5).max(500).optional(),
  })
  .strict();
export const riderAvailabilitySchema = z
  .object({ online: z.boolean(), city: z.string().max(60) })
  .strict();
export const deliveryCommandSchema = z
  .object({
    expectedVersion: z.number().int().positive(),
    code: z
      .string()
      .regex(/^\d{6}$/)
      .optional(),
  })
  .strict();
export const fulfillmentSnapshotSchema = z
  .object({
    mode: commerceModeSchema,
    orderId: z.string().uuid(),
    number: z.string(),
    version: z.number().int().positive(),
    status: orderStatusSchema,
    paymentState: paymentStateSchema,
    restaurantId: z.string().uuid(),
    restaurantName: z.string(),
    pickup: z.object({ address: z.string(), point: coordinatesSchema }).strict(),
    items: z.array(
      z
        .object({ name: z.string(), quantity: z.number().int(), selection: z.array(z.string()) })
        .strict(),
    ),
    preparationMinutes: z.number().int().nullable(),
    acceptedAt: z.string().nullable(),
    readyAt: z.string().nullable(),
    deliveredAt: z.string().nullable(),
    assignment: z
      .object({
        id: z.string().uuid(),
        riderId: z.string().uuid(),
        riderName: z.string(),
        version: z.number().int(),
        assignedAt: z.string(),
        arrived: z.boolean(),
      })
      .strict()
      .nullable(),
    dispatchState: z.enum(['WAITING', 'SEARCHING', 'ASSIGNED', 'NO_RIDER', 'CLOSED']),
    pickupCode: z.string().nullable(),
    deliveryCode: z.string().nullable(),
    proofExpiresAt: z.string().nullable(),
    dropoff: z
      .object({
        street: z.string(),
        apartment: z.string(),
        landmark: z.string(),
        instructions: z.string(),
        recipient: z.string(),
        phone: z.string(),
        point: coordinatesSchema,
      })
      .strict()
      .nullable(),
    latestLocation: z
      .object({
        point: coordinatesSchema,
        accuracy: z.number(),
        capturedAt: z.string(),
        receivedAt: z.string(),
      })
      .strict()
      .nullable(),
    trackingStale: z.boolean(),
    timeline: z.array(
      z.object({ at: z.string(), status: z.string(), message: z.string() }).strict(),
    ),
  })
  .strict();
export type FulfillmentSnapshot = z.infer<typeof fulfillmentSnapshotSchema>;
export const deliveryOfferSchema = z
  .object({
    id: z.string().uuid(),
    orderId: z.string().uuid(),
    restaurantName: z.string(),
    pickup: coordinatesSchema,
    distanceMeters: z.number(),
    expiresAt: z.string(),
    state: z.enum(['OPEN', 'DECLINED', 'EXPIRED', 'ACCEPTING', 'ACCEPTED', 'WITHDRAWN']),
    round: z.number().int(),
  })
  .strict();
export type DeliveryOffer = z.infer<typeof deliveryOfferSchema>;
export const notificationSchema = z
  .object({
    id: z.string(),
    title: z.string(),
    href: z.string(),
    at: z.string(),
    readAt: z.string().nullable(),
  })
  .strict();
export type DeliveryNotification = z.infer<typeof notificationSchema>;
export const distanceMeters = (
  a: { latitude: number; longitude: number },
  b: { latitude: number; longitude: number },
) => {
  const radians = (v: number) => (v * Math.PI) / 180,
    lat = radians(b.latitude - a.latitude),
    lon = radians(b.longitude - a.longitude);
  return (
    6371000 *
    2 *
    Math.asin(
      Math.min(
        1,
        Math.sqrt(
          Math.sin(lat / 2) ** 2 +
            Math.cos(radians(a.latitude)) * Math.cos(radians(b.latitude)) * Math.sin(lon / 2) ** 2,
        ),
      ),
    )
  );
};

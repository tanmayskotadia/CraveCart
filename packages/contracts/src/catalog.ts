import { z } from 'zod';

export const pointSchema = z
  .object({ longitude: z.number().min(68).max(98), latitude: z.number().min(6).max(38) })
  .strict();
export const hoursSchema = z
  .array(
    z
      .object({
        day: z.number().int().min(0).max(6),
        openMinute: z.number().int().min(0).max(1439),
        closeMinute: z.number().int().min(1).max(1440),
      })
      .strict()
      .refine((slot) => slot.closeMinute > slot.openMinute, 'Split overnight hours at midnight'),
  )
  .max(21)
  .refine(
    (slots) =>
      slots.every((slot, index) =>
        slots.every(
          (other, j) =>
            j === index ||
            slot.day !== other.day ||
            slot.closeMinute <= other.openMinute ||
            slot.openMinute >= other.closeMinute,
        ),
      ),
    'Hours cannot overlap',
  );
export const addressInputSchema = z
  .object({
    label: z.string().trim().min(2).max(40),
    recipient: z.string().trim().min(2).max(80),
    phone: z.string().regex(/^[6-9]\d{9}$/),
    city: z.string().max(60),
    street: z.string().trim().min(10).max(300),
    apartment: z.string().trim().max(100).default(''),
    landmark: z.string().trim().max(160).default(''),
    instructions: z.string().trim().max(300).default(''),
    pincode: z.string().regex(/^[1-9]\d{5}$/),
    point: pointSchema,
    isDefault: z.boolean().default(false),
  })
  .strict();
export const addressSchema = addressInputSchema.extend({
  id: z.string().uuid(),
  version: z.number().int().positive(),
});
export type Address = z.infer<typeof addressSchema>;
export const zoneInputSchema = z
  .object({
    name: z.string().trim().min(3).max(80),
    city: z.string().max(60),
    active: z.boolean(),
    polygon: z
      .object({
        type: z.literal('Polygon'),
        coordinates: z
          .array(
            z
              .array(z.tuple([z.number().min(68).max(98), z.number().min(6).max(38)]))
              .min(4)
              .max(51),
          )
          .length(1),
      })
      .strict()
      .refine((value) => {
        const ring = value.coordinates[0]!;
        return ring[0]![0] === ring.at(-1)![0] && ring[0]![1] === ring.at(-1)![1];
      }, 'Close the polygon ring'),
    hours: hoursSchema,
    feePolicyVersion: z.number().int().positive(),
    deliveryFeeMinor: z.number().int().min(0).max(100000),
    travelMinutesMin: z.number().int().min(1).max(180),
    travelMinutesMax: z.number().int().min(1).max(240),
  })
  .strict()
  .refine((zone) => zone.travelMinutesMax >= zone.travelMinutesMin, 'Invalid travel range');
export type ZoneInput = z.infer<typeof zoneInputSchema>;
export const restaurantInputSchema = z
  .object({
    name: z.string().trim().min(2).max(120),
    description: z.string().trim().max(1000),
    cuisines: z.array(z.string().trim().min(2).max(40)).min(1).max(8),
    city: z.string().max(60),
    address: z.string().trim().min(10).max(400),
    point: pointSchema,
    hours: hoursSchema,
    holidays: z
      .array(z.object({ date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), closed: z.boolean() }))
      .max(60),
    imageId: z.string().uuid().nullable(),
    libraryImage: z.enum(['biryani', 'pizza', 'indian-feast']),
    costForTwoMinor: z.number().int().min(100).max(1000000),
    minimumOrderMinor: z.number().int().min(0).max(1000000),
    preparationMinutes: z.number().int().min(5).max(180),
    published: z.boolean(),
    paused: z.boolean(),
    pauseReason: z.string().trim().max(200),
  })
  .strict()
  .refine((value) => !value.paused || value.pauseReason.length >= 5, 'Explain the temporary pause');
export type RestaurantInput = z.infer<typeof restaurantInputSchema>;
const option = z
  .object({
    id: z.string().uuid(),
    name: z.string().trim().min(1).max(80),
    priceMinor: z.number().int().min(0).max(1000000),
    available: z.boolean(),
  })
  .strict();
export const menuItemInputSchema = z
  .object({
    category: z.string().trim().min(2).max(60),
    name: z.string().trim().min(2).max(120),
    description: z.string().trim().max(1000),
    priceMinor: z.number().int().min(1).max(1000000),
    diet: z.enum(['veg', 'vegan', 'non-veg']),
    allergens: z.array(z.string().trim().min(1).max(60)).max(20),
    available: z.boolean(),
    stock: z.number().int().min(0).max(100000).nullable(),
    imageId: z.string().uuid().nullable(),
    libraryImage: z.enum(['biryani', 'pizza', 'indian-feast']),
    variants: z.array(option).max(12),
    modifierGroups: z
      .array(
        z
          .object({
            id: z.string().uuid(),
            name: z.string().trim().min(1).max(80),
            min: z.number().int().min(0).max(12),
            max: z.number().int().min(1).max(12),
            options: z.array(option).min(1).max(12),
          })
          .strict()
          .refine(
            (group) => group.min <= group.max && group.max <= group.options.length,
            'Invalid add-on limits',
          ),
      )
      .max(8),
  })
  .strict()
  .refine((item) => {
    const ids = [
      ...item.variants.map((option) => option.id),
      ...item.modifierGroups.flatMap((group) => [
        group.id,
        ...group.options.map((option) => option.id),
      ]),
    ];
    return new Set(ids).size === ids.length;
  }, 'Option IDs must be unique');
export type MenuItemInput = z.infer<typeof menuItemInputSchema>;
export type MenuItem = MenuItemInput & { id: string; restaurantId: string; version: number };
export type Restaurant = RestaurantInput & {
  id: string;
  slug: string;
  version: number;
  sample: boolean;
  open: boolean;
  rating: number | null;
  ratingCount: number;
  access?: 'owner' | 'manager' | 'kitchen';
};
export const offerInputSchema = z
  .object({
    code: z
      .string()
      .trim()
      .toUpperCase()
      .regex(/^[A-Z0-9]{3,20}$/),
    title: z.string().trim().min(3).max(100),
    percent: z.number().int().min(1).max(70),
    usageLimit: z.number().int().min(1).max(1000000).nullable().default(null),
    perUserLimit: z.number().int().min(1).max(10000).nullable().default(null),
    maxDiscountMinor: z.number().int().min(1).max(100000),
    minimumSubtotalMinor: z.number().int().min(0).max(1000000),
    startsAt: z.string().datetime(),
    endsAt: z.string().datetime(),
    active: z.boolean(),
  })
  .strict()
  .refine(
    (value) => Date.parse(value.endsAt) > Date.parse(value.startsAt),
    'Offer end must follow start',
  );
export type Offer = z.infer<typeof offerInputSchema> & {
  id: string;
  restaurantId: string;
  version: number;
};
export const cartLineInputSchema = z
  .object({
    itemId: z.string().uuid(),
    variantId: z.string().uuid().nullable(),
    optionIds: z.array(z.string().uuid()).max(96),
    quantity: z.number().int().min(1).max(20),
    instructions: z.string().trim().max(200),
  })
  .strict()
  .refine((line) => new Set(line.optionIds).size === line.optionIds.length, 'Duplicate add-ons');
export type CartLineInput = z.infer<typeof cartLineInputSchema>;
export const cartInputSchema = z
  .object({
    expectedVersion: z.number().int().min(0),
    restaurantId: z.string().uuid(),
    addressId: z.string().uuid(),
    replace: z.boolean().default(false),
    lines: z.array(cartLineInputSchema).min(1).max(20),
  })
  .strict()
  .refine(
    (cart) => cart.lines.reduce((sum, line) => sum + line.quantity, 0) <= 100,
    'Cart is limited to 100 portions',
  );
export type CartLine = CartLineInput & {
  name: string;
  selection: string[];
  unitPriceMinor: number;
  itemVersion: number;
};
export type Cart = {
  version: number;
  restaurantId: string;
  restaurantName: string;
  addressId: string;
  lines: CartLine[];
  subtotalMinor: number;
  currency: 'INR';
  issues: string[];
  checkoutEnabled: boolean;
  updatedAt: string;
};
export const restaurantSchema = restaurantInputSchema.safeExtend({
  point: z
    .object({ latitude: z.number().min(-90).max(90), longitude: z.number().min(-180).max(180) })
    .strict(),
  id: z.string().uuid(),
  slug: z.string(),
  version: z.number().int().positive(),
  sample: z.boolean(),
  open: z.boolean(),
  rating: z.number().min(1).max(5).nullable(),
  ratingCount: z.number().int().nonnegative(),
  access: z.enum(['owner', 'manager', 'kitchen']).optional(),
  updatedAt: z.string().datetime(),
});
export const menuItemSchema = menuItemInputSchema.safeExtend({
  id: z.string().uuid(),
  restaurantId: z.string().uuid(),
  version: z.number().int().positive(),
});
export const offerSchema = offerInputSchema.safeExtend({
  id: z.string().uuid(),
  restaurantId: z.string().uuid(),
  version: z.number().int().positive(),
  restaurantSlug: z.string().optional(),
  restaurantName: z.string().optional(),
});
export const cartSchema = z
  .object({
    version: z.number().int().positive(),
    restaurantId: z.string().uuid(),
    restaurantName: z.string(),
    addressId: z.string().uuid(),
    lines: z.array(
      cartLineInputSchema.safeExtend({
        name: z.string(),
        selection: z.array(z.string()),
        unitPriceMinor: z.number().int().positive(),
        itemVersion: z.number().int().positive(),
      }),
    ),
    subtotalMinor: z.number().int().min(0),
    currency: z.literal('INR'),
    issues: z.array(z.string()),
    checkoutEnabled: z.boolean(),
    updatedAt: z.string().datetime(),
  })
  .strict();
export const serviceabilitySchema = z
  .object({
    serviceable: z.boolean(),
    reason: z.enum(['AVAILABLE', 'OUTSIDE_OPERATING_HOURS', 'OUTSIDE_CONFIGURED_ZONE']),
    zones: z.array(
      z
        .object({
          id: z.string().uuid(),
          name: z.string(),
          city: z.string(),
          version: z.number().int().positive(),
          feePolicyVersion: z.number().int().positive(),
          deliveryFeeMinor: z.number().int().nonnegative(),
          travelMinutesMin: z.number().int().positive(),
          travelMinutesMax: z.number().int().positive(),
        })
        .strict(),
    ),
  })
  .strict();
export function isOpen(
  hours: z.infer<typeof hoursSchema>,
  now = new Date(),
  holidays: Array<{ date: string; closed: boolean }> = [],
) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(now);
  const get = (type: string) => parts.find((part) => part.type === type)?.value ?? '';
  if (
    holidays.some(
      (day) => day.date === `${get('year')}-${get('month')}-${get('day')}` && day.closed,
    )
  )
    return false;
  const weekday = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(get('weekday')),
    minute = Number(get('hour')) * 60 + Number(get('minute'));
  return hours.some(
    (slot) => slot.day === weekday && minute >= slot.openMinute && minute < slot.closeMinute,
  );
}

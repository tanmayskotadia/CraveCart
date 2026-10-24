import { MongoClient } from 'mongodb';
import { createHash } from 'node:crypto';
try {
  process.loadEnvFile('.env');
} catch {
  /* Local defaults only. */
}
if (process.env.NODE_ENV === 'production' || process.env.DEV_ADAPTERS === 'false')
  throw new Error('Sample catalog is forbidden outside development mode');
const uuid = (value) => {
  const hex = createHash('sha256').update(`cravecart-development-catalog:${value}`).digest('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-8${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
};
const cities = [
  ['chennai', 'Chennai', 13.0827, 80.2707],
  ['mumbai', 'Mumbai', 19.076, 72.8777],
  ['delhi', 'Delhi', 28.6139, 77.209],
  ['bengaluru', 'Bengaluru', 12.9716, 77.5946],
  ['hyderabad', 'Hyderabad', 17.385, 78.4867],
  ['kochi', 'Kochi', 9.9312, 76.2673],
];
const hours = Array.from({ length: 7 }, (_, day) => ({ day, openMinute: 0, closeMinute: 1440 }));
const client = new MongoClient(
  process.env.MONGO_URI ?? 'mongodb://127.0.0.1:27017/?directConnection=true&replicaSet=rs0',
);
try {
  await client.connect();
  for (const [city, name, latitude, longitude] of cities) {
    const userId = uuid(`${city}:seller`),
      now = new Date().toISOString();
    await client
      .db('cravecart_auth')
      .collection('users')
      .updateOne(
        { _id: userId },
        {
          $setOnInsert: {
            contact: `sample-catalog-${city}@example.test`,
            name: `Sample ${name} Seller`,
            roles: ['customer', 'seller'],
            permissions: [],
            status: 'ACTIVE',
            sample: true,
            createdAt: new Date(),
          },
        },
        { upsert: true },
      );
    const a = longitude - 0.07,
      b = longitude + 0.07,
      c = latitude - 0.06,
      d = latitude + 0.06;
    await client
      .db('cravecart_admin')
      .collection('zones')
      .updateOne(
        { _id: uuid(`${city}:zone`) },
        {
          $setOnInsert: {
            name: `${name} development cart area`,
            city,
            country: 'IN',
            active: true,
            polygon: {
              type: 'Polygon',
              coordinates: [
                [
                  [a, c],
                  [b, c],
                  [b, d],
                  [a, d],
                  [a, c],
                ],
              ],
            },
            hours,
            feePolicyVersion: 1,
            deliveryFeeMinor: 3000,
            travelMinutesMin: 10,
            travelMinutesMax: 25,
            version: 1,
            sample: true,
            updatedAt: now,
          },
        },
        { upsert: true },
      );
    for (const [index, title, cuisines, image, cost] of [
      [0, 'The Southern Table', ['South Indian', 'Indian'], 'indian-feast', 45000],
      [1, 'Biryani & Co.', ['Biryani', 'Indian'], 'biryani', 65000],
      [2, 'A Slice of Home', ['Italian', 'Pizza'], 'pizza', 80000],
    ]) {
      const id = uuid(`${city}:restaurant:${index}`),
        slug = `sample-${city}-${index === 0 ? 'southern-table' : index === 1 ? 'biryani-and-co' : 'slice-of-home'}`;
      await client
        .db('cravecart_restaurant')
        .collection('restaurants')
        .updateOne(
          { _id: id },
          {
            $setOnInsert: {
              userId,
              slug,
              name: `${title} · ${name}`,
              description:
                'Fictional development sample for exploring CraveCart. No real restaurant affiliation; no orders or payments are accepted.',
              cuisines,
              city,
              address: `Development sample pin, ${name} (not a real pickup address)`,
              point: { latitude, longitude },
              hours,
              holidays: [],
              imageId: null,
              libraryImage: image,
              costForTwoMinor: cost,
              minimumOrderMinor: 0,
              preparationMinutes: 20 + index * 5,
              published: true,
              paused: false,
              pauseReason: '',
              version: 1,
              sample: true,
              updatedAt: now,
            },
          },
          { upsert: true },
        );
      const names =
        index === 0
          ? ['Ghee podi idli', 'Masala dosa', 'Curd rice', 'Filter coffee']
          : index === 1
            ? ['Vegetable dum biryani', 'Chicken dum biryani', 'Paneer pepper roast', 'Rose milk']
            : ['Classic margherita', 'Garden harvest pizza', 'Garlic bread', 'Chocolate brownie'];
      for (const [dishIndex, dishName] of names.entries()) {
        const itemId = uuid(`${id}:item:${dishIndex}`),
          priceMinor = [14900, 22900, 17900, 7900][dishIndex] + index * 3000;
        await client
          .db('cravecart_restaurant')
          .collection('menu_items')
          .updateOne(
            { _id: itemId },
            {
              $setOnInsert: {
                restaurantId: id,
                category: dishIndex === 3 ? 'Something sweet' : 'Kitchen favourites',
                name: dishName,
                description:
                  'An illustrative sample dish for testing menu choices. The displayed photograph is illustrative.',
                priceMinor,
                diet: index === 1 && dishIndex === 1 ? 'non-veg' : 'veg',
                allergens: ['Milk'],
                available: true,
                stock: null,
                imageId: null,
                libraryImage: image,
                variants:
                  dishIndex < 2
                    ? [
                        {
                          id: uuid(`${itemId}:regular`),
                          name: 'Regular',
                          priceMinor: 0,
                          available: true,
                        },
                        {
                          id: uuid(`${itemId}:large`),
                          name: 'Large',
                          priceMinor: 6000,
                          available: true,
                        },
                      ]
                    : [],
                modifierGroups:
                  dishIndex < 2
                    ? [
                        {
                          id: uuid(`${itemId}:group`),
                          name: 'Make it yours',
                          min: 0,
                          max: 2,
                          options: [
                            {
                              id: uuid(`${itemId}:extra`),
                              name: index === 2 ? 'Extra cheese' : 'Extra side',
                              priceMinor: 3000,
                              available: true,
                            },
                            {
                              id: uuid(`${itemId}:drink`),
                              name: 'Add a drink',
                              priceMinor: 5000,
                              available: true,
                            },
                          ],
                        },
                      ]
                    : [],
                version: 1,
                deleted: false,
                sample: true,
              },
            },
            { upsert: true },
          );
      }
      await client
        .db('cravecart_restaurant')
        .collection('offers')
        .updateOne(
          { _id: uuid(`${id}:offer`) },
          {
            $setOnInsert: {
              restaurantId: id,
              code: 'SAMPLE10',
              title: 'A little welcome treat',
              percent: 10,
              maxDiscountMinor: 5000,
              minimumSubtotalMinor: 20000,
              startsAt: '2026-01-01T00:00:00.000Z',
              endsAt: '2027-12-31T23:59:59.000Z',
              active: true,
              version: 1,
              sample: true,
            },
          },
          { upsert: true },
        );
    }
  }
  console.log(
    'Development samples ready: 18 fictional restaurants, 72 dishes and 6 test zones. Existing edits were preserved. No orders, privileged administrator or real merchant accounts were created.',
  );
  console.log(
    'Select Chennai, Mumbai, Delhi, Bengaluru, Hyderabad or Kochi. Sample pins and areas are for cart testing only.',
  );
} finally {
  await client.close();
}

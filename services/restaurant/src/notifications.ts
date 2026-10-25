import type { Db, ClientSession } from 'mongodb';
import type { OrderRecord } from './orders.js';

export async function persistOrderNotifications(
  db: Db,
  session: ClientSession,
  order: OrderRecord,
) {
  if (order.status === 'PAYMENT_PENDING' || order.status === 'EXPIRED') return;
  const restaurant = await db
    .collection('restaurants')
    .findOne({ _id: order.quote.restaurant.id as never }, { session });
  const notes = db.collection<{
    _id: string;
    userId: string;
    title: string;
    href: string;
    at: string;
    readAt: string | null;
  }>('delivery_notifications');
  for (const [userId, href, role] of [
    [order.userId, `/orders/${order.id}/track`, 'customer'],
    [
      restaurant?.userId ? String(restaurant.userId) : '',
      `/seller/restaurants/${order.quote.restaurant.id}/orders/${order.id}`,
      'seller',
    ],
  ]) {
    if (!userId) continue;
    await notes.updateOne(
      { _id: `${order.id}:${order.version}:${role}` },
      {
        $setOnInsert: {
          userId,
          href,
          title: `${order.quote.restaurant.name}: ${order.status.replaceAll('_', ' ').toLowerCase()}`,
          at: new Date().toISOString(),
          readAt: null,
        },
      },
      { upsert: true, session },
    );
  }
}

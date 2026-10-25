import { HttpError, internalCall, type DomainContext } from '@cravecart/platform';
export async function restaurantAccess(
  ctx: DomainContext,
  id: string,
  userId: string,
  scope: 'manage' | 'kitchen' | 'owner' = 'manage',
) {
  const restaurant = await ctx.db.collection('restaurants').findOne({ _id: id as never });
  if (!restaurant) throw new HttpError(404, 'RESTAURANT_NOT_FOUND', 'Restaurant not found');
  if (restaurant.userId === userId) return restaurant;
  const member =
    scope !== 'owner' &&
    (await ctx.db.collection('restaurant_staff').findOne({
      restaurantId: id,
      userId,
      active: true,
      ...(scope === 'manage' ? { role: 'manager' } : {}),
    }));
  if (!member) throw new HttpError(404, 'RESTAURANT_NOT_FOUND', 'Restaurant not found');
  const owner = await internalCall<{ activeUserIds: string[] }>(
    ctx,
    'auth',
    '/internal/v1/memberships/check',
    { role: 'seller', userIds: [restaurant.userId] },
  );
  if (!owner.activeUserIds.includes(String(restaurant.userId)))
    throw new HttpError(403, 'RESTAURANT_UNAVAILABLE', 'Restaurant owner is unavailable');
  return restaurant;
}

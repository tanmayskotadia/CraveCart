import { createHash } from 'node:crypto';

function developmentOnly() {
  if (process.env.NODE_ENV === 'production' || process.env.DEV_ADAPTERS === 'false')
    throw new Error('Synthetic adapters are disabled');
}

/** No adapter sends messages, charges money or requests a third-party route. */
export const syntheticAdapters = {
  payment(orderId: string, amountMinor: number) {
    developmentOnly();
    if (!Number.isSafeInteger(amountMinor) || amountMinor <= 0)
      throw new Error('Invalid minor-unit amount');
    return {
      reference: `synthetic_${createHash('sha256').update(`${orderId}:${amountMinor}`).digest('hex').slice(0, 20)}`,
      amountMinor,
      currency: 'INR' as const,
      state: 'SIMULATED' as const,
    };
  },
  notification(userId: string, template: string) {
    developmentOnly();
    return { userId, template, state: 'NOT_SENT' as const, synthetic: true };
  },
  map() {
    developmentOnly();
    return {
      lat: 13.0827,
      lng: 80.2707,
      label: 'Synthetic Chennai fixture — no route or live GPS',
      synthetic: true,
    };
  },
};

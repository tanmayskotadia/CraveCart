import { describe, it, expect } from 'vitest';
import { createHmac, randomUUID } from 'node:crypto';
import { loadConfig } from '@cravecart/config';
import type { PayableOrder } from '@cravecart/contracts';
import { Gateways, verifyWebhook, gatewayCapabilities } from '../../services/utils/src/gateways.js';
const config = loadConfig({
  NODE_ENV: 'test',
  COMMERCE_MODE: 'test',
  RAZORPAY_KEY_ID: 'rzp_test_fixture',
  RAZORPAY_KEY_SECRET: 'fixture-key-secret',
  RAZORPAY_WEBHOOK_SECRET: 'fixture-webhook-secret',
  RAZORPAY_ACCOUNT_ID: 'acc_fixture',
  STRIPE_SECRET_KEY: 'sk_test_fixture',
  STRIPE_WEBHOOK_SECRET: 'whsec_fixture',
});
function order(gateway: 'stripe' | 'razorpay'): PayableOrder {
  return {
    orderId: randomUUID(),
    userId: randomUUID(),
    attemptId: randomUUID(),
    gateway,
    mode: 'test',
    amountMinor: 25000,
    currency: 'INR',
    status: 'PAYMENT_PENDING',
    paymentDeadline: new Date(Date.now() + 600000).toISOString(),
    restaurantName: 'Fixture Kitchen',
  };
}
function fixture(gateway: 'stripe' | 'razorpay') {
  const value = order(gateway),
    refs = {
      cravecart_order_id: value.orderId,
      cravecart_attempt_id: value.attemptId,
      cravecart_mode: 'test',
    };
  const resource: Record<string, unknown> =
    gateway === 'stripe'
      ? {
          id: 'cs_test_fixture',
          amount_total: 25000,
          currency: 'inr',
          metadata: refs,
          client_reference_id: value.orderId,
          livemode: false,
          url: 'https://checkout.stripe.com/c/pay/fixture',
          payment_intent: 'pi_fixture',
          payment_status: 'paid',
          status: 'complete',
        }
      : {
          id: 'order_fixture',
          amount: 25000,
          currency: 'INR',
          notes: refs,
          receipt: value.orderId,
        };
  let captured = true,
    refundState = 'pending';
  const requests: Array<{ path: string; body: string; headers: Record<string, string> }> = [];
  const fetcher: typeof fetch = async (input, init) => {
    const url = new URL(String(input));
    const headers = init?.headers as Record<string, string>;
    requests.push({ path: url.pathname, body: String(init?.body ?? ''), headers });
    let response: Record<string, unknown> = resource;
    if (url.pathname.includes('/payment_intents/'))
      response = {
        id: 'pi_fixture',
        amount: 25000,
        amount_received: 25000,
        currency: 'inr',
        metadata: refs,
        livemode: false,
        status: captured ? 'succeeded' : 'processing',
      };
    else if (url.pathname.endsWith('/payments'))
      response = {
        items: [
          {
            id: 'pay_fixture',
            amount: 25000,
            currency: 'INR',
            order_id: 'order_fixture',
            status: captured ? 'captured' : 'authorized',
          },
        ],
      };
    else if (url.pathname.includes('/refund'))
      response = {
        id: gateway === 'stripe' ? 're_fixture' : 'rfnd_fixture',
        amount: 25000,
        currency: 'INR',
        ...(gateway === 'stripe'
          ? { payment_intent: 'pi_fixture' }
          : { payment_id: 'pay_fixture' }),
        status: refundState,
      };
    return Response.json(response);
  };
  return {
    value,
    resource,
    requests,
    adapter: new Gateways(config, fetcher),
    setCaptured: (v: boolean) => (captured = v),
    setRefund: (v: string) => (refundState = v),
  };
}
describe('provider adapters and exact-byte webhook signatures', () => {
  for (const gateway of ['razorpay', 'stripe'] as const) {
    it(`${gateway}: validates creation, captured amounts and pending refunds`, async () => {
      const f = fixture(gateway);
      const checkout = await f.adapter.create(f.value);
      expect(checkout.providerId).toBe(f.resource.id);
      f.setCaptured(false);
      expect(await f.adapter.captures(f.value, checkout.providerId)).toEqual([]);
      f.setCaptured(true);
      expect(await f.adapter.captures(f.value, checkout.providerId)).toHaveLength(1);
      const pending = await f.adapter.refund(
        gateway,
        gateway === 'stripe' ? 'pi_fixture' : 'pay_fixture',
        25000,
        'stable_refund_id',
      );
      expect(pending.state).toBe('PENDING');
      f.setRefund(gateway === 'stripe' ? 'succeeded' : 'processed');
      expect(
        (
          await f.adapter.fetchRefund(
            gateway,
            pending.id,
            gateway === 'stripe' ? 'pi_fixture' : 'pay_fixture',
            25000,
          )
        ).state,
      ).toBe('PROCESSED');
      const refundRequest = f.requests.find(
        (r) => r.path.endsWith('/refund') || r.path === '/v1/refunds',
      )!;
      expect(Object.values(refundRequest.headers)).toContain('refund-stable_refund_id');
      if (gateway === 'stripe') {
        expect(f.requests[0]!.headers['Idempotency-Key']).toBe(`checkout-${f.value.attemptId}`);
        expect(
          new URLSearchParams(f.requests[0]!.body).get(
            'payment_intent_data[metadata][cravecart_attempt_id]',
          ),
        ).toBe(f.value.attemptId);
      }
    });
    it(`${gateway}: rejects wrong provider amount and foreign order linkage`, async () => {
      const f = fixture(gateway);
      f.resource[gateway === 'stripe' ? 'amount_total' : 'amount'] = 1;
      await expect(f.adapter.verifyReference(f.value, String(f.resource.id))).rejects.toMatchObject(
        { code: 'PROVIDER_MISMATCH' },
      );
      f.resource[gateway === 'stripe' ? 'amount_total' : 'amount'] = 25000;
      f.resource[gateway === 'stripe' ? 'client_reference_id' : 'receipt'] = randomUUID();
      await expect(f.adapter.verifyReference(f.value, String(f.resource.id))).rejects.toMatchObject(
        { code: 'PROVIDER_MISMATCH' },
      );
    });
  }
  it('verifies Razorpay returns against the stored order identifier', () => {
    const adapter = new Gateways(config),
      signature = createHmac('sha256', config.RAZORPAY_KEY_SECRET!)
        .update('order_fixture|pay_fixture')
        .digest('hex');
    expect(() => adapter.verifyReturn('order_fixture', 'pay_fixture', signature)).not.toThrow();
    expect(() => adapter.verifyReturn('order_foreign', 'pay_fixture', signature)).toThrow();
  });
  it('rejects altered Stripe bytes, old timestamps, live events and foreign accounts', () => {
    const timestamp = Math.floor(Date.now() / 1000),
      payload = {
        id: 'evt_fixture',
        type: 'payment_intent.succeeded',
        livemode: false,
        data: { object: { id: 'pi_fixture', metadata: { cravecart_attempt_id: randomUUID() } } },
      };
    const sign = (raw: Buffer, t = timestamp) => ({
      'stripe-signature': `t=${t},v1=${createHmac('sha256', config.STRIPE_WEBHOOK_SECRET!).update(`${t}.`).update(raw).digest('hex')}`,
    });
    const raw = Buffer.from(JSON.stringify(payload));
    expect(verifyWebhook('stripe', raw, sign(raw), config).paymentRef).toBe('pi_fixture');
    expect(() =>
      verifyWebhook('stripe', Buffer.concat([raw, Buffer.from(' ')]), sign(raw), config),
    ).toThrow();
    expect(() => verifyWebhook('stripe', raw, sign(raw, timestamp - 301), config)).toThrow();
    for (const extra of [{ livemode: true }, { account: 'acct_foreign' }]) {
      const bytes = Buffer.from(JSON.stringify({ ...payload, ...extra }));
      expect(() => verifyWebhook('stripe', bytes, sign(bytes), config)).toThrow();
    }
  });
  it('verifies Razorpay raw bytes and rejects an event from another account', () => {
    const sign = (raw: Buffer) => ({
      'x-razorpay-signature': createHmac('sha256', config.RAZORPAY_WEBHOOK_SECRET!)
        .update(raw)
        .digest('hex'),
      'x-razorpay-event-id': 'event_fixture',
    });
    const payload = {
      account_id: 'acc_fixture',
      event: 'payment.captured',
      payload: { payment: { entity: { id: 'pay_fixture', order_id: 'order_fixture' } } },
    };
    const raw = Buffer.from(JSON.stringify(payload));
    expect(verifyWebhook('razorpay', raw, sign(raw), config).providerId).toBe('order_fixture');
    expect(() =>
      verifyWebhook('razorpay', Buffer.concat([raw, Buffer.from(' ')]), sign(raw), config),
    ).toThrow();
    const foreign = Buffer.from(JSON.stringify({ ...payload, account_id: 'acc_foreign' }));
    expect(() => verifyWebhook('razorpay', foreign, sign(foreign), config)).toThrow();
  });
  it('blocks external webhooks and gateway listings when commerce is disabled', () => {
    const disabled = { ...config, COMMERCE_MODE: 'disabled' as const };
    expect(gatewayCapabilities(disabled).gateways).toEqual([]);
    expect(() => verifyWebhook('stripe', Buffer.from('{}'), {}, disabled)).toThrow();
  });
  it('rejects enabling the development simulator in production', () => {
    expect(() => loadConfig({ NODE_ENV: 'production', COMMERCE_MODE: 'development' })).toThrow();
  });
});

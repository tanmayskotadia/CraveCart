import { createHmac } from 'node:crypto';
import { z } from 'zod';
import type { Config } from '@cravecart/config';
import type { Gateway, PayableOrder } from '@cravecart/contracts';
import { HttpError, equal, hash } from '@cravecart/platform';

export interface CaptureProof {
  paymentRef: string;
  amountMinor: number;
  currency: 'INR';
}
export interface ProviderCheckout {
  providerId: string;
  checkoutUrl: string | null;
  publicKey: string | null;
}
export interface ProviderRefund {
  id: string;
  state: 'PENDING' | 'PROCESSED' | 'FAILED';
  amountMinor: number;
  paymentRef: string;
  currency: 'INR';
}
const identifier = z
  .string()
  .regex(/^[A-Za-z0-9_]+$/)
  .max(180);
const metadata = z.record(z.string(), z.unknown());
const object = z.record(z.string(), z.unknown());
function mismatch(message = 'The provider resource does not match the stored payment') {
  throw new HttpError(409, 'PROVIDER_MISMATCH', message);
}
export function gatewayCapabilities(config: Config) {
  const development =
    config.COMMERCE_MODE === 'development' &&
    config.NODE_ENV !== 'production' &&
    config.DEV_ADAPTERS === 'true';
  return {
    enabled: config.COMMERCE_MODE !== 'disabled',
    mode: config.COMMERCE_MODE,
    development,
    gateways: (config.COMMERCE_MODE === 'disabled'
      ? []
      : development
        ? ['razorpay', 'stripe']
        : [
            ...(config.RAZORPAY_KEY_ID &&
            config.RAZORPAY_KEY_SECRET &&
            config.RAZORPAY_WEBHOOK_SECRET &&
            (config.COMMERCE_MODE !== 'live' || config.RAZORPAY_ACCOUNT_ID)
              ? ['razorpay']
              : []),
            ...(config.STRIPE_SECRET_KEY &&
            config.STRIPE_WEBHOOK_SECRET &&
            (config.COMMERCE_MODE !== 'live' || config.STRIPE_API_VERSION)
              ? ['stripe']
              : []),
          ]) as Gateway[],
  };
}
export class Gateways {
  constructor(
    private config: Config,
    private fetcher: typeof fetch = fetch,
  ) {}
  private async request(
    gateway: Gateway,
    path: string,
    method = 'GET',
    body?: Record<string, string | number | boolean | object>,
    key?: string,
  ) {
    const stripe = gateway === 'stripe',
      url = new URL(path, stripe ? 'https://api.stripe.com' : 'https://api.razorpay.com');
    const headers: Record<string, string> = {
      authorization: stripe
        ? `Bearer ${this.config.STRIPE_SECRET_KEY}`
        : `Basic ${Buffer.from(`${this.config.RAZORPAY_KEY_ID}:${this.config.RAZORPAY_KEY_SECRET}`).toString('base64')}`,
    };
    if (stripe && this.config.STRIPE_API_VERSION)
      headers['Stripe-Version'] = this.config.STRIPE_API_VERSION;
    if (key) headers[stripe ? 'Idempotency-Key' : 'X-Refund-Idempotency'] = key;
    if (body)
      headers['content-type'] = stripe ? 'application/x-www-form-urlencoded' : 'application/json';
    const response = await this.fetcher(url, {
      method,
      headers,
      body: body
        ? stripe
          ? new URLSearchParams(Object.entries(body).map(([key, value]) => [key, String(value)]))
          : JSON.stringify(body)
        : undefined,
      signal: AbortSignal.timeout(10000),
      redirect: 'error',
    });
    if (!response.ok)
      throw new HttpError(
        503,
        'GATEWAY_UNAVAILABLE',
        'The payment provider could not confirm this operation',
        true,
      );
    return object.parse(await response.json());
  }
  private refs(order: PayableOrder) {
    return {
      cravecart_order_id: order.orderId,
      cravecart_attempt_id: order.attemptId,
      cravecart_mode: order.mode,
    };
  }
  private verifyMeta(value: Record<string, unknown>, order: PayableOrder) {
    if (
      value.cravecart_order_id !== order.orderId ||
      value.cravecart_attempt_id !== order.attemptId ||
      value.cravecart_mode !== order.mode
    )
      mismatch();
  }
  private amount(value: Record<string, unknown>, order: PayableOrder, key = 'amount') {
    if (value[key] !== order.amountMinor || String(value.currency).toUpperCase() !== order.currency)
      mismatch();
  }
  async create(order: PayableOrder): Promise<ProviderCheckout> {
    if (order.gateway === 'razorpay') {
      const result = await this.request('razorpay', '/v1/orders', 'POST', {
        amount: order.amountMinor,
        currency: order.currency,
        receipt: order.orderId,
        partial_payment: false,
        notes: this.refs(order),
      });
      this.amount(result, order);
      this.verifyMeta(metadata.parse(result.notes), order);
      if (result.receipt !== order.orderId) mismatch();
      return {
        providerId: identifier.parse(result.id),
        checkoutUrl: null,
        publicKey: this.config.RAZORPAY_KEY_ID!,
      };
    }
    const body: Record<string, string | number | boolean | object> = {
      mode: 'payment',
      'line_items[0][price_data][currency]': 'inr',
      'line_items[0][price_data][unit_amount]': order.amountMinor,
      'line_items[0][price_data][product_data][name]': `CraveCart ${order.orderId.slice(0, 8)}`,
      'line_items[0][quantity]': 1,
      client_reference_id: order.orderId,
      success_url: `${this.config.APP_ORIGIN}/checkout/return?attemptId=${order.attemptId}`,
      cancel_url: `${this.config.APP_ORIGIN}/checkout/return?attemptId=${order.attemptId}&cancelled=1`,
      // Freeze every idempotent parameter. Stripe rejects a retry if expiry changes.
      // The business deadline is at most 30 minutes; this remains under its 24-hour maximum.
      expires_at: Math.floor(Date.parse(order.paymentDeadline) / 1000) + 1801,
    };
    for (const [key, value] of Object.entries(this.refs(order))) {
      body[`metadata[${key}]`] = value;
      body[`payment_intent_data[metadata][${key}]`] = value;
    }
    const result = await this.request(
      'stripe',
      '/v1/checkout/sessions',
      'POST',
      body,
      `checkout-${order.attemptId}`,
    );
    this.verifyStripeSession(result, order);
    const url = new URL(z.string().url().parse(result.url));
    if (url.protocol !== 'https:' || url.hostname !== 'checkout.stripe.com')
      mismatch('Provider checkout URL is not allowed');
    return { providerId: identifier.parse(result.id), checkoutUrl: url.href, publicKey: null };
  }
  private verifyStripeSession(value: Record<string, unknown>, order: PayableOrder) {
    this.amount(value, order, 'amount_total');
    this.verifyMeta(metadata.parse(value.metadata), order);
    if (value.client_reference_id !== order.orderId || value.livemode !== (order.mode === 'live'))
      mismatch();
  }
  async verifyReference(order: PayableOrder, providerId: string) {
    identifier.parse(providerId);
    const value = await this.request(
      order.gateway,
      order.gateway === 'razorpay'
        ? `/v1/orders/${encodeURIComponent(providerId)}`
        : `/v1/checkout/sessions/${encodeURIComponent(providerId)}`,
    );
    if (order.gateway === 'stripe') this.verifyStripeSession(value, order);
    else {
      this.amount(value, order);
      this.verifyMeta(metadata.parse(value.notes), order);
      if (value.receipt !== order.orderId) mismatch();
    }
    return value;
  }
  async captures(order: PayableOrder, providerId: string): Promise<CaptureProof[]> {
    const value = await this.verifyReference(order, providerId);
    if (order.gateway === 'razorpay') {
      const payments = await this.request(
          'razorpay',
          `/v1/orders/${encodeURIComponent(providerId)}/payments`,
        ),
        items = z.array(object).parse(payments.items);
      return items
        .filter((payment) => payment.status === 'captured')
        .map((payment) => {
          this.amount(payment, order);
          if (payment.order_id !== providerId) mismatch();
          return {
            paymentRef: identifier.parse(payment.id),
            amountMinor: order.amountMinor,
            currency: 'INR',
          };
        });
    }
    if (!value.payment_intent) return [];
    const id = identifier.parse(
        typeof value.payment_intent === 'string'
          ? value.payment_intent
          : object.parse(value.payment_intent).id,
      ),
      intent = await this.request('stripe', `/v1/payment_intents/${encodeURIComponent(id)}`);
    this.amount(intent, order);
    this.verifyMeta(metadata.parse(intent.metadata), order);
    if (intent.livemode !== (order.mode === 'live')) mismatch();
    if (intent.status !== 'succeeded') return [];
    if (intent.amount_received !== order.amountMinor || value.payment_status !== 'paid') mismatch();
    return [{ paymentRef: id, amountMinor: order.amountMinor, currency: 'INR' }];
  }
  verifyReturn(providerId: string, paymentId: string, signature: string) {
    identifier.parse(paymentId);
    if (
      !this.config.RAZORPAY_KEY_SECRET ||
      !equal(
        createHmac('sha256', this.config.RAZORPAY_KEY_SECRET)
          .update(`${providerId}|${paymentId}`)
          .digest('hex'),
        signature,
      )
    )
      throw new HttpError(
        401,
        'INVALID_PAYMENT_SIGNATURE',
        'The payment return could not be verified',
      );
  }
  async refund(gateway: Gateway, paymentRef: string, amountMinor: number, refundId: string) {
    identifier.parse(paymentRef);
    const value = await this.request(
      gateway,
      gateway === 'stripe'
        ? '/v1/refunds'
        : `/v1/payments/${encodeURIComponent(paymentRef)}/refund`,
      'POST',
      gateway === 'stripe'
        ? {
            payment_intent: paymentRef,
            amount: amountMinor,
            'metadata[cravecart_refund_id]': refundId,
          }
        : { amount: amountMinor, speed: 'normal', notes: { cravecart_refund_id: refundId } },
      `refund-${refundId}`,
    );
    return this.normalizeRefund(gateway, value, paymentRef, amountMinor);
  }
  async fetchRefund(gateway: Gateway, providerId: string, paymentRef: string, amountMinor: number) {
    identifier.parse(providerId);
    return this.normalizeRefund(
      gateway,
      await this.request(
        gateway,
        gateway === 'stripe'
          ? `/v1/refunds/${encodeURIComponent(providerId)}`
          : `/v1/refunds/${encodeURIComponent(providerId)}`,
      ),
      paymentRef,
      amountMinor,
    );
  }
  private normalizeRefund(
    gateway: Gateway,
    value: Record<string, unknown>,
    paymentRef: string,
    amountMinor: number,
  ): ProviderRefund {
    if (
      value.amount !== amountMinor ||
      (gateway === 'stripe' ? value.payment_intent : value.payment_id) !== paymentRef ||
      (value.currency && String(value.currency).toUpperCase() !== 'INR')
    )
      mismatch('The provider refund does not match its authorization');
    const status = z.string().parse(value.status),
      state =
        gateway === 'stripe'
          ? status === 'succeeded'
            ? 'PROCESSED'
            : ['failed', 'canceled'].includes(status)
              ? 'FAILED'
              : 'PENDING'
          : status === 'processed'
            ? 'PROCESSED'
            : status === 'failed'
              ? 'FAILED'
              : 'PENDING';
    return { id: identifier.parse(value.id), state, amountMinor, paymentRef, currency: 'INR' };
  }
  async expire(order: PayableOrder, providerId: string) {
    if (order.gateway === 'stripe') {
      const value = await this.verifyReference(order, providerId);
      if (value.status === 'open')
        await this.request(
          'stripe',
          `/v1/checkout/sessions/${encodeURIComponent(providerId)}/expire`,
          'POST',
          {},
          `expire-${order.attemptId}`,
        );
    }
  }
}
export interface WebhookHint {
  eventId: string;
  type: string;
  attemptId?: string;
  providerId?: string;
  paymentRef?: string;
  refundRef?: string;
  bodyHash: string;
}
export function verifyWebhook(
  gateway: Gateway,
  raw: Buffer,
  headers: Record<string, string | undefined>,
  config: Config,
  now = Date.now(),
): WebhookHint {
  if (config.COMMERCE_MODE === 'disabled' || config.COMMERCE_MODE === 'development')
    throw new HttpError(
      503,
      'WEBHOOK_DISABLED',
      'External webhooks are disabled in this environment',
    );
  const secret =
    gateway === 'stripe' ? config.STRIPE_WEBHOOK_SECRET : config.RAZORPAY_WEBHOOK_SECRET;
  if (!secret)
    throw new HttpError(503, 'WEBHOOK_UNCONFIGURED', 'Webhook verification is not configured');
  if (gateway === 'razorpay') {
    if (
      !equal(
        createHmac('sha256', secret).update(raw).digest('hex'),
        headers['x-razorpay-signature'] ?? '',
      )
    )
      throw new HttpError(401, 'INVALID_SIGNATURE', 'Webhook signature is invalid');
  } else {
    const entries = (headers['stripe-signature'] ?? '')
        .slice(0, 4096)
        .split(',')
        .map((value) => value.split('=')),
      timestamp = entries.find((value) => value[0] === 't')?.[1];
    if (!timestamp || !/^\d{10}$/.test(timestamp) || Math.abs(now / 1000 - Number(timestamp)) > 300)
      throw new HttpError(401, 'INVALID_SIGNATURE', 'Webhook signature is invalid or expired');
    const expected = createHmac('sha256', secret).update(`${timestamp}.`).update(raw).digest('hex');
    if (!entries.some((value) => value[0] === 'v1' && equal(value[1] ?? '', expected)))
      throw new HttpError(401, 'INVALID_SIGNATURE', 'Webhook signature is invalid');
  }
  let payload: Record<string, unknown>;
  try {
    payload = object.parse(JSON.parse(raw.toString('utf8')));
  } catch {
    throw new HttpError(400, 'INVALID_EVENT', 'Webhook payload is invalid');
  }
  if (gateway === 'stripe') {
    if (payload.livemode !== (config.COMMERCE_MODE === 'live') || payload.account)
      throw new HttpError(
        400,
        'ACCOUNT_MISMATCH',
        'This event belongs to an unsupported account or environment',
      );
    const data = object.parse(object.parse(payload.data).object),
      meta = data.metadata ? object.parse(data.metadata) : {},
      attempt = z.string().uuid().safeParse(meta.cravecart_attempt_id),
      id = identifier.parse(data.id);
    return {
      eventId: identifier.parse(payload.id),
      type: z.string().max(100).parse(payload.type),
      ...(attempt.success ? { attemptId: attempt.data } : {}),
      ...(id.startsWith('cs_') ? { providerId: id } : {}),
      ...(id.startsWith('pi_') ? { paymentRef: id } : {}),
      ...(id.startsWith('re_') ? { refundRef: id } : {}),
      bodyHash: hash(raw),
    };
  }
  if (config.RAZORPAY_ACCOUNT_ID && payload.account_id !== config.RAZORPAY_ACCOUNT_ID)
    throw new HttpError(400, 'ACCOUNT_MISMATCH', 'Webhook account does not match');
  const entities = object.parse(payload.payload),
    payment = entities.payment ? object.parse(object.parse(entities.payment).entity) : {},
    refund = entities.refund ? object.parse(object.parse(entities.refund).entity) : {},
    order = entities.order ? object.parse(object.parse(entities.order).entity) : {},
    providerId = payment.order_id ?? order.id,
    paymentRef = payment.id ?? refund.payment_id;
  return {
    eventId: z
      .string()
      .regex(/^[A-Za-z0-9_-]{1,180}$/)
      .parse(headers['x-razorpay-event-id']),
    type: z.string().max(100).parse(payload.event),
    ...(providerId ? { providerId: identifier.parse(providerId) } : {}),
    ...(paymentRef ? { paymentRef: identifier.parse(paymentRef) } : {}),
    ...(refund.id ? { refundRef: identifier.parse(refund.id) } : {}),
    bodyHash: hash(raw),
  };
}

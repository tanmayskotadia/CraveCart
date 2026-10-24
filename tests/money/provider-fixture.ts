import { randomUUID } from 'node:crypto';
import type { Gateway } from '@cravecart/contracts';
// In-memory provider HTTP boundary; the application still runs its real adapters and reducers.
export function providerFixture() {
  let dropCreation = false;
  const resources = new Map<string, Record<string, unknown>>(),
    captured = new Set<string>(),
    refundKeys = new Map<string, Record<string, unknown>>();
  const requests: Array<{ path: string; method: string; idempotency: string | undefined }> = [];
  const fetcher: typeof fetch = async (input, init) => {
    const url = new URL(String(input)),
      gateway: Gateway = url.hostname === 'api.stripe.com' ? 'stripe' : 'razorpay',
      path = url.pathname,
      method = init?.method ?? 'GET',
      headers = init?.headers as Record<string, string>;
    const idempotency = headers['Idempotency-Key'] ?? headers['X-Refund-Idempotency'];
    requests.push({ path, method, idempotency });
    if (method === 'POST' && (path === '/v1/orders' || path === '/v1/checkout/sessions')) {
      const body =
        gateway === 'stripe'
          ? Object.fromEntries(new URLSearchParams(String(init?.body)))
          : JSON.parse(String(init?.body));
      const existing = idempotency
        ? [...resources.values()].find((r) => r.fixtureKey === idempotency)
        : undefined;
      if (existing) {
        if (existing.fixturePayload !== String(init?.body))
          throw new Error('Provider idempotency parameters changed');
        return Response.json(existing);
      }
      const id = (gateway === 'stripe' ? 'cs_test_' : 'order_') + randomUUID().replaceAll('-', '');
      const metadata =
        gateway === 'stripe'
          ? {
              cravecart_order_id: body['metadata[cravecart_order_id]'],
              cravecart_attempt_id: body['metadata[cravecart_attempt_id]'],
              cravecart_mode: 'test',
            }
          : body.notes;
      const value =
        gateway === 'stripe'
          ? {
              id,
              fixtureKey: idempotency,
              fixturePayload: String(init?.body),
              amount_total: Number(body['line_items[0][price_data][unit_amount]']),
              currency: 'inr',
              metadata,
              client_reference_id: body.client_reference_id,
              livemode: false,
              url: 'https://checkout.stripe.com/c/pay/fixture',
              payment_intent: 'pi_' + id.slice(8),
              status: 'open',
              payment_status: 'unpaid',
            }
          : {
              id,
              amount: body.amount,
              currency: body.currency,
              notes: metadata,
              receipt: body.receipt,
            };
      resources.set(id, value);
      if (dropCreation) {
        dropCreation = false;
        throw new Error('Injected lost provider response');
      }
      return Response.json(value);
    }
    if (method === 'POST' && (path === '/v1/refunds' || path.endsWith('/refund'))) {
      if (!idempotency) throw new Error('Refund lacks stable idempotency');
      const prior = refundKeys.get(idempotency);
      if (prior) return Response.json(prior);
      const body =
        gateway === 'stripe'
          ? Object.fromEntries(new URLSearchParams(String(init?.body)))
          : JSON.parse(String(init?.body));
      const value = {
        id: (gateway === 'stripe' ? 're_' : 'rfnd_') + randomUUID().replaceAll('-', ''),
        amount: Number(body.amount),
        currency: 'INR',
        ...(gateway === 'stripe'
          ? { payment_intent: body.payment_intent }
          : { payment_id: path.split('/')[3] }),
        status: gateway === 'stripe' ? 'succeeded' : 'processed',
      };
      refundKeys.set(idempotency, value);
      resources.set(value.id, value);
      return Response.json(value);
    }
    const id = path.split('/').at(-1)!;
    if (path.includes('/payment_intents/')) {
      const session = [...resources.values()].find((r) => r.payment_intent === id);
      if (!session) throw new Error('Unknown payment intent');
      return Response.json({
        id,
        amount: session.amount_total,
        amount_received: captured.has(String(session.id)) ? session.amount_total : 0,
        currency: 'inr',
        metadata: session.metadata,
        livemode: false,
        status: captured.has(String(session.id)) ? 'succeeded' : 'processing',
      });
    }
    if (path.endsWith('/payments')) {
      const ownerId = path.split('/')[3]!,
        resource = resources.get(ownerId);
      if (!resource) throw new Error('Unknown provider order');
      return Response.json({
        items: [
          {
            id: 'pay_' + ownerId.slice(6),
            order_id: ownerId,
            amount: resource.amount,
            currency: 'INR',
            status: captured.has(ownerId) ? 'captured' : 'authorized',
          },
        ],
      });
    }
    if (path.endsWith('/expire')) {
      const resource = resources.get(path.split('/').at(-2)!)!;
      resource.status = 'expired';
      return Response.json(resource);
    }
    const resource = resources.get(id);
    if (!resource) throw new Error(`Unexpected provider request ${method} ${path}`);
    return Response.json(resource);
  };
  return {
    fetcher,
    requests,
    loseNextCreation() {
      dropCreation = true;
    },
    capture(id: string) {
      captured.add(id);
      const resource = resources.get(id)!;
      if (id.startsWith('cs_')) {
        resource.payment_status = 'paid';
        resource.status = 'complete';
      }
    },
    payment(id: string) {
      return id.startsWith('cs_') ? 'pi_' + id.slice(8) : 'pay_' + id.slice(6);
    },
    resources,
  };
}

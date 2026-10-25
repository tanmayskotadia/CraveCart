import { useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import type {
  Order,
  Quote,
  PaymentAttempt,
  Refund,
  Gateway,
  Totals,
  Address,
  ReorderPreview,
  FinancialApproval,
} from '@cravecart/contracts';
import { api } from '../api';
import { WorkspaceShell, ErrorNotice } from '../components/WorkspaceShell';
import { Field, money } from '../components/CatalogFields';
import type { CartState } from './Catalog';
import { useSession } from '../components/SessionProvider';

type Capabilities = { enabled: boolean; development: boolean; mode: string; gateways: Gateway[] };
const key = () => ({ 'Idempotency-Key': crypto.randomUUID() });
function Environment({ mode }: { mode: string }) {
  return mode !== 'live' ? (
    <p className="commerce-banner" role="status">
      {mode === 'development'
        ? 'Development checkout · simulated payments only. No real money is charged. Use coordinated test deliveries only.'
        : mode === 'test'
          ? 'Payment gateway sandbox · test payments only. Use coordinated test deliveries only.'
          : 'Checkout is currently unavailable.'}
    </p>
  ) : null;
}
function Bill({ totals }: { totals: Totals }) {
  return (
    <dl className="commerce-bill">
      {[
        ['Items subtotal', totals.subtotalMinor],
        ['Offer discount', -totals.discountMinor],
        ['Delivery fee', totals.deliveryFeeMinor],
        ['Platform fee', totals.platformFeeMinor],
        [totals.taxLabel, totals.taxMinor],
        ['Rider tip', totals.tipMinor],
        ['Total', totals.totalMinor],
      ].map(([label, value]) => (
        <div key={label}>
          <dt>{label}</dt>
          <dd>{money(Number(value))}</dd>
        </div>
      ))}
    </dl>
  );
}
export function CheckoutPage() {
  const navigate = useNavigate();
  const cart = useQuery({ queryKey: ['cart'], queryFn: () => api<CartState>('/cart') });
  const caps = useQuery({
    queryKey: ['payment-capabilities'],
    queryFn: () => api<Capabilities>('/payments/capabilities'),
  });
  const [quote, setQuote] = useState<Quote>();
  const [policiesAccepted, setPoliciesAccepted] = useState(false);
  const [offerCode, setOffer] = useState('');
  const [tipMinor, setTip] = useState(0);
  const [gateway, setGateway] = useState<Gateway>('razorpay');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>();
  const [orderKey, setOrderKey] = useState(key);
  async function review() {
    setBusy(true);
    setError(undefined);
    setQuote(undefined);
    setPoliciesAccepted(false);
    try {
      const current = await cart.refetch();
      if (!current.data?.cart)
        throw new Error('Your cart is empty. Add a dish before checking out.');
      setQuote(
        await api<Quote>('/quotes', {
          method: 'POST',
          body: {
            cartVersion: current.data.version,
            ...(offerCode.trim() ? { offerCode: offerCode.trim() } : {}),
            tipMinor,
          },
        }),
      );
      setOrderKey(key());
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }
  async function place() {
    if (!quote) return;
    if (Date.parse(quote.expiresAt) <= Date.now()) {
      setError(new Error('This quote expired. Review the final total again.'));
      return;
    }
    setBusy(true);
    setError(undefined);
    try {
      const order = await api<Order>('/orders', {
        method: 'POST',
        headers: orderKey,
        body: {
          quoteId: quote.id,
          gateway,
          ...(quote.policies?.length
            ? { acceptedPolicyIds: quote.policies.map((policy) => policy.id) }
            : {}),
        },
      });
      navigate(`/orders/${order.id}`);
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }
  return (
    <WorkspaceShell title="Checkout" description="Your food, your address, every charge in view.">
      <ErrorNotice error={error ?? cart.error ?? caps.error} />
      {caps.data && <Environment mode={caps.data.mode} />}
      {!cart.isPending && !cart.data?.cart && (
        <p>
          Your cart is empty. <Link to="/">Find something delicious</Link>
        </p>
      )}
      {cart.data?.cart && (
        <div className="cart-layout">
          <div className="workspace-panel">
            <h2>{cart.data.cart.restaurantName}</h2>
            <p>Stock is reserved only when you continue to payment.</p>
            <Field label="Offer code">
              <input
                className="form-input"
                value={offerCode}
                onChange={(e) => {
                  setOffer(e.target.value);
                  setQuote(undefined);
                }}
              />
            </Field>
            <Field label="Rider tip">
              <select
                className="form-input"
                value={tipMinor}
                onChange={(e) => {
                  setTip(Number(e.target.value));
                  setQuote(undefined);
                }}
              >
                {[0, 2000, 3000, 5000].map((n) => (
                  <option key={n} value={n}>
                    {money(n)}
                  </option>
                ))}
              </select>
            </Field>
            <button
              className="outline-button"
              disabled={busy || !caps.data?.enabled}
              onClick={() => void review()}
            >
              Review final total
            </button>
            <p>
              <Link to="/cart">Edit dishes or delivery address</Link>
            </p>
            {quote && (
              <>
                <h3>Deliver to {quote.address.label}</h3>
                <p>
                  {quote.address.street}, {quote.address.city} · {quote.address.pincode}
                </p>
                {quote.lines.map((line, i) => (
                  <div className="cart-line" key={i}>
                    <span>
                      {line.quantity} × {line.name}
                      <small>{line.selection.join(' · ')}</small>
                    </span>
                    <strong>{money(line.unitPriceMinor * line.quantity)}</strong>
                  </div>
                ))}
                {quote.warnings.map((w) => (
                  <p className="small-help" key={w}>
                    {w}
                  </p>
                ))}
              </>
            )}
          </div>
          <aside className="workspace-panel cart-summary">
            <h2>Payment summary</h2>
            {quote ? (
              <>
                <Bill totals={quote.totals} />
                <p className="small-help">
                  Quote valid until {new Date(quote.expiresAt).toLocaleTimeString('en-IN')}. Changed
                  prices or availability require a fresh review.
                </p>
                <fieldset className="commerce-methods">
                  <legend>Payment gateway</legend>
                  {caps.data?.gateways.map((g) => (
                    <label key={g}>
                      <input
                        type="radio"
                        name="gateway"
                        checked={gateway === g}
                        onChange={() => setGateway(g)}
                      />
                      {g === 'razorpay' ? 'Razorpay' : 'Stripe'}
                    </label>
                  ))}
                </fieldset>
                <button
                  className="red-button"
                  disabled={
                    busy ||
                    !caps.data?.gateways.includes(gateway) ||
                    Boolean(quote.policies?.length && !policiesAccepted)
                  }
                  onClick={() => void place()}
                >
                  Continue to payment · {money(quote.totals.totalMinor)}
                </button>
                <p className="small-help">Your order remains pending until payment is verified.</p>
                {Boolean(quote.policies?.length) && (
                  <div>
                    <label className="check-label">
                      <input
                        type="checkbox"
                        checked={policiesAccepted}
                        onChange={(event) => setPoliciesAccepted(event.target.checked)}
                      />
                      I accept the published checkout policies
                    </label>
                    <ul>
                      {quote.policies?.map((policy) => (
                        <li key={policy.id}>
                          <Link
                            target="_blank"
                            rel="noopener noreferrer"
                            to={`/legal/${policy.kind}?revision=${policy.id}`}
                          >
                            {policy.kind} · version {policy.version}
                          </Link>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </>
            ) : (
              <p>Review your final total to see offers, fees and taxes before payment.</p>
            )}
          </aside>
        </div>
      )}
    </WorkspaceShell>
  );
}

type RazorpayInstance = { open(): void; on(name: string, callback: () => void): void };
type RazorpayConstructor = new (options: Record<string, unknown>) => RazorpayInstance;
let sdk: Promise<void> | undefined;
async function razorpaySdk() {
  sdk ??= new Promise<void>((resolve, reject) => {
    const script = document.createElement('script');
    script.src = 'https://checkout.razorpay.com/v1/checkout.js';
    script.onload = () => resolve();
    script.onerror = () => {
      script.remove();
      sdk = undefined;
      reject(new Error('Could not load secure checkout. Please retry.'));
    };
    document.head.append(script);
  });
  await sdk;
  const constructor = (window as unknown as { Razorpay?: RazorpayConstructor }).Razorpay;
  if (!constructor) throw new Error('Secure checkout is unavailable');
  return constructor;
}
function PaymentControls({ order, refresh }: { order: Order; refresh: () => Promise<unknown> }) {
  const [attempt, setAttempt] = useState<PaymentAttempt>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>();
  const [attemptKey] = useState(key);
  async function verify(body = {}) {
    try {
      setAttempt(
        await api<PaymentAttempt>(`/payments/attempts/${order.attemptId}/verify`, {
          method: 'POST',
          body,
        }),
      );
      await refresh();
    } catch (e) {
      setError(e);
    }
  }
  async function pay() {
    setBusy(true);
    setError(undefined);
    try {
      const current = await api<PaymentAttempt>('/payments/attempts', {
        method: 'POST',
        body: { orderId: order.id },
        headers: attemptKey,
      });
      setAttempt(current);
      if (current.state !== 'READY' || current.mode === 'development') return;
      if (current.gateway === 'stripe') {
        const url = new URL(current.checkoutUrl ?? '');
        if (url.protocol !== 'https:' || url.hostname !== 'checkout.stripe.com')
          throw new Error('Payment URL could not be verified');
        window.location.assign(url.href);
      } else {
        const Razorpay = await razorpaySdk();
        const checkout = new Razorpay({
          key: current.publicKey,
          order_id: current.providerId,
          amount: current.amountMinor,
          currency: current.currency,
          name: 'CraveCart',
          handler: (result: { razorpay_payment_id: string; razorpay_signature: string }) =>
            void verify({
              paymentId: result.razorpay_payment_id,
              signature: result.razorpay_signature,
            }),
          modal: {
            ondismiss: () => {
              setError(
                new Error(
                  'Checkout closed. Your order is pending until the server verifies a captured payment.',
                ),
              );
              void refresh();
            },
          },
        });
        checkout.on('payment.failed', () => {
          setError(
            new Error(
              'The gateway reported a payment failure. Check the order status before trying again.',
            ),
          );
          void refresh();
        });
        checkout.open();
      }
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }
  async function simulate(outcome: string) {
    setBusy(true);
    setError(undefined);
    try {
      setAttempt(
        await api<PaymentAttempt>(`/payments/attempts/${order.attemptId}/simulate`, {
          method: 'POST',
          body: { outcome },
        }),
      );
      await refresh();
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="commerce-payment">
      <ErrorNotice error={error} />
      <p>Payment deadline: {new Date(order.paymentDeadline).toLocaleString('en-IN')}</p>
      <button
        className="red-button"
        disabled={busy || attempt?.reconciliationRequired}
        onClick={() => void pay()}
      >
        Continue payment with {order.gateway === 'razorpay' ? 'Razorpay' : 'Stripe'}
      </button>
      {attempt?.mode === 'development' && attempt.state === 'READY' && (
        <div className="confirm-inline">
          <p>Local payment simulator. No money will be charged.</p>
          <button className="red-button" disabled={busy} onClick={() => void simulate('captured')}>
            Simulate successful payment
          </button>
          <button
            className="outline-button"
            disabled={busy}
            onClick={() => void simulate('failed')}
          >
            Simulate declined payment
          </button>
        </div>
      )}
      {attempt?.state === 'CAPTURED' && (
        <p role="status">
          Payment captured. We are checking order placement; please do not pay again.
        </p>
      )}
      {attempt?.lastError && (
        <p role="status">
          {attempt.reconciliationRequired
            ? 'The provider result is uncertain. We are checking it; avoid creating another payment.'
            : attempt.lastError}
        </p>
      )}
      <button className="text-link" disabled={busy} onClick={() => void refresh()}>
        Refresh order status
      </button>
    </div>
  );
}
export function OrdersPage({ admin = false }: { admin?: boolean }) {
  const query = useQuery({
    queryKey: ['orders', admin],
    queryFn: () => api<Order[]>(admin ? '/admin/orders' : '/orders'),
    refetchInterval: 10000,
  });
  return (
    <WorkspaceShell
      role={admin ? 'admin' : 'customer'}
      title={admin ? 'Orders' : 'Your orders'}
      description={
        admin
          ? 'Current environment · most recent 100 orders.'
          : 'Every craving, with a clear payment trail.'
      }
    >
      <ErrorNotice error={query.error} />
      {query.isPending && <p role="status">Loading orders…</p>}
      {query.data?.length === 0 && (
        <div className="catalog-empty">
          <h2>Your first order starts with a craving.</h2>
          <Link className="red-button" to="/">
            Explore food
          </Link>
        </div>
      )}
      {query.data?.map((order) => (
        <article className="workspace-panel commerce-order" key={order.id}>
          <Environment mode={order.quote.mode} />
          {!admin && (
            <div className="button-row">
              <Link to={`/support?orderId=${order.id}`}>Contact support</Link>
              <Link to={`/assistant?orderId=${order.id}`}>Ask about this order</Link>
              <Link to={`/orders/${order.id}/messages`}>Delivery conversation</Link>
              {order.status === 'DELIVERED' && (
                <Link to={`/orders/${order.id}/review`}>Review your meal</Link>
              )}
            </div>
          )}
          <div className="panel-title-row">
            <h2>{order.quote.restaurant.name}</h2>
            <strong>{money(order.quote.totals.totalMinor)}</strong>
          </div>
          <p>
            {order.number} · {new Date(order.createdAt).toLocaleString('en-IN')}
          </p>
          <p>
            {order.status.replaceAll('_', ' ')} · {order.paymentState.replaceAll('_', ' ')}
          </p>
          <Link className="text-link" to={`${admin ? '/admin' : ''}/orders/${order.id}`}>
            View order
          </Link>
        </article>
      ))}
    </WorkspaceShell>
  );
}
function ReorderPanel({ order }: { order: Order }) {
  const navigate = useNavigate();
  const addresses = useQuery({
    queryKey: ['addresses'],
    queryFn: () => api<Address[]>('/addresses'),
  });
  const [addressId, setAddress] = useState('');
  const [preview, setPreview] = useState<ReorderPreview>();
  const [confirmed, setConfirmed] = useState(false);
  const [replace, setReplace] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>();
  const [command, setCommand] = useState(key);
  const selected =
    addressId ||
    addresses.data?.find((address) => address.id === order.quote.address.id)?.id ||
    addresses.data?.find((address) => address.isDefault)?.id ||
    '';
  return (
    <form
      className="workspace-panel"
      onSubmit={(event) => {
        event.preventDefault();
        setBusy(true);
        setError(undefined);
        void (async () => {
          try {
            if (!preview) {
              const value = await api<ReorderPreview>(`/orders/${order.id}/reorder/preview`, {
                method: 'POST',
                body: { addressId: selected },
              });
              setPreview(value);
              setConfirmed(false);
              setReplace(false);
              setCommand(key());
            } else {
              await api(`/orders/${order.id}/reorder/confirm`, {
                method: 'POST',
                headers: command,
                body: { previewId: preview.id, expectedCartVersion: preview.cartVersion, replace },
              });
              navigate('/cart');
            }
          } catch (cause) {
            setError(cause);
          } finally {
            setBusy(false);
          }
        })();
      }}
    >
      <h2>Order these dishes again</h2>
      <p>
        Review today’s availability and prices before adding the same selections to your cart.
        Checkout calculates current fees, offers and payment separately.
      </p>
      <ErrorNotice error={error ?? addresses.error} />
      <Field label="Reorder delivery address">
        <select
          className="form-input"
          value={selected}
          disabled={busy || Boolean(preview)}
          onChange={(event) => setAddress(event.target.value)}
        >
          <option value="">Choose an address</option>
          {addresses.data?.map((address) => (
            <option key={address.id} value={address.id}>
              {address.label} · {address.street}
            </option>
          ))}
        </select>
      </Field>
      <Link className="inline-link" to="/addresses">
        Manage delivery addresses
      </Link>
      {preview && (
        <>
          {preview.lines.map((line, index) => (
            <div className="cart-line" key={index}>
              <span>
                {line.quantity} × {line.name}
                <small>{line.selection.join(' · ')}</small>
              </span>
              <strong>{money(line.quantity * line.unitPriceMinor)}</strong>
            </div>
          ))}
          <p>
            Current items subtotal: <strong>{money(preview.subtotalMinor)}</strong>
          </p>
          {preview.issues.map((issue) => (
            <p className="small-help" key={issue}>
              {issue}
            </p>
          ))}
          {preview.replacesCart && (
            <label className="check-label">
              <input
                type="checkbox"
                checked={replace}
                onChange={(event) => setReplace(event.target.checked)}
              />
              Replace the items already in my cart
            </label>
          )}
          <label className="check-label">
            <input
              type="checkbox"
              checked={confirmed}
              onChange={(event) => setConfirmed(event.target.checked)}
            />
            I reviewed the current selections and prices
          </label>
          <button
            className="text-link"
            type="button"
            disabled={busy}
            onClick={() => {
              setPreview(undefined);
              setError(undefined);
            }}
          >
            Change address or refresh prices
          </button>
        </>
      )}
      <p>
        <button
          className="red-button"
          disabled={
            busy ||
            !selected ||
            Boolean(preview && (!confirmed || (preview.replacesCart && !replace)))
          }
        >
          {busy ? 'Checking…' : preview ? 'Confirm reorder to cart' : 'Review reorder'}
        </button>
      </p>
      <Link className="inline-link" to={`/restaurants/${order.quote.restaurant.slug}`}>
        Browse the current menu
      </Link>
    </form>
  );
}

export function OrderPage({ admin = false }: { admin?: boolean }) {
  const { session } = useSession();
  const { orderId } = useParams();
  const query = useQuery({
    queryKey: ['order', orderId, admin],
    queryFn: () => api<Order>(`${admin ? '/admin' : ''}/orders/${orderId}`),
    refetchInterval: 3000,
  });
  const refunds = useQuery({
    queryKey: ['refunds', orderId],
    queryFn: () => api<Refund[]>(`/refunds?orderId=${orderId}`),
    enabled: !admin,
    refetchInterval: 5000,
  });
  const [preview, setPreview] = useState<{
    allowed: boolean;
    expectedVersion: number;
    refundAmountMinor: number;
    message: string;
  }>();
  const [reason, setReason] = useState('');
  const [amount, setAmount] = useState('');
  const [error, setError] = useState<unknown>();
  const [busy, setBusy] = useState(false);
  const [commandKey, setCommandKey] = useState(key);
  const [approvalNotice, setApprovalNotice] = useState('');
  async function cancel() {
    setBusy(true);
    setError(undefined);
    try {
      await api(`/orders/${orderId}/cancel`, {
        method: 'POST',
        headers: commandKey,
        body: { expectedVersion: preview?.expectedVersion, reason },
      });
      setPreview(undefined);
      setCommandKey(key());
      await query.refetch();
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }
  const order = query.data;
  return (
    <WorkspaceShell
      role={admin ? 'admin' : 'customer'}
      title={order ? `Order ${order.number}` : 'Order details'}
    >
      <ErrorNotice error={error ?? query.error} />
      {order && (
        <>
          <Environment mode={order.quote.mode} />
          {!admin && ['DELIVERED', 'CANCELLED', 'REJECTED', 'EXPIRED'].includes(order.status) && (
            <ReorderPanel key={order.id} order={order} />
          )}
          <div className="cart-layout">
            <div className="workspace-panel">
              <h2>{order.quote.restaurant.name}</h2>
              <p className="commerce-status" role="status">
                {order.status.replaceAll('_', ' ')} · {order.paymentState.replaceAll('_', ' ')}
              </p>
              {order.status === 'PLACED' && (
                <p>
                  Payment verified. Follow kitchen preparation and your assigned rider on the
                  tracking page.
                </p>
              )}
              {order.status === 'PAYMENT_PENDING' && !admin && (
                <PaymentControls order={order} refresh={query.refetch} />
              )}
              {!admin && order.status !== 'PAYMENT_PENDING' && (
                <p>
                  <Link className="red-button" to={`/orders/${order.id}/track`}>
                    Track your food
                  </Link>
                </p>
              )}
              <h3>Order timeline</h3>
              <ol className="commerce-timeline">
                {order.timeline.map((entry, i) => (
                  <li key={i}>
                    <strong>{entry.status.replaceAll('_', ' ')}</strong>
                    <p>{entry.message}</p>
                    <time>{new Date(entry.at).toLocaleString('en-IN')}</time>
                  </li>
                ))}
              </ol>
              <h3>Deliver to {order.quote.address.label}</h3>
              <p>
                {order.quote.address.street}, {order.quote.address.city} ·{' '}
                {order.quote.address.pincode}
              </p>
              {order.quote.lines.map((line, i) => (
                <div className="cart-line" key={i}>
                  <span>
                    {line.quantity} × {line.name}
                    <small>{line.selection.join(' · ')}</small>
                  </span>
                  <strong>{money(line.unitPriceMinor * line.quantity)}</strong>
                </div>
              ))}
            </div>
            <aside className="workspace-panel cart-summary">
              <h2>Payment receipt</h2>
              <p>
                {order.gateway} · {order.quote.mode}
              </p>
              <Bill totals={order.quote.totals} />
              <p>
                Refund requested: {money(order.refundRequestedMinor)}
                <br />
                Refund processed: {money(order.refundedMinor)}
              </p>
              <button className="outline-button" onClick={() => window.print()}>
                Print order receipt
              </button>
              {!admin && ['PAYMENT_PENDING', 'PLACED'].includes(order.status) && (
                <button
                  className="text-link"
                  onClick={() => {
                    setError(undefined);
                    void api<typeof preview>(`/orders/${orderId}/cancellation-preview`)
                      .then(setPreview)
                      .catch(setError);
                  }}
                >
                  Review cancellation
                </button>
              )}
              {preview && (
                <div className="confirm-inline">
                  <p>{preview.message}</p>
                  <p>Potential refund: {money(preview.refundAmountMinor)}</p>
                  {preview.allowed && (
                    <>
                      <Field label="Cancellation reason">
                        <textarea
                          className="form-input"
                          value={reason}
                          onChange={(e) => setReason(e.target.value)}
                          maxLength={500}
                        />
                      </Field>
                      <button
                        className="red-button"
                        disabled={busy || reason.trim().length < 5}
                        onClick={() => void cancel()}
                      >
                        Confirm cancellation
                      </button>
                    </>
                  )}
                  <button className="text-link" onClick={() => setPreview(undefined)}>
                    Keep order
                  </button>
                </div>
              )}
              {admin && session?.principal.permissions.includes('finance:write') && (
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    setBusy(true);
                    setError(undefined);
                    void api<{ approval?: FinancialApproval }>(`/admin/orders/${orderId}/refund`, {
                      method: 'POST',
                      headers: commandKey,
                      body: {
                        expectedVersion: order.version,
                        amountMinor: Math.round(Number(amount) * 100),
                        reason,
                      },
                    })
                      .then(async (result) => {
                        setApprovalNotice(
                          result.approval
                            ? 'Refund request saved. A different authorized finance account must approve it before funds are authorized.'
                            : 'Refund authorized. Gateway processing is tracked separately.',
                        );
                        setCommandKey(key());
                        await query.refetch();
                      })
                      .catch(setError)
                      .finally(() => setBusy(false));
                  }}
                >
                  {order.status === 'READY_FOR_PICKUP' && (
                    <div>
                      <button
                        className="outline-button"
                        type="button"
                        disabled={busy || reason.trim().length < 5}
                        onClick={() => {
                          setBusy(true);
                          void api(`/admin/orders/${order.id}/dispatch/retry`, {
                            method: 'POST',
                            body: { reason },
                          })
                            .then(() => query.refetch())
                            .catch(setError)
                            .finally(() => setBusy(false));
                        }}
                      >
                        Retry rider search
                      </button>
                      <p className="small-help">
                        Enter an operator reason below and verify your authenticator before
                        restarting dispatch.
                      </p>
                    </div>
                  )}
                  <h3>Authorize refund</h3>
                  {approvalNotice && (
                    <p role="status">
                      {approvalNotice} <Link to="/admin/finance">Open financial approvals</Link>
                    </p>
                  )}
                  <p className="small-help">
                    Requires a fresh authenticator check. Amount cannot exceed the remaining
                    captured balance. Requests meeting the cumulative approval threshold wait for a
                    second finance account.
                  </p>
                  <Field label="Refund amount in rupees">
                    <input
                      className="form-input"
                      type="number"
                      min="0.01"
                      step="0.01"
                      value={amount}
                      onChange={(e) => setAmount(e.target.value)}
                      required
                    />
                  </Field>
                  <Field label="Refund reason">
                    <textarea
                      className="form-input"
                      minLength={5}
                      maxLength={500}
                      value={reason}
                      onChange={(e) => setReason(e.target.value)}
                      required
                    />
                  </Field>
                  <button className="red-button" disabled={busy}>
                    Request refund authorization
                  </button>
                </form>
              )}
            </aside>
          </div>
          {!admin && (
            <div className="workspace-panel">
              <h2>Refund activity</h2>
              <ErrorNotice error={refunds.error} />
              {refunds.data?.map((refund) => (
                <p key={refund.id}>
                  {money(refund.amountMinor)} · {refund.state} · {refund.reason}
                </p>
              ))}
              {refunds.data?.length === 0 && <p>No refunds requested.</p>}
            </div>
          )}
        </>
      )}
    </WorkspaceShell>
  );
}
export function PaymentReturnPage() {
  const [search] = useSearchParams();
  const id = search.get('attemptId');
  const valid = !!id && /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(id);
  const [error, setError] = useState<unknown>();
  const [busy, setBusy] = useState(false);
  const query = useQuery({
    queryKey: ['payment-return', id],
    queryFn: () => api<PaymentAttempt>(`/payments/attempts/${id}`),
    enabled: valid,
    refetchInterval: 3000,
  });
  return (
    <WorkspaceShell title="Checking your payment">
      <ErrorNotice error={error ?? query.error} />
      {!valid && (
        <p>
          Payment reference is missing or invalid. <Link to="/orders">View your orders</Link>
        </p>
      )}
      {query.data && (
        <>
          <Environment mode={query.data.mode} />
          <p role="status">
            Server payment status: {query.data.state}. A browser return alone does not confirm
            payment.
          </p>
          {query.data.gateway === 'stripe' && (
            <button
              className="red-button"
              disabled={busy}
              onClick={() => {
                setBusy(true);
                void api(`/payments/attempts/${id}/verify`, { method: 'POST', body: {} })
                  .then(() => query.refetch())
                  .catch(setError)
                  .finally(() => setBusy(false));
              }}
            >
              Verify with payment provider
            </button>
          )}
          <p>
            <Link to={`/orders/${query.data.orderId}`}>View order status</Link>
          </p>
        </>
      )}
    </WorkspaceShell>
  );
}

import { useEffect, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import type { FulfillmentSnapshot, DeliveryOffer } from '@cravecart/contracts';
import { api } from '../api';
import { WorkspaceShell, ErrorNotice } from '../components/WorkspaceShell';
import { Field } from '../components/CatalogFields';
import {
  useDelivery,
  DeliveryMap,
  SoundControl,
  NotificationInbox,
  PushControl,
  navigationUrl,
} from '../components/DeliveryLive';
const headers = () => ({ 'Idempotency-Key': crypto.randomUUID() });
export function SellerOrdersPage() {
  const { restaurantId, orderId } = useParams();
  const [error, setError] = useState<unknown>(),
    [busy, setBusy] = useState(false),
    [reason, setReason] = useState(''),
    [minutes, setMinutes] = useState(25);
  const query = useQuery({
    queryKey: ['seller-orders', restaurantId, orderId],
    queryFn: async () =>
      orderId
        ? [await api<FulfillmentSnapshot>(`/seller/restaurants/${restaurantId}/orders/${orderId}`)]
        : api<FulfillmentSnapshot[]>(`/seller/restaurants/${restaurantId}/orders`),
    refetchInterval: 3000,
  });
  async function action(snapshot: FulfillmentSnapshot, name: string) {
    setBusy(true);
    setError(undefined);
    try {
      await api(`/seller/restaurants/${restaurantId}/orders/${snapshot.orderId}/actions`, {
        method: 'POST',
        headers: headers(),
        body: {
          expectedVersion: snapshot.version,
          action: name,
          ...(name === 'accept' ? { preparationMinutes: minutes } : {}),
          ...(name === 'reject' ? { reason } : {}),
        },
      });
      await query.refetch();
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }
  return (
    <WorkspaceShell
      role="seller"
      title={orderId ? 'Order details' : 'Incoming orders'}
      description="A live kitchen board, from a paid order to a verified handover."
    >
      <div className="button-row">
        <Link className="text-link" to={`/seller/restaurants/${restaurantId}/menu`}>
          Manage menu
        </Link>
        <SoundControl ids={query.data?.map((o) => `${o.orderId}:${o.version}`) ?? []} />
      </div>
      <ErrorNotice error={error ?? query.error} />
      {query.isPending && <p role="status">Loading orders…</p>}
      {query.data?.length === 0 && (
        <div className="catalog-empty">
          <h2>Your kitchen is ready.</h2>
          <p>Verified paid orders for this restaurant appear here.</p>
        </div>
      )}
      {query.data?.map((o) => (
        <article className="workspace-panel kitchen-order" key={o.orderId}>
          <div className="panel-title-row">
            <h2>{o.number}</h2>
            <span className="status-badge">{o.status.replaceAll('_', ' ')}</span>
          </div>
          <p>
            {o.paymentState.replaceAll('_', ' ')} · {o.restaurantName}
          </p>
          {o.items.map((item, i) => (
            <div className="cart-line" key={i}>
              <strong>
                {item.quantity} × {item.name}
              </strong>
              <span>{item.selection.join(' · ')}</span>
            </div>
          ))}
          <p>
            Rider:{' '}
            {o.assignment?.riderName ??
              (o.dispatchState === 'NO_RIDER'
                ? 'No rider found — operator attention needed'
                : 'Waiting for assignment')}
          </p>
          {o.pickupCode && (
            <div className="verification-code">
              <span>Restaurant pickup code</span>
              <strong>{o.pickupCode}</strong>
              <p>Share this only when handing the packed food to the assigned rider.</p>
            </div>
          )}
          <div className="button-row">
            {o.status === 'PLACED' && (
              <>
                <Field label="Preparation time in minutes">
                  <input
                    className="form-input"
                    type="number"
                    min={5}
                    max={120}
                    value={minutes}
                    onChange={(e) => setMinutes(Number(e.target.value))}
                  />
                </Field>
                <button
                  className="red-button"
                  disabled={busy}
                  onClick={() => void action(o, 'accept')}
                >
                  Accept order
                </button>
              </>
            )}
            {o.status === 'ACCEPTED' && (
              <button
                className="red-button"
                disabled={busy}
                onClick={() => void action(o, 'preparing')}
              >
                Start preparing
              </button>
            )}
            {['ACCEPTED', 'PREPARING'].includes(o.status) && (
              <button
                className="red-button"
                disabled={busy}
                onClick={() => void action(o, 'ready')}
              >
                Mark ready for pickup
              </button>
            )}
            {o.status === 'READY_FOR_PICKUP' && (
              <button
                className="outline-button"
                disabled={busy}
                onClick={() => void action(o, 'renew-pickup-code')}
              >
                Renew pickup code
              </button>
            )}
          </div>
          {['PLACED', 'ACCEPTED', 'PREPARING', 'READY_FOR_PICKUP'].includes(o.status) && (
            <details>
              <summary>Unable to fulfill this order?</summary>
              <Field label="Rejection reason">
                <textarea
                  className="form-input"
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  maxLength={500}
                />
              </Field>
              <button
                className="outline-button"
                disabled={busy || reason.trim().length < 5}
                onClick={() => void action(o, 'reject')}
              >
                Reject and request refund
              </button>
            </details>
          )}
          {!orderId && (
            <Link
              className="text-link"
              to={`/seller/restaurants/${restaurantId}/orders/${o.orderId}`}
            >
              Open order
            </Link>
          )}
        </article>
      ))}
    </WorkspaceShell>
  );
}
export function CustomerTrackingPage() {
  const { orderId } = useParams();
  const query = useDelivery(orderId);
  const [error, setError] = useState<unknown>();
  const o = query.data;
  return (
    <WorkspaceShell
      title="Follow your food"
      description="From the kitchen to your doorstep, with each step confirmed."
    >
      <ErrorNotice error={error ?? query.error} />
      {!o && query.isPending && <p role="status">Loading your delivery…</p>}
      {o && (
        <>
          {o.mode !== 'live' && (
            <p className="commerce-banner">
              {o.mode === 'development' ? 'Development simulator' : 'Gateway sandbox'} order. No
              live payment was collected.
            </p>
          )}
          <p className="small-help">
            {query.live ? 'Live updates connected' : 'Checking for order updates'}
          </p>
          <div className="cart-layout">
            <div className="workspace-panel">
              <h2>{o.restaurantName}</h2>
              <div className="button-row">
                <Link to={`/orders/${o.orderId}/messages`}>Message delivery partner</Link>
                <Link to={`/support?orderId=${o.orderId}`}>Get support</Link>
              </div>
              <p className="commerce-status" role="status">
                {o.status.replaceAll('_', ' ')}
              </p>
              {o.preparationMinutes && (
                <p>
                  Kitchen preparation estimate: {o.preparationMinutes} minutes. This is not a
                  delivery ETA.
                </p>
              )}
              {o.assignment && (
                <p>
                  Your delivery partner: <strong>{o.assignment.riderName}</strong>
                </p>
              )}
              {o.dispatchState === 'NO_RIDER' && (
                <p className="commerce-banner">
                  A rider has not been found. The restaurant and operator can review dispatch; no
                  delivery ETA is promised.
                </p>
              )}
              {o.deliveryCode && (
                <div className="verification-code">
                  <span>Your delivery code</span>
                  <strong>{o.deliveryCode}</strong>
                  <p>Share only after receiving your food from the assigned delivery partner.</p>
                </div>
              )}
              {['PICKED_UP', 'OUT_FOR_DELIVERY'].includes(o.status) && (
                <button
                  className="text-link"
                  onClick={() =>
                    void api(`/orders/${o.orderId}/delivery-code`, {
                      method: 'POST',
                      headers: headers(),
                      body: { expectedVersion: o.version },
                    })
                      .then(() => query.refetch())
                      .catch(setError)
                  }
                >
                  Renew delivery code
                </button>
              )}
              <ol className="commerce-timeline">
                {o.timeline.map((event, i) => (
                  <li key={i}>
                    <strong>{event.status.replaceAll('_', ' ')}</strong>
                    <p>{event.message}</p>
                    <time>{new Date(event.at).toLocaleString('en-IN')}</time>
                  </li>
                ))}
              </ol>
              <Link className="text-link" to={`/orders/${o.orderId}`}>
                Receipt, payment and cancellation
              </Link>
            </div>
            <aside className="workspace-panel">
              <h2>Delivery map</h2>
              <DeliveryMap snapshot={o} />
              {o.assignment && (
                <p role="status">
                  {o.trackingStale
                    ? 'Rider location is unavailable or stale. The map does not imply a live position.'
                    : `Rider location updated ${new Date(o.latestLocation!.receivedAt).toLocaleTimeString('en-IN')} · accuracy ±${Math.round(o.latestLocation!.accuracy)} m`}
                </p>
              )}
              {o.status === 'DELIVERED' && <p>Delivered. Rider-location sharing has ended.</p>}
            </aside>
          </div>
        </>
      )}
    </WorkspaceShell>
  );
}
interface Task {
  id: string;
  orderId: string;
  state: string;
  status: string;
  restaurantName: string;
}
interface Operation {
  id: string;
  state: string;
  error: string | null;
  taskId: string;
}
function operationMessage(code: string | null) {
  return (
    (
      {
        INVALID_PROOF: 'The verification code is incorrect. Ask for the current code.',
        PROOF_EXPIRED:
          'The code expired or was locked. Ask the restaurant or customer to renew it.',
        ORDER_CHANGED: 'The order changed. Review the latest status before trying again.',
        ASSIGNMENT_REVOKED: 'This assignment is no longer active.',
        OWNER_CONFIRMATION_PENDING: 'Waiting for confirmation from the order service.',
      } as Record<string, string>
    )[code ?? ''] ?? 'Review the current delivery status before trying again.'
  );
}
export function RiderDeliveriesPage() {
  const { deliveryId } = useParams();
  const [error, setError] = useState<unknown>(),
    [busy, setBusy] = useState(false),
    [city, setCity] = useState('chennai'),
    [sharing, setSharing] = useState(false),
    [gps, setGps] = useState('Location sharing is off.'),
    [code, setCode] = useState(''),
    [reason, setReason] = useState(''),
    [operation, setOperation] = useState<Operation>();
  const watch = useRef<number | null>(null),
    sequence = useRef(0),
    lastSent = useRef(0),
    sending = useRef(false);
  const availability = useQuery({
    queryKey: ['rider-availability'],
    queryFn: () =>
      api<{ online: boolean; busy: boolean; city: string; streamId: string | null }>(
        '/rider/availability',
      ),
    refetchInterval: 10000,
  });
  const offers = useQuery({
    queryKey: ['rider-offers'],
    queryFn: () => api<DeliveryOffer[]>('/rider/offers'),
    refetchInterval: 4000,
  });
  const tasks = useQuery({
    queryKey: ['rider-deliveries'],
    queryFn: () => api<Task[]>('/rider/deliveries'),
    refetchInterval: 4000,
  });
  const task = useQuery({
    queryKey: ['rider-delivery', deliveryId],
    queryFn: () =>
      api<{ task: Task; snapshot: FulfillmentSnapshot | null }>(`/rider/deliveries/${deliveryId}`),
    enabled: !!deliveryId,
    refetchInterval: 3000,
  });
  const progress = useQuery({
    queryKey: ['rider-operation', operation?.id],
    queryFn: () => api<Operation>(`/rider/operations/${operation!.id}`),
    enabled: operation?.state === 'PENDING',
    refetchInterval: 2000,
  });
  const currentOp = progress.data ?? operation;
  const pending = currentOp?.state === 'PENDING';
  useEffect(
    () => () => {
      if (watch.current !== null) navigator.geolocation.clearWatch(watch.current);
    },
    [],
  );
  async function startSharing() {
    setError(undefined);
    try {
      if (!navigator.geolocation) throw new Error('GPS is not available on this device.');
      const value = await api<{ streamId: string }>('/rider/availability', {
        method: 'POST',
        body: { online: true, city },
      });
      setSharing(true);
      setGps('Waiting for an accurate GPS fix…');
      if (watch.current !== null) navigator.geolocation.clearWatch(watch.current);
      sequence.current = 0;
      watch.current = navigator.geolocation.watchPosition(
        (position) => {
          if (sending.current || Date.now() - lastSent.current < 4000) return;
          if (position.coords.accuracy > 100) {
            setGps('GPS accuracy is too low. Move to an open area before accepting offers.');
            return;
          }
          sending.current = true;
          lastSent.current = Date.now();
          void api('/rider/location', {
            method: 'POST',
            body: {
              streamId: value.streamId,
              sequence: ++sequence.current,
              capturedAt: new Date(position.timestamp).toISOString(),
              point: { latitude: position.coords.latitude, longitude: position.coords.longitude },
              accuracy: position.coords.accuracy,
            },
          })
            .then(() =>
              setGps(
                `Location shared at ${new Date().toLocaleTimeString('en-IN')}; keep this page open.`,
              ),
            )
            .catch((e) => {
              setError(e);
              setGps('Location update failed. Offers and tracking may become stale.');
            })
            .finally(() => {
              sending.current = false;
            });
        },
        () => {
          setGps(
            'GPS permission denied or unavailable. Enable precise location to receive offers.',
          );
          setSharing(false);
        },
        { enableHighAccuracy: true, maximumAge: 0, timeout: 15000 },
      );
      await availability.refetch();
    } catch (e) {
      setError(e);
    }
  }
  async function perform(path: string, body: unknown) {
    setBusy(true);
    setError(undefined);
    try {
      const result = await api<Operation>(path, { method: 'POST', headers: headers(), body });
      setOperation(result);
      await tasks.refetch();
      await offers.refetch();
      await task.refetch();
      if (result.state === 'REJECTED') setError(new Error(operationMessage(result.error)));
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }
  const snapshot = task.data?.snapshot;
  return (
    <WorkspaceShell
      role="rider"
      title={deliveryId ? 'Your delivery' : 'Delivery partner'}
      description="Real tasks, verified handovers, and clear navigation."
    >
      <ErrorNotice
        error={error ?? availability.error ?? offers.error ?? tasks.error ?? task.error}
      />
      <div className="workspace-panel">
        <div className="panel-title-row">
          <h2>{availability.data?.online ? 'You are online' : 'You are offline'}</h2>
          <SoundControl ids={offers.data?.map((o) => o.id) ?? []} />
        </div>
        <p>{gps}</p>
        <p className="small-help">
          Foreground tracking only. Keep this page open and the screen awake during delivery;
          background or screen-off tracking is not guaranteed.
        </p>
        <Field label="Your delivery city">
          <select className="form-input" value={city} onChange={(e) => setCity(e.target.value)}>
            {[
              'chennai',
              'mumbai',
              'delhi',
              'bengaluru',
              'hyderabad',
              'kochi',
              'pune',
              'kolkata',
              'ahmedabad',
              'jaipur',
              'chandigarh',
              'lucknow',
              'indore',
              'surat',
              'coimbatore',
              'panaji',
              'bhubaneswar',
              'thiruvananthapuram',
            ].map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </Field>
        <div className="button-row">
          <button
            className="red-button"
            disabled={busy || sharing}
            onClick={() => void startSharing()}
          >
            Go online and share location
          </button>
          <button
            className="outline-button"
            disabled={busy || availability.data?.busy}
            onClick={() => {
              setBusy(true);
              void api('/rider/availability', { method: 'POST', body: { online: false, city } })
                .then(async () => {
                  if (watch.current !== null) navigator.geolocation.clearWatch(watch.current);
                  setSharing(false);
                  setGps('Location sharing is off.');
                  await availability.refetch();
                })
                .catch(setError)
                .finally(() => setBusy(false));
            }}
          >
            Go offline
          </button>
        </div>
      </div>
      {currentOp && (
        <p className="commerce-banner" role="status">
          Action{' '}
          {currentOp.state === 'APPLIED'
            ? 'confirmed'
            : currentOp.state === 'REJECTED'
              ? 'not applied'
              : 'awaiting confirmation'}
          {currentOp.error ? `: ${operationMessage(currentOp.error)}` : ''}.{' '}
          {pending ? 'Waiting for the order service to confirm; do not repeat the action.' : ''}
        </p>
      )}
      {!deliveryId && (
        <>
          <h2>Delivery offers</h2>
          {offers.data?.length === 0 && (
            <p>No open offers. Stay online with an accurate location to receive nearby tasks.</p>
          )}
          {offers.data?.map((offer) => (
            <article className="workspace-panel" key={offer.id}>
              <h3>{offer.restaurantName}</h3>
              <p>
                {(offer.distanceMeters / 1000).toFixed(1)} km straight-line distance to pickup ·
                expires {new Date(offer.expiresAt).toLocaleTimeString('en-IN')}
              </p>
              <div className="button-row">
                <button
                  className="red-button"
                  disabled={busy || pending}
                  onClick={() => void perform(`/rider/offers/${offer.id}/accept`, {})}
                >
                  Accept delivery
                </button>
                <button
                  className="outline-button"
                  disabled={busy || pending}
                  onClick={() =>
                    void api(`/rider/offers/${offer.id}/decline`, { method: 'POST', body: {} })
                      .then(() => offers.refetch())
                      .catch(setError)
                  }
                >
                  Decline offer
                </button>
              </div>
            </article>
          ))}
          <h2>Your deliveries</h2>
          {tasks.data?.map((t) => (
            <article className="workspace-panel" key={t.id}>
              <h3>{t.restaurantName}</h3>
              <p>
                {t.state} · {t.status}
              </p>
              <Link className="text-link" to={`/rider/deliveries/${t.id}`}>
                Open delivery
              </Link>
            </article>
          ))}
        </>
      )}
      {snapshot && (
        <div className="workspace-panel">
          <h2>{snapshot.restaurantName}</h2>
          <div className="button-row">
            <Link to={`/orders/${snapshot.orderId}/messages`}>Message customer</Link>
            <Link to={`/support?orderId=${snapshot.orderId}`}>Contact support</Link>
          </div>
          <p className="commerce-status">{snapshot.status.replaceAll('_', ' ')}</p>
          <DeliveryMap snapshot={snapshot} />
          <p>Pickup: {snapshot.pickup.address}</p>
          <a
            className="red-button"
            href={navigationUrl(
              ['PICKED_UP', 'OUT_FOR_DELIVERY'].includes(snapshot.status) && snapshot.dropoff
                ? snapshot.dropoff.point
                : snapshot.pickup.point,
            )}
            target="_blank"
            rel="noopener noreferrer"
          >
            Open navigation to{' '}
            {['PICKED_UP', 'OUT_FOR_DELIVERY'].includes(snapshot.status)
              ? 'customer'
              : 'restaurant'}
          </a>
          {snapshot.dropoff && (
            <div>
              <h3>Delivery address</h3>
              <p>
                {snapshot.dropoff.recipient} · {snapshot.dropoff.street},{' '}
                {snapshot.dropoff.apartment}
              </p>
              <p>
                {snapshot.dropoff.landmark} · {snapshot.dropoff.instructions}
              </p>
              <a className="text-link" href={`tel:+91${snapshot.dropoff.phone}`}>
                Call customer
              </a>
            </div>
          )}
          <div className="button-row">
            {['ACCEPTED', 'PREPARING', 'READY_FOR_PICKUP'].includes(snapshot.status) &&
              !snapshot.assignment?.arrived && (
                <button
                  className="outline-button"
                  disabled={busy || pending}
                  onClick={() =>
                    void perform(`/rider/deliveries/${deliveryId}/arrive`, {
                      expectedVersion: snapshot.version,
                    })
                  }
                >
                  I’ve arrived at restaurant
                </button>
              )}
            {snapshot.status === 'PICKED_UP' && (
              <button
                className="red-button"
                disabled={busy || pending}
                onClick={() =>
                  void perform(`/rider/deliveries/${deliveryId}/depart`, {
                    expectedVersion: snapshot.version,
                  })
                }
              >
                Start delivery
              </button>
            )}
          </div>
          {['READY_FOR_PICKUP', 'PICKED_UP', 'OUT_FOR_DELIVERY'].includes(snapshot.status) && (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                void perform(
                  `/rider/deliveries/${deliveryId}/${snapshot.status === 'READY_FOR_PICKUP' ? 'pickup' : 'complete'}`,
                  { expectedVersion: snapshot.version, code },
                );
              }}
            >
              <Field
                label={
                  snapshot.status === 'READY_FOR_PICKUP'
                    ? 'Pickup code from restaurant'
                    : 'Delivery code from customer'
                }
              >
                <input
                  className="form-input"
                  inputMode="numeric"
                  autoComplete="off"
                  pattern="[0-9]{6}"
                  maxLength={6}
                  value={code}
                  onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
                  required
                />
              </Field>
              <button className="red-button" disabled={busy || pending || code.length !== 6}>
                {snapshot.status === 'READY_FOR_PICKUP'
                  ? 'Verify food pickup'
                  : 'Verify delivery completion'}
              </button>
            </form>
          )}
          <details>
            <summary>Report a delivery problem</summary>
            <Field label="Incident details">
              <textarea
                className="form-input"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                maxLength={1000}
              />
            </Field>
            <button
              className="outline-button"
              disabled={busy || reason.trim().length < 5}
              onClick={() =>
                void api(`/rider/deliveries/${deliveryId}/incidents`, {
                  method: 'POST',
                  headers: headers(),
                  body: { reason },
                })
                  .then(() => setReason(''))
                  .catch(setError)
              }
            >
              Submit incident for review
            </button>
            <p>
              Reporting an incident does not mark delivery complete or automatically reassign food
              in transit.
            </p>
          </details>
        </div>
      )}
      {deliveryId && task.data && !snapshot && (
        <div className="workspace-panel">
          <h2>{task.data.task.status}</h2>
          <p>
            Task state: {task.data.task.state}. Private delivery details are no longer exposed after
            a task ends.
          </p>
          <Link to="/rider/dashboard">Back to deliveries</Link>
        </div>
      )}
    </WorkspaceShell>
  );
}
export function NotificationsPage() {
  return (
    <WorkspaceShell
      title="Notifications"
      description="Important order and delivery updates, kept in one place."
    >
      <PushControl />
      <NotificationInbox />
    </WorkspaceShell>
  );
}

export function DeliveryOperationsPage() {
  const query = useQuery({
    queryKey: ['delivery-operations'],
    queryFn: () =>
      api<{
        tasks: Task[];
        pending: Array<Operation & { orderId: string; attempts: number }>;
        incidents: Array<{ _id: string; orderId: string; reason: string; createdAt: string }>;
      }>('/admin/delivery-operations'),
    refetchInterval: 5000,
  });
  const [reason, setReason] = useState(''),
    [error, setError] = useState<unknown>(),
    [busy, setBusy] = useState(false);
  async function act(path: string) {
    setBusy(true);
    setError(undefined);
    try {
      await api(path, { method: 'POST', body: { reason } });
      await query.refetch();
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }
  return (
    <WorkspaceShell
      role="admin"
      title="Delivery operations"
      description="Active tasks, uncertain commands and rider-reported incidents. No automatic completion or in-transit reassignment."
    >
      <ErrorNotice error={error ?? query.error} />
      <div className="workspace-panel">
        <Field label="Operator action reason">
          <textarea
            className="form-input"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            minLength={5}
            maxLength={500}
          />
        </Field>
        <p className="small-help">
          Actions require a fresh authenticator check and an audited reason.
        </p>
      </div>
      <h2>Active deliveries</h2>
      {query.data?.tasks.map((t) => (
        <article className="workspace-panel" key={t.id}>
          <h3>{t.restaurantName}</h3>
          <p>
            {t.state} · {t.status}
          </p>
          <Link to={`/admin/orders/${t.orderId}`}>View order</Link>
        </article>
      ))}
      <h2>Pending confirmations</h2>
      {query.data?.pending.map((op) => (
        <article className="workspace-panel" key={op.id}>
          <p>
            {op.id} · {op.attempts} attempts · {op.error}
          </p>
          <button
            className="outline-button"
            disabled={busy || reason.trim().length < 5}
            onClick={() => void act(`/admin/delivery-operations/${op.id}/retry`)}
          >
            Retry original command
          </button>
        </article>
      ))}
      <h2>Open incidents</h2>
      {query.data?.incidents.map((incident) => (
        <article className="workspace-panel" key={incident._id}>
          <p>{incident.reason}</p>
          <Link to={`/admin/orders/${incident.orderId}`}>View order</Link>
          <p>
            <button
              className="outline-button"
              disabled={busy || reason.trim().length < 5}
              onClick={() => void act(`/admin/delivery-incidents/${incident._id}/resolve`)}
            >
              Record incident resolution
            </button>
          </p>
        </article>
      ))}
      {query.data?.incidents.length === 0 && <p>No open incidents.</p>}
    </WorkspaceShell>
  );
}

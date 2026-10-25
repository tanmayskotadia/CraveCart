import { useEffect, useRef, useState } from 'react';
import { io, type Socket } from 'socket.io-client';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import type { FulfillmentSnapshot, DeliveryNotification } from '@cravecart/contracts';
import { api } from '../api';
import { ErrorNotice } from './WorkspaceShell';
import { useSession } from './SessionProvider';
import 'leaflet/dist/leaflet.css';
export function useDelivery(orderId: string | undefined) {
  const [live, setLive] = useState(false),
    [pushed, setPushed] = useState<{ snapshot: FulfillmentSnapshot; receivedAt: number }>();
  const query = useQuery({
    queryKey: ['tracking', orderId],
    queryFn: () => api<FulfillmentSnapshot>(`/orders/${orderId}/tracking`),
    enabled: !!orderId,
    refetchInterval: live ? 15000 : 5000,
  });
  useEffect(() => {
    if (!orderId) return;
    let disposed = false;
    let socket: Socket | undefined;
    let retry: ReturnType<typeof setTimeout> | undefined;
    const connect = async () => {
      try {
        const { ticket } = await api<{ ticket: string }>('/realtime/tickets', {
          method: 'POST',
          body: {},
        });
        if (disposed) return;
        socket = io(
          import.meta.env.VITE_REALTIME_ORIGIN ??
            (import.meta.env.DEV ? 'http://localhost:4005' : window.location.origin),
          { transports: ['websocket'], auth: { ticket }, reconnection: false },
        );
        socket.on('connect', () => {
          socket?.emit('delivery:subscribe', { orderId });
        });
        socket.on('delivery:snapshot', (value: FulfillmentSnapshot) => {
          if (value.orderId === orderId) {
            setLive(true);
            setPushed((old) =>
              !old || old.snapshot.orderId !== orderId || value.version >= old.snapshot.version
                ? { snapshot: value, receivedAt: Date.now() }
                : old,
            );
          }
        });
        const reconnect = () => {
          setLive(false);
          socket?.removeAllListeners();
          socket?.disconnect();
          if (!disposed) retry = setTimeout(() => void connect(), 5000);
        };
        socket.on('disconnect', reconnect);
        socket.on('connect_error', reconnect);
        socket.on('delivery:forbidden', () => {
          setLive(false);
          setPushed(undefined);
          socket?.disconnect();
          void query.refetch();
        });
      } catch {
        setLive(false);
        if (!disposed) retry = setTimeout(() => void connect(), 10000);
      }
    };
    void connect();
    return () => {
      disposed = true;
      if (retry) clearTimeout(retry);
      socket?.removeAllListeners();
      socket?.disconnect();
    };
    // Reconnect always mints a new single-use ticket; HTTP snapshots recover missed versions.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orderId]);
  const latestPush = live && pushed?.snapshot.orderId === orderId ? pushed : undefined;
  const data = query.error
    ? undefined
    : latestPush &&
        (!query.data ||
          latestPush.snapshot.version > query.data.version ||
          (latestPush.snapshot.version === query.data.version &&
            latestPush.receivedAt >= query.dataUpdatedAt))
      ? latestPush.snapshot
      : query.data;
  return { ...query, data, live };
}
export function SoundControl({ ids }: { ids: string[] }) {
  const [enabled, setEnabled] = useState(false),
    context = useRef<AudioContext | null>(null),
    seen = useRef(new Set<string>()),
    initialized = useRef(false);
  useEffect(() => {
    const unseen = ids.filter((id) => !seen.current.has(id));
    for (const id of ids) seen.current.add(id);
    if (initialized.current && enabled && unseen.length && context.current) {
      const oscillator = context.current.createOscillator(),
        gain = context.current.createGain();
      oscillator.connect(gain);
      gain.connect(context.current.destination);
      oscillator.frequency.value = 740;
      gain.gain.value = 0.06;
      oscillator.start();
      oscillator.stop(context.current.currentTime + 0.2);
    }
    if (ids.length) initialized.current = true;
  }, [ids, enabled]);
  useEffect(
    () => () => {
      void context.current?.close();
    },
    [],
  );
  return (
    <button
      className="outline-button"
      onClick={() => {
        if (enabled) {
          setEnabled(false);
          return;
        }
        context.current ??= new AudioContext();
        void context.current.resume();
        setEnabled(true);
      }}
    >
      {enabled ? 'Mute sound notifications' : 'Enable sound notifications'}
    </button>
  );
}
export function NotificationInbox() {
  const { session } = useSession();
  const query = useQuery({
    queryKey: ['delivery-notifications', session?.principal.userId],
    queryFn: () => api<DeliveryNotification[]>('/notifications'),
    enabled: !!session,
    refetchInterval: 10000,
  });
  return (
    <>
      <ErrorNotice error={query.error} />
      {query.data?.map((n) => (
        <article className="workspace-panel" key={n.id}>
          <Link to={n.href}>{n.title}</Link>
          <p>{new Date(n.at).toLocaleString('en-IN')}</p>
          {!n.readAt && (
            <button
              className="text-link"
              onClick={() =>
                void api('/notifications/read', { method: 'POST', body: { id: n.id } }).then(() =>
                  query.refetch(),
                )
              }
            >
              Mark read
            </button>
          )}
        </article>
      ))}
      {query.data?.length === 0 && <p>No notifications yet.</p>}
    </>
  );
}
export function DeliveryMap({ snapshot }: { snapshot: FulfillmentSnapshot }) {
  const root = useRef<HTMLDivElement>(null),
    map = useRef<import('leaflet').Map | null>(null),
    markers = useRef<import('leaflet').LayerGroup | null>(null);
  const tile = import.meta.env.VITE_MAP_TILE_URL;
  useEffect(() => {
    let cancelled = false;
    void import('leaflet').then((L) => {
      if (cancelled || !root.current) return;
      map.current = L.map(root.current).setView(
        [snapshot.pickup.point.latitude, snapshot.pickup.point.longitude],
        14,
      );
      if (tile)
        L.tileLayer(tile, {
          attribution:
            import.meta.env.VITE_MAP_ATTRIBUTION ?? 'Map data © OpenStreetMap contributors',
          maxZoom: 19,
        }).addTo(map.current);
      markers.current = L.layerGroup().addTo(map.current);
    });
    return () => {
      cancelled = true;
      map.current?.remove();
      map.current = null;
    };
    // The map is initialized once; markers follow each authorized snapshot below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    let cancelled = false;
    void import('leaflet').then((L) => {
      if (cancelled || !markers.current || !map.current) return;
      markers.current.clearLayers();
      const points: Array<{
        point: { latitude: number; longitude: number };
        label: string;
        color: string;
      }> = [{ point: snapshot.pickup.point, label: 'Restaurant pickup', color: '#ef4f5f' }];
      if (snapshot.dropoff)
        points.push({ point: snapshot.dropoff.point, label: 'Delivery address', color: '#303b60' });
      if (snapshot.latestLocation)
        points.push({
          point: snapshot.latestLocation.point,
          label: snapshot.trackingStale
            ? 'Last reported rider position (stale)'
            : 'Delivery partner',
          color: snapshot.trackingStale ? '#888' : '#248655',
        });
      for (const item of points)
        L.circleMarker([item.point.latitude, item.point.longitude], {
          radius: 9,
          color: item.color,
          fillOpacity: 0.85,
        })
          .bindTooltip(item.label)
          .addTo(markers.current);
      map.current.fitBounds(
        L.latLngBounds(
          points.map((p) => [p.point.latitude, p.point.longitude] as [number, number]),
        ),
        { padding: [35, 35], maxZoom: 16 },
      );
    });
    return () => {
      cancelled = true;
    };
  }, [snapshot]);
  return (
    <>
      <div
        ref={root}
        className="delivery-map"
        aria-label="Restaurant, delivery address and authorized rider position"
      />
      {!tile && (
        <p className="small-help">
          Map tiles are not configured. Position markers and navigation remain available; configure
          a licensed tile provider before launch.
        </p>
      )}
      <p className="small-help">
        The map shows the restaurant, delivery address and the rider’s latest reported location.
      </p>
    </>
  );
}
export function navigationUrl(point: { latitude: number; longitude: number }) {
  const params = new URLSearchParams({
    api: '1',
    destination: `${point.latitude},${point.longitude}`,
    travelmode: 'driving',
  });
  return `https://www.google.com/maps/dir/?${params}`;
}

export function PushControl() {
  const caps = useQuery({
    queryKey: ['push-capabilities'],
    queryFn: () =>
      api<{ enabled: boolean; publicKey: string | null }>('/notifications/push-capabilities'),
  });
  const [error, setError] = useState<unknown>(),
    [busy, setBusy] = useState(false),
    [subscribed, setSubscribed] = useState(false);
  async function enable() {
    setBusy(true);
    setError(undefined);
    try {
      if (
        !('serviceWorker' in navigator) ||
        !('PushManager' in window) ||
        !('Notification' in window)
      )
        throw new Error(
          'This browser does not support push notifications. Use your inbox for updates.',
        );
      if ((await Notification.requestPermission()) !== 'granted')
        throw new Error('Notification permission was not granted. Your inbox remains available.');
      const registration = await navigator.serviceWorker.register('/sw.js');
      await navigator.serviceWorker.ready;
      const encoded = caps.data!.publicKey!.replace(/-/g, '+').replace(/_/g, '/'),
        bytes = Uint8Array.from(atob(encoded + '='.repeat((4 - (encoded.length % 4)) % 4)), (c) =>
          c.charCodeAt(0),
        );
      const subscription =
        (await registration.pushManager.getSubscription()) ??
        (await registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: bytes,
        }));
      const value = subscription.toJSON();
      await api('/notifications/subscriptions', {
        method: 'POST',
        body: { endpoint: subscription.endpoint, keys: value.keys },
      });
      setSubscribed(true);
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }
  async function disable() {
    setBusy(true);
    setError(undefined);
    try {
      const registration = await navigator.serviceWorker.getRegistration(),
        subscription = await registration?.pushManager.getSubscription();
      if (subscription) {
        await subscription.unsubscribe();
        await api('/notifications/subscriptions', {
          method: 'DELETE',
          body: { endpoint: subscription.endpoint },
        });
      }
      setSubscribed(false);
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="workspace-panel">
      <h2>Browser notifications</h2>
      <ErrorNotice error={error ?? caps.error} />
      {caps.data?.enabled ? (
        <button
          className="outline-button"
          disabled={busy}
          onClick={() => void (subscribed ? disable() : enable())}
        >
          {subscribed ? 'Disable browser push' : 'Enable browser push'}
        </button>
      ) : (
        <p>
          Push is unavailable on this deployment. Important updates remain in your notification
          inbox.
        </p>
      )}
      <p className="small-help">
        Push messages contain a generic update. Sign in to see order details. Delivery depends on
        your browser and device settings.
      </p>
    </div>
  );
}

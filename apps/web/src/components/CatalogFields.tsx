import {
  useEffect,
  useRef,
  useState,
  useId,
  isValidElement,
  cloneElement,
  type ReactNode,
} from 'react';
import type { RestaurantInput } from '@cravecart/contracts';
import { api } from '../api';
import 'leaflet/dist/leaflet.css';

export const money = (minor: number) =>
  new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: minor % 100 ? 2 : 0,
  }).format(minor / 100);
export const imageUrl = (image: { imageId: string | null; libraryImage: string }) =>
  image.imageId
    ? `${import.meta.env.VITE_API_ORIGIN ?? ''}/api/v1/media/${image.imageId}`
    : `/images/${image.libraryImage}.webp`;
export function Field({ label, children }: { label: string; children: ReactNode }) {
  const generated = useId();
  const child = isValidElement<{ id?: string }>(children) ? children : null;
  const id = child?.props.id ?? generated;
  return (
    <div className="catalog-field">
      <label htmlFor={id}>{label}</label>
      {child ? cloneElement(child, { id }) : children}
    </div>
  );
}
export function PointFields({
  point,
  onChange,
}: {
  point: { longitude: number; latitude: number };
  onChange: (point: { longitude: number; latitude: number }) => void;
}) {
  const [map, setMap] = useState(false),
    [message, setMessage] = useState('');
  function locate() {
    setMessage('Checking your location…');
    if (!navigator.geolocation) {
      setMessage('Location is unavailable. Enter coordinates manually.');
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (position) => {
        onChange({
          longitude: Number(position.coords.longitude.toFixed(6)),
          latitude: Number(position.coords.latitude.toFixed(6)),
        });
        setMessage('Location found. Check and adjust the pin before saving.');
      },
      () =>
        setMessage(
          'Location permission was denied or unavailable. You can enter coordinates manually.',
        ),
      { timeout: 12000, maximumAge: 60000, enableHighAccuracy: true },
    );
  }
  return (
    <div className="pin-fields">
      <div className="form-grid">
        <Field label="Latitude">
          <input
            className="form-input"
            type="number"
            min="6"
            max="38"
            step="any"
            required
            value={point.latitude || ''}
            onChange={(e) => onChange({ ...point, latitude: Number(e.target.value) })}
          />
        </Field>
        <Field label="Longitude">
          <input
            className="form-input"
            type="number"
            min="68"
            max="98"
            step="any"
            required
            value={point.longitude || ''}
            onChange={(e) => onChange({ ...point, longitude: Number(e.target.value) })}
          />
        </Field>
      </div>
      <div className="button-row">
        <button className="outline-button" type="button" onClick={locate}>
          Use my current location
        </button>
        <button className="text-link" type="button" onClick={() => setMap((value) => !value)}>
          {map ? 'Close map' : 'Choose a pin on the map'}
        </button>
      </div>
      {message && (
        <p role="status" className="small-help">
          {message}
        </p>
      )}
      {map && (
        <>
          <p className="small-help">
            Opening the map requests tiles for this area from the configured map provider. Click the
            map to move your pin. Coordinates also work without map tiles.
          </p>
          <PinMap point={point} onChange={onChange} />
        </>
      )}
    </div>
  );
}
function PinMap({
  point,
  onChange,
}: {
  point: { longitude: number; latitude: number };
  onChange: (point: { longitude: number; latitude: number }) => void;
}) {
  const initialPoint = useRef(point);
  const root = useRef<HTMLDivElement>(null),
    mapRef = useRef<import('leaflet').Map | null>(null),
    marker = useRef<import('leaflet').CircleMarker | null>(null),
    change = useRef(onChange);
  useEffect(() => {
    change.current = onChange;
  }, [onChange]);
  useEffect(() => {
    let active = true;
    void import('leaflet').then((L) => {
      if (!active || !root.current) return;
      const initial = initialPoint.current,
        hasPin = initial.latitude >= 6 && initial.longitude >= 68,
        center: import('leaflet').LatLngTuple = hasPin
          ? [initial.latitude, initial.longitude]
          : [22, 79];
      const map = L.map(root.current).setView(center, hasPin ? 15 : 4);
      mapRef.current = map;
      const tileUrl =
        import.meta.env.VITE_MAP_TILE_URL ??
        (import.meta.env.DEV ? 'https://tile.openstreetmap.org/{z}/{x}/{y}.png' : '');
      if (tileUrl)
        L.tileLayer(tileUrl, {
          maxZoom: 19,
          attribution:
            '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
        }).addTo(map);
      marker.current = L.circleMarker(center, {
        radius: 10,
        color: '#dc2445',
        fillOpacity: 0.8,
      }).addTo(map);
      map.on('click', (event: import('leaflet').LeafletMouseEvent) =>
        change.current({
          latitude: Number(event.latlng.lat.toFixed(6)),
          longitude: Number(event.latlng.lng.toFixed(6)),
        }),
      );
    });
    return () => {
      active = false;
      mapRef.current?.remove();
      mapRef.current = null;
      marker.current = null;
    };
  }, []);
  useEffect(() => {
    if (mapRef.current && point.latitude >= 6 && point.longitude >= 68) {
      marker.current?.setLatLng([point.latitude, point.longitude]);
      mapRef.current.setView(
        [point.latitude, point.longitude],
        Math.max(13, mapRef.current.getZoom()),
      );
    }
  }, [point]);
  return <div className="pin-map" ref={root} aria-label="Delivery pin map" />;
}
export function HoursFields({
  hours,
  onChange,
}: {
  hours: RestaurantInput['hours'];
  onChange: (hours: RestaurantInput['hours']) => void;
}) {
  return (
    <div className="hours-grid">
      {['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'].map(
        (name, day) => {
          const slots = hours.filter((slot) => slot.day === day);
          return (
            <div key={day}>
              <label>
                <input
                  type="checkbox"
                  checked={slots.length > 0}
                  onChange={(e) =>
                    onChange(
                      e.target.checked
                        ? [...hours, { day, openMinute: 600, closeMinute: 1320 }]
                        : hours.filter((slot) => slot.day !== day),
                    )
                  }
                />{' '}
                {name}
              </label>
              {slots.map((slot, index) => (
                <div className="hours-slot" key={index}>
                  {(['openMinute', 'closeMinute'] as const).map((key) => (
                    <input
                      key={key}
                      className="form-input"
                      aria-label={`${name} ${key === 'openMinute' ? 'opens' : 'closes'} ${index + 1}`}
                      type="time"
                      value={`${Math.floor((slot[key] === 1440 ? 0 : slot[key]) / 60)
                        .toString()
                        .padStart(
                          2,
                          '0',
                        )}:${((slot[key] === 1440 ? 0 : slot[key]) % 60).toString().padStart(2, '0')}`}
                      onChange={(e) => {
                        const [h, m] = e.target.value.split(':').map(Number);
                        onChange(
                          hours.map((value) =>
                            value === slot
                              ? {
                                  ...value,
                                  [key]:
                                    key === 'closeMinute' && h === 0 && m === 0
                                      ? 1440
                                      : h! * 60 + m!,
                                }
                              : value,
                          ),
                        );
                      }}
                    />
                  ))}
                  <button
                    className="text-link"
                    type="button"
                    aria-label={`Remove ${name} time slot ${index + 1}`}
                    onClick={() => onChange(hours.filter((value) => value !== slot))}
                  >
                    Remove
                  </button>
                </div>
              ))}
              {slots.length > 0 && slots.length < 3 && (
                <button
                  type="button"
                  className="text-link"
                  onClick={() => onChange([...hours, { day, openMinute: 840, closeMinute: 900 }])}
                >
                  Add time slot
                </button>
              )}
            </div>
          );
        },
      )}
      <p className="small-help">
        India time (IST). Split overnight opening across two days. Time slots must not overlap. A
        closing time of 00:00 means midnight at the end of that day.
      </p>
    </div>
  );
}
export function PhotoField({
  imageId,
  libraryImage,
  onChange,
}: {
  imageId: string | null;
  libraryImage: 'biryani' | 'pizza' | 'indian-feast';
  onChange: (value: {
    imageId: string | null;
    libraryImage: 'biryani' | 'pizza' | 'indian-feast';
  }) => void;
}) {
  const [pending, setPending] = useState(false),
    [error, setError] = useState('');
  async function upload(file: File) {
    setPending(true);
    setError('');
    try {
      const intent = await api<{ uploadId: string; uploadToken: string; url: string }>(
        '/uploads/intents',
        {
          method: 'POST',
          body: { filename: file.name, size: file.size, purpose: 'catalog-image' },
        },
      );
      await api(intent.url.replace('/api/v1', ''), {
        method: 'PUT',
        body: file,
        headers: { 'X-Upload-Token': intent.uploadToken },
      });
      await api(`/uploads/${intent.uploadId}/complete`, { method: 'POST', body: {} });
      onChange({ imageId: intent.uploadId, libraryImage });
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Upload failed');
    } finally {
      setPending(false);
    }
  }
  return (
    <div className="photo-field">
      <Field label="Fallback photograph">
        <select
          className="form-input"
          value={libraryImage}
          onChange={(e) =>
            onChange({ imageId: null, libraryImage: e.target.value as typeof libraryImage })
          }
        >
          <option value="indian-feast">Indian table · illustration</option>
          <option value="biryani">Biryani · illustration</option>
          <option value="pizza">Pizza · illustration</option>
        </select>
      </Field>
      <Field label="Upload your public catalog photograph">
        <input
          type="file"
          accept="image/jpeg,image/png"
          disabled={pending}
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) void upload(file);
            e.target.value = '';
          }}
        />
      </Field>
      <p className="small-help">
        PNG or JPEG, up to 5 MB. Catalog photos become public when saved. Verification documents
        stay private.{' '}
        {imageId ? 'Your photograph is attached.' : 'Library photos are illustrative.'}
      </p>
      {pending && <p role="status">Checking photograph…</p>}
      {error && (
        <p className="form-feedback" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

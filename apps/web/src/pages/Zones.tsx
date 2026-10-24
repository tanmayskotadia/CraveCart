import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { cityDirectory, type ZoneInput } from '@cravecart/contracts';
import { api } from '../api';
import { WorkspaceShell, ErrorNotice } from '../components/WorkspaceShell';
import { Field, HoursFields, PointFields, money } from '../components/CatalogFields';
type Zone = ZoneInput & { id: string; version: number; country: string; updatedAt: string };
export function ZonesPage() {
  const query = useQuery({ queryKey: ['admin-zones'], queryFn: () => api<Zone[]>('/admin/zones') }),
    [selected, setSelected] = useState<Zone>(),
    [editing, setEditing] = useState(false);
  return (
    <WorkspaceShell
      role="admin"
      title="Operating zones"
      description="Delivery opens only inside an active, open polygon shared by the pickup and delivery pins."
    >
      <div className="section-title-row">
        <p>India · all times in IST</p>
        <button
          className="red-button"
          onClick={() => {
            setSelected(undefined);
            setEditing(true);
          }}
        >
          Add a zone
        </button>
      </div>
      <ErrorNotice error={query.error} />
      {query.isPending ? (
        <p role="status">Loading zones…</p>
      ) : (
        <div className="address-grid">
          {query.data?.map((zone) => (
            <article className="workspace-panel" key={zone.id}>
              <div className="panel-title-row">
                <h2>{zone.name}</h2>
                <span className={`status-badge status-${zone.active ? 'approved' : 'draft'}`}>
                  {zone.active ? 'Active' : 'Inactive'}
                </span>
              </div>
              <p>
                {zone.city} · revision {zone.version}
              </p>
              <p>
                {money(zone.deliveryFeeMinor)} delivery fee · {zone.travelMinutesMin}–
                {zone.travelMinutesMax} min configured travel estimate
              </p>
              <button
                className="text-link"
                onClick={() => {
                  setSelected(zone);
                  setEditing(true);
                }}
              >
                Edit zone
              </button>
            </article>
          ))}
        </div>
      )}
      {!query.isPending && !query.error && !query.data?.length && (
        <p>No zones are configured. Delivery checks currently fail closed.</p>
      )}
      {editing && (
        <ZoneForm key={selected?.id ?? 'new'} zone={selected} onDone={() => setEditing(false)} />
      )}
    </WorkspaceShell>
  );
}
function ZoneForm({ zone, onDone }: { zone?: Zone; onDone: () => void }) {
  const [value, setValue] = useState(() =>
      zone
        ? zoneFields(zone)
        : {
            name: '',
            city: '',
            active: false,
            polygon: { type: 'Polygon' as const, coordinates: [[] as Array<[number, number]>] },
            hours: [],
            feePolicyVersion: 1,
            deliveryFeeMinor: 3000,
            travelMinutesMin: 10,
            travelMinutesMax: 25,
          },
    ),
    [points, setPoints] = useState<Array<[number, number]>>(() =>
      zone ? zone.polygon.coordinates[0]!.slice(0, -1) : [],
    ),
    [pin, setPin] = useState({ latitude: 0, longitude: 0 }),
    [reason, setReason] = useState(''),
    [error, setError] = useState<unknown>(),
    [pending, setPending] = useState(false),
    client = useQueryClient();
  async function save() {
    setPending(true);
    setError(undefined);
    try {
      if (points.length < 3) throw new Error('Choose at least three distinct boundary points.');
      await api(`/admin/zones${zone ? `/${zone.id}` : ''}`, {
        method: zone ? 'PATCH' : 'POST',
        body: {
          zone: { ...value, polygon: { type: 'Polygon', coordinates: [[...points, points[0]]] } },
          reason,
          ...(zone ? { expectedVersion: zone.version } : {}),
        },
      });
      await client.invalidateQueries({ queryKey: ['admin-zones'] });
      onDone();
    } catch (error) {
      setError(error);
    } finally {
      setPending(false);
    }
  }
  return (
    <form
      className="workspace-panel catalog-form"
      onSubmit={(e) => {
        e.preventDefault();
        void save();
      }}
    >
      <h2>{zone ? 'Update zone' : 'Create zone'}</h2>
      <div className="form-grid">
        <Field label="Zone name">
          <input
            className="form-input"
            required
            minLength={3}
            maxLength={80}
            value={value.name}
            onChange={(e) => setValue((old) => ({ ...old, name: e.target.value }))}
          />
        </Field>
        <Field label="Zone city">
          <select
            className="form-input"
            required
            value={value.city}
            onChange={(e) => setValue((old) => ({ ...old, city: e.target.value }))}
          >
            <option value="">Choose city</option>
            {cityDirectory.map((city) => (
              <option value={city.slug} key={city.slug}>
                {city.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Delivery fee (₹)">
          <input
            className="form-input"
            required
            type="number"
            min={0}
            max={1000}
            step="0.01"
            value={value.deliveryFeeMinor / 100}
            onChange={(e) =>
              setValue((old) => ({
                ...old,
                deliveryFeeMinor: Math.round(Number(e.target.value) * 100),
              }))
            }
          />
        </Field>
        <Field label="Fee policy version">
          <input
            className="form-input"
            required
            type="number"
            min={1}
            value={value.feePolicyVersion}
            onChange={(e) =>
              setValue((old) => ({ ...old, feePolicyVersion: Number(e.target.value) }))
            }
          />
        </Field>
        {(['travelMinutesMin', 'travelMinutesMax'] as const).map((key) => (
          <Field
            label={
              key === 'travelMinutesMin'
                ? 'Minimum travel estimate (minutes)'
                : 'Maximum travel estimate (minutes)'
            }
            key={key}
          >
            <input
              className="form-input"
              required
              type="number"
              min={1}
              max={180}
              value={value[key]}
              onChange={(e) => setValue((old) => ({ ...old, [key]: Number(e.target.value) }))}
            />
          </Field>
        ))}
      </div>
      <h3>Boundary points</h3>
      <p className="small-help">
        Add points around the delivery area in order. The last point is joined to the first
        automatically. Do not cross boundary lines.
      </p>
      <PointFields point={pin} onChange={setPin} />
      <button
        className="outline-button"
        type="button"
        disabled={!pin.latitude || points.length >= 50}
        onClick={() => setPoints((old) => [...old, [pin.longitude, pin.latitude]])}
      >
        Add this boundary point
      </button>
      <ol className="boundary-list">
        {points.map((point, index) => (
          <li key={index}>
            {point[1]}, {point[0]}{' '}
            <button
              className="text-link"
              type="button"
              onClick={() => setPoints((old) => old.filter((_, i) => i !== index))}
            >
              Remove point {index + 1}
            </button>
          </li>
        ))}
      </ol>
      <HoursFields
        hours={value.hours}
        onChange={(hours) => setValue((old) => ({ ...old, hours }))}
      />
      <label>
        <input
          type="checkbox"
          checked={value.active}
          onChange={(e) => setValue((old) => ({ ...old, active: e.target.checked }))}
        />{' '}
        Activate this operating zone
      </label>
      <Field label="Reason for this change">
        <textarea
          className="form-input"
          required
          minLength={5}
          maxLength={500}
          rows={3}
          value={reason}
          onChange={(e) => setReason(e.target.value)}
        />
      </Field>
      <ErrorNotice error={error} />
      <div className="button-row">
        <button className="red-button" disabled={pending}>
          {pending ? 'Saving…' : 'Save zone'}
        </button>
        <button className="text-link" type="button" onClick={onDone}>
          Cancel
        </button>
      </div>
      <p className="small-help">
        Saving requires the zones permission and an authenticator check within five minutes. Every
        change is audited.
      </p>
    </form>
  );
}
function zoneFields({
  id: _id,
  version: _version,
  country: _country,
  updatedAt: _updatedAt,
  ...zone
}: Zone) {
  return zone;
}

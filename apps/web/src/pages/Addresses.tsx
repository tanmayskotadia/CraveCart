import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { cityDirectory, addressInputSchema, type Address } from '@cravecart/contracts';
import { api } from '../api';
import { useSession } from '../components/SessionProvider';
import { WorkspaceShell, ErrorNotice } from '../components/WorkspaceShell';
import { Field, PointFields } from '../components/CatalogFields';
export function AddressesPage({ edit = false }: { edit?: boolean }) {
  const { session } = useSession(),
    { addressId } = useParams();
  const query = useQuery({
    queryKey: ['addresses', session?.principal.userId],
    queryFn: () => api<Address[]>('/addresses'),
  });
  if (query.isPending)
    return (
      <WorkspaceShell title="Your addresses">
        <p role="status">Loading addresses…</p>
      </WorkspaceShell>
    );
  if (query.error)
    return (
      <WorkspaceShell title="Your addresses">
        <ErrorNotice error={query.error} />
        <button className="outline-button" onClick={() => void query.refetch()}>
          Try again
        </button>
      </WorkspaceShell>
    );
  const existing = query.data.find((address) => address.id === addressId);
  if (edit && addressId && !existing)
    return (
      <WorkspaceShell title="Address unavailable">
        <p>This address does not belong to this account or has been removed.</p>
        <Link to="/addresses">Back to your addresses</Link>
      </WorkspaceShell>
    );
  return edit ? (
    <AddressEditor key={addressId ?? 'new'} address={existing} />
  ) : (
    <AddressList addresses={query.data} />
  );
}
function AddressList({ addresses }: { addresses: Address[] }) {
  const client = useQueryClient(),
    { session } = useSession(),
    [error, setError] = useState<unknown>(),
    [remove, setRemove] = useState(''),
    [pending, setPending] = useState(false);
  async function change(address: Address, deleted = false) {
    setPending(true);
    setError(undefined);
    try {
      const { id, version, ...input } = address;
      await api(`/addresses/${id}`, {
        method: deleted ? 'DELETE' : 'PATCH',
        ...(deleted ? {} : { body: { ...input, isDefault: true, expectedVersion: version } }),
      });
      await client.invalidateQueries({ queryKey: ['addresses', session?.principal.userId] });
      setRemove('');
    } catch (error) {
      setError(error);
    } finally {
      setPending(false);
    }
  }
  return (
    <WorkspaceShell title="Your addresses" description="A precise pin makes all the difference.">
      <div className="panel-title-row">
        <p>Choose a default for browsing and your cart.</p>
        <Link className="red-button" to="/addresses/new">
          Add an address
        </Link>
      </div>
      <ErrorNotice error={error} />
      <div className="address-grid">
        {addresses.map((address) => (
          <article className="workspace-panel" key={address.id}>
            <div className="panel-title-row">
              <h2>{address.label}</h2>
              {address.isDefault && <span className="status-badge status-approved">Default</span>}
            </div>
            <p>
              {address.recipient} · {address.phone}
            </p>
            <p>
              {address.street}
              {address.apartment ? `, ${address.apartment}` : ''}, {address.city} {address.pincode}
            </p>
            {address.landmark && <p className="small-help">Near {address.landmark}</p>}
            <div className="button-row">
              <Link className="text-link" to={`/addresses/${address.id}/edit`}>
                Edit
              </Link>
              {!address.isDefault && (
                <button
                  className="text-link"
                  disabled={pending}
                  onClick={() => void change(address)}
                >
                  Make default
                </button>
              )}
              <button
                className="text-link"
                disabled={pending}
                onClick={() => setRemove(address.id)}
              >
                Remove
              </button>
            </div>
            {remove === address.id && (
              <div className="confirm-inline">
                <p>Remove this saved address?</p>
                <button
                  className="outline-button"
                  disabled={pending}
                  onClick={() => void change(address, true)}
                >
                  Confirm removal
                </button>
                <button className="text-link" onClick={() => setRemove('')}>
                  Keep address
                </button>
              </div>
            )}
          </article>
        ))}
      </div>
      {!addresses.length && (
        <div className="workspace-panel">
          <h2>Where should we bring your favourites?</h2>
          <p>Add your home, work, or any address you love.</p>
        </div>
      )}
    </WorkspaceShell>
  );
}
function AddressEditor({ address }: { address?: Address }) {
  const { session } = useSession(),
    navigate = useNavigate(),
    client = useQueryClient();
  const [value, setValue] = useState(() =>
      address
        ? addressInputSchema.parse(addressInput(address))
        : {
            label: 'Home',
            recipient: session?.principal.name ?? '',
            phone: '',
            city: '',
            street: '',
            apartment: '',
            landmark: '',
            instructions: '',
            pincode: '',
            point: { latitude: 0, longitude: 0 },
            isDefault: false,
          },
    ),
    [error, setError] = useState<unknown>(),
    [pending, setPending] = useState(false),
    [checked, setChecked] = useState('');
  function field<Key extends keyof typeof value>(key: Key, input: (typeof value)[Key]) {
    setValue((old) => ({ ...old, [key]: input }));
    setChecked('');
  }
  async function save() {
    setPending(true);
    setError(undefined);
    try {
      const input = addressInputSchema.parse(value);
      await api(address ? `/addresses/${address.id}` : '/addresses', {
        method: address ? 'PATCH' : 'POST',
        body: { ...input, ...(address ? { expectedVersion: address.version } : {}) },
      });
      await client.invalidateQueries({ queryKey: ['addresses'] });
      navigate('/addresses');
    } catch (error) {
      setError(error);
    } finally {
      setPending(false);
    }
  }
  async function check() {
    setPending(true);
    setError(undefined);
    try {
      const result = await api<{ serviceable: boolean; reason: string }>('/serviceability', {
        method: 'POST',
        body: { city: value.city, point: value.point },
      });
      setChecked(
        result.serviceable
          ? 'This pin is inside an active operating zone. Restaurant availability is checked separately.'
          : 'Delivery is not configured or open at this pin. You can still save the address.',
      );
    } catch (error) {
      setError(error);
    } finally {
      setPending(false);
    }
  }
  return (
    <WorkspaceShell
      title={address ? 'Edit address' : 'A new place for good food'}
      description="Enter the address, then check the exact delivery pin."
    >
      <Link className="text-link" to="/addresses">
        ← Your addresses
      </Link>
      <form
        className="workspace-panel catalog-form"
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        <div className="form-grid">
          {(
            [
              ['label', 'Address label'],
              ['recipient', 'Recipient'],
              ['phone', 'Indian mobile number'],
              ['pincode', 'PIN code'],
            ] as const
          ).map(([key, label]) => (
            <Field key={key} label={label}>
              <input
                className="form-input"
                required
                maxLength={key === 'phone' ? 10 : key === 'pincode' ? 6 : 80}
                pattern={
                  key === 'phone'
                    ? '[6-9][0-9]{9}'
                    : key === 'pincode'
                      ? '[1-9][0-9]{5}'
                      : undefined
                }
                value={value[key]}
                onChange={(e) => field(key, e.target.value)}
              />
            </Field>
          ))}
          <Field label="City">
            <select
              className="form-input"
              required
              value={value.city}
              onChange={(e) => field('city', e.target.value)}
            >
              <option value="">Choose city</option>
              {cityDirectory.map((city) => (
                <option key={city.slug} value={city.slug}>
                  {city.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Street address">
            <input
              className="form-input"
              required
              minLength={10}
              maxLength={300}
              value={value.street}
              onChange={(e) => field('street', e.target.value)}
            />
          </Field>
          {(
            [
              ['apartment', 'Apartment / floor'],
              ['landmark', 'Landmark'],
              ['instructions', 'Delivery instructions'],
            ] as const
          ).map(([key, label]) => (
            <Field key={key} label={label}>
              <input
                className="form-input"
                maxLength={key === 'instructions' ? 300 : 100}
                value={value[key]}
                onChange={(e) => field(key, e.target.value)}
              />
            </Field>
          ))}
        </div>
        <h2>Your delivery pin</h2>
        <PointFields point={value.point} onChange={(point) => field('point', point)} />
        <button
          className="outline-button"
          type="button"
          disabled={pending || !value.city || !value.point.latitude}
          onClick={() => void check()}
        >
          Check this pin
        </button>
        {checked && (
          <p role="status" className="small-help">
            {checked}
          </p>
        )}
        <label>
          <input
            type="checkbox"
            checked={value.isDefault}
            onChange={(e) => field('isDefault', e.target.checked)}
          />{' '}
          Make this my default address
        </label>
        <ErrorNotice error={error} />
        <button className="red-button" disabled={pending}>
          {pending ? 'Saving…' : 'Save address'}
        </button>
      </form>
    </WorkspaceShell>
  );
}
function addressInput({ id: _id, version: _version, ...value }: Address) {
  return value;
}

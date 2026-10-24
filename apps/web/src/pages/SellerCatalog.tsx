import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  cityDirectory,
  restaurantInputSchema,
  type RestaurantInput,
  type MenuItemInput,
  type MenuItem,
  type Offer,
} from '@cravecart/contracts';
import { api } from '../api';
import { WorkspaceShell, ErrorNotice } from '../components/WorkspaceShell';
import { Field, HoursFields, PointFields, PhotoField, money } from '../components/CatalogFields';
import type { CatalogData } from './Catalog';
function useCatalog() {
  const { restaurantId } = useParams();
  return useQuery({
    queryKey: ['seller-catalog', restaurantId],
    queryFn: () => api<CatalogData>(`/seller/restaurants/${restaurantId}/catalog`),
  });
}
export function SellerCatalogPage() {
  const { restaurantId } = useParams(),
    query = useCatalog(),
    client = useQueryClient(),
    [error, setError] = useState<unknown>(),
    [pending, setPending] = useState(false),
    [remove, setRemove] = useState<string>();
  async function change(item: MenuItem, deleted = false) {
    setPending(true);
    setError(undefined);
    try {
      const { id, version, restaurantId: _restaurantId, ...input } = item;
      await api(`/seller/restaurants/${restaurantId}/items/${id}`, {
        method: deleted ? 'DELETE' : 'PUT',
        body: deleted ? { expectedVersion: version } : { expectedVersion: version, item: input },
      });
      await client.invalidateQueries({ queryKey: ['seller-catalog', restaurantId] });
      setRemove(undefined);
    } catch (error) {
      setError(error);
    } finally {
      setPending(false);
    }
  }
  return (
    <WorkspaceShell
      role="seller"
      title={query.data?.restaurant.name ?? 'Your menu'}
      description="A menu worth coming back for."
    >
      <Link className="text-link" to="/seller/restaurants">
        ← Your restaurants
      </Link>
      <ErrorNotice error={query.error ?? error} />
      {query.isPending ? (
        <p role="status">Loading your catalog…</p>
      ) : (
        query.data && (
          <>
            <div className="seller-toolbar">
              <span
                className={`status-badge status-${query.data.restaurant.published ? 'approved' : 'draft'}`}
              >
                {query.data.restaurant.published ? 'Published' : 'Draft'}
              </span>
              <Link className="outline-button" to={`/seller/restaurants/${restaurantId}/profile`}>
                Restaurant details
              </Link>
              <Link className="outline-button" to={`/seller/restaurants/${restaurantId}/hours`}>
                Opening hours
              </Link>
              <Link className="red-button" to={`/seller/restaurants/${restaurantId}/menu/new`}>
                Add a dish
              </Link>
              {query.data.restaurant.published && (
                <Link className="text-link" to={`/restaurants/${query.data.restaurant.slug}`}>
                  View public menu →
                </Link>
              )}
            </div>
            {!query.data.restaurant.published && (
              <p className="small-help">
                Complete the pickup pin, opening hours and an available dish, then publish from
                restaurant details.
              </p>
            )}
            <div className="workspace-panel">
              <div className="catalog-table-wrap">
                <table className="catalog-table">
                  <thead>
                    <tr>
                      <th>Dish</th>
                      <th>Category</th>
                      <th>Price</th>
                      <th>Availability</th>
                      <th>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {query.data.items.map((item) => (
                      <tr key={item.id}>
                        <td>
                          <strong>{item.name}</strong>
                          <small>
                            {item.diet} · {item.variants.length} variants ·{' '}
                            {item.modifierGroups.length} add-on groups
                          </small>
                        </td>
                        <td>{item.category}</td>
                        <td>{money(item.priceMinor)}</td>
                        <td>
                          <button
                            className="text-link"
                            disabled={pending}
                            onClick={() => void change({ ...item, available: !item.available })}
                          >
                            {item.available ? 'Available' : 'Sold out'}
                          </button>
                          {item.stock !== null && <small>Stock: {item.stock}</small>}
                        </td>
                        <td>
                          <div className="button-row">
                            <Link
                              className="text-link"
                              to={`/seller/restaurants/${restaurantId}/menu/${item.id}/edit`}
                            >
                              Edit
                            </Link>
                            <button
                              className="text-link"
                              disabled={pending}
                              onClick={() => setRemove(item.id)}
                            >
                              Remove
                            </button>
                          </div>
                          {remove === item.id && (
                            <div className="confirm-inline">
                              <p>Remove {item.name} from the menu?</p>
                              <button
                                className="text-link"
                                disabled={pending}
                                onClick={() => void change(item, true)}
                              >
                                Confirm removal
                              </button>
                              <button className="text-link" onClick={() => setRemove(undefined)}>
                                Keep dish
                              </button>
                            </div>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {!query.data.items.length && (
                <p>No dishes yet. Add the first dish to begin your menu.</p>
              )}
            </div>
            <OfferManager
              key={restaurantId}
              restaurantId={restaurantId!}
              offers={query.data.offers}
            />
          </>
        )
      )}
    </WorkspaceShell>
  );
}
export function RestaurantProfilePage({ hoursOnly = false }: { hoursOnly?: boolean }) {
  const query = useCatalog();
  return (
    <WorkspaceShell
      role="seller"
      title={hoursOnly ? 'Opening hours' : 'Restaurant details'}
      description="Let customers get to know your kitchen."
    >
      <ErrorNotice error={query.error} />
      {query.isPending ? (
        <p role="status">Loading details…</p>
      ) : (
        query.data && (
          <ProfileForm key={query.data.restaurant.id} data={query.data} hoursOnly={hoursOnly} />
        )
      )}
    </WorkspaceShell>
  );
}
function ProfileForm({ data, hoursOnly }: { data: CatalogData; hoursOnly: boolean }) {
  const restaurant = data.restaurant,
    client = useQueryClient(),
    { restaurantId } = useParams();
  const [value, setValue] = useState<RestaurantInput>(
      () =>
        Object.fromEntries(
          Object.keys(restaurantInputSchema.shape).map((key) => [
            key,
            restaurant[key as keyof typeof restaurant],
          ]),
        ) as RestaurantInput,
    ),
    [version, setVersion] = useState(restaurant.version),
    [error, setError] = useState<unknown>(),
    [notice, setNotice] = useState(''),
    [pending, setPending] = useState(false);
  function field<Key extends keyof RestaurantInput>(key: Key, input: RestaurantInput[Key]) {
    setValue((old) => ({ ...old, [key]: input }));
    setNotice('');
  }
  async function save() {
    setPending(true);
    setError(undefined);
    setNotice('');
    try {
      const result = await api<{ version: number }>(`/seller/restaurants/${restaurantId}`, {
        method: 'PUT',
        body: {
          expectedVersion: version,
          restaurant: { ...value, holidays: value.holidays.filter((day) => day.date.trim()) },
        },
      });
      setVersion(result.version);
      await client.invalidateQueries({ queryKey: ['seller-catalog', restaurantId] });
      await client.invalidateQueries({ queryKey: ['restaurants'] });
      setNotice('Restaurant details saved.');
    } catch (error) {
      setError(error);
    } finally {
      setPending(false);
    }
  }
  return (
    <>
      <Link className="text-link" to={`/seller/restaurants/${restaurantId}/menu`}>
        ← Your catalog
      </Link>
      <form
        className="workspace-panel catalog-form"
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        {!hoursOnly && (
          <>
            <div className="form-grid">
              <Field label="Restaurant name">
                <input
                  className="form-input"
                  required
                  minLength={2}
                  maxLength={120}
                  value={value.name}
                  onChange={(e) => field('name', e.target.value)}
                />
              </Field>
              <Field label="Cuisines (comma separated)">
                <input
                  className="form-input"
                  required
                  value={value.cuisines.join(', ')}
                  onChange={(e) =>
                    field(
                      'cuisines',
                      e.target.value.split(',').map((value) => value.trim()),
                    )
                  }
                />
              </Field>
              <Field label="City">
                <select
                  className="form-input"
                  value={value.city}
                  onChange={(e) => field('city', e.target.value)}
                >
                  {cityDirectory.map((city) => (
                    <option key={city.slug} value={city.slug}>
                      {city.name}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Pickup address">
                <input
                  className="form-input"
                  required
                  minLength={10}
                  maxLength={400}
                  value={value.address}
                  onChange={(e) => field('address', e.target.value)}
                />
              </Field>
            </div>
            <Field label="About your kitchen">
              <textarea
                className="form-input"
                maxLength={1000}
                rows={3}
                value={value.description}
                onChange={(e) => field('description', e.target.value)}
              />
            </Field>
            <h2>Pickup pin</h2>
            <PointFields point={value.point} onChange={(point) => field('point', point)} />
            <PhotoField
              imageId={value.imageId}
              libraryImage={value.libraryImage}
              onChange={(photo) => setValue((old) => ({ ...old, ...photo }))}
            />
            <div className="form-grid">
              {(
                [
                  ['costForTwoMinor', 'Approximate cost for two (₹)'],
                  ['minimumOrderMinor', 'Minimum items subtotal (₹)'],
                ] as const
              ).map(([key, label]) => (
                <Field key={key} label={label}>
                  <input
                    className="form-input"
                    type="number"
                    min={0}
                    step="0.01"
                    required
                    value={value[key] / 100}
                    onChange={(e) => field(key, Math.round(Number(e.target.value) * 100))}
                  />
                </Field>
              ))}
              <Field label="Preparation estimate (minutes)">
                <input
                  className="form-input"
                  type="number"
                  min={5}
                  max={180}
                  value={value.preparationMinutes}
                  onChange={(e) => field('preparationMinutes', Number(e.target.value))}
                />
              </Field>
            </div>
          </>
        )}
        <h2>Weekly opening hours</h2>
        <HoursFields hours={value.hours} onChange={(hours) => field('hours', hours)} />
        <Field label="Closed dates (comma separated, YYYY-MM-DD)">
          <input
            className="form-input"
            placeholder="2026-12-25, 2027-01-01"
            value={value.holidays.map((day) => day.date).join(', ')}
            onChange={(e) =>
              field(
                'holidays',
                e.target.value
                  .split(',')
                  .map((date) => date.trim())
                  .map((date) => ({ date, closed: true })),
              )
            }
          />
        </Field>
        {!hoursOnly && (
          <>
            <label>
              <input
                type="checkbox"
                checked={value.published}
                onChange={(e) => field('published', e.target.checked)}
              />{' '}
              Publish this restaurant and menu
            </label>
            <label>
              <input
                type="checkbox"
                checked={value.paused}
                onChange={(e) => field('paused', e.target.checked)}
              />{' '}
              Temporarily pause new cart additions
            </label>
            {value.paused && (
              <Field label="Pause reason, visible to customers">
                <input
                  className="form-input"
                  required
                  minLength={5}
                  maxLength={200}
                  value={value.pauseReason}
                  onChange={(e) => field('pauseReason', e.target.value)}
                />
              </Field>
            )}
          </>
        )}
        <ErrorNotice error={error} />
        {notice && (
          <p className="success-notice" role="status">
            {notice}
          </p>
        )}
        <div className="button-row">
          <button className="red-button" disabled={pending}>
            {pending ? 'Saving…' : 'Save restaurant'}
          </button>
          <button className="text-link" type="button" onClick={() => window.location.reload()}>
            Reload latest details
          </button>
        </div>
        {hoursOnly && !value.point.latitude && (
          <p className="small-help">
            Complete the pickup pin in restaurant details before saving the first setup.
          </p>
        )}
      </form>
    </>
  );
}
const blankItem: MenuItemInput = {
  category: 'Main course',
  name: '',
  description: '',
  priceMinor: 10000,
  diet: 'veg',
  allergens: [],
  available: true,
  stock: null,
  imageId: null,
  libraryImage: 'indian-feast',
  variants: [],
  modifierGroups: [],
};
export function MenuItemPage() {
  const query = useCatalog(),
    { itemId } = useParams();
  if (query.isPending)
    return (
      <WorkspaceShell role="seller" title="Your dish">
        <p role="status">Loading dish…</p>
      </WorkspaceShell>
    );
  const item = query.data?.items.find((item) => item.id === itemId);
  return (
    <WorkspaceShell
      role="seller"
      title={itemId ? 'Edit dish' : 'A new dish on the menu'}
      description="Clear choices, accurate prices, and a photograph worth a second look."
    >
      <ErrorNotice error={query.error} />
      {query.data &&
        (itemId && !item ? (
          <p>
            This dish was removed or is not part of your restaurant.{' '}
            <Link to={`/seller/restaurants/${query.data.restaurant.id}/menu`}>Back to menu</Link>
          </p>
        ) : (
          <ItemForm key={itemId ?? 'new'} item={item} />
        ))}
    </WorkspaceShell>
  );
}
function ItemForm({ item }: { item?: MenuItem }) {
  const { restaurantId } = useParams(),
    navigate = useNavigate(),
    client = useQueryClient(),
    [value, setValue] = useState<MenuItemInput>(() =>
      item ? itemFields(item) : structuredClone(blankItem),
    ),
    [error, setError] = useState<unknown>(),
    [pending, setPending] = useState(false),
    [command] = useState(() => crypto.randomUUID());
  function field<Key extends keyof MenuItemInput>(key: Key, input: MenuItemInput[Key]) {
    setValue((old) => ({ ...old, [key]: input }));
  }
  async function save() {
    setPending(true);
    setError(undefined);
    try {
      await api(`/seller/restaurants/${restaurantId}/items${item ? `/${item.id}` : ''}`, {
        method: item ? 'PUT' : 'POST',
        body: item
          ? {
              expectedVersion: item.version,
              item: { ...value, allergens: value.allergens.filter(Boolean) },
            }
          : { ...value, allergens: value.allergens.filter(Boolean) },
        headers: { 'Idempotency-Key': command },
      });
      await client.invalidateQueries({ queryKey: ['seller-catalog', restaurantId] });
      navigate(`/seller/restaurants/${restaurantId}/menu`);
    } catch (error) {
      setError(error);
    } finally {
      setPending(false);
    }
  }
  function groupChange(index: number, input: Partial<MenuItemInput['modifierGroups'][number]>) {
    field(
      'modifierGroups',
      value.modifierGroups.map((group, i) => (i === index ? { ...group, ...input } : group)),
    );
  }
  return (
    <>
      <Link className="text-link" to={`/seller/restaurants/${restaurantId}/menu`}>
        ← Your catalog
      </Link>
      <form
        className="workspace-panel catalog-form"
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        <div className="form-grid">
          <Field label="Dish name">
            <input
              className="form-input"
              required
              minLength={2}
              maxLength={120}
              value={value.name}
              onChange={(e) => field('name', e.target.value)}
            />
          </Field>
          <Field label="Menu category">
            <input
              className="form-input"
              required
              minLength={2}
              maxLength={60}
              value={value.category}
              onChange={(e) => field('category', e.target.value)}
            />
          </Field>
          <Field label="Base price (₹)">
            <input
              className="form-input"
              type="number"
              required
              min={0.01}
              max={10000}
              step="0.01"
              value={value.priceMinor / 100}
              onChange={(e) => field('priceMinor', Math.round(Number(e.target.value) * 100))}
            />
          </Field>
          <Field label="Dietary label">
            <select
              className="form-input"
              value={value.diet}
              onChange={(e) => field('diet', e.target.value as MenuItemInput['diet'])}
            >
              <option value="veg">Vegetarian</option>
              <option value="vegan">Vegan</option>
              <option value="non-veg">Non-vegetarian</option>
            </select>
          </Field>
        </div>
        <Field label="Dish description">
          <textarea
            className="form-input"
            rows={3}
            maxLength={1000}
            value={value.description}
            onChange={(e) => field('description', e.target.value)}
          />
        </Field>
        <Field label="Declared allergens (comma separated)">
          <input
            className="form-input"
            value={value.allergens.join(', ')}
            onChange={(e) =>
              field(
                'allergens',
                e.target.value.split(',').map((value) => value.trim()),
              )
            }
          />
        </Field>
        <PhotoField
          imageId={value.imageId}
          libraryImage={value.libraryImage}
          onChange={(photo) => setValue((old) => ({ ...old, ...photo }))}
        />
        <label>
          <input
            type="checkbox"
            checked={value.available}
            onChange={(e) => field('available', e.target.checked)}
          />{' '}
          Available on the menu
        </label>
        <label>
          <input
            type="checkbox"
            checked={value.stock !== null}
            onChange={(e) => field('stock', e.target.checked ? 10 : null)}
          />{' '}
          Limit displayed portions
        </label>
        {value.stock !== null && (
          <Field label="Available portions">
            <input
              className="form-input"
              type="number"
              min={0}
              max={100000}
              required
              value={value.stock}
              onChange={(e) => field('stock', Number(e.target.value))}
            />
          </Field>
        )}
        <div className="section-title-row">
          <h2>Sizes & variants</h2>
          <button
            type="button"
            className="outline-button"
            disabled={value.variants.length >= 12}
            onClick={() =>
              field('variants', [
                ...value.variants,
                { id: crypto.randomUUID(), name: '', priceMinor: 0, available: true },
              ])
            }
          >
            Add variant
          </button>
        </div>
        <p className="small-help">
          A customer must choose one available variant when variants exist. Prices below are added
          to the base price.
        </p>
        <OptionsEditor
          options={value.variants}
          onChange={(options) => field('variants', options)}
        />
        <div className="section-title-row">
          <h2>Add-on groups</h2>
          <button
            type="button"
            className="outline-button"
            disabled={value.modifierGroups.length >= 8}
            onClick={() =>
              field('modifierGroups', [
                ...value.modifierGroups,
                {
                  id: crypto.randomUUID(),
                  name: '',
                  min: 0,
                  max: 1,
                  options: [{ id: crypto.randomUUID(), name: '', priceMinor: 0, available: true }],
                },
              ])
            }
          >
            Add group
          </button>
        </div>
        {value.modifierGroups.map((group, index) => (
          <fieldset className="modifier-editor" key={group.id}>
            <legend>Add-on group {index + 1}</legend>
            <div className="form-grid">
              <Field label={`Group ${index + 1} name`}>
                <input
                  className="form-input"
                  required
                  maxLength={80}
                  value={group.name}
                  onChange={(e) => groupChange(index, { name: e.target.value })}
                />
              </Field>
              <Field label="Minimum choices">
                <input
                  className="form-input"
                  type="number"
                  min={0}
                  max={12}
                  value={group.min}
                  onChange={(e) => groupChange(index, { min: Number(e.target.value) })}
                />
              </Field>
              <Field label="Maximum choices">
                <input
                  className="form-input"
                  type="number"
                  min={1}
                  max={12}
                  value={group.max}
                  onChange={(e) => groupChange(index, { max: Number(e.target.value) })}
                />
              </Field>
            </div>
            <OptionsEditor
              options={group.options}
              onChange={(options) => groupChange(index, { options })}
            />
            <div className="button-row">
              <button
                className="outline-button"
                type="button"
                disabled={group.options.length >= 12}
                onClick={() =>
                  groupChange(index, {
                    options: [
                      ...group.options,
                      { id: crypto.randomUUID(), name: '', priceMinor: 0, available: true },
                    ],
                  })
                }
              >
                Add option
              </button>
              <button
                className="text-link"
                type="button"
                onClick={() =>
                  field(
                    'modifierGroups',
                    value.modifierGroups.filter((_, i) => i !== index),
                  )
                }
              >
                Remove group
              </button>
            </div>
          </fieldset>
        ))}
        <ErrorNotice error={error} />
        <button className="red-button" disabled={pending}>
          {pending ? 'Saving…' : 'Save dish'}
        </button>
      </form>
    </>
  );
}
function itemFields({
  id: _id,
  version: _version,
  restaurantId: _restaurantId,
  ...item
}: MenuItem) {
  return item;
}
function OptionsEditor({
  options,
  onChange,
}: {
  options: MenuItemInput['variants'];
  onChange: (options: MenuItemInput['variants']) => void;
}) {
  return (
    <div className="options-editor">
      {options.map((option, index) => (
        <div className="option-editor" key={option.id}>
          <Field label={`Option ${index + 1} name`}>
            <input
              className="form-input"
              required
              maxLength={80}
              value={option.name}
              onChange={(e) =>
                onChange(
                  options.map((value, i) =>
                    i === index ? { ...value, name: e.target.value } : value,
                  ),
                )
              }
            />
          </Field>
          <Field label={`Option ${index + 1} extra price (₹)`}>
            <input
              className="form-input"
              type="number"
              min={0}
              max={10000}
              step="0.01"
              required
              value={option.priceMinor / 100}
              onChange={(e) =>
                onChange(
                  options.map((value, i) =>
                    i === index
                      ? { ...value, priceMinor: Math.round(Number(e.target.value) * 100) }
                      : value,
                  ),
                )
              }
            />
          </Field>
          <label>
            <input
              type="checkbox"
              checked={option.available}
              onChange={(e) =>
                onChange(
                  options.map((value, i) =>
                    i === index ? { ...value, available: e.target.checked } : value,
                  ),
                )
              }
            />{' '}
            Available
          </label>
          <button
            className="text-link"
            type="button"
            onClick={() => onChange(options.filter((_, i) => i !== index))}
          >
            Remove option
          </button>
        </div>
      ))}
    </div>
  );
}
function OfferManager({ restaurantId, offers }: { restaurantId: string; offers: Offer[] }) {
  const [selected, setSelected] = useState<Offer | undefined>(),
    [editing, setEditing] = useState(false);
  return (
    <section className="workspace-panel">
      <div className="section-title-row">
        <h2>Restaurant offers</h2>
        <button
          className="outline-button"
          onClick={() => {
            setSelected(undefined);
            setEditing(true);
          }}
        >
          Create offer
        </button>
      </div>
      <p className="small-help">
        Offers display publicly during their active dates. Checkout eligibility and redemption begin
        with payments.
      </p>
      {offers.map((offer) => (
        <div className="offer-summary" key={offer.id}>
          <div>
            <strong>
              {offer.code} · {offer.title}
            </strong>
            <p>
              {offer.percent}% · cap {money(offer.maxDiscountMinor)} ·{' '}
              {offer.active ? 'Enabled' : 'Disabled'}
            </p>
          </div>
          <button
            className="text-link"
            onClick={() => {
              setSelected(offer);
              setEditing(true);
            }}
          >
            Edit offer
          </button>
        </div>
      ))}
      {editing && (
        <OfferForm
          key={selected?.id ?? 'new'}
          restaurantId={restaurantId}
          offer={selected}
          onDone={() => setEditing(false)}
        />
      )}
    </section>
  );
}
function OfferForm({
  restaurantId,
  offer,
  onDone,
}: {
  restaurantId: string;
  offer?: Offer;
  onDone: () => void;
}) {
  const [value, setValue] = useState(() =>
      offer
        ? {
            code: offer.code,
            title: offer.title,
            percent: offer.percent,
            maxDiscountMinor: offer.maxDiscountMinor,
            minimumSubtotalMinor: offer.minimumSubtotalMinor,
            startsAt: offer.startsAt,
            endsAt: offer.endsAt,
            active: offer.active,
          }
        : {
            code: '',
            title: '',
            percent: 10,
            maxDiscountMinor: 5000,
            minimumSubtotalMinor: 20000,
            startsAt: new Date().toISOString(),
            endsAt: new Date(Date.now() + 7 * 86400000).toISOString(),
            active: true,
          },
    ),
    [error, setError] = useState<unknown>(),
    [pending, setPending] = useState(false),
    [key] = useState(() => crypto.randomUUID()),
    client = useQueryClient();
  async function save() {
    setPending(true);
    setError(undefined);
    try {
      await api(`/seller/restaurants/${restaurantId}/offers${offer ? `/${offer.id}` : ''}`, {
        method: offer ? 'PUT' : 'POST',
        body: { offer: value, ...(offer ? { expectedVersion: offer.version } : {}) },
        headers: { 'Idempotency-Key': key },
      });
      await client.invalidateQueries({ queryKey: ['seller-catalog', restaurantId] });
      onDone();
    } catch (error) {
      setError(error);
    } finally {
      setPending(false);
    }
  }
  return (
    <form
      className="catalog-form"
      onSubmit={(e) => {
        e.preventDefault();
        void save();
      }}
    >
      <div className="form-grid">
        {(['code', 'title'] as const).map((key) => (
          <Field label={key === 'code' ? 'Offer code' : 'Offer title'} key={key}>
            <input
              className="form-input"
              required
              maxLength={key === 'code' ? 20 : 100}
              value={value[key]}
              onChange={(e) => setValue((old) => ({ ...old, [key]: e.target.value }))}
            />
          </Field>
        ))}
        <Field label="Discount percent">
          <input
            className="form-input"
            type="number"
            min={1}
            max={70}
            required
            value={value.percent}
            onChange={(e) => setValue((old) => ({ ...old, percent: Number(e.target.value) }))}
          />
        </Field>
        {(
          [
            ['maxDiscountMinor', 'Discount cap (₹)'],
            ['minimumSubtotalMinor', 'Minimum items subtotal (₹)'],
          ] as const
        ).map(([key, label]) => (
          <Field label={label} key={key}>
            <input
              className="form-input"
              type="number"
              min={0}
              step="0.01"
              required
              value={value[key] / 100}
              onChange={(e) =>
                setValue((old) => ({ ...old, [key]: Math.round(Number(e.target.value) * 100) }))
              }
            />
          </Field>
        ))}
        {(['startsAt', 'endsAt'] as const).map((key) => (
          <Field label={key === 'startsAt' ? 'Starts (India time)' : 'Ends (India time)'} key={key}>
            <input
              className="form-input"
              type="datetime-local"
              required
              value={new Date(Date.parse(value[key]) + 330 * 60000).toISOString().slice(0, 16)}
              onChange={(e) => {
                if (e.target.value)
                  setValue((old) => ({
                    ...old,
                    [key]: new Date(
                      Date.parse(`${e.target.value}:00.000Z`) - 330 * 60000,
                    ).toISOString(),
                  }));
              }}
            />
          </Field>
        ))}
      </div>
      <label>
        <input
          type="checkbox"
          checked={value.active}
          onChange={(e) => setValue((old) => ({ ...old, active: e.target.checked }))}
        />{' '}
        Offer enabled
      </label>
      <ErrorNotice error={error} />
      <div className="button-row">
        <button className="red-button" disabled={pending}>
          Save offer
        </button>
        <button className="text-link" type="button" onClick={onDone}>
          Cancel
        </button>
      </div>
    </form>
  );
}

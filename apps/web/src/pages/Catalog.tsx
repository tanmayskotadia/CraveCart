import { useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  Restaurant,
  MenuItem,
  Offer,
  Address,
  Cart,
  CartLineInput,
} from '@cravecart/contracts';
import { api, ApiError } from '../api';
import { useSession } from '../components/SessionProvider';
import { ErrorNotice, WorkspaceShell } from '../components/WorkspaceShell';
import { Modal } from '../components/Modal';
import { Field, money, imageUrl } from '../components/CatalogFields';
export interface CatalogData {
  restaurant: Restaurant;
  items: MenuItem[];
  offers: Offer[];
}
export interface CartState {
  cart: Cart | null;
  version: number;
}
export const lineInput = (line: CartLineInput): CartLineInput => ({
  itemId: line.itemId,
  variantId: line.variantId,
  optionIds: line.optionIds,
  quantity: line.quantity,
  instructions: line.instructions,
});
export function RestaurantCard({ restaurant }: { restaurant: Restaurant }) {
  return (
    <Link className="restaurant-card" to={`/restaurants/${restaurant.slug}`}>
      <div className="restaurant-photo">
        <img
          src={imageUrl(restaurant)}
          alt={restaurant.name}
          loading="lazy"
          width={480}
          height={300}
        />
        {restaurant.sample && <span className="sample-label">Development sample</span>}
        <span className={`opening-label ${restaurant.open ? 'is-open' : ''}`}>
          {restaurant.open ? 'Open now' : restaurant.paused ? 'Temporarily paused' : 'Closed now'}
        </span>
      </div>
      <div className="restaurant-card-copy">
        <div>
          <h2>{restaurant.name}</h2>
          <span className="new-label">New</span>
        </div>
        <p>{restaurant.cuisines.join(' · ')}</p>
        <div className="restaurant-card-meta">
          <span>{money(restaurant.costForTwoMinor)} for two</span>
          <span>{restaurant.preparationMinutes} min prep</span>
        </div>
      </div>
    </Link>
  );
}
export function RestaurantResults({ city }: { city: string }) {
  const [params, setParams] = useSearchParams(),
    { session } = useSession();
  const key = new URLSearchParams({
    city,
    q: params.get('q') ?? '',
    sort: params.get('sort') ?? 'name',
    page: params.get('page') ?? '1',
  });
  for (const name of ['cuisine', 'diet', 'open', 'maxPrice', 'maxMinutes', 'minRating'])
    if (params.get(name)) key.set(name, params.get(name)!);
  const query = useQuery({
    queryKey: ['restaurants', key.toString()],
    queryFn: () =>
      api<{ restaurants: Restaurant[]; total: number; page: number; pageSize: number }>(
        `/restaurants?${key}`,
      ),
    retry: 1,
  });
  const address = useQuery({
    queryKey: ['addresses', session?.principal.userId],
    queryFn: () => api<Address[]>('/addresses'),
    enabled: Boolean(session),
  });
  const selected = address.data?.find((value) => value.isDefault && value.city === city);
  const service = useQuery({
    queryKey: ['serviceability', selected?.id, selected?.version],
    queryFn: () =>
      api<{ serviceable: boolean; reason: string }>('/serviceability', {
        method: 'POST',
        body: { city, point: selected!.point },
      }),
    enabled: Boolean(selected),
    retry: false,
  });
  function filter(name: string, value: string) {
    const next = new URLSearchParams(params);
    next.delete('page');
    if (value) next.set(name, value);
    else next.delete(name);
    setParams(next);
  }
  return (
    <>
      <div className="discovery-address">
        <span>
          {selected
            ? `${selected.label} · ${selected.street}`
            : 'Explore restaurants. Add a precise delivery address to check your area.'}
        </span>
        <Link className="text-link" to="/addresses">
          {selected ? 'Change address' : 'Choose address'}
        </Link>
      </div>
      {selected && service.data && (
        <p className="small-help" role="status">
          {service.data.serviceable
            ? 'Your address is in an active operating zone. Each restaurant is checked again when adding to your cart.'
            : 'Delivery is not currently configured or open at your saved pin. You can browse menus.'}
        </p>
      )}
      <ErrorNotice error={service.error} />
      <div className="catalog-filters">
        <Field label="Sort by">
          <select
            value={params.get('sort') ?? 'name'}
            onChange={(e) => filter('sort', e.target.value)}
          >
            <option value="name">Name</option>
            <option value="price">Price for two</option>
            <option value="preparation">Preparation time</option>
          </select>
        </Field>
        <Field label="Dietary preference">
          <select value={params.get('diet') ?? ''} onChange={(e) => filter('diet', e.target.value)}>
            <option value="">All food</option>
            <option value="veg">Vegetarian</option>
            <option value="vegan">Vegan</option>
            <option value="non-veg">Non-vegetarian</option>
          </select>
        </Field>
        <Field label="Cuisine">
          <input
            placeholder="e.g. Indian"
            maxLength={40}
            value={params.get('cuisine') ?? ''}
            onChange={(e) => filter('cuisine', e.target.value)}
          />
        </Field>
        <Field label="Budget for two">
          <select
            value={params.get('maxPrice') ?? ''}
            onChange={(e) => filter('maxPrice', e.target.value)}
          >
            <option value="">Any budget</option>
            <option value="30000">Up to ₹300</option>
            <option value="60000">Up to ₹600</option>
            <option value="100000">Up to ₹1,000</option>
          </select>
        </Field>
        <Field label="Preparation time">
          <select
            value={params.get('maxMinutes') ?? ''}
            onChange={(e) => filter('maxMinutes', e.target.value)}
          >
            <option value="">Any time</option>
            <option value="20">Up to 20 minutes</option>
            <option value="40">Up to 40 minutes</option>
          </select>
        </Field>
        <Field label="Rating">
          <select
            value={params.get('minRating') ?? ''}
            onChange={(e) => filter('minRating', e.target.value)}
          >
            <option value="">All ratings</option>
            <option value="4">4 and above</option>
            <option value="3">3 and above</option>
          </select>
        </Field>
        <label className="filter-check">
          <input
            type="checkbox"
            checked={params.get('open') === 'true'}
            onChange={(e) => filter('open', e.target.checked ? 'true' : '')}
          />{' '}
          Open now
        </label>
      </div>
      <div className="section-title-row">
        <h2>Restaurants in your city</h2>
        <Link to={`/offers?city=${city}`} className="text-link">
          Explore offers →
        </Link>
      </div>
      <ErrorNotice error={query.error} />
      {query.isPending ? (
        <p role="status">Finding your next favourite…</p>
      ) : query.error ? (
        <button className="outline-button" onClick={() => void query.refetch()}>
          Try again
        </button>
      ) : query.data?.restaurants.length ? (
        <>
          <p className="small-help">
            {query.data.total} result{query.data.total === 1 ? '' : 's'}. Preparation estimates are
            supplied by the restaurant; delivery time is confirmed later.
          </p>
          <div className="restaurant-grid">
            {query.data.restaurants.map((restaurant) => (
              <RestaurantCard key={restaurant.id} restaurant={restaurant} />
            ))}
          </div>
          <div className="pagination">
            <button
              className="outline-button"
              disabled={query.data.page <= 1}
              onClick={() => {
                const next = new URLSearchParams(params);
                next.set('page', String(query.data!.page - 1));
                setParams(next);
              }}
            >
              Previous
            </button>
            <span>Page {query.data.page}</span>
            <button
              className="outline-button"
              disabled={query.data.page * query.data.pageSize >= query.data.total}
              onClick={() => {
                const next = new URLSearchParams(params);
                next.set('page', String(query.data!.page + 1));
                setParams(next);
              }}
            >
              Next
            </button>
          </div>
        </>
      ) : (
        <div className="catalog-empty">
          <h3>No restaurants match this view.</h3>
          <p>
            Try another cuisine, fewer filters, or a different city. New restaurants appear after
            verification and publication.
          </p>
          <button className="outline-button" onClick={() => setParams({ city })}>
            Clear filters
          </button>
        </div>
      )}
    </>
  );
}
export function RestaurantPage() {
  const { slug } = useParams(),
    { session } = useSession(),
    client = useQueryClient(),
    [chosen, setChosen] = useState<MenuItem>(),
    [notice, setNotice] = useState(''),
    [error, setError] = useState<unknown>(),
    [menuSearch, setMenuSearch] = useState('');
  const query = useQuery({
    queryKey: ['restaurant', slug],
    queryFn: () => api<CatalogData>(`/restaurants/${encodeURIComponent(slug ?? '')}`),
    retry: false,
  });
  const cart = useQuery({
    queryKey: ['cart', session?.principal.userId],
    queryFn: () => api<CartState>('/cart'),
    enabled: Boolean(session),
  });
  const addresses = useQuery({
    queryKey: ['addresses', session?.principal.userId],
    queryFn: () => api<Address[]>('/addresses'),
    enabled: Boolean(session),
  });
  const favorites = useQuery({
    queryKey: ['favorites', session?.principal.userId],
    queryFn: () => api<Restaurant[]>('/favorites'),
    enabled: Boolean(session),
  });
  const [favoritePending, setFavoritePending] = useState(false);
  if (query.isPending)
    return (
      <section className="page-width menu-page">
        <p role="status">Loading the menu…</p>
      </section>
    );
  if (query.error)
    return (
      <section className="message-page page-width">
        <h1>We couldn’t open this restaurant.</h1>
        <ErrorNotice error={query.error} />
        <Link className="red-button" to="/">
          Explore your city
        </Link>
      </section>
    );
  const { restaurant, items, offers } = query.data,
    defaultAddress = addresses.data?.find(
      (address) => address.isDefault && address.city === restaurant.city,
    ),
    isFavorite = favorites.data?.some((value) => value.id === restaurant.id) ?? false;
  async function favorite() {
    setFavoritePending(true);
    setError(undefined);
    try {
      await api(`/favorites/${restaurant.id}`, { method: 'PUT', body: { favorite: !isFavorite } });
      await client.invalidateQueries({ queryKey: ['favorites'] });
    } catch (error) {
      setError(error);
    } finally {
      setFavoritePending(false);
    }
  }
  async function add(line: CartLineInput, replace = false) {
    if (!defaultAddress)
      throw new Error('Choose a default delivery address in this city before adding dishes.');
    const latest = await api<CartState>('/cart'),
      old = latest.cart;
    if (old && old.restaurantId !== restaurant.id && !replace)
      throw new ApiError(
        409,
        'REPLACE_CART_REQUIRED',
        `Your cart contains dishes from ${old.restaurantName}. Replace them with this restaurant?`,
      );
    const lines = old && old.restaurantId === restaurant.id ? old.lines.map(lineInput) : [];
    const equal = (value: CartLineInput) =>
      value.itemId === line.itemId &&
      value.variantId === line.variantId &&
      [...value.optionIds].sort().join() === [...line.optionIds].sort().join() &&
      value.instructions === line.instructions;
    const previous = lines.find(equal);
    if (previous) previous.quantity += line.quantity;
    else lines.push(line);
    await api('/cart', {
      method: 'PUT',
      body: {
        expectedVersion: latest.version,
        restaurantId: restaurant.id,
        addressId: defaultAddress.id,
        replace,
        lines,
      },
    });
    await client.invalidateQueries({ queryKey: ['cart'] });
    setChosen(undefined);
    setNotice('Added to your cart.');
  }
  const filtered = items.filter((item) =>
      `${item.name} ${item.category}`.toLowerCase().includes(menuSearch.toLowerCase()),
    ),
    categories = [...new Set(filtered.map((item) => item.category))];
  return (
    <div className="menu-page page-width">
      <nav className="breadcrumbs" aria-label="Breadcrumb">
        <Link to="/">Home</Link>
        <span>/</span>
        <Link to={`/search?city=${restaurant.city}`}>{restaurant.city}</Link>
        <span>/</span>
        <span>{restaurant.name}</span>
      </nav>
      <div className="restaurant-hero">
        <img src={imageUrl(restaurant)} alt={restaurant.name} width={1200} height={450} />
        {restaurant.sample && (
          <span className="sample-label">Development sample · no real restaurant affiliation</span>
        )}
      </div>
      <div className="menu-heading">
        <div>
          <p className="eyebrow">
            {restaurant.open ? 'Open now' : 'Currently closed'} · {restaurant.city}
          </p>
          <h1>{restaurant.name}</h1>
          <p>{restaurant.cuisines.join(' · ')}</p>
          <p className="small-help">{restaurant.address}</p>
          <p>
            {money(restaurant.costForTwoMinor)} for two · {restaurant.preparationMinutes} minutes
            preparation · No reviews yet
          </p>
        </div>
        <div className="button-row">
          {session ? (
            <button
              className="outline-button"
              disabled={favoritePending}
              onClick={() => void favorite()}
            >
              {isFavorite ? 'Saved to favourites' : 'Save restaurant'}
            </button>
          ) : (
            <Link
              className="outline-button"
              to={`/login?returnTo=${encodeURIComponent(`/restaurants/${restaurant.slug}`)}`}
            >
              Sign in to save
            </Link>
          )}
          <Link className="red-button" to="/cart">
            Your cart
            {cart.data?.cart
              ? ` · ${cart.data.cart.lines.reduce((sum, line) => sum + line.quantity, 0)}`
              : ''}
          </Link>
        </div>
      </div>
      {restaurant.description && <p className="restaurant-description">{restaurant.description}</p>}
      {restaurant.paused && (
        <p className="form-feedback">Temporarily paused: {restaurant.pauseReason}</p>
      )}
      <ErrorNotice error={error} />
      {notice && (
        <p role="status" className="success-notice">
          {notice} <Link to="/cart">View cart →</Link>
        </p>
      )}
      <details className="restaurant-hours">
        <summary>Opening hours · India time</summary>
        {restaurant.hours.map((slot, index) => (
          <p key={index}>
            {
              ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][
                slot.day
              ]
            }{' '}
            ·{' '}
            {Math.floor(slot.openMinute / 60)
              .toString()
              .padStart(2, '0')}
            :{(slot.openMinute % 60).toString().padStart(2, '0')}–
            {slot.closeMinute === 1440
              ? 'midnight'
              : `${Math.floor(slot.closeMinute / 60)
                  .toString()
                  .padStart(2, '0')}:${(slot.closeMinute % 60).toString().padStart(2, '0')}`}
          </p>
        ))}
        {restaurant.holidays
          .filter((day) => day.closed)
          .map((day) => (
            <p key={day.date}>Closed: {day.date}</p>
          ))}
      </details>
      <div className="menu-offer-row">
        {offers.map((offer) => (
          <OfferCard key={offer.id} offer={offer} />
        ))}
      </div>
      <div className="menu-toolbar">
        <nav aria-label="Menu categories">
          {categories.map((category) => (
            <a key={category} href={`#category-${categories.indexOf(category)}`}>
              {category}
            </a>
          ))}
        </nav>
        <input
          className="form-input"
          type="search"
          aria-label="Search this menu"
          placeholder="Search this menu"
          value={menuSearch}
          onChange={(e) => setMenuSearch(e.target.value)}
        />
      </div>
      <div className="menu-layout">
        <div>
          {categories.map((category) => (
            <section
              className="menu-category"
              id={`category-${categories.indexOf(category)}`}
              key={category}
            >
              <h2>{category}</h2>
              {filtered
                .filter((item) => item.category === category)
                .map((item) => (
                  <article className="dish-row" key={item.id}>
                    <div>
                      <span className={`diet-mark diet-${item.diet}`} aria-label={item.diet} />
                      <h3>{item.name}</h3>
                      <strong>
                        {money(item.priceMinor)}
                        {item.variants.length > 0 ? ' onwards' : ''}
                      </strong>
                      <p>{item.description}</p>
                      {item.allergens.length > 0 && (
                        <p className="allergen-note">
                          Seller-declared allergens: {item.allergens.join(', ')}
                        </p>
                      )}
                      {item.stock !== null && (
                        <p className="small-help">
                          {item.stock > 0 ? `${item.stock} currently available` : 'Sold out'}
                        </p>
                      )}
                    </div>
                    <div className="dish-visual">
                      <img
                        src={imageUrl(item)}
                        alt={item.name}
                        loading="lazy"
                        width={160}
                        height={135}
                      />
                      {session ? (
                        <button
                          className="add-dish"
                          disabled={!restaurant.open || !item.available || item.stock === 0}
                          onClick={() => {
                            setNotice('');
                            setChosen(item);
                          }}
                        >
                          {!item.available || item.stock === 0 ? 'Sold out' : 'Add +'}
                        </button>
                      ) : (
                        <Link
                          className="add-dish"
                          to={`/login?returnTo=${encodeURIComponent(`/restaurants/${restaurant.slug}`)}`}
                        >
                          Sign in to add
                        </Link>
                      )}
                      {!item.imageId && <span>Illustrative photo</span>}
                    </div>
                  </article>
                ))}
            </section>
          ))}
          {!filtered.length && (
            <div className="catalog-empty">
              <h2>No dishes in this view.</h2>
              <p>Try another search or return to the restaurant list.</p>
            </div>
          )}
        </div>
        <aside className="menu-side-note">
          <h3>A little before you order</h3>
          <p>
            {defaultAddress
              ? `Your default: ${defaultAddress.label}, ${defaultAddress.street}`
              : 'Choose a default address in this city to build your cart.'}
          </p>
          <Link className="text-link" to="/addresses">
            Manage addresses →
          </Link>
          <hr />
          <p>
            Dietary and allergen details come from the restaurant. Check directly if you have
            specific dietary needs.
          </p>
          <p>
            Ordering and payment are not open yet. Your cart is a saved selection, not a confirmed
            order.
          </p>
        </aside>
      </div>
      {chosen && (
        <DishChooser
          item={chosen}
          hasAddress={Boolean(defaultAddress)}
          onClose={() => setChosen(undefined)}
          onAdd={add}
        />
      )}
    </div>
  );
}
function DishChooser({
  item,
  hasAddress,
  onClose,
  onAdd,
}: {
  item: MenuItem;
  hasAddress: boolean;
  onClose: () => void;
  onAdd: (line: CartLineInput, replace: boolean) => Promise<void>;
}) {
  const [variantId, setVariant] = useState<string | null>(
      item.variants.find((value) => value.available)?.id ?? null,
    ),
    [optionIds, setOptions] = useState<string[]>([]),
    [quantity, setQuantity] = useState(1),
    [instructions, setInstructions] = useState(''),
    [pending, setPending] = useState(false),
    [error, setError] = useState<unknown>(),
    [replacement, setReplacement] = useState(false);
  const valid = item.modifierGroups.every((group) => {
    const count = group.options.filter((option) => optionIds.includes(option.id)).length;
    return count >= group.min && count <= group.max;
  });
  const price =
    item.priceMinor +
    (item.variants.find((value) => value.id === variantId)?.priceMinor ?? 0) +
    item.modifierGroups
      .flatMap((group) => group.options)
      .filter((option) => optionIds.includes(option.id))
      .reduce((sum, option) => sum + option.priceMinor, 0);
  async function add(replace = false) {
    setPending(true);
    setError(undefined);
    try {
      await onAdd({ itemId: item.id, variantId, optionIds, quantity, instructions }, replace);
    } catch (error) {
      setError(error);
      if (error instanceof ApiError && error.code === 'REPLACE_CART_REQUIRED') setReplacement(true);
    } finally {
      setPending(false);
    }
  }
  return (
    <Modal
      title={replacement ? 'Replace your cart?' : item.name}
      onClose={onClose}
      className="dish-dialog"
    >
      {replacement ? (
        <>
          <ErrorNotice error={error} />
          <p>
            The dishes in your previous cart will be removed only if this new selection is valid.
          </p>
          <button className="red-button" disabled={pending} onClick={() => void add(true)}>
            Replace cart and add
          </button>
          <button className="text-link" onClick={onClose}>
            Keep my current cart
          </button>
        </>
      ) : (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void add();
          }}
        >
          {item.variants.length > 0 && (
            <fieldset>
              <legend>Choose your size</legend>
              {item.variants.map((variant) => (
                <label className="option-row" key={variant.id}>
                  <input
                    type="radio"
                    name="variant"
                    checked={variantId === variant.id}
                    disabled={!variant.available}
                    onChange={() => setVariant(variant.id)}
                  />
                  <span>
                    {variant.name}
                    {!variant.available ? ' · unavailable' : ''}
                  </span>
                  <strong>+ {money(variant.priceMinor)}</strong>
                </label>
              ))}
            </fieldset>
          )}
          {item.modifierGroups.map((group) => (
            <fieldset key={group.id}>
              <legend>
                {group.name}{' '}
                <small>
                  Choose {group.min}–{group.max}
                </small>
              </legend>
              {group.options.map((option) => (
                <label className="option-row" key={option.id}>
                  <input
                    type="checkbox"
                    checked={optionIds.includes(option.id)}
                    disabled={!option.available}
                    onChange={(e) =>
                      setOptions((old) =>
                        e.target.checked
                          ? [...old, option.id]
                          : old.filter((id) => id !== option.id),
                      )
                    }
                  />
                  <span>
                    {option.name}
                    {!option.available ? ' · unavailable' : ''}
                  </span>
                  <strong>+ {money(option.priceMinor)}</strong>
                </label>
              ))}
            </fieldset>
          ))}
          <div className="form-grid">
            <Field label="Quantity">
              <input
                className="form-input"
                type="number"
                min={1}
                max={Math.min(20, item.stock ?? 20)}
                required
                value={quantity}
                onChange={(e) => setQuantity(Number(e.target.value))}
              />
            </Field>
            <Field label="Preparation request">
              <input
                className="form-input"
                maxLength={200}
                value={instructions}
                onChange={(e) => setInstructions(e.target.value)}
                placeholder="Optional; restaurant confirmation required"
              />
            </Field>
          </div>
          {!hasAddress && (
            <p className="form-feedback">
              Choose a default address in this city first.{' '}
              <Link to="/addresses">Manage addresses</Link>
            </p>
          )}
          <ErrorNotice error={error} />
          <button className="red-button" disabled={pending || !valid || !hasAddress}>
            {pending ? 'Adding…' : `Add to cart · ${money(price * quantity)}`}
          </button>
          {!valid && (
            <p className="small-help">Check the required add-on choices before continuing.</p>
          )}
        </form>
      )}
    </Modal>
  );
}
export function OfferCard({
  offer,
}: {
  offer: Offer & { restaurantSlug?: string; restaurantName?: string };
}) {
  return (
    <article className="offer-card">
      <span className="eyebrow">{offer.code}</span>
      <h3>{offer.title}</h3>
      <p>
        {offer.percent}% off, up to {money(offer.maxDiscountMinor)}
      </p>
      <small>
        Items subtotal from {money(offer.minimumSubtotalMinor)} · Ends{' '}
        {new Date(offer.endsAt).toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata' })}.
        Availability and final eligibility are checked at checkout.
      </small>
      {offer.restaurantSlug && (
        <Link className="text-link" to={`/restaurants/${offer.restaurantSlug}`}>
          View {offer.restaurantName ?? 'menu'} →
        </Link>
      )}
    </article>
  );
}
export function FavoritesPage() {
  const { session } = useSession(),
    query = useQuery({
      queryKey: ['favorites', session?.principal.userId],
      queryFn: () => api<Restaurant[]>('/favorites'),
    });
  return (
    <WorkspaceShell title="Your favourites" description="Good places, kept close.">
      <ErrorNotice error={query.error} />
      {query.isPending ? (
        <p role="status">Loading favourites…</p>
      ) : query.data?.length ? (
        <div className="restaurant-grid">
          {query.data.map((restaurant) => (
            <RestaurantCard key={restaurant.id} restaurant={restaurant} />
          ))}
        </div>
      ) : (
        !query.error && (
          <div className="workspace-panel">
            <h2>Your next favourite is waiting.</h2>
            <Link to="/">Explore your city</Link>
          </div>
        )
      )}
    </WorkspaceShell>
  );
}
export function OffersPage() {
  const [params] = useSearchParams(),
    city = params.get('city'),
    query = useQuery({
      queryKey: ['offers', city],
      queryFn: () => api<Offer[]>(`/offers?${new URLSearchParams({ city: city ?? '' })}`),
      enabled: Boolean(city),
    });
  return (
    <section className="page-width menu-page">
      <p className="eyebrow">A little more to love</p>
      <h1>Offers worth a look.</h1>
      {!city ? (
        <p>
          Choose a city from <Link to="/">discovery</Link> to see its restaurant offers.
        </p>
      ) : (
        <>
          <ErrorNotice error={query.error} />
          {query.isPending ? (
            <p role="status">Loading offers…</p>
          ) : query.data?.length ? (
            <div className="offers-grid">
              {query.data.map((offer) => (
                <OfferCard key={offer.id} offer={offer} />
              ))}
            </div>
          ) : (
            !query.error && <p>No active offers for this city right now.</p>
          )}
          <Link className="text-link" to={`/search?city=${city}`}>
            ← Restaurants in {city}
          </Link>
        </>
      )}
    </section>
  );
}
export function CartPage() {
  const { session } = useSession(),
    client = useQueryClient(),
    [error, setError] = useState<unknown>(),
    [pending, setPending] = useState(false),
    [clearing, setClearing] = useState(false);
  const query = useQuery({
      queryKey: ['cart', session?.principal.userId],
      queryFn: () => api<CartState>('/cart'),
    }),
    addresses = useQuery({
      queryKey: ['addresses', session?.principal.userId],
      queryFn: () => api<Address[]>('/addresses'),
    });
  const cart = query.data?.cart;
  async function update(lines: CartLineInput[], addressId = cart?.addressId) {
    if (!cart) return;
    setPending(true);
    setError(undefined);
    try {
      if (!lines.length)
        await api('/cart', { method: 'DELETE', body: { expectedVersion: query.data!.version } });
      else
        await api('/cart', {
          method: 'PUT',
          body: {
            expectedVersion: query.data!.version,
            restaurantId: cart.restaurantId,
            addressId,
            replace: false,
            lines,
          },
        });
      await query.refetch();
      setClearing(false);
    } catch (error) {
      setError(error);
      await query.refetch();
    } finally {
      setPending(false);
      await client.invalidateQueries({ queryKey: ['cart'] });
    }
  }
  return (
    <WorkspaceShell title="Your cart" description="A little closer to your next favourite meal.">
      <ErrorNotice error={query.error ?? error} />
      {query.isPending ? (
        <p role="status">Loading your cart…</p>
      ) : cart ? (
        <div className="cart-layout">
          <div className="workspace-panel">
            <div className="panel-title-row">
              <h2>{cart.restaurantName}</h2>
              <button className="text-link" disabled={pending} onClick={() => setClearing(true)}>
                Clear cart
              </button>
            </div>
            {clearing && (
              <div className="confirm-inline">
                <p>Remove every dish from this cart?</p>
                <button
                  className="outline-button"
                  disabled={pending}
                  onClick={() => void update([])}
                >
                  Confirm clear cart
                </button>
                <button className="text-link" onClick={() => setClearing(false)}>
                  Keep dishes
                </button>
              </div>
            )}
            {cart.issues.map((issue) => (
              <p key={issue} className="form-feedback" role="alert">
                {issue}
              </p>
            ))}
            <button
              className="text-link"
              disabled={pending}
              onClick={() => void update(cart.lines.map(lineInput))}
            >
              Recheck menu and update cart prices
            </button>
            {cart.lines.map((line, index) => (
              <article className="cart-line" key={index}>
                <div>
                  <h3>{line.name}</h3>
                  <p>{line.selection.join(' · ')}</p>
                  {line.instructions && <p className="small-help">Request: {line.instructions}</p>}
                  <strong>{money(line.unitPriceMinor * line.quantity)}</strong>
                </div>
                <div className="quantity-control">
                  <button
                    aria-label={`Reduce ${line.name}`}
                    disabled={pending || line.quantity <= 1}
                    onClick={() =>
                      void update(
                        cart.lines.map((value, i) => ({
                          ...lineInput(value),
                          quantity: i === index ? value.quantity - 1 : value.quantity,
                        })),
                      )
                    }
                  >
                    −
                  </button>
                  <span>{line.quantity}</span>
                  <button
                    aria-label={`Increase ${line.name}`}
                    disabled={pending || line.quantity >= 20}
                    onClick={() =>
                      void update(
                        cart.lines.map((value, i) => ({
                          ...lineInput(value),
                          quantity: i === index ? value.quantity + 1 : value.quantity,
                        })),
                      )
                    }
                  >
                    +
                  </button>
                </div>
                <button
                  className="text-link"
                  disabled={pending}
                  onClick={() =>
                    void update(cart.lines.filter((_, i) => i !== index).map(lineInput))
                  }
                >
                  Remove
                </button>
              </article>
            ))}
          </div>
          <aside className="workspace-panel cart-summary">
            <h2>Your selection</h2>
            <Field label="Delivery address">
              <select
                className="form-input"
                value={cart.addressId}
                disabled={pending}
                onChange={(e) => void update(cart.lines.map(lineInput), e.target.value)}
              >
                <option
                  value={cart.addressId}
                  disabled={!addresses.data?.some((address) => address.id === cart.addressId)}
                >
                  {addresses.data?.find((address) => address.id === cart.addressId)?.label ??
                    'Address unavailable'}
                </option>
                {addresses.data
                  ?.filter((address) => address.id !== cart.addressId)
                  .map((address) => (
                    <option value={address.id} key={address.id}>
                      {address.label} · {address.city}
                    </option>
                  ))}
              </select>
            </Field>
            <Link className="text-link" to="/addresses">
              Manage addresses
            </Link>
            <div className="subtotal-row">
              <span>Items subtotal</span>
              <strong>{money(cart.subtotalMinor)}</strong>
            </div>
            <p className="small-help">
              This is a saved selection. Stock is not reserved. Taxes, delivery fees and offers
              require a fresh checkout quote.
            </p>
            {cart.checkoutEnabled ? (
              <Link className="red-button" to="/checkout">
                Proceed to checkout
              </Link>
            ) : (
              <p className="small-help">Checkout is currently unavailable.</p>
            )}
          </aside>
        </div>
      ) : (
        !query.error && (
          <div className="catalog-empty">
            <h2>Your cart has room for a craving.</h2>
            <p>Find a restaurant, choose an address, and make it yours.</p>
            <Link className="red-button" to="/">
              Explore food
            </Link>
          </div>
        )
      )}
    </WorkspaceShell>
  );
}

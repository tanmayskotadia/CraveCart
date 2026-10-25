import { useEffect, lazy, Suspense } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { findCity } from '@cravecart/contracts';
import { useCity } from '../components/CityProvider';
import { SearchBar } from '../components/SearchBar';
import { Icon } from '../components/Icon';
const RestaurantResults = lazy(() =>
  import('./Catalog').then((module) => ({ default: module.RestaurantResults })),
);

export function Explore() {
  const [params] = useSearchParams();
  const city = findCity(params.get('city'));
  const query = (params.get('q') ?? '').slice(0, 100);
  const { openCities, selectCity } = useCity();
  useEffect(() => {
    if (city) selectCity(city);
  }, [city, selectCity]);
  if (!city)
    return (
      <section className="message-page page-width">
        <p className="eyebrow">A country of possibilities</p>
        <h1>Let’s find your city.</h1>
        <p>
          Select a city to start exploring. Delivery availability will be checked for your area.
        </p>
        <button className="red-button" onClick={() => openCities(query)}>
          Choose a city <Icon name="pin" size={18} />
        </button>
      </section>
    );
  return (
    <div className="explore-page page-width">
      <nav className="breadcrumbs" aria-label="Breadcrumb">
        <Link to="/">Home</Link>
        <span>/</span>
        <span>{city.name}</span>
      </nav>
      <div className="discovery-intro">
        <div>
          <p className="eyebrow">{city.state}, India</p>
          <h1>
            {query ? `${query} in ${city.name}` : `Hello, ${city.name}.`}
            <span className="sr-only"> What are you craving?</span>
          </h1>
          <p>Discover food from kitchens near you.</p>
        </div>
        <SearchBar key={city.slug + query} initialQuery={query} />
      </div>
      <nav className="delivery-tabs" aria-label="Food discovery">
        <span className="active">Food delivery</span>
        <Link to="/orders">Your orders</Link>
        <Link to="/favorites">Favourites</Link>
      </nav>
      <section className="inspiration-band">
        <h2>Inspiration for your next order</h2>
        <div className="cuisine-circles">
          {[
            ['Biryani', 'biryani', 'Biryani'],
            ['South Indian', 'indian-feast', 'South Indian'],
            ['Pizza', 'pizza', 'Pizza'],
            ['Meals', 'indian-feast', 'Meals'],
            ['North Indian', 'indian-feast', 'North Indian'],
            ['Rice bowls', 'biryani', 'Rice'],
          ].map(([label, image, term]) => (
            <Link key={label} to={`/search?${new URLSearchParams({ city: city.slug, q: term! })}`}>
              <img src={`/images/${image}.webp`} alt="" width={115} height={115} />
              <span>{label}</span>
            </Link>
          ))}
        </div>
      </section>
      <Suspense fallback={<p role="status">Loading restaurants…</p>}>
        <RestaurantResults city={city.slug} />
      </Suspense>
      <div className="service-notice" role="status">
        <span className="notice-icon">
          <Icon name="pin" size={24} />
        </span>
        <div>
          <h2>Choose a delivery address.</h2>
          <p>
            Availability depends on your exact address and the restaurant’s delivery area. Checkout
            clearly identifies sandbox payments before you place an order.
          </p>
        </div>
      </div>
      <section className="explore-flavours">
        <h2>A little inspiration for your next meal</h2>
        <p>Explore a craving. Restaurant availability will follow.</p>
        <div className="flavour-grid">
          {[
            {
              name: 'Biryani',
              image: 'biryani',
              description: 'A bowl of comfort, full of flavour.',
            },
            { name: 'Pizza', image: 'pizza', description: 'For the moments worth sharing.' },
          ].map((dish) => (
            <Link
              key={dish.image}
              to={`/search?${new URLSearchParams({ city: city.slug, q: dish.name })}`}
              className="flavour-card"
            >
              <img src={`/images/${dish.image}.webp`} alt={dish.name} width={260} height={260} />
              <div>
                <h3>{dish.name}</h3>
                <p>{dish.description}</p>
              </div>
              <Icon name="arrow" />
            </Link>
          ))}
        </div>
      </section>
    </div>
  );
}

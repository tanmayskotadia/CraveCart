import { useEffect, lazy, Suspense } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { findCity } from '@cravecart/contracts';
import { useCity } from '../components/CityProvider';
import { SearchBar } from '../components/SearchBar';
import { Icon } from '../components/Icon';
const RestaurantResults = lazy(() =>
  import('./Catalog').then((module) => ({ default: module.RestaurantResults })),
);
const cravings = [
  { label: 'Biryani', image: 'biryani.webp', description: 'Big on flavour', term: 'Biryani' },
  { label: 'Pizza', image: 'pizza.webp', description: 'A slice of happiness', term: 'Pizza' },
  {
    label: 'South Indian',
    image: 'south-indian.webp',
    description: 'Comfort on a plate',
    term: 'South Indian',
  },
];
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
    <div className="explore-page page-width discovery-v2">
      <nav className="breadcrumbs" aria-label="Breadcrumb">
        <Link to="/">Home</Link>
        <span>/</span>
        <span>{city.name}</span>
      </nav>
      <section className="craving-hero" aria-labelledby="craving-heading">
        <div className="craving-hero-copy">
          <p className="eyebrow">
            <span /> GOOD FOOD. GOOD MOOD.
          </p>
          <h1 id="craving-heading">
            {query ? (
              <>
                {query} in {city.name}
                <span className="sr-only"> What are you craving?</span>
              </>
            ) : (
              <>
                Hello, {city.name}.<br />
                <span>What’s the craving?</span>
              </>
            )}
          </h1>
          <p>Your comfort meal. A new favourite. Find a little delicious in your day.</p>
          <SearchBar key={city.slug + query} initialQuery={query} />
          <div className="hero-search-hint">
            <Icon name="fork" size={16} /> Made for your next “that looks good”.
          </div>
        </div>
        <div className="craving-hero-art" aria-hidden="true">
          <div className="food-orbit" />
          <img
            className="hero-food-main"
            src="/images/biryani.webp"
            alt=""
            width={450}
            height={450}
          />
          <img
            className="hero-food-small"
            src="/images/pizza.webp"
            alt=""
            width={200}
            height={200}
          />
          <span className="food-note">
            A little spice.
            <br />
            <strong>A lot of happiness.</strong>
          </span>
          <span className="food-spark spark-one">✦</span>
          <span className="food-spark spark-two">✦</span>
        </div>
      </section>
      <nav className="delivery-tabs" aria-label="Food discovery">
        <span className="active">
          <Icon name="fork" size={20} /> Food delivery
        </span>
        <Link to="/orders">
          <Icon name="bag" size={20} /> Your orders
        </Link>
        <Link to="/favorites">
          <Icon name="heart" size={20} /> Favourites
        </Link>
      </nav>
      <section className="craving-picks" aria-labelledby="picks-heading">
        <div className="discovery-section-heading">
          <div>
            <p className="eyebrow">FOLLOW YOUR APPETITE</p>
            <h2 id="picks-heading">What sounds good?</h2>
          </div>
          <span>One craving away from your next favourite.</span>
        </div>
        <div className="craving-cards">
          {cravings.map((dish) => (
            <Link
              className={`craving-card ${query.toLowerCase() === dish.term.toLowerCase() ? 'selected' : ''}`}
              key={dish.label}
              to={`/search?${new URLSearchParams({ city: city.slug, q: dish.term })}`}
            >
              <div>
                <h3>{dish.label}</h3>
                <p>{dish.description}</p>
                <span className="craving-card-arrow">
                  <Icon name="arrow" size={20} />
                </span>
              </div>
              <img src={`/images/${dish.image}`} alt="" width={180} height={180} />
            </Link>
          ))}
        </div>
      </section>
      <section className="discovery-restaurants" aria-label="Restaurants">
        <Suspense fallback={<p role="status">Loading restaurants…</p>}>
          <RestaurantResults city={city.slug} />
        </Suspense>
      </section>
      <div className="service-notice" role="status">
        <span className="notice-icon">
          <Icon name="pin" size={24} />
        </span>
        <div>
          <h2>Choose a delivery address.</h2>
          <p>
            Availability depends on your exact address and the restaurant’s delivery area. Add your
            pin to find the kitchens that can deliver to you.
          </p>
        </div>
        <Link to="/addresses" className="text-link">
          Set my address <Icon name="arrow" size={18} />
        </Link>
      </div>
    </div>
  );
}

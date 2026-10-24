import { useEffect } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { findCity } from '@cravecart/contracts';
import { useCity } from '../components/CityProvider';
import { SearchBar } from '../components/SearchBar';
import { Icon } from '../components/Icon';

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
      <div className="explore-heading">
        <p className="eyebrow">{city.state}, India</p>
        <h1>
          {query ? `${query} in ${city.name}` : `Hello, ${city.name}.`}
          <span>What are you craving?</span>
        </h1>
        <p>A city full of flavour. Let’s find your next favourite.</p>
      </div>
      <SearchBar key={city.slug + query} initialQuery={query} />
      <div className="service-notice" role="status">
        <span className="notice-icon">
          <Icon name="pin" size={24} />
        </span>
        <div>
          <h2>Good things are cooking in {city.name}.</h2>
          <p>
            Delivery is opening area by area. Restaurant menus will appear here when service is
            available near you. No orders are being accepted yet.
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

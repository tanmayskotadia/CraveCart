import { useState } from 'react';
import { useCity } from './CityProvider';
import { Icon } from './Icon';

export function SearchBar({ initialQuery = '' }: { initialQuery?: string }) {
  const { city, openCities, explore } = useCity();
  const [query, setQuery] = useState(initialQuery);
  return (
    <form
      className="search-bar"
      role="search"
      onSubmit={(event) => {
        event.preventDefault();
        explore(query);
      }}
    >
      <button
        className="location-button"
        type="button"
        aria-label={city ? `Change city, currently ${city.name}` : 'Select your city'}
        onClick={() => openCities(query)}
      >
        <Icon name="pin" size={23} />
        <span>{city?.name ?? 'Select your city'}</span>
        <Icon name="down" size={15} />
      </button>
      <span className="search-divider" />
      <label className="search-input">
        <Icon name="search" size={23} />
        <input
          aria-label="Search for a dish or cuisine"
          placeholder="Search for a dish or cuisine"
          maxLength={100}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </label>
      <button className="search-submit" type="submit" aria-label="Explore food">
        <Icon name="arrow" size={22} />
      </button>
    </form>
  );
}

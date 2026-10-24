import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { cityDirectory, findCity, type DiscoveryCity } from '@cravecart/contracts';
import { Modal } from './Modal';
import { Icon } from './Icon';

interface CityContextValue {
  city: DiscoveryCity | undefined;
  selectCity: (city: DiscoveryCity) => void;
  openCities: (query?: string) => void;
  explore: (query?: string) => void;
}
const CityContext = createContext<CityContextValue | null>(null);
export function useCity() {
  const value = useContext(CityContext);
  if (!value) throw new Error('Missing city provider');
  return value;
}
export function CityProvider({ children }: { children: ReactNode }) {
  const navigate = useNavigate();
  const [city, setCity] = useState<DiscoveryCity | undefined>(() => {
    try {
      return findCity(localStorage.getItem('cravecart.city'));
    } catch {
      return undefined;
    }
  });
  const [open, setOpen] = useState(false);
  const [filter, setFilter] = useState('');
  const [pendingQuery, setPendingQuery] = useState('');
  useEffect(() => {
    try {
      if (city) localStorage.setItem('cravecart.city', city.slug);
    } catch {
      /* Browsing remains available without storage. */
    }
  }, [city]);
  const openCities = (query = '') => {
    setFilter('');
    setPendingQuery(query);
    setOpen(true);
  };
  const selectCity = useCallback((selected: DiscoveryCity) => {
    setCity(selected);
  }, []);
  const explore = (query = '') => {
    if (!city) {
      openCities(query);
      return;
    }
    navigate(
      `/search?${new URLSearchParams({ city: city.slug, ...(query.trim() ? { q: query.trim().slice(0, 100) } : {}) })}`,
    );
  };
  const choose = (selected: DiscoveryCity) => {
    setCity(selected);
    setOpen(false);
    navigate(
      `/search?${new URLSearchParams({ city: selected.slug, ...(pendingQuery.trim() ? { q: pendingQuery.trim().slice(0, 100) } : {}) })}`,
    );
  };
  const visible = cityDirectory.filter((item) =>
    `${item.name} ${item.state}`.toLowerCase().includes(filter.toLowerCase().trim()),
  );
  return (
    <CityContext.Provider value={{ city, selectCity, openCities, explore }}>
      {children}
      {open && (
        <Modal
          title="Where’s your next craving?"
          onClose={() => setOpen(false)}
          className="city-modal"
        >
          <p className="modal-subtitle">Find your city. Discover its flavours.</p>
          <label className="city-filter">
            <Icon name="search" />
            <input
              type="search"
              aria-label="Search cities"
              placeholder="Search for a city"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
            />
          </label>
          <div className="city-options">
            {visible.map((item) => (
              <button key={item.slug} className="city-option" onClick={() => choose(item)}>
                <Icon name="pin" size={18} />
                <span>
                  <strong>{item.name}</strong>
                  <small>{item.state}</small>
                </span>
                {city?.slug === item.slug ? (
                  <Icon name="check" size={18} />
                ) : (
                  <Icon name="chevron" size={16} />
                )}
              </button>
            ))}
            {visible.length === 0 && (
              <p className="empty-city">No city matches “{filter}”. Try another city name.</p>
            )}
          </div>
          <p className="modal-footnote">
            City discovery is available now. Delivery opens area by area.
          </p>
        </Modal>
      )}
    </CityContext.Provider>
  );
}

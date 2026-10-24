import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { cityDirectory, platformSchema } from '@cravecart/contracts';
import { SearchBar } from '../components/SearchBar';
import { useCity } from '../components/CityProvider';
import { Icon } from '../components/Icon';

function useReveals() {
  useEffect(() => {
    if (
      matchMedia('(prefers-reduced-motion: reduce)').matches ||
      !('IntersectionObserver' in window)
    )
      return;
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            entry.target.classList.add('is-visible');
            observer.unobserve(entry.target);
          }
        });
      },
      { threshold: 0.12 },
    );
    document.documentElement.classList.add('motion-ready');
    document.querySelectorAll('.reveal').forEach((node) => observer.observe(node));
    return () => {
      observer.disconnect();
      document.documentElement.classList.remove('motion-ready');
    };
  }, []);
}
async function getPlatform() {
  const response = await fetch(`${import.meta.env.VITE_API_ORIGIN ?? ''}/api/v1/platform`, {
    signal: AbortSignal.timeout(4000),
  });
  if (!response.ok) throw new Error('Availability could not be checked');
  return platformSchema.parse(await response.json());
}

export function Landing() {
  useReveals();
  const platform = useQuery({ queryKey: ['platform'], queryFn: getPlatform });
  const { openCities, selectCity, explore } = useCity();
  const [allCities, setAllCities] = useState(false);
  const [dish, setDish] = useState<'biryani' | 'pizza'>('biryani');
  return (
    <>
      <section className="hero" aria-labelledby="hero-title">
        <picture className="hero-picture">
          <img
            src="/images/indian-feast.webp"
            alt=""
            width={1672}
            height={941}
            fetchPriority="high"
          />
        </picture>
        <div className="hero-shade" />
        <div className="hero-content">
          <p className="hero-wordmark">cravecart</p>
          <h1 id="hero-title">
            Every craving.
            <br />
            Every corner of India.
          </h1>
          <p className="hero-subtitle">Find the food you love, in the city you call home.</p>
          <SearchBar />
          <div className="hero-suggestions">
            <span>On your mind?</span>
            {['Biryani', 'Pizza', 'South Indian'].map((name) => (
              <button key={name} onClick={() => explore(name)}>
                {name}
                <span aria-hidden="true">↗</span>
              </button>
            ))}
          </div>
        </div>
        <a className="scroll-cue" href="#discover">
          A little more to love
          <Icon name="down" size={20} />
        </a>
      </section>

      <section id="discover" className="food-story section-anchor">
        <svg
          className="story-lines"
          viewBox="0 0 1440 640"
          fill="none"
          preserveAspectRatio="none"
          aria-hidden="true"
        >
          <path d="M-50 360C250 120 50 50 310 90S600 350 400 450 300 680 650 600M1490 220C1220 450 1370 580 1120 530S850 280 1080 190 1150-20 800 40" />
        </svg>
        <img
          className="floating-food floating-biryani"
          src="/images/biryani.webp"
          alt="A bowl of saffron biryani with fresh herbs"
          width={360}
          height={360}
          loading="lazy"
        />
        <img
          className="floating-food floating-pizza"
          src="/images/pizza.webp"
          alt="Fresh basil and mozzarella pizza"
          width={350}
          height={350}
          loading="lazy"
        />
        <div className="story-copy reveal">
          <p className="eyebrow">A country of cravings</p>
          <h2>
            Good food.
            <br />
            No boundaries.
          </h2>
          <p>
            Different cities. Different favourites.
            <br />
            The same love for a really good meal.
          </p>
          <button className="text-link" onClick={() => openCities()}>
            Find your city <Icon name="arrow" size={19} />
          </button>
        </div>
        <div className="story-values reveal">
          <div>
            <Icon name="fork" size={27} />
            <span>Regional flavours</span>
          </div>
          <span className="value-divider" />
          <div>
            <Icon name="pin" size={27} />
            <span>Local discoveries</span>
          </div>
          <span className="value-divider" />
          <div>
            <Icon name="heart" size={27} />
            <span>Everyday favourites</span>
          </div>
        </div>
      </section>

      <section className="experience-section">
        <div className="section-heading reveal">
          <p className="eyebrow">A little more you</p>
          <h2>
            Your kind of food.
            <br />
            Your kind of experience.
          </h2>
          <p>From “what should we eat?” to “that’s the one.”</p>
        </div>
        <div className="experience-stage reveal">
          <div className="experience-feature feature-discover">
            <span className="feature-icon">
              <Icon name="search" size={28} />
            </span>
            <h3>Follow your cravings</h3>
            <p>
              Start with a dish.
              <br />
              Discover a new favourite.
            </p>
          </div>
          <div className="experience-feature feature-city">
            <span className="feature-icon">
              <Icon name="pin" size={28} />
            </span>
            <h3>Make it local</h3>
            <p>
              Your city.
              <br />
              Its own world of flavour.
            </p>
          </div>
          <div className="phone">
            <div className="phone-notch" />
            <div className="phone-screen">
              <div className="phone-top">
                <span className="mini-wordmark">cravecart</span>
                <span className="phone-location">
                  <Icon name="pin" size={12} />
                  India
                </span>
              </div>
              <h3>
                What’s on
                <br />
                your mind?
              </h3>
              <div className="phone-food">
                <img
                  key={dish}
                  src={`/images/${dish}.webp`}
                  alt={dish === 'biryani' ? 'Biryani discovery preview' : 'Pizza discovery preview'}
                  width={240}
                  height={240}
                  loading="lazy"
                />
              </div>
              <span className="phone-kicker">A little comfort. A lot of flavour.</span>
              <strong className="phone-dish">
                {dish === 'biryani' ? 'Biryani, anyone?' : 'A slice of happiness.'}
              </strong>
              <div className="dish-toggle" aria-label="Food preview">
                <button
                  className={dish === 'biryani' ? 'active' : ''}
                  aria-pressed={dish === 'biryani'}
                  onClick={() => setDish('biryani')}
                >
                  Biryani
                </button>
                <button
                  className={dish === 'pizza' ? 'active' : ''}
                  aria-pressed={dish === 'pizza'}
                  onClick={() => setDish('pizza')}
                >
                  Pizza
                </button>
              </div>
              <div className="phone-bottom">
                <Icon name="search" size={18} />
                <Icon name="heart" size={18} />
                <Icon name="bag" size={18} />
              </div>
            </div>
          </div>
          <div className="experience-feature feature-choice">
            <span className="feature-icon">
              <Icon name="sliders" size={28} />
            </span>
            <h3>A taste for every mood</h3>
            <p>
              Comfort classics.
              <br />
              Something unexpected.
            </p>
          </div>
          <div className="experience-feature feature-love">
            <span className="feature-icon">
              <Icon name="heart" size={28} />
            </span>
            <h3>Made for food people</h3>
            <p>
              The big celebrations.
              <br />
              The everyday little joys.
            </p>
          </div>
        </div>
        <p className="experience-caption">
          A glimpse of what’s cooking. Ordering opens area by area.
        </p>
      </section>

      <section id="cities" className="cities-section section-anchor">
        <div className="cities-heading reveal">
          <div>
            <p className="eyebrow">Near you, wherever you are</p>
            <h2>
              Find your flavour
              <br />
              across <span>India.</span>
            </h2>
          </div>
          <p>
            Big-city favourites. Hometown comforts.
            <br />
            Start exploring your city.
          </p>
        </div>
        <div className="cities-grid reveal">
          {cityDirectory.slice(0, allCities ? undefined : 9).map((city) => (
            <Link
              className="city-card"
              key={city.slug}
              to={`/search?city=${city.slug}`}
              onClick={() => selectCity(city)}
            >
              <span>
                <strong>{city.name}</strong>
                <small>{city.state}</small>
              </span>
              <Icon name="chevron" size={18} />
            </Link>
          ))}
        </div>
        <button
          className="all-cities-button"
          aria-expanded={allCities}
          onClick={() => setAllCities(!allCities)}
        >
          {allCities ? 'Show fewer cities' : 'See all cities'}
          <Icon name="down" size={17} className={allCities ? 'turned' : ''} />
        </button>
        <div className="availability-note" role="status">
          {platform.isPending ? (
            'Checking delivery availability…'
          ) : platform.isError ? (
            <>
              We couldn’t check delivery availability. You can still explore cities.
              <button onClick={() => void platform.refetch()}>Check again</button>
            </>
          ) : (
            'Explore cities across India. Live delivery availability depends on your area.'
          )}
        </div>
      </section>

      <section id="partners" className="partners-section section-anchor">
        <div className="partners-inner">
          <div className="partners-title reveal">
            <p className="eyebrow">A place at the table</p>
            <h2>
              Great food.
              <br />
              <span>Greater possibilities.</span>
            </h2>
            <p>Good things happen when we come together.</p>
          </div>
          <div className="partner-links reveal">
            <Link to="/seller/login">
              <div>
                <span className="partner-number">01 / FOR RESTAURANTS</span>
                <h3>Your kitchen. A bigger audience.</h3>
                <p>Bring what you do best to more people.</p>
              </div>
              <span className="partner-arrow">
                <Icon name="arrow" size={27} />
              </span>
            </Link>
            <Link to="/rider/login">
              <div>
                <span className="partner-number">02 / FOR DELIVERY PARTNERS</span>
                <h3>Be part of the journey.</h3>
                <p>Make the everyday a little more rewarding.</p>
              </div>
              <span className="partner-arrow">
                <Icon name="arrow" size={27} />
              </span>
            </Link>
          </div>
        </div>
      </section>
    </>
  );
}

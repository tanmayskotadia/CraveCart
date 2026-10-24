import { useEffect, useState } from 'react';
import { Link, Navigate, Route, Routes, matchPath, useLocation } from 'react-router-dom';
import manifest from '../../../contracts/routes.json';
import { CityProvider, useCity } from './components/CityProvider';
import { AuthModal } from './components/LoginDialog';
import { Icon } from './components/Icon';
import { Landing } from './pages/Landing';
import { Explore } from './pages/Explore';
import { useSession } from './components/SessionProvider';
import { RequireSession } from './components/WorkspaceShell';
import { AccountPage, SecurityPage, SessionsPage, WorkspacesPage } from './pages/Account';
import { OnboardingPage, SellerWorkspace, RiderWorkspace } from './pages/Onboarding';
import {
  AdminOverview,
  VerificationQueue,
  VerificationDetail,
  AdminUsers,
  AdminAudit,
} from './pages/Verification';

const authPaths = [
  '/login',
  '/signup',
  '/seller/login',
  '/seller/register',
  '/rider/login',
  '/rider/register',
  '/admin/login',
];
function Header() {
  const location = useLocation();
  const { session, logout } = useSession();
  const [logoutError, setLogoutError] = useState('');
  const overlay = location.pathname === '/' || authPaths.includes(location.pathname);
  const { city, openCities } = useCity();
  const authState = {
    from: authPaths.includes(location.pathname) ? '/' : location.pathname + location.search,
  };
  return (
    <header className={`site-header ${overlay ? 'header-overlay' : 'header-solid'}`}>
      <div className="header-inner">
        <Link className="brand" to="/" aria-label="CraveCart home">
          cravecart
        </Link>
        <button className="header-city" onClick={() => openCities()}>
          <Icon name="pin" size={18} />
          <span>{city?.name ?? 'India'}</span>
          <Icon name="down" size={13} />
        </button>
        <nav aria-label="Main navigation">
          <Link className="desktop-nav" to="/#cities">
            Explore cities
          </Link>
          <Link className="desktop-nav" to="/seller/login" state={authState}>
            Add restaurant
          </Link>
          {session ? (
            <>
              <Link className="desktop-nav" to="/workspaces">
                Workspaces
              </Link>
              <Link className="account-chip" to="/profile" aria-label="My account">
                {session.principal.name.charAt(0).toUpperCase()}
              </Link>
              <button
                className="header-logout"
                onClick={() => {
                  void logout().catch((error) =>
                    setLogoutError(error instanceof Error ? error.message : 'Could not sign out'),
                  );
                }}
              >
                Sign out
              </button>
            </>
          ) : (
            <>
              <Link to="/login" state={authState}>
                Log in
              </Link>
              <Link className="signup-link" to="/signup" state={authState}>
                Sign up
              </Link>
            </>
          )}
        </nav>
      </div>
      {logoutError && (
        <p className="header-error" role="alert">
          {logoutError}
        </p>
      )}
    </header>
  );
}
function Footer() {
  return (
    <footer className="site-footer">
      <div className="footer-inner">
        <div className="footer-top">
          <Link className="brand" to="/">
            cravecart
          </Link>
          <span className="country-badge">
            <span className="india-flag" aria-hidden="true" />
            India<span>English</span>
          </span>
        </div>
        <div className="footer-columns">
          <div>
            <h2>ABOUT CRAVECART</h2>
            <Link to="/#discover">Our story</Link>
            <Link to="/#cities">Explore cities</Link>
            <Link to="/help">Help & support</Link>
          </div>
          <div>
            <h2>FOR RESTAURANTS</h2>
            <Link to="/seller/login">Partner with us</Link>
            <Link to="/seller/login">Restaurant login</Link>
          </div>
          <div>
            <h2>FOR DELIVERY PARTNERS</h2>
            <Link to="/rider/login">Join the journey</Link>
            <Link to="/rider/login">Partner login</Link>
          </div>
          <div>
            <h2>LEARN MORE</h2>
            <Link to="/legal/privacy">Privacy</Link>
            <Link to="/legal/terms">Terms of service</Link>
            <Link to="/legal/cancellations">Cancellation policy</Link>
            <Link to="/admin/login">Team access</Link>
          </div>
        </div>
        <div className="footer-bottom">
          <p>Different cities. One love for good food.</p>
          <span>© {new Date().getFullYear()} CraveCart. All rights reserved.</span>
        </div>
      </div>
    </footer>
  );
}
export function MessagePage({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="message-page page-width">
      <p className="eyebrow">CraveCart · India</p>
      <h1>{title}</h1>
      <div className="message-copy">{children}</div>
      <Link className="red-button" to="/">
        Back to home
        <Icon name="arrow" size={18} />
      </Link>
    </section>
  );
}
function ProtectedPage({ roles }: { roles: string[] }) {
  return (
    <RequireSession roles={roles}>
      <MessagePage title="Something good is on its way">
        <p>
          This workspace feature is being prepared. Your account and application tools are available
          from Workspaces.
        </p>
        <Link className="text-link" to="/workspaces">
          Choose a workspace
        </Link>
      </MessagePage>
    </RequireSession>
  );
}
function PartnerEntry({ kind }: { kind: 'seller' | 'rider' }) {
  const { session } = useSession();
  return (
    <RequireSession applicantRole={kind}>
      <Navigate
        replace
        to={
          session?.principal.roles.includes(kind)
            ? kind === 'seller'
              ? '/seller/restaurants'
              : '/rider/dashboard'
            : `/${kind}/onboarding`
        }
      />
    </RequireSession>
  );
}
function RoutePage({
  route,
}: {
  route: { path: string; sessionRequired: boolean; roles: string[] };
}) {
  const path = route.path;
  if (path === '/profile')
    return (
      <RequireSession>
        <AccountPage />
      </RequireSession>
    );
  if (path === '/settings')
    return (
      <RequireSession>
        <SecurityPage />
      </RequireSession>
    );
  if (path === '/settings/sessions')
    return (
      <RequireSession>
        <SessionsPage />
      </RequireSession>
    );
  if (path === '/workspaces')
    return (
      <RequireSession>
        <WorkspacesPage />
      </RequireSession>
    );
  if (path === '/seller/onboarding' || path === '/rider/onboarding') {
    const kind = path.startsWith('/seller') ? 'seller' : 'rider';
    return (
      <RequireSession applicantRole={kind}>
        <OnboardingPage kind={kind} />
      </RequireSession>
    );
  }
  if (path === '/seller' || path === '/rider')
    return <PartnerEntry kind={path === '/seller' ? 'seller' : 'rider'} />;
  if (path === '/seller/restaurants')
    return (
      <RequireSession roles={['seller']}>
        <SellerWorkspace />
      </RequireSession>
    );
  if (path === '/rider/dashboard' || path === '/rider/profile')
    return (
      <RequireSession roles={['rider']}>
        <RiderWorkspace />
      </RequireSession>
    );
  const adminPages: Record<string, React.ReactNode> = {
    '/admin': <Navigate to="/admin/dashboard" replace />,
    '/admin/dashboard': <AdminOverview />,
    '/admin/verifications': <VerificationQueue />,
    '/admin/verifications/:applicationId': <VerificationDetail />,
    '/admin/users': <AdminUsers />,
    '/admin/audit': <AdminAudit />,
  };
  if (adminPages[path])
    return <RequireSession roles={['admin']}>{adminPages[path]}</RequireSession>;
  return route.sessionRequired ? <ProtectedPage roles={route.roles} /> : <PublicPage path={path} />;
}
function PublicPage({ path }: { path: string }) {
  if (path === '/') return <Landing />;
  if (authPaths.includes(path))
    return (
      <>
        <Landing />
        <AuthModal key={path} />
      </>
    );
  if (path === '/search') return <Explore />;
  if (path === '/location') return <Explore />;
  if (path === '*')
    return (
      <MessagePage title="We couldn’t find that page">
        <p>The link may have changed. Head home to find your way.</p>
      </MessagePage>
    );
  if (path === '/403')
    return (
      <MessagePage title="This workspace isn’t available to you">
        <p>Use an account with the required access.</p>
      </MessagePage>
    );
  if (path === '/cart')
    return (
      <MessagePage title="A little room for your next craving">
        <p>Your cart is empty. Restaurant menus will appear when delivery opens in your area.</p>
      </MessagePage>
    );
  if (path.startsWith('/legal/'))
    return (
      <MessagePage title="Our policies are being prepared">
        <p>
          Approved terms, privacy and cancellation policies will be published before ordering opens.
          No orders or payments are currently accepted.
        </p>
      </MessagePage>
    );
  if (path === '/help')
    return (
      <MessagePage title="A little help, right here.">
        <div className="help-questions">
          <details>
            <summary>Can I order food right now?</summary>
            <p>
              Not yet. Explore the city directory now; restaurant menus and ordering open as each
              delivery area is configured.
            </p>
          </details>
          <details>
            <summary>Is CraveCart only for Chennai?</summary>
            <p>
              No. CraveCart is being built for India, with city-specific delivery areas. Explore the
              city directory to choose your city.
            </p>
          </details>
          <details>
            <summary>Why didn’t I receive a login code?</summary>
            <p>
              In local development, the code is shown on the verification screen and no message is
              sent. Live SMS and email delivery require configured providers.
            </p>
          </details>
        </div>
      </MessagePage>
    );
  return (
    <MessagePage title="Something good is on its way">
      <p>
        We’re preparing this experience for India. Explore your city while we get the kitchens
        ready.
      </p>
    </MessagePage>
  );
}
function RiderAlias() {
  const location = useLocation();
  const path = location.pathname.replace(/^\/driver(?=\/|$)/, '/rider');
  const known = manifest.routes.some(
    (route) => route.workspace === 'rider' && matchPath({ path: route.path, end: true }, path),
  );
  return known ? <Navigate to={`${path}${location.search}`} replace /> : <PublicPage path="*" />;
}
function ScrollToSection() {
  const location = useLocation();
  useEffect(() => {
    if (!location.hash) {
      window.scrollTo(0, 0);
      return;
    }
    const frame = requestAnimationFrame(() =>
      document.getElementById(location.hash.slice(1))?.scrollIntoView(),
    );
    return () => cancelAnimationFrame(frame);
  }, [location.pathname, location.hash]);
  return null;
}
export function App() {
  return (
    <CityProvider>
      <a className="skip-link" href="#main">
        Skip to content
      </a>
      <Header />
      <main id="main" tabIndex={-1}>
        <Routes>
          {manifest.routes.map((route) => (
            <Route key={route.id} path={route.path} element={<RoutePage route={route} />} />
          ))}
          <Route path="/driver/*" element={<RiderAlias />} />
        </Routes>
      </main>
      <Footer />
      <ScrollToSection />
    </CityProvider>
  );
}

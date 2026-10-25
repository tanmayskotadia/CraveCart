import './fulfillment.css';
import './operations.css';
import './commerce.css';
import { useEffect, useState, lazy, Suspense } from 'react';
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

const RestaurantPage = lazy(() =>
  import('./pages/Catalog').then((module) => ({ default: module.RestaurantPage })),
);
const CartPage = lazy(() =>
  import('./pages/Catalog').then((module) => ({ default: module.CartPage })),
);
const FavoritesPage = lazy(() =>
  import('./pages/Catalog').then((module) => ({ default: module.FavoritesPage })),
);
const OffersPage = lazy(() =>
  import('./pages/Catalog').then((module) => ({ default: module.OffersPage })),
);
const AddressesPage = lazy(() =>
  import('./pages/Addresses').then((module) => ({ default: module.AddressesPage })),
);
const SellerCatalogPage = lazy(() =>
  import('./pages/SellerCatalog').then((module) => ({ default: module.SellerCatalogPage })),
);
const RestaurantProfilePage = lazy(() =>
  import('./pages/SellerCatalog').then((module) => ({ default: module.RestaurantProfilePage })),
);
const MenuItemPage = lazy(() =>
  import('./pages/SellerCatalog').then((module) => ({ default: module.MenuItemPage })),
);
const ZonesPage = lazy(() =>
  import('./pages/Zones').then((module) => ({ default: module.ZonesPage })),
);

const CheckoutPage = lazy(() =>
  import('./pages/Commerce').then((m) => ({ default: m.CheckoutPage })),
);
const OrdersPage = lazy(() => import('./pages/Commerce').then((m) => ({ default: m.OrdersPage })));
const OrderPage = lazy(() => import('./pages/Commerce').then((m) => ({ default: m.OrderPage })));
const PaymentReturnPage = lazy(() =>
  import('./pages/Commerce').then((m) => ({ default: m.PaymentReturnPage })),
);
const FinancePage = lazy(() => import('./pages/Finance').then((m) => ({ default: m.FinancePage })));
const RefundsPage = lazy(() => import('./pages/Finance').then((m) => ({ default: m.RefundsPage })));

const SellerOrdersPage = lazy(() =>
  import('./pages/Fulfillment').then((m) => ({ default: m.SellerOrdersPage })),
);
const CustomerTrackingPage = lazy(() =>
  import('./pages/Fulfillment').then((m) => ({ default: m.CustomerTrackingPage })),
);
const RiderDeliveriesPage = lazy(() =>
  import('./pages/Fulfillment').then((m) => ({ default: m.RiderDeliveriesPage })),
);
const NotificationsPage = lazy(() =>
  import('./pages/Fulfillment').then((m) => ({ default: m.NotificationsPage })),
);
const DeliveryOperationsPage = lazy(() =>
  import('./pages/Fulfillment').then((m) => ({ default: m.DeliveryOperationsPage })),
);
const SupportPage = lazy(() =>
  import('./pages/Operations').then((m) => ({ default: m.SupportPage })),
);
const OrderMessagesPage = lazy(() =>
  import('./pages/Operations').then((m) => ({ default: m.OrderMessagesPage })),
);
const OrderReviewPage = lazy(() =>
  import('./pages/Operations').then((m) => ({ default: m.OrderReviewPage })),
);
const ReviewsPage = lazy(() =>
  import('./pages/Operations').then((m) => ({ default: m.ReviewsPage })),
);
const StatementsPage = lazy(() =>
  import('./pages/Operations').then((m) => ({ default: m.StatementsPage })),
);
const ReportsPage = lazy(() =>
  import('./pages/Operations').then((m) => ({ default: m.ReportsPage })),
);
const HistoryPage = lazy(() =>
  import('./pages/Operations').then((m) => ({ default: m.HistoryPage })),
);
const TeamPage = lazy(() => import('./pages/Operations').then((m) => ({ default: m.TeamPage })));
const PromotionsPage = lazy(() =>
  import('./pages/Operations').then((m) => ({ default: m.PromotionsPage })),
);
const OperationsAuditPage = lazy(() =>
  import('./pages/Operations').then((m) => ({ default: m.OperationsAuditPage })),
);
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
          CraveCart
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
              <Link className="header-cart" to="/cart" aria-label="Your cart">
                <Icon name="bag" size={21} />
              </Link>
              <Link className="desktop-nav" to="/notifications">
                Notifications
              </Link>
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
            CraveCart
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
  const catalogPages: Record<string, React.ReactNode> = {
    '/support': (
      <RequireSession>
        <SupportPage />
      </RequireSession>
    ),
    '/support/tickets/:ticketId': (
      <RequireSession>
        <SupportPage />
      </RequireSession>
    ),
    '/orders/:orderId/messages': (
      <RequireSession>
        <OrderMessagesPage />
      </RequireSession>
    ),
    '/orders/:orderId/review': (
      <RequireSession>
        <OrderReviewPage />
      </RequireSession>
    ),
    '/admin/support': (
      <RequireSession roles={['admin']}>
        <SupportPage admin />
      </RequireSession>
    ),
    '/admin/support/:ticketId': (
      <RequireSession roles={['admin']}>
        <SupportPage admin />
      </RequireSession>
    ),
    '/admin/reviews': (
      <RequireSession roles={['admin']}>
        <ReviewsPage admin />
      </RequireSession>
    ),
    '/admin/team': (
      <RequireSession roles={['admin']}>
        <TeamPage admin />
      </RequireSession>
    ),
    '/admin/settlements': (
      <RequireSession roles={['admin']}>
        <FinancePage />
      </RequireSession>
    ),
    '/admin/settings': (
      <RequireSession roles={['admin']}>
        <FinancePage />
      </RequireSession>
    ),
    '/admin/promotions': (
      <RequireSession roles={['admin']}>
        <PromotionsPage />
      </RequireSession>
    ),
    '/admin/reports': (
      <RequireSession roles={['admin']}>
        <ReportsPage admin />
      </RequireSession>
    ),
    '/admin/audit': (
      <RequireSession roles={['admin']}>
        <OperationsAuditPage />
      </RequireSession>
    ),
    '/seller/restaurants/:restaurantId/reviews': (
      <RequireSession roles={['seller']}>
        <ReviewsPage />
      </RequireSession>
    ),
    '/seller/restaurants/:restaurantId/staff': (
      <RequireSession roles={['seller']}>
        <TeamPage />
      </RequireSession>
    ),
    '/seller/restaurants/:restaurantId/analytics': (
      <RequireSession roles={['seller']}>
        <ReportsPage />
      </RequireSession>
    ),
    '/seller/restaurants/:restaurantId/finance': (
      <RequireSession roles={['seller']}>
        <StatementsPage />
      </RequireSession>
    ),
    '/seller/restaurants/:restaurantId/history': (
      <RequireSession roles={['seller']}>
        <HistoryPage />
      </RequireSession>
    ),
    '/rider/history': (
      <RequireSession roles={['rider']}>
        <HistoryPage rider />
      </RequireSession>
    ),
    '/rider/earnings': (
      <RequireSession roles={['rider']}>
        <StatementsPage rider />
      </RequireSession>
    ),
    '/admin/delivery-operations': (
      <RequireSession roles={['admin']}>
        <DeliveryOperationsPage />
      </RequireSession>
    ),
    '/seller/restaurants/:restaurantId/orders': (
      <RequireSession roles={['seller']}>
        <SellerOrdersPage />
      </RequireSession>
    ),
    '/seller/restaurants/:restaurantId/orders/:orderId': (
      <RequireSession roles={['seller']}>
        <SellerOrdersPage />
      </RequireSession>
    ),
    '/orders/:orderId/track': (
      <RequireSession>
        <CustomerTrackingPage />
      </RequireSession>
    ),
    '/rider/dashboard': (
      <RequireSession roles={['rider']}>
        <RiderDeliveriesPage />
      </RequireSession>
    ),
    '/rider/offers': (
      <RequireSession roles={['rider']}>
        <RiderDeliveriesPage />
      </RequireSession>
    ),
    '/rider/deliveries': (
      <RequireSession roles={['rider']}>
        <RiderDeliveriesPage />
      </RequireSession>
    ),
    '/rider/deliveries/:deliveryId': (
      <RequireSession roles={['rider']}>
        <RiderDeliveriesPage />
      </RequireSession>
    ),
    '/rider/deliveries/:deliveryId/navigate': (
      <RequireSession roles={['rider']}>
        <RiderDeliveriesPage />
      </RequireSession>
    ),
    '/notifications': (
      <RequireSession>
        <NotificationsPage />
      </RequireSession>
    ),
    '/restaurants/:slug': <RestaurantPage />,
    '/checkout': (
      <RequireSession>
        <CheckoutPage />
      </RequireSession>
    ),
    '/checkout/return': (
      <RequireSession>
        <PaymentReturnPage />
      </RequireSession>
    ),
    '/orders': (
      <RequireSession>
        <OrdersPage />
      </RequireSession>
    ),
    '/orders/:orderId': (
      <RequireSession>
        <OrderPage />
      </RequireSession>
    ),
    '/admin/orders': (
      <RequireSession roles={['admin']}>
        <OrdersPage admin />
      </RequireSession>
    ),
    '/admin/orders/:orderId': (
      <RequireSession roles={['admin']}>
        <OrderPage admin />
      </RequireSession>
    ),
    '/admin/finance': (
      <RequireSession roles={['admin']}>
        <FinancePage />
      </RequireSession>
    ),
    '/admin/refunds': (
      <RequireSession roles={['admin']}>
        <RefundsPage />
      </RequireSession>
    ),
    '/admin/refunds/:refundId': (
      <RequireSession roles={['admin']}>
        <RefundsPage />
      </RequireSession>
    ),
    '/offers': <OffersPage />,
    '/cart': (
      <RequireSession>
        <CartPage />
      </RequireSession>
    ),
    '/favorites': (
      <RequireSession>
        <FavoritesPage />
      </RequireSession>
    ),
    '/addresses': (
      <RequireSession>
        <AddressesPage />
      </RequireSession>
    ),
    '/addresses/new': (
      <RequireSession>
        <AddressesPage edit />
      </RequireSession>
    ),
    '/addresses/:addressId/edit': (
      <RequireSession>
        <AddressesPage edit />
      </RequireSession>
    ),
    '/seller/restaurants/:restaurantId/menu': (
      <RequireSession roles={['seller']}>
        <SellerCatalogPage />
      </RequireSession>
    ),
    '/seller/restaurants/:restaurantId/dashboard': (
      <RequireSession roles={['seller']}>
        <SellerOrdersPage />
      </RequireSession>
    ),
    '/seller/restaurants/:restaurantId/menu/new': (
      <RequireSession roles={['seller']}>
        <MenuItemPage />
      </RequireSession>
    ),
    '/seller/restaurants/:restaurantId/menu/:itemId/edit': (
      <RequireSession roles={['seller']}>
        <MenuItemPage />
      </RequireSession>
    ),
    '/seller/restaurants/:restaurantId/profile': (
      <RequireSession roles={['seller']}>
        <RestaurantProfilePage />
      </RequireSession>
    ),
    '/seller/restaurants/:restaurantId/hours': (
      <RequireSession roles={['seller']}>
        <RestaurantProfilePage hoursOnly />
      </RequireSession>
    ),
    '/admin/zones': (
      <RequireSession roles={['admin']}>
        <ZonesPage />
      </RequireSession>
    ),
  };
  if (catalogPages[path])
    return (
      <Suspense
        fallback={
          <section className="page-width workspace-wait" role="status">
            Opening your workspace…
          </section>
        }
      >
        {catalogPages[path]}
      </Suspense>
    );
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
          Development checkout is for simulation only. Live ordering requires approved policies and
          operational qualification.
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
              You can browse menus and try labelled development checkout in configured areas. Test
              payments do not charge money or dispatch a delivery. Live ordering will open after
              operational qualification.
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

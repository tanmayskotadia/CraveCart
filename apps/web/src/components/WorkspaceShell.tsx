import { useState, type ReactNode } from 'react';
import { Link, NavLink, useLocation } from 'react-router-dom';
import { useSession } from './SessionProvider';
import { MfaDialog } from './Authenticator';

export function RequireSession({
  children,
  roles,
  applicantRole,
}: {
  children: ReactNode;
  roles?: string[];
  applicantRole?: string;
}) {
  const { session, loading, error, reload } = useSession();
  const location = useLocation();
  if (loading)
    return (
      <section className="workspace-wait page-width" role="status">
        Checking your account…
      </section>
    );
  if (error)
    return (
      <section className="workspace-wait page-width">
        <h1>We couldn’t check your account.</h1>
        <p>{error.message}</p>
        <button className="red-button" onClick={() => void reload()}>
          Try again
        </button>
      </section>
    );
  if (!session) {
    const role = applicantRole ?? (roles?.length === 1 ? roles[0] : 'customer');
    const login = role === 'customer' ? '/login' : `/${role}/login`;
    return (
      <section className="message-page page-width">
        <p className="eyebrow">Your CraveCart workspace</p>
        <h1>Sign in to continue</h1>
        <p>This page belongs to a protected workspace.</p>
        <Link
          className="red-button"
          to={`${login}?returnTo=${encodeURIComponent(location.pathname)}`}
          state={{ from: location.pathname }}
        >
          Go to {role} access
        </Link>
      </section>
    );
  }
  if (
    roles?.length &&
    !roles.some((role) =>
      session.principal.roles.includes(role as typeof session.principal.workspace),
    )
  )
    return (
      <section className="message-page page-width">
        <h1>This workspace isn’t available to you.</h1>
        <p>Partner access is granted after application approval.</p>
        <Link className="red-button" to="/workspaces">
          Choose a workspace
        </Link>
      </section>
    );
  return children;
}
const navigation = {
  customer: [
    ['My account', '/profile'],
    ['Addresses', '/addresses'],
    ['Favourites', '/favorites'],
    ['My cart', '/cart'],
    ['Sessions', '/settings/sessions'],
    ['Security', '/settings'],
    ['Workspaces', '/workspaces'],
  ],
  seller: [
    ['Application', '/seller/onboarding'],
    ['My restaurants', '/seller/restaurants'],
    ['Security', '/settings'],
    ['Workspaces', '/workspaces'],
  ],
  rider: [
    ['Application', '/rider/onboarding'],
    ['Rider profile', '/rider/dashboard'],
    ['Security', '/settings'],
    ['Workspaces', '/workspaces'],
  ],
  admin: [
    ['Overview', '/admin/dashboard'],
    ['Verifications', '/admin/verifications'],
    ['Accounts', '/admin/users'],
    ['Audit history', '/admin/audit'],
    ['Operating zones', '/admin/zones'],
    ['Security', '/settings'],
    ['Workspaces', '/workspaces'],
  ],
} as const;
export function WorkspaceShell({
  title,
  description,
  role,
  children,
}: {
  title: string;
  description?: string;
  role?: keyof typeof navigation;
  children: ReactNode;
}) {
  const { session } = useSession();
  const [mfa, setMfa] = useState(false);
  const active = role ?? session?.principal.workspace ?? 'customer';
  return (
    <div className="workspace-layout page-width">
      <aside className="workspace-sidebar">
        <p className="eyebrow">CRAVECART WORKSPACE</p>
        <h2>
          {active === 'seller'
            ? 'Restaurant'
            : active === 'rider'
              ? 'Delivery partner'
              : active === 'admin'
                ? 'Administration'
                : 'My account'}
        </h2>
        <p className="workspace-person">{session?.principal.name}</p>
        <nav aria-label="Workspace navigation">
          {navigation[active]
            .filter(
              ([label]) =>
                !(label === 'My restaurants' && !session?.principal.roles.includes('seller')) &&
                !(label === 'Rider profile' && !session?.principal.roles.includes('rider')),
            )
            .map(([label, path]) => (
              <NavLink key={path} to={path} end>
                {label}
              </NavLink>
            ))}
        </nav>
        {active === 'admin' && (
          <button className="text-link" onClick={() => setMfa(true)}>
            Verify authenticator
          </button>
        )}
      </aside>
      <section className="workspace-content">
        <header className="workspace-heading">
          <h1>{title}</h1>
          {description && <p>{description}</p>}
        </header>
        {children}
      </section>
      {mfa && <MfaDialog onClose={() => setMfa(false)} />}
    </div>
  );
}
export function ErrorNotice({ error }: { error: unknown }) {
  return error ? (
    <p className="form-feedback" role="alert">
      {error instanceof Error ? error.message : String(error)}
    </p>
  ) : null;
}

import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import type { Workspace } from '@cravecart/contracts';
import { api } from '../api';
import { workspaceHome } from '../access';
import { useSession } from '../components/SessionProvider';
import { ErrorNotice } from '../components/WorkspaceShell';
import { MfaDialog } from '../components/Authenticator';

const workspaces = [
  {
    role: 'customer',
    label: 'Customer',
    title: 'Your next favourite meal.',
    description: 'Explore restaurants, customise your food and follow every step to your door.',
    login: '/login',
    register: '/signup',
    action: 'Create a customer account',
    steps: ['Choose your address', 'Order and pay securely', 'Track your delivery'],
  },
  {
    role: 'seller',
    label: 'Restaurant',
    title: 'Bring your kitchen to the city.',
    description:
      'Apply for verification, publish your menu and manage incoming orders from one place.',
    login: '/seller/login',
    register: '/seller/register',
    action: 'Register your restaurant',
    steps: [
      'Submit business documents',
      'Get reviewed by the team',
      'Add dishes and fulfil orders',
    ],
  },
  {
    role: 'rider',
    label: 'Delivery partner',
    title: 'Make the last mile yours.',
    description:
      'Go online after approval, accept nearby offers and navigate from pickup to doorstep.',
    login: '/rider/login',
    register: '/rider/register',
    action: 'Apply as a delivery partner',
    steps: ['Complete your application', 'Accept a delivery offer', 'Verify pickup and drop-off'],
  },
  {
    role: 'admin',
    label: 'Administration',
    title: 'Keep every order moving.',
    description:
      'Review restaurant and rider applications, handle exceptions and oversee operations.',
    login: '/admin/login',
    register: null,
    action: null,
    steps: ['Review partner documents', 'Approve or request changes', 'Monitor orders and support'],
  },
] as const;

export function AccessPage() {
  const { session, loading, error: sessionError, reload } = useSession();
  const navigate = useNavigate();
  const [busy, setBusy] = useState<Workspace | null>(null);
  const [error, setError] = useState<unknown>();
  const [mfa, setMfa] = useState(false);
  async function enter(role: Workspace) {
    setBusy(role);
    setError(undefined);
    try {
      await api('/auth/workspace', { method: 'POST', body: { workspace: role } });
      await reload();
      navigate(workspaceHome(role, session?.principal.permissions));
    } catch (cause) {
      setError(cause);
    } finally {
      setBusy(null);
    }
  }
  return (
    <section className="access-page page-width">
      <header className="access-heading">
        <p className="eyebrow">ONE CRAVECART. EVERY PART OF THE JOURNEY.</p>
        <h1>
          A place for every appetite.
          <br />
          <span>And everyone behind it.</span>
        </h1>
        <p>Choose where you belong. Your workspace brings the right tools together.</p>
      </header>
      <ErrorNotice error={error ?? sessionError} />
      {loading && <p role="status">Checking your account…</p>}
      {sessionError && (
        <button className="outline-button" onClick={() => void reload()}>
          Try again
        </button>
      )}
      <div className="access-grid">
        {workspaces.map((item, index) => {
          const granted = session?.principal.roles.includes(item.role);
          return (
            <article
              className="access-card"
              key={item.role}
              aria-labelledby={`access-${item.role}`}
            >
              <div className="access-card-top">
                <span>{item.label}</span>
                <span aria-hidden="true">0{index + 1}</span>
              </div>
              <h2 id={`access-${item.role}`}>{item.title}</h2>
              <p>{item.description}</p>
              <ol>
                {item.steps.map((step) => (
                  <li key={step}>{step}</li>
                ))}
              </ol>
              <div className="access-actions">
                {granted ? (
                  <button
                    className="red-button"
                    disabled={busy !== null || loading || Boolean(sessionError)}
                    onClick={() => void enter(item.role)}
                  >
                    {busy === item.role ? 'Opening…' : `Open ${item.label.toLowerCase()} workspace`}
                  </button>
                ) : session && (item.role === 'seller' || item.role === 'rider') ? (
                  <Link className="red-button" to={`/${item.role}/onboarding`}>
                    View {item.label.toLowerCase()} application
                  </Link>
                ) : (
                  <Link className="red-button" to={item.login}>
                    {item.label} login
                  </Link>
                )}
                {!session && item.register && (
                  <Link className="inline-link" to={item.register}>
                    {item.action}
                  </Link>
                )}
                {item.role === 'admin' && (
                  <p className="small-help">
                    Access is assigned by an administrator. There is no public admin registration.
                  </p>
                )}
              </div>
            </article>
          );
        })}
      </div>
      {session?.principal.roles.includes('admin') && (
        <p className="access-security">
          Team workspace changes may require a recent authenticator check.{' '}
          <button className="text-link" onClick={() => setMfa(true)}>
            Verify authenticator
          </button>
        </p>
      )}
      <div className="access-journey">
        <div>
          <p className="eyebrow">FROM KITCHEN TO DOORSTEP</p>
          <h2>One order. A connected journey.</h2>
        </div>
        <p>
          The customer places an order. The restaurant accepts and prepares it. An approved delivery
          partner collects the food and confirms delivery. The admin team reviews partners and
          handles exceptions along the way.
        </p>
      </div>
      {mfa && <MfaDialog onClose={() => setMfa(false)} />}
    </section>
  );
}

import { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api, setCsrf } from '../api';
import { useSession } from '../components/SessionProvider';
import { WorkspaceShell, ErrorNotice } from '../components/WorkspaceShell';
import { MfaDialog } from '../components/Authenticator';
import type { Principal } from '@cravecart/contracts';
import { workspaceHome } from '../access';
import { PrivacySettingsPage } from './Privacy';

export function PrivacyPage() {
  return <PrivacySettingsPage />;
}

export function AccountPage() {
  const { session, reload } = useSession();
  const [name, setName] = useState(session?.principal.name ?? ''),
    [contact, setContact] = useState(''),
    [code, setCode] = useState(''),
    [challenge, setChallenge] = useState<{ challengeId: string; developmentCode?: string }>();
  const [error, setError] = useState<unknown>(),
    [notice, setNotice] = useState(''),
    [pending, setPending] = useState(false);
  async function save() {
    setPending(true);
    setError(undefined);
    try {
      await api('/auth/me', { method: 'PATCH', body: { name } });
      await reload();
      setNotice('Your profile has been updated.');
    } catch (error) {
      setError(error);
    } finally {
      setPending(false);
    }
  }
  async function change() {
    setPending(true);
    setError(undefined);
    try {
      if (!challenge) {
        setChallenge(await api('/auth/contact-changes', { method: 'POST', body: { contact } }));
      } else {
        await api(`/auth/contact-changes/${challenge.challengeId}/confirm`, {
          method: 'POST',
          body: { code },
        });
        setChallenge(undefined);
        setContact('');
        setCode('');
        await reload();
        setNotice('Your verified contact has been changed. Other sessions were revoked.');
      }
    } catch (error) {
      setError(error);
    } finally {
      setPending(false);
    }
  }
  return (
    <WorkspaceShell
      title="Your account"
      description="A little about you. Keep your details up to date."
    >
      <div className="workspace-panel">
        <h2>Profile details</h2>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            void save();
          }}
        >
          <label className="field-label" htmlFor="profile-name">
            Full name
          </label>
          <input
            className="form-input"
            id="profile-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            minLength={2}
            maxLength={80}
            required
          />
          <label className="field-label spaced-label">Verified contact</label>
          <p className="verified-contact">
            {session?.principal.contact}
            <span className="status-badge status-approved">Verified</span>
          </p>
          <button className="red-button" disabled={pending} type="submit">
            Save changes
          </button>
        </form>
      </div>
      <div className="workspace-panel">
        <h2>Change your contact</h2>
        <p className="panel-description">
          You’ll need a recent sign-in and a code sent to the new contact. Other sessions will be
          revoked.
        </p>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            void change();
          }}
        >
          {!challenge ? (
            <>
              <label className="field-label" htmlFor="new-contact">
                New email or Indian mobile number
              </label>
              <input
                className="form-input"
                id="new-contact"
                value={contact}
                onChange={(e) => setContact(e.target.value)}
                required
                maxLength={254}
              />
            </>
          ) : (
            <>
              <label className="field-label" htmlFor="contact-code">
                Verification code
              </label>
              <input
                className="form-input"
                id="contact-code"
                value={code}
                onChange={(e) => setCode(e.target.value)}
                inputMode="numeric"
                maxLength={6}
                required
              />
              {challenge.developmentCode && (
                <p className="development-banner">
                  Local development code: <strong>{challenge.developmentCode}</strong>. No message
                  was sent.
                </p>
              )}
            </>
          )}
          <button className="red-button" disabled={pending} type="submit">
            {challenge ? 'Confirm new contact' : 'Request verification code'}
          </button>
        </form>
      </div>
      {notice && (
        <p className="success-notice" role="status">
          {notice}
        </p>
      )}
      <ErrorNotice error={error} />
      <p className="small-help">
        If a sensitive change asks you to verify again,{' '}
        <Link className="inline-link" to="/login" state={{ from: '/profile' }}>
          sign in again
        </Link>{' '}
        or verify your authenticator in Security.
      </p>
    </WorkspaceShell>
  );
}
export function SecurityPage() {
  const { session } = useSession();
  const [mfa, setMfa] = useState(false);
  return (
    <WorkspaceShell title="Account security" description="Control access to your account.">
      <div className="workspace-panel">
        <h2>Authenticator protection</h2>
        <p className="panel-description">
          {session?.principal.mfaEnabled
            ? 'Your authenticator is enabled. Verify a fresh code before privileged actions.'
            : 'Add an authenticator app for an extra layer of protection. Team accounts require it.'}
        </p>
        <span
          className={`status-badge ${session?.principal.mfaEnabled ? 'status-approved' : 'status-draft'}`}
        >
          {session?.principal.mfaEnabled ? 'Enabled' : 'Not enabled'}
        </span>
        <div>
          <button className="red-button" onClick={() => setMfa(true)}>
            {session?.principal.mfaEnabled ? 'Verify authenticator' : 'Set up authenticator'}
          </button>
        </div>
      </div>
      <div className="workspace-panel">
        <h2>Signed-in devices</h2>
        <p className="panel-description">Review and revoke your browser sessions.</p>
        <Link className="text-link" to="/settings/sessions">
          Manage sessions
        </Link>
      </div>
      {mfa && <MfaDialog onClose={() => setMfa(false)} />}
    </WorkspaceShell>
  );
}
interface SessionEntry {
  id: string;
  current: boolean;
  workspace: string;
  createdAt: string;
  expiresAt: string;
}
export function SessionsPage() {
  const { session, logout } = useSession();
  const client = useQueryClient(),
    navigate = useNavigate();
  const [error, setError] = useState<unknown>();
  const [pending, setPending] = useState(false);
  const list = useQuery({
    queryKey: ['sessions', session?.principal.userId],
    queryFn: () => api<SessionEntry[]>('/auth/sessions'),
  });
  async function revoke(id: string, current: boolean) {
    setPending(true);
    setError(undefined);
    try {
      if (current) {
        await logout();
        navigate('/');
      } else {
        await api(`/auth/sessions/${id}`, { method: 'DELETE' });
        await client.invalidateQueries({ queryKey: ['sessions'] });
      }
    } catch (error) {
      setError(error);
    } finally {
      setPending(false);
    }
  }
  async function all() {
    if (!confirm('Sign out of every browser session, including this one?')) return;
    setPending(true);
    try {
      await api('/auth/sessions/revoke-all', { method: 'POST', body: {} });
      await logout().catch(() => {});
      setCsrf('');
      client.removeQueries({ predicate: (query) => query.queryKey[0] !== 'session' });
      client.setQueryData(['session'], null);
      navigate('/');
    } catch (error) {
      setError(error);
    } finally {
      setPending(false);
    }
  }
  return (
    <WorkspaceShell
      title="Your sessions"
      description="Only you should have access to your account."
    >
      <ErrorNotice error={error ?? list.error} />
      {list.isPending ? (
        <p role="status">Loading your sessions…</p>
      ) : (
        <div className="workspace-panel">
          {list.data?.map((item) => (
            <div className="session-row" key={item.id}>
              <div>
                <h3>
                  Browser session{' '}
                  {item.current && (
                    <span className="status-badge status-approved">This browser</span>
                  )}
                </h3>
                <p>
                  {item.workspace} · Signed in {formatDate(item.createdAt)}
                </p>
              </div>
              <button
                className="outline-button"
                disabled={pending}
                onClick={() => void revoke(item.id, item.current)}
              >
                Sign out
              </button>
            </div>
          ))}
        </div>
      )}
      <button
        className="outline-button danger-button"
        disabled={pending}
        onClick={() => void all()}
      >
        Sign out everywhere
      </button>
    </WorkspaceShell>
  );
}
export function WorkspacesPage() {
  const { session, reload } = useSession();
  const navigate = useNavigate();
  const [error, setError] = useState<unknown>(),
    [pending, setPending] = useState(false),
    [mfa, setMfa] = useState(false);
  async function enter(role: Principal['workspace']) {
    setPending(true);
    setError(undefined);
    try {
      await api('/auth/workspace', { method: 'POST', body: { workspace: role } });
      await reload();
      navigate(workspaceHome(role, session?.principal.permissions));
    } catch (error) {
      setError(error);
    } finally {
      setPending(false);
    }
  }
  return (
    <WorkspaceShell
      title="Your workspaces"
      description="Switch between the access you’ve been granted."
    >
      <div className="workspace-options">
        {session?.principal.roles.map((role) => (
          <div className="workspace-panel" key={role}>
            <p className="eyebrow">{role}</p>
            <h2>
              {role === 'customer'
                ? 'Food, your way'
                : role === 'seller'
                  ? 'Restaurant workspace'
                  : role === 'rider'
                    ? 'Delivery partner workspace'
                    : 'Administration'}
            </h2>
            <button className="red-button" disabled={pending} onClick={() => void enter(role)}>
              Open {role} workspace
            </button>
          </div>
        ))}
      </div>
      <div className="workspace-panel">
        <h2>Become a partner</h2>
        <p className="panel-description">
          Partner roles are granted after your application is verified.
        </p>
        <div className="button-row">
          {!session?.principal.roles.includes('seller') && (
            <Link className="outline-button" to="/seller/onboarding">
              Apply as a restaurant
            </Link>
          )}
          {!session?.principal.roles.includes('rider') && (
            <Link className="outline-button" to="/rider/onboarding">
              Apply as a delivery partner
            </Link>
          )}
        </div>
      </div>
      <ErrorNotice error={error} />
      {session?.principal.roles.includes('admin') && (
        <button className="text-link" onClick={() => setMfa(true)}>
          Verify authenticator for team access
        </button>
      )}
      {mfa && <MfaDialog onClose={() => setMfa(false)} />}
    </WorkspaceShell>
  );
}
export function formatDate(value: string) {
  return new Intl.DateTimeFormat('en-IN', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: 'Asia/Kolkata',
  }).format(new Date(value));
}

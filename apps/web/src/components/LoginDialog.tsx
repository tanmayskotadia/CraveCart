import { useEffect, useState } from 'react';
import { useLocation, useNavigate, Link } from 'react-router-dom';
import { useCity } from './CityProvider';
import { useQuery } from '@tanstack/react-query';
import { sessionResponseSchema, type SessionResponse } from '@cravecart/contracts';
import { api } from '../api';
import { useSession } from './SessionProvider';
import { Modal } from './Modal';
import { Icon } from './Icon';
import { AuthenticatorQr, RecoveryCodes } from './Authenticator';
import { safeReturnPath, workspaceHome } from '../access';

interface Challenge {
  challengeId: string;
  expiresAt: string;
  resendAfterSeconds: number;
  delivery: 'development' | 'email' | 'sms';
  developmentCode?: string;
}
interface MfaChallenge {
  mfaChallengeId: string;
  enrollmentRequired: boolean;
}
export function AuthModal() {
  const location = useLocation(),
    navigate = useNavigate(),
    { accept } = useSession();
  const signup = location.pathname === '/signup' || location.pathname.endsWith('/register');
  const workspace = location.pathname.startsWith('/seller')
    ? 'seller'
    : location.pathname.startsWith('/rider')
      ? 'rider'
      : location.pathname.startsWith('/admin')
        ? 'admin'
        : 'customer';
  const state = location.state as { from?: string } | null;
  const closePath = safeReturnPath(state?.from, ['customer', 'seller', 'rider', 'admin']) ?? '/';
  const [chosenMode, setMode] = useState<'phone' | 'email'>('phone'),
    [value, setValue] = useState(''),
    [name, setName] = useState(''),
    [code, setCode] = useState(''),
    [message, setMessage] = useState(''),
    [pending, setPending] = useState(false);
  const [adminPassword, setAdminPassword] = useState('');
  const [contactLogin, setContactLogin] = useState(false);
  const [challenge, setChallenge] = useState<Challenge>(),
    [mfa, setMfa] = useState<MfaChallenge>(),
    [setup, setSetup] = useState<{ secret: string; uri: string }>(),
    [backup, setBackup] = useState<string[]>(),
    [completed, setCompleted] = useState<SessionResponse>(),
    [resendAt, setResendAt] = useState(0),
    [seconds, setSeconds] = useState(0);
  const { city } = useCity();
  const capabilities = useQuery({
    queryKey: ['auth-capabilities'],
    queryFn: () =>
      api<{ methods: string[]; developmentDelivery: boolean; adminPasswordEnabled?: boolean }>(
        '/auth/capabilities',
      ),
    retry: false,
  });
  const passwordLogin =
    workspace === 'admin' && capabilities.data?.adminPasswordEnabled === true && !contactLogin;
  const mode =
    capabilities.data?.methods.length === 1
      ? capabilities.data.methods[0] === 'email'
        ? 'email'
        : 'phone'
      : chosenMode;
  useEffect(() => {
    if (!resendAt) return;
    const update = () => setSeconds(Math.max(0, Math.ceil((resendAt - Date.now()) / 1000)));
    update();
    const timer = setInterval(update, 1000);
    return () => clearInterval(timer);
  }, [resendAt]);
  const close = () => navigate(closePath, { replace: true });
  function finish(session: SessionResponse) {
    const roles = session.principal.roles;
    const requested = new URLSearchParams(location.search).get('returnTo');
    const safe = safeReturnPath(requested, roles);
    const destination =
      safe ??
      (workspace === 'seller'
        ? roles.includes('seller')
          ? '/seller/restaurants'
          : '/seller/onboarding'
        : workspace === 'rider'
          ? roles.includes('rider')
            ? '/rider/dashboard'
            : '/rider/onboarding'
          : workspace === 'admin'
            ? workspaceHome('admin', session.principal.permissions)
            : ((state?.from && state.from !== '/' ? safeReturnPath(state.from, roles) : null) ??
              (city ? `/search?city=${city.slug}` : '/search')));
    navigate(destination, { replace: true });
  }
  async function requestCode() {
    const valid =
      mode === 'phone'
        ? /^[6-9]\d{9}$/.test(value.replace(/\s/g, ''))
        : /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());
    if (!valid) {
      setMessage(
        mode === 'phone'
          ? 'Enter a valid 10-digit Indian mobile number.'
          : 'Enter a valid email address.',
      );
      return;
    }
    if (signup && name.trim().length < 2) {
      setMessage('Enter your full name.');
      return;
    }
    setPending(true);
    setMessage('');
    try {
      const result = await api<Challenge>(signup ? '/auth/register' : '/auth/login', {
        method: 'POST',
        body: { contact: value, workspace, ...(signup ? { name: name.trim() } : {}) },
      });
      setChallenge(result);
      setResendAt(Date.now() + result.resendAfterSeconds * 1000);
      setCode('');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Could not request a code');
    } finally {
      setPending(false);
    }
  }
  async function adminSignIn() {
    setPending(true);
    setMessage('');
    try {
      const result = await api<MfaChallenge>('/auth/admin/password', {
        method: 'POST',
        body: { loginId: value, password: adminPassword },
      });
      setMfa(result);
      setCode('');
      if (result.enrollmentRequired)
        setSetup(
          await api('/auth/mfa/enroll', {
            method: 'POST',
            body: { mfaChallengeId: result.mfaChallengeId },
          }),
        );
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Admin sign-in failed');
    } finally {
      setAdminPassword('');
      setPending(false);
    }
  }
  async function verify() {
    setPending(true);
    setMessage('');
    try {
      const result = await api<SessionResponse | (MfaChallenge & { recoveryCodes?: string[] })>(
        mfa ? '/auth/mfa/verify' : '/auth/otp/verify',
        {
          method: 'POST',
          body: mfa
            ? { mfaChallengeId: mfa.mfaChallengeId, code }
            : { challengeId: challenge!.challengeId, code },
        },
      );
      if ('mfaChallengeId' in result) {
        setMfa(result);
        setCode('');
        if (result.enrollmentRequired)
          setSetup(
            await api('/auth/mfa/enroll', {
              method: 'POST',
              body: { mfaChallengeId: result.mfaChallengeId },
            }),
          );
        return;
      }
      const { recoveryCodes, ...rest } = result as SessionResponse & { recoveryCodes?: string[] };
      const session = sessionResponseSchema.parse(rest);
      accept(session);
      setCompleted(session);
      if (recoveryCodes) setBackup(recoveryCodes);
      else finish(session);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Verification failed');
    } finally {
      setPending(false);
    }
  }
  const title = backup
    ? 'Keep your account safe'
    : mfa
      ? mfa.enrollmentRequired
        ? 'Set up your authenticator'
        : 'Authenticator verification'
      : challenge
        ? 'Verify your contact'
        : workspace === 'admin'
          ? 'Admin login'
          : workspace === 'seller'
            ? 'Restaurant partner login'
            : workspace === 'rider'
              ? 'Delivery partner login'
              : signup
                ? 'Create account'
                : 'Log in';
  return (
    <Modal title={title} onClose={close} className="auth-modal">
      {backup ? (
        <RecoveryCodes
          codes={backup}
          onDone={() => {
            if (completed) finish(completed);
          }}
        />
      ) : (
        <form
          noValidate
          onSubmit={(event) => {
            event.preventDefault();
            void (challenge || mfa ? verify() : passwordLogin ? adminSignIn() : requestCode());
          }}
        >
          {!challenge && !mfa ? (
            <>
              <p className="auth-context">
                {workspace === 'seller'
                  ? 'Manage your kitchen, menu and incoming orders. New restaurants start with a verified application.'
                  : workspace === 'rider'
                    ? 'Manage delivery offers, pickups and drop-offs. New delivery partners need approval before going online.'
                    : workspace === 'admin'
                      ? 'Authorized team members only. Review partner applications and manage operations within your assigned permissions.'
                      : 'Discover restaurants, place an order and follow your delivery.'}
              </p>
              {passwordLogin ? (
                <>
                  <label className="field-label" htmlFor="admin-login-id">
                    Admin login ID
                  </label>
                  <input
                    className="form-input spaced-field"
                    id="admin-login-id"
                    autoComplete="username"
                    value={value}
                    onChange={(e) => setValue(e.target.value)}
                    maxLength={254}
                  />
                  <label className="field-label" htmlFor="admin-password">
                    Password
                  </label>
                  <input
                    className="form-input spaced-field"
                    id="admin-password"
                    type="password"
                    autoComplete="current-password"
                    value={adminPassword}
                    onChange={(e) => setAdminPassword(e.target.value)}
                    maxLength={128}
                  />
                  <p className="small-help">
                    Use your privately provisioned admin credentials. Authenticator verification
                    follows.
                  </p>
                </>
              ) : (
                <>
                  {signup && (
                    <>
                      <label className="field-label" htmlFor="auth-name">
                        Full name
                      </label>
                      <input
                        className="form-input spaced-field"
                        id="auth-name"
                        value={name}
                        onChange={(e) => setName(e.target.value)}
                        autoComplete="name"
                        maxLength={80}
                      />
                    </>
                  )}
                  <label className="field-label" htmlFor="auth-contact">
                    {mode === 'phone' ? 'Mobile number' : 'Email address'}
                  </label>
                  <div className="contact-field">
                    {mode === 'phone' && (
                      <span className="phone-code">
                        <span className="india-flag" aria-hidden="true" />
                        +91
                        <span className="contact-divider" />
                      </span>
                    )}
                    <input
                      id="auth-contact"
                      type={mode === 'phone' ? 'tel' : 'email'}
                      autoComplete={mode === 'phone' ? 'tel-national' : 'email'}
                      placeholder={mode === 'phone' ? 'Phone number' : 'you@example.com'}
                      value={value}
                      onChange={(e) => {
                        setValue(e.target.value);
                        setMessage('');
                      }}
                      maxLength={mode === 'phone' ? 14 : 254}
                    />
                  </div>
                </>
              )}
            </>
          ) : (
            <>
              {mfa ? (
                <>
                  {setup && (
                    <div className="mfa-setup">
                      <p>
                        Scan this code with your authenticator app, then enter its current code.
                      </p>
                      <AuthenticatorQr uri={setup.uri} />
                      <details>
                        <summary>Use a setup key instead</summary>
                        <code data-testid="totp-secret">{setup.secret}</code>
                      </details>
                    </div>
                  )}
                  <label className="field-label" htmlFor="auth-code">
                    Authenticator or recovery code
                  </label>
                </>
              ) : (
                <>
                  <p className="modal-subtitle">
                    {challenge!.delivery === 'development'
                      ? 'Use the local development code below.'
                      : `Enter the code sent to ${value}.`}
                  </p>
                  {challenge!.developmentCode && (
                    <p className="development-banner" data-testid="development-code">
                      Local development code: <strong>{challenge!.developmentCode}</strong>
                      <br />
                      <small>No SMS or email was sent.</small>
                    </p>
                  )}
                  <label className="field-label" htmlFor="auth-code">
                    Verification code
                  </label>
                </>
              )}
              <input
                className="form-input otp-input"
                id="auth-code"
                value={code}
                onChange={(e) => setCode(e.target.value.trim())}
                inputMode={mfa ? 'text' : 'numeric'}
                autoComplete="one-time-code"
                maxLength={mfa ? 32 : 6}
              />
              {mfa && (
                <p className="small-help">
                  Codes work once. Wait for a new authenticator code, or use an unused recovery
                  code.
                </p>
              )}
            </>
          )}
          {message && (
            <p className="form-feedback" role="alert">
              {message}
            </p>
          )}
          <button
            className="red-button auth-submit"
            disabled={
              pending ||
              Boolean(
                !challenge && !mfa && !passwordLogin && capabilities.data?.methods.length === 0,
              )
            }
            type="submit"
          >
            {pending
              ? 'Please wait…'
              : challenge || mfa
                ? 'Verify and continue'
                : passwordLogin
                  ? 'Sign in as admin'
                  : mode === 'phone'
                    ? 'Send one-time password'
                    : 'Continue with email'}
          </button>
          {challenge && !mfa && (
            <div className="otp-actions">
              <button
                type="button"
                className="text-link"
                disabled={pending || seconds > 0}
                onClick={() => void requestCode()}
              >
                {seconds > 0 ? `Resend in ${seconds}s` : 'Resend code'}
              </button>
              <button
                type="button"
                className="text-link"
                onClick={() => {
                  setChallenge(undefined);
                  setCode('');
                  setMessage('');
                }}
              >
                Change contact
              </button>
            </div>
          )}
          {!challenge && !mfa && (
            <>
              {workspace === 'admin' && capabilities.data?.adminPasswordEnabled && (
                <button
                  type="button"
                  className="text-link"
                  onClick={() => {
                    setContactLogin(!contactLogin);
                    setValue('');
                    setAdminPassword('');
                    setMessage('');
                  }}
                >
                  {contactLogin ? 'Use admin ID and password' : 'Use contact verification instead'}
                </button>
              )}
              {!passwordLogin &&
                Boolean(capabilities.data && capabilities.data.methods.length > 1) && (
                  <>
                    <div className="or-divider">
                      <span>or</span>
                    </div>
                    <button
                      className="alternative-login"
                      type="button"
                      disabled={pending}
                      onClick={() => {
                        setMode(mode === 'phone' ? 'email' : 'phone');
                        setValue('');
                        setMessage('');
                      }}
                    >
                      <Icon name={mode === 'phone' ? 'mail' : 'pin'} size={21} />
                      Continue with {mode === 'phone' ? 'email' : 'phone'}
                    </button>
                  </>
                )}
              <p className="auth-policy">
                By continuing, you agree to our <Link to="/legal/terms">Terms of Service</Link> and{' '}
                <Link to="/legal/privacy">Privacy Policy</Link>.
              </p>
              {workspace !== 'admin' && (
                <p className="auth-switch">
                  {signup ? 'Already have an account?' : 'New to CraveCart?'}{' '}
                  <Link
                    to={
                      workspace === 'customer'
                        ? signup
                          ? '/login'
                          : '/signup'
                        : `/${workspace}/${signup ? 'login' : 'register'}`
                    }
                    state={{ from: closePath }}
                  >
                    {signup ? 'Log in' : 'Create account'}
                  </Link>
                </p>
              )}
              {workspace !== 'customer' && (
                <p className="auth-access-link">
                  <Link to="/access">Choose a different workspace</Link>
                </p>
              )}
            </>
          )}
        </form>
      )}
    </Modal>
  );
}

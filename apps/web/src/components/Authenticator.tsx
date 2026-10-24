import { useEffect, useState } from 'react';
import { api } from '../api';
import { useSession } from './SessionProvider';
import { Modal } from './Modal';
import type { SessionResponse } from '@cravecart/contracts';

export function AuthenticatorQr({ uri }: { uri: string }) {
  const [image, setImage] = useState('');
  useEffect(() => {
    let active = true;
    void import('qrcode').then(module=>module.default.toDataURL(uri,{width:210,margin:1})).then((value) => {
      if (active) setImage(value);
    });
    return () => {
      active = false;
    };
  }, [uri]);
  return image ? (
    <img
      className="authenticator-qr"
      src={image}
      width={210}
      height={210}
      alt="Authenticator enrollment QR code"
    />
  ) : (
    <p>Preparing authenticator setup…</p>
  );
}
export function RecoveryCodes({ codes, onDone }: { codes: string[]; onDone: () => void }) {
  return (
    <div className="recovery-panel">
      <h3>Save your recovery codes</h3>
      <p>Each code works once. Keep them somewhere private; they won’t be shown again.</p>
      <div className="recovery-codes">
        {codes.map((code) => (
          <code key={code}>{code}</code>
        ))}
      </div>
      <button className="red-button" onClick={onDone}>
        I’ve saved my recovery codes
      </button>
    </div>
  );
}
export function MfaDialog({
  onClose,
  onVerified,
}: {
  onClose: () => void;
  onVerified?: () => void;
}) {
  const { accept } = useSession();
  const [challenge, setChallenge] = useState<{
    mfaChallengeId: string;
    enrollmentRequired: boolean;
  }>();
  const [setup, setSetup] = useState<{ secret: string; uri: string }>();
  const [code, setCode] = useState('');
  const [error, setError] = useState('');
  const [pending, setPending] = useState(false);
  const [recovery, setRecovery] = useState<string[]>();
  async function begin() {
    setPending(true);
    setError('');
    try {
      const value = await api<{ mfaChallengeId: string; enrollmentRequired: boolean }>(
        '/auth/mfa/challenge',
        { method: 'POST', body: {} },
      );
      setChallenge(value);
      if (value.enrollmentRequired)
        setSetup(
          await api('/auth/mfa/enroll', {
            method: 'POST',
            body: { mfaChallengeId: value.mfaChallengeId },
          }),
        );
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Unable to start verification');
    } finally {
      setPending(false);
    }
  }
  async function verify() {
    if (!challenge) return;
    setPending(true);
    setError('');
    try {
      const result = await api<SessionResponse & { recoveryCodes?: string[] }>('/auth/mfa/verify', {
        method: 'POST',
        body: { mfaChallengeId: challenge.mfaChallengeId, code },
      });
      const { recoveryCodes, ...session } = result;
      accept(session);
      if (recoveryCodes) setRecovery(recoveryCodes);
      else {
        onVerified?.();
        onClose();
      }
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Verification failed');
    } finally {
      setPending(false);
    }
  }
  return (
    <Modal title="Verify your authenticator" onClose={onClose} className="auth-modal">
      {recovery ? (
        <RecoveryCodes
          codes={recovery}
          onDone={() => {
            onVerified?.();
            onClose();
          }}
        />
      ) : (
        <>
          {!challenge ? (
            <>
              <p className="modal-subtitle">
                Set up an authenticator or confirm a fresh code before sensitive actions.
              </p>
              <button className="red-button" disabled={pending} onClick={() => void begin()}>
                {pending ? 'Preparing…' : 'Continue'}
              </button>
            </>
          ) : (
            <form
              onSubmit={(event) => {
                event.preventDefault();
                void verify();
              }}
            >
              {setup && (
                <div className="mfa-setup">
                  <p>Scan this code in your authenticator app.</p>
                  <AuthenticatorQr uri={setup.uri} />
                  <details>
                    <summary>Use a setup key instead</summary>
                    <code>{setup.secret}</code>
                  </details>
                </div>
              )}
              <label className="field-label" htmlFor="mfa-step-up">
                Authenticator or recovery code
              </label>
              <input
                className="form-input"
                id="mfa-step-up"
                autoComplete="one-time-code"
                value={code}
                onChange={(e) => setCode(e.target.value)}
                maxLength={32}
                required
              />
              <p className="small-help">
                Authenticator codes work once. Wait for the next code, or use an unused recovery
                code.
              </p>
              <button className="red-button full-button" disabled={pending} type="submit">
                {pending ? 'Verifying…' : 'Verify code'}
              </button>
            </form>
          )}
          {error && (
            <p className="form-feedback" role="alert">
              {error}
            </p>
          )}
        </>
      )}
    </Modal>
  );
}

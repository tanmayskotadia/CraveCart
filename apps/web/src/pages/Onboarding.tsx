import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { cityDirectory, type Application, type ApplicationProfile } from '@cravecart/contracts';
import { api } from '../api';
import { useSession } from '../components/SessionProvider';
import { WorkspaceShell, ErrorNotice } from '../components/WorkspaceShell';

type Kind = 'seller' | 'rider';
interface FileEntry {
  id: string;
  filename: string;
  status: string;
}
export function OnboardingPage({ kind }: { kind: Kind }) {
  const { session } = useSession();
  const base = kind === 'seller' ? '/seller/applications' : '/rider/application';
  const query = useQuery({
    queryKey: ['application', kind, session?.principal.userId],
    queryFn: () => api<Application[]>(base),
    refetchInterval: 5000,
  });
  if (query.isPending)
    return (
      <WorkspaceShell role={kind} title="Your partner application">
        <p role="status">Loading your application…</p>
      </WorkspaceShell>
    );
  if (query.error)
    return (
      <WorkspaceShell role={kind} title="Your partner application">
        <ErrorNotice error={query.error} />
        <button className="outline-button" onClick={() => void query.refetch()}>
          Try again
        </button>
      </WorkspaceShell>
    );
  return (
    <ApplicationForm
      key={`${kind}:${query.data?.[0]?.id ?? 'new'}`}
      kind={kind}
      application={query.data?.[0]}
      refresh={query.refetch}
    />
  );
}
function ApplicationForm({
  kind,
  application,
  refresh,
}: {
  kind: Kind;
  application: Application | undefined;
  refresh: () => Promise<unknown>;
}) {
  const { session, reload } = useSession();
  const client = useQueryClient();
  const base = kind === 'seller' ? '/seller/applications' : '/rider/application';
  const [profile, setProfile] = useState<ApplicationProfile>(
      application?.profile ?? {
        fullName: session?.principal.name ?? '',
        city: '',
        address: '',
        pincode: '',
        ...(kind === 'seller' ? { businessName: '' } : { vehicleType: 'bicycle' }),
      },
    ),
    [files, setFiles] = useState<FileEntry[]>(
      () =>
        application?.documentIds.map((id, index) => ({
          id,
          filename: `Verification document ${index + 1}`,
          status: 'ATTACHED',
        })) ?? [],
    ),
    [error, setError] = useState<unknown>(),
    [notice, setNotice] = useState(''),
    [pending, setPending] = useState(false),
    [loadedVersion, setLoadedVersion] = useState(application?.version ?? 0);
  useEffect(() => {
    if (
      application?.status === 'APPROVED' &&
      application.grantState === 'APPLIED' &&
      !session?.principal.roles.includes(kind)
    )
      void reload();
  }, [application, kind, reload, session?.principal.roles]);
  const editable =
    !application || ['DRAFT', 'CHANGES_REQUESTED', 'REJECTED'].includes(application.status);
  const conflict = Boolean(application && application.version !== loadedVersion);
  function reloadDraft() {
    if (!application) return;
    setProfile(application.profile);
    setFiles(
      application.documentIds.map((id, index) => ({
        id,
        filename: `Verification document ${index + 1}`,
        status: 'ATTACHED',
      })),
    );
    setLoadedVersion(application.version);
    setError(undefined);
  }
  function field<Key extends keyof ApplicationProfile>(key: Key, value: ApplicationProfile[Key]) {
    setProfile((old) => ({ ...old, [key]: value }));
  }
  async function addFile(file: File) {
    setError(undefined);
    setPending(true);
    try {
      if (files.length >= 5) throw new Error('Attach at most five documents.');
      if (file.size > 5 * 1024 * 1024) throw new Error('Each document must be 5 MB or smaller.');
      const intent = await api<{ uploadId: string; uploadToken: string; url: string }>(
        '/uploads/intents',
        {
          method: 'POST',
          body: { filename: file.name, size: file.size, purpose: `${kind}-verification` },
        },
      );
      await api(intent.url.replace('/api/v1', ''), {
        method: 'PUT',
        body: file,
        headers: { 'X-Upload-Token': intent.uploadToken },
      });
      setFiles((old) => [
        ...old,
        { id: intent.uploadId, filename: file.name, status: 'QUARANTINED' },
      ]);
      await checkFile(intent.uploadId);
    } catch (error) {
      setError(error);
    } finally {
      setPending(false);
    }
  }
  async function checkFile(id: string) {
    setPending(true);
    setError(undefined);
    try {
      const result = await api<{ status: string }>(`/uploads/${id}/complete`, {
        method: 'POST',
        body: {},
      });
      setFiles((old) =>
        old.map((file) => (file.id === id ? { ...file, status: result.status } : file)),
      );
    } catch (error) {
      setError(error);
    } finally {
      setPending(false);
    }
  }
  async function save(submit: boolean) {
    setPending(true);
    setError(undefined);
    setNotice('');
    try {
      if (!files.length) throw new Error('Attach at least one verification document.');
      if (files.some((file) => file.status === 'QUARANTINED'))
        throw new Error('Finish the document check before saving your application.');
      const body = { profile, documentIds: files.map((file) => file.id) };
      let value = await api<Application>(application ? `${base}/${application.id}` : base, {
        method: application ? 'PATCH' : 'POST',
        body: { ...body, ...(application ? { expectedVersion: loadedVersion } : {}) },
      });
      if (submit)
        value = await api<Application>(`${base}/${value.id}/submit`, {
          method: 'POST',
          body: { expectedVersion: value.version },
          headers: { 'Idempotency-Key': crypto.randomUUID() },
        });
      setLoadedVersion(value.version);
      client.setQueryData(['application', kind, session?.principal.userId], [value]);
      setNotice(
        submit ? 'Your application has been submitted for review.' : 'Your draft has been saved.',
      );
    } catch (error) {
      setError(error);
      await refresh();
    } finally {
      setPending(false);
    }
  }
  return (
    <WorkspaceShell
      role={kind}
      title={
        kind === 'seller'
          ? 'Bring your kitchen to CraveCart'
          : 'Start your delivery partner journey'
      }
      description="Complete your application. Partner access opens after verification."
    >
      <>
        {application && (
          <div className={`application-state state-${application.status.toLowerCase()}`}>
            <div>
              <span className={`status-badge status-${application.status.toLowerCase()}`}>
                {application.status.replaceAll('_', ' ')}
              </span>
              <h2>
                {application.status === 'SUBMITTED'
                  ? 'Your application is with our verification team.'
                  : application.status === 'APPROVED'
                    ? 'Your application has been approved.'
                    : application.status === 'CHANGES_REQUESTED'
                      ? 'A few details need your attention.'
                      : application.status === 'REJECTED'
                        ? 'Review the feedback before submitting again.'
                        : 'Your draft is saved.'}
              </h2>
              {application.reason && <p>{application.reason}</p>}
              {application.grantState === 'PENDING' && (
                <p>
                  Workspace activation is pending. The team can retry the operation; your
                  application is safely recorded.
                </p>
              )}
            </div>
            {application.status === 'APPROVED' && application.grantState === 'APPLIED' && (
              <Link
                className="red-button"
                to={kind === 'seller' ? '/seller/restaurants' : '/rider/dashboard'}
              >
                Open your workspace
              </Link>
            )}
          </div>
        )}
        <form
          onSubmit={(event) => {
            event.preventDefault();
            void save(true);
          }}
        >
          {conflict && editable && (
            <div className="form-feedback" role="alert">
              This application changed in another session. Your unsaved values are preserved until
              you choose to reload.
              <button className="text-link" type="button" onClick={reloadDraft}>
                Reload latest details
              </button>
            </div>
          )}
          <fieldset disabled={!editable || pending || conflict} className="onboarding-fieldset">
            <div className="workspace-panel">
              <div className="panel-step">
                <span>01</span>
                <div>
                  <h2>{kind === 'seller' ? 'Business details' : 'Your details'}</h2>
                  <p>Use accurate details for your verification.</p>
                </div>
              </div>
              <div className="form-grid">
                <div>
                  <label className="field-label" htmlFor="app-name">
                    Full name
                  </label>
                  <input
                    className="form-input"
                    id="app-name"
                    value={profile.fullName}
                    onChange={(e) => field('fullName', e.target.value)}
                    required
                    minLength={2}
                    maxLength={80}
                  />
                </div>
                {kind === 'seller' && (
                  <div>
                    <label className="field-label" htmlFor="app-business">
                      Restaurant or business name
                    </label>
                    <input
                      className="form-input"
                      id="app-business"
                      value={profile.businessName ?? ''}
                      onChange={(e) => field('businessName', e.target.value)}
                      required
                      minLength={2}
                      maxLength={120}
                    />
                  </div>
                )}
                <div>
                  <label className="field-label" htmlFor="app-city">
                    City
                  </label>
                  <select
                    className="form-input"
                    id="app-city"
                    value={profile.city}
                    onChange={(e) => field('city', e.target.value)}
                    required
                  >
                    <option value="">Select your city</option>
                    {cityDirectory.map((city) => (
                      <option key={city.slug} value={city.slug}>
                        {city.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="field-label" htmlFor="app-pincode">
                    PIN code
                  </label>
                  <input
                    className="form-input"
                    id="app-pincode"
                    value={profile.pincode}
                    onChange={(e) => field('pincode', e.target.value)}
                    inputMode="numeric"
                    pattern="[1-9][0-9]{5}"
                    required
                    maxLength={6}
                  />
                </div>
                <div className="form-full">
                  <label className="field-label" htmlFor="app-address">
                    {kind === 'seller' ? 'Business address' : 'Address'}
                  </label>
                  <textarea
                    className="form-input"
                    id="app-address"
                    value={profile.address}
                    onChange={(e) => field('address', e.target.value)}
                    minLength={10}
                    maxLength={500}
                    required
                    rows={3}
                  />
                </div>
                {kind === 'rider' && (
                  <>
                    <div>
                      <label className="field-label" htmlFor="app-vehicle">
                        Vehicle type
                      </label>
                      <select
                        className="form-input"
                        id="app-vehicle"
                        value={profile.vehicleType ?? 'bicycle'}
                        onChange={(e) =>
                          field('vehicleType', e.target.value as ApplicationProfile['vehicleType'])
                        }
                      >
                        {['bicycle', 'scooter', 'motorbike', 'car'].map((vehicle) => (
                          <option key={vehicle} value={vehicle}>
                            {vehicle}
                          </option>
                        ))}
                      </select>
                    </div>
                    {profile.vehicleType !== 'bicycle' && (
                      <div>
                        <label className="field-label" htmlFor="app-registration">
                          Vehicle registration
                        </label>
                        <input
                          className="form-input"
                          id="app-registration"
                          value={profile.vehicleRegistration ?? ''}
                          onChange={(e) => field('vehicleRegistration', e.target.value)}
                          maxLength={30}
                          required
                        />
                      </div>
                    )}
                  </>
                )}
              </div>
            </div>
            <div className="workspace-panel">
              <div className="panel-step">
                <span>02</span>
                <div>
                  <h2>Verification documents</h2>
                  <p>PNG, JPEG or PDF. Up to 5 MB per file.</p>
                </div>
              </div>
              <label className="document-dropzone">
                <strong>
                  {pending ? 'Checking your document…' : 'Choose a verification document'}
                </strong>
                <span>Proof of identity or business, as requested by the verification team.</span>
                <input
                  type="file"
                  accept="image/png,image/jpeg,application/pdf"
                  aria-label="Verification document"
                  onChange={(event) => {
                    const file = event.target.files?.[0];
                    if (file) void addFile(file);
                    event.target.value = '';
                  }}
                />
              </label>
              <div className="document-list">
                {files.map((file) => (
                  <div key={file.id}>
                    <span>{file.filename}</span>
                    <span className="status-badge status-approved">
                      {file.status === 'DEVELOPMENT_REVIEWABLE'
                        ? 'Development checked'
                        : file.status === 'QUARANTINED'
                          ? 'Check pending'
                          : 'Attached'}
                    </span>
                    {file.status === 'QUARANTINED' && (
                      <button
                        className="text-link"
                        type="button"
                        onClick={() => void checkFile(file.id)}
                      >
                        Retry document check
                      </button>
                    )}
                    <button
                      className="text-link"
                      type="button"
                      aria-label={`Remove ${file.filename}`}
                      onClick={() => setFiles((old) => old.filter((item) => item.id !== file.id))}
                    >
                      Remove
                    </button>
                  </div>
                ))}
              </div>
              {files.some((file) => file.status === 'DEVELOPMENT_REVIEWABLE') && (
                <p className="development-banner">
                  Local development: documents receive format checks, not an antivirus clearance.
                  Live deployments require malware scanning.
                </p>
              )}
            </div>
          </fieldset>
          {editable && (
            <div className="button-row">
              <button
                className="outline-button"
                type="button"
                disabled={pending || conflict}
                onClick={() => void save(false)}
              >
                Save draft
              </button>
              <button className="red-button" disabled={pending || conflict} type="submit">
                {pending ? 'Please wait…' : 'Submit for verification'}
              </button>
            </div>
          )}
        </form>
        <ErrorNotice error={error} />
        {notice && (
          <p className="success-notice" role="status">
            {notice}
          </p>
        )}
      </>
    </WorkspaceShell>
  );
}
export function SellerWorkspace() {
  const { session } = useSession();
  const query = useQuery({
    queryKey: ['restaurants', session?.principal.userId],
    queryFn: () =>
      api<
        Array<{
          id: string;
          name: string;
          city: string;
          verification: string;
          orderingEnabled: boolean;
        }>
      >('/seller/restaurants'),
  });
  return (
    <WorkspaceShell
      role="seller"
      title="Your restaurants"
      description="Verified businesses attached to your account."
    >
      <ErrorNotice error={query.error} />
      {query.isPending ? (
        <p role="status">Loading restaurants…</p>
      ) : query.data?.length ? (
        query.data.map((restaurant) => (
          <div className="workspace-panel" key={restaurant.id}>
            <span className="status-badge status-approved">Verified</span>
            <h2>{restaurant.name}</h2>
            <p className="panel-description">{restaurant.city}</p>
            <p>
              Manage your restaurant, opening hours, menu and offers. Ordering is currently
              disabled.
            </p>
            <div className="button-row">
              <Link className="red-button" to={`/seller/restaurants/${restaurant.id}/menu`}>
                Manage menu
              </Link>
              <Link className="outline-button" to={`/seller/restaurants/${restaurant.id}/profile`}>
                Restaurant details
              </Link>
            </div>
          </div>
        ))
      ) : (
        <div className="workspace-panel">
          <h2>No verified restaurant yet</h2>
          <Link className="text-link" to="/seller/onboarding">
            Review your application
          </Link>
        </div>
      )}
    </WorkspaceShell>
  );
}
export function RiderWorkspace() {
  const { session } = useSession();
  const query = useQuery({
    queryKey: ['rider-profile', session?.principal.userId],
    queryFn: () =>
      api<ApplicationProfile & { verification: string; dispatchEnabled: boolean }>(
        '/rider/profile',
      ),
  });
  return (
    <WorkspaceShell
      role="rider"
      title="Delivery partner workspace"
      description="Your approved delivery profile."
    >
      <ErrorNotice error={query.error} />
      {query.isPending ? (
        <p role="status">Loading your profile…</p>
      ) : (
        query.data && (
          <div className="workspace-panel">
            <span className="status-badge status-approved">Verified partner</span>
            <h2>{query.data.fullName}</h2>
            <dl className="detail-grid">
              <dt>City</dt>
              <dd>{query.data.city}</dd>
              <dt>Vehicle</dt>
              <dd>{query.data.vehicleType}</dd>
              <dt>Registration</dt>
              <dd>{query.data.vehicleRegistration ?? 'Not required'}</dd>
            </dl>
            <p className="small-help">
              Delivery offers and live navigation will open when dispatch is available. You are not
              accepting deliveries yet.
            </p>
          </div>
        )
      )}
    </WorkspaceShell>
  );
}

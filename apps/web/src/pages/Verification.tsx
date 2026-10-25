import { useEffect, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { Application } from '@cravecart/contracts';
import { api, ApiError, documentBlob } from '../api';
import { useSession } from '../components/SessionProvider';
import { WorkspaceShell, ErrorNotice } from '../components/WorkspaceShell';
import { MfaDialog } from '../components/Authenticator';
import { Modal } from '../components/Modal';
import { formatDate } from './Account';

interface Operation {
  operationId: string;
  applicationId: string;
  state: 'PENDING' | 'APPLIED' | 'FAILED';
  requiresMfa: boolean;
  error: string | null;
  attempts: number;
  result: Application | null;
}
interface Audit {
  id: string;
  action: string;
  actorId: string;
  reason: string;
  at: string;
}
interface Detail {
  application: Application;
  operation: Operation | null;
  audit: Audit[];
}
export function AdminOverview() {
  const query = useQuery({
    queryKey: ['admin-overview'],
    queryFn: () =>
      api<{ submitted: number; pendingOperations: number; approved: number }>('/admin/dashboard'),
    refetchInterval: 10_000,
  });
  return (
    <WorkspaceShell
      role="admin"
      title="Verification overview"
      description="A clear view of partner onboarding."
    >
      <ErrorNotice error={query.error} />
      {query.isPending ? (
        <p role="status">Loading overview…</p>
      ) : (
        query.data && (
          <>
            <div className="summary-grid">
              <div className="workspace-panel">
                <span>Awaiting review</span>
                <strong>{query.data.submitted}</strong>
              </div>
              <div className="workspace-panel">
                <span>Pending operations</span>
                <strong>{query.data.pendingOperations}</strong>
              </div>
              <div className="workspace-panel">
                <span>Approved applications</span>
                <strong>{query.data.approved}</strong>
              </div>
            </div>
            <Link className="red-button" to="/admin/verifications">
              Open verification queue
            </Link>
          </>
        )
      )}
    </WorkspaceShell>
  );
}
export function VerificationQueue({ initialKind = '' }: { initialKind?: string } = {}) {
  const [status, setStatus] = useState(initialKind ? '' : 'SUBMITTED'),
    [kind, setKind] = useState(initialKind);
  const params = new URLSearchParams({ ...(status ? { status } : {}), ...(kind ? { kind } : {}) });
  const query = useQuery({
    queryKey: ['verification-queue', status, kind],
    queryFn: () =>
      api<Array<{ application: Application; operationId: string | null }>>(
        `/admin/verifications?${params}`,
      ),
    refetchInterval: 10_000,
  });
  return (
    <WorkspaceShell
      role="admin"
      title="Partner verifications"
      description="Review documents and record a reason for every decision."
    >
      <div className="filter-row">
        <label>
          Status
          <select className="form-input" value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="">All statuses</option>
            {['SUBMITTED', 'APPROVED', 'CHANGES_REQUESTED', 'REJECTED'].map((state) => (
              <option key={state} value={state}>
                {state.replaceAll('_', ' ')}
              </option>
            ))}
          </select>
        </label>
        <label>
          Partner type
          <select className="form-input" value={kind} onChange={(e) => setKind(e.target.value)}>
            <option value="">All partners</option>
            <option value="seller">Restaurant</option>
            <option value="rider">Delivery partner</option>
          </select>
        </label>
      </div>
      <ErrorNotice error={query.error} />
      {query.isPending ? (
        <p role="status">Loading verifications…</p>
      ) : query.data?.length ? (
        <div className="application-queue">
          {query.data.map(({ application, operationId }) => (
            <Link
              className="verification-row"
              to={`/admin/verifications/${application.id}`}
              key={application.id}
            >
              <div>
                <p className="eyebrow">
                  {application.kind === 'seller' ? 'Restaurant' : 'Delivery partner'} ·{' '}
                  {application.profile.city}
                </p>
                <h2>{application.profile.businessName ?? application.profile.fullName}</h2>
                <p>
                  {application.profile.fullName} · Updated {formatDate(application.updatedAt)}
                </p>
              </div>
              <span className={`status-badge status-${application.status.toLowerCase()}`}>
                {operationId ? 'Operation pending' : application.status.replaceAll('_', ' ')}
              </span>
              <span aria-hidden="true">→</span>
            </Link>
          ))}
        </div>
      ) : (
        <div className="workspace-panel">
          <h2>No applications in this view.</h2>
          <p>Change the filters or come back when partners submit their applications.</p>
        </div>
      )}
    </WorkspaceShell>
  );
}
export function VerificationDetail() {
  const { applicationId } = useParams();
  const { session } = useSession();
  const client = useQueryClient();
  const query = useQuery({
    queryKey: ['verification', applicationId],
    queryFn: () => api<Detail>(`/admin/verifications/${applicationId}`),
  });
  const [decision, setDecision] = useState<'approved' | 'rejected' | 'changes-requested'>(
      'approved',
    ),
    [reason, setReason] = useState(''),
    [error, setError] = useState<unknown>(),
    [pending, setPending] = useState(false),
    [localOperation, setLocalOperation] = useState<Operation>(),
    [mfa, setMfa] = useState(false),
    [retryAfterMfa, setRetryAfterMfa] = useState(false),
    [preview, setPreview] = useState<{ url: string; mime: string }>();
  const key = useRef(crypto.randomUUID());
  const operationId = localOperation?.operationId ?? query.data?.operation?.operationId;
  const operationQuery = useQuery({
    queryKey: ['verification-operation', operationId],
    queryFn: () => api<Operation>(`/admin/operations/${operationId}`),
    enabled: Boolean(operationId),
    refetchInterval: (query) => (query.state.data?.state === 'PENDING' ? 2500 : false),
  });
  const operation = operationQuery.data ?? localOperation ?? query.data?.operation;
  const refreshDetail = query.refetch;
  useEffect(() => {
    if (operation?.state === 'APPLIED') {
      void refreshDetail();
      void client.invalidateQueries({ queryKey: ['verification-queue'] });
    }
  }, [operation?.state, refreshDetail, client]);
  useEffect(
    () => () => {
      if (preview) URL.revokeObjectURL(preview.url);
    },
    [preview],
  );
  async function review() {
    if (!query.data) return;
    setPending(true);
    setError(undefined);
    try {
      const value = await api<Operation>(`/admin/verifications/${applicationId}/decision`, {
        method: 'POST',
        body: { expectedVersion: query.data.application.version, decision, reason },
        headers: { 'Idempotency-Key': key.current },
      });
      setLocalOperation(value);
      await query.refetch();
    } catch (error) {
      setError(error);
    } finally {
      setPending(false);
    }
  }
  async function retry() {
    if (!operationId) return;
    setPending(true);
    setError(undefined);
    try {
      setLocalOperation(
        await api(`/admin/operations/${operationId}/retry`, { method: 'POST', body: {} }),
      );
      await operationQuery.refetch();
      await query.refetch();
    } catch (error) {
      setError(error);
    } finally {
      setPending(false);
    }
  }
  async function view(id: string) {
    setPending(true);
    setError(undefined);
    try {
      const metadata = await api<{ url: string; mime: string }>(`/uploads/${id}/access`);
      const blob = await documentBlob(metadata.url.replace('/api/v1', ''));
      setPreview({ url: URL.createObjectURL(blob), mime: metadata.mime });
    } catch (error) {
      setError(error);
    } finally {
      setPending(false);
    }
  }
  const application = query.data?.application;
  return (
    <WorkspaceShell
      role="admin"
      title="Review application"
      description="Only a verified decision grants partner access."
    >
      <Link className="text-link" to="/admin/verifications">
        ← Back to the queue
      </Link>
      <ErrorNotice error={query.error ?? error ?? operationQuery.error} />
      {error instanceof ApiError && ['MFA_REQUIRED', 'REAUTH_REQUIRED'].includes(error.code) && (
        <button
          className="outline-button"
          onClick={() => {
            setRetryAfterMfa(false);
            setMfa(true);
          }}
        >
          Verify authenticator
        </button>
      )}
      {query.isPending ? (
        <p role="status">Loading application…</p>
      ) : (
        application && (
          <>
            <div className="workspace-panel">
              <div className="panel-title-row">
                <h2>{application.profile.businessName ?? application.profile.fullName}</h2>
                <span className={`status-badge status-${application.status.toLowerCase()}`}>
                  {application.status.replaceAll('_', ' ')}
                </span>
              </div>
              <dl className="detail-grid">
                <dt>Applicant</dt>
                <dd>{application.profile.fullName}</dd>
                <dt>Partner type</dt>
                <dd>{application.kind}</dd>
                <dt>City</dt>
                <dd>{application.profile.city}</dd>
                <dt>Address</dt>
                <dd>
                  {application.profile.address}, {application.profile.pincode}
                </dd>
                {application.kind === 'rider' && (
                  <>
                    <dt>Vehicle</dt>
                    <dd>
                      {application.profile.vehicleType} {application.profile.vehicleRegistration}
                    </dd>
                  </>
                )}
                <dt>Revision</dt>
                <dd>{application.version}</dd>
                <dt>Workspace activation</dt>
                <dd>{application.grantState ?? 'NOT_REQUESTED'}</dd>
              </dl>
              {application.reason && <p className="review-reason">{application.reason}</p>}
            </div>
            <div className="workspace-panel">
              <h2>Protected documents</h2>
              <p className="panel-description">
                Document access requires fresh MFA and is recorded in the audit history.
              </p>
              <div className="button-row">
                {application.documentIds.map((id, index) => (
                  <button
                    className="outline-button"
                    disabled={pending}
                    key={id}
                    onClick={() => void view(id)}
                  >
                    View document {index + 1}
                  </button>
                ))}
              </div>
            </div>
            {operation && (
              <div
                className={`application-state state-${operation.state.toLowerCase()}`}
                role="status"
              >
                <h2>Review operation: {operation.state.toLowerCase()}</h2>
                {operation.state === 'PENDING' && (
                  <p>
                    The request is safely recorded. Partner access is not confirmed until activation
                    succeeds.
                  </p>
                )}
                {operation.error && (
                  <p>
                    {operation.requiresMfa
                      ? 'A reviewer must verify fresh MFA before retrying.'
                      : `Action required: ${operation.error}`}
                  </p>
                )}
                {operation.state !== 'APPLIED' && (
                  <div className="button-row">
                    <button
                      className="outline-button"
                      disabled={pending}
                      onClick={() => {
                        setRetryAfterMfa(true);
                        setMfa(true);
                      }}
                    >
                      Verify and retry
                    </button>
                    <button className="text-link" disabled={pending} onClick={() => void retry()}>
                      Retry operation
                    </button>
                  </div>
                )}
              </div>
            )}
            {application.userId === session?.principal.userId ? (
              <p className="form-feedback">You cannot review your own application.</p>
            ) : (
              application.status === 'SUBMITTED' &&
              operation?.state !== 'PENDING' && (
                <div className="workspace-panel">
                  <h2>Record your decision</h2>
                  <form
                    onSubmit={(event) => {
                      event.preventDefault();
                      void review();
                    }}
                  >
                    <label className="field-label" htmlFor="review-decision">
                      Decision
                    </label>
                    <select
                      className="form-input"
                      id="review-decision"
                      value={decision}
                      onChange={(e) => setDecision(e.target.value as typeof decision)}
                    >
                      <option value="approved">Approve</option>
                      <option value="changes-requested">Request changes</option>
                      <option value="rejected">Reject</option>
                    </select>
                    <label className="field-label spaced-label" htmlFor="review-reason">
                      Reason, visible to the applicant
                    </label>
                    <textarea
                      className="form-input"
                      id="review-reason"
                      value={reason}
                      onChange={(e) => setReason(e.target.value)}
                      minLength={5}
                      maxLength={1000}
                      required
                      rows={4}
                    />
                    <p className="small-help">
                      You are confirming a {decision.replaceAll('-', ' ')} decision for revision{' '}
                      {application.version}.
                    </p>
                    <button className="red-button" disabled={pending} type="submit">
                      {pending ? 'Recording…' : 'Confirm decision'}
                    </button>
                  </form>
                </div>
              )
            )}
            <div className="workspace-panel">
              <h2>Review history</h2>
              {query.data?.audit.length ? (
                query.data.audit.map((entry) => (
                  <div className="audit-entry" key={entry.id}>
                    <strong>{entry.action}</strong>
                    <p>{entry.reason}</p>
                    <small>{formatDate(entry.at)}</small>
                  </div>
                ))
              ) : (
                <p className="small-help">No decisions have been recorded yet.</p>
              )}
            </div>
          </>
        )
      )}
      {mfa && (
        <MfaDialog
          onClose={() => setMfa(false)}
          onVerified={() => {
            setError(undefined);
            if (retryAfterMfa) void retry();
          }}
        />
      )}
      {preview && (
        <Modal
          title="Verification document"
          onClose={() => setPreview(undefined)}
          className="document-modal"
        >
          {preview.mime.startsWith('image/') ? (
            <img
              className="document-preview"
              src={preview.url}
              alt="Protected verification document"
            />
          ) : (
            <p>PDF documents download securely and are not embedded into this page.</p>
          )}
          <a
            className="red-button"
            href={preview.url}
            download={`verification-document.${preview.mime === 'application/pdf' ? 'pdf' : preview.mime === 'image/png' ? 'png' : 'jpg'}`}
          >
            Download document
          </a>
        </Modal>
      )}
    </WorkspaceShell>
  );
}
interface UserRow {
  id: string;
  name: string;
  contact: string;
  roles: string[];
  status: 'ACTIVE' | 'SUSPENDED';
}
export function AdminUsers() {
  const { userId } = useParams();
  const { session } = useSession();
  const query = useQuery({
    queryKey: ['admin-users', userId],
    queryFn: () =>
      userId
        ? api<UserRow>('/admin/users/' + encodeURIComponent(userId)).then((user) => [user])
        : api<UserRow[]>('/admin/users'),
  });
  const [selected, setSelected] = useState<UserRow>(),
    [reason, setReason] = useState(''),
    [error, setError] = useState<unknown>(),
    [pending, setPending] = useState(false),
    [mfa, setMfa] = useState(false);
  async function change() {
    if (!selected) return;
    setPending(true);
    setError(undefined);
    try {
      await api(`/admin/users/${selected.id}/status`, {
        method: 'POST',
        body: { status: selected.status === 'ACTIVE' ? 'SUSPENDED' : 'ACTIVE', reason },
      });
      setSelected(undefined);
      setReason('');
      await query.refetch();
    } catch (error) {
      setError(error);
    } finally {
      setPending(false);
    }
  }
  return (
    <WorkspaceShell
      role="admin"
      title={userId ? 'Account details' : 'Account management'}
      description="Suspension revokes active sessions immediately."
    >
      <ErrorNotice error={query.error} />
      {query.isPending ? (
        <p role="status">Loading accounts…</p>
      ) : (
        <div className="table-scroll">
          <table className="workspace-table">
            <thead>
              <tr>
                <th>Account</th>
                <th>Access</th>
                <th>Status</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              {query.data?.map((user) => (
                <tr key={user.id}>
                  <td>
                    <Link to={'/admin/users/' + user.id}>
                      <strong>{user.name}</strong>
                    </Link>
                    <small>{user.contact}</small>
                  </td>
                  <td>{user.roles.join(', ')}</td>
                  <td>
                    <span
                      className={`status-badge ${user.status === 'ACTIVE' ? 'status-approved' : 'status-rejected'}`}
                    >
                      {user.status}
                    </span>
                  </td>
                  <td>
                    <button
                      className="text-link"
                      disabled={user.id === session?.principal.userId}
                      onClick={() => {
                        setSelected(user);
                        setError(undefined);
                      }}
                    >
                      {user.status === 'ACTIVE' ? 'Suspend' : 'Restore'}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {selected && (
        <Modal
          title={`${selected.status === 'ACTIVE' ? 'Suspend' : 'Restore'} account`}
          onClose={() => setSelected(undefined)}
        >
          <p className="panel-description">
            {selected.name} · {selected.contact}
          </p>
          <form
            onSubmit={(event) => {
              event.preventDefault();
              void change();
            }}
          >
            <label className="field-label" htmlFor="status-reason">
              Reason
            </label>
            <textarea
              className="form-input"
              id="status-reason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              minLength={5}
              maxLength={1000}
              required
              rows={3}
            />
            <ErrorNotice error={error} />
            {error instanceof ApiError && error.code === 'MFA_REQUIRED' && (
              <button
                type="button"
                className="text-link"
                onClick={() => {
                  setSelected(undefined);
                  setMfa(true);
                }}
              >
                Verify authenticator first
              </button>
            )}
            <button className="red-button full-button" disabled={pending} type="submit">
              Confirm account change
            </button>
          </form>
        </Modal>
      )}
      {mfa && <MfaDialog onClose={() => setMfa(false)} />}
    </WorkspaceShell>
  );
}
export function AdminAudit() {
  const query = useQuery({
    queryKey: ['admin-audit'],
    queryFn: () => api<Audit[]>('/admin/audit'),
  });
  return (
    <WorkspaceShell
      role="admin"
      title="Audit history"
      description="Recorded verification and account-management actions."
    >
      <ErrorNotice error={query.error} />
      {query.isPending ? (
        <p role="status">Loading audit history…</p>
      ) : (
        <div className="workspace-panel">
          {query.data?.length ? (
            query.data.map((entry) => (
              <div className="audit-entry" key={entry.id}>
                <strong>{entry.action}</strong>
                <p>{entry.reason}</p>
                <small>
                  {entry.actorId} · {formatDate(entry.at)}
                </small>
              </div>
            ))
          ) : (
            <p>No administrative actions have been recorded yet.</p>
          )}
        </div>
      )}
    </WorkspaceShell>
  );
}

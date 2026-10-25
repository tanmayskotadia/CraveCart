import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import type { PrivacyRequest } from '@cravecart/contracts';
import { api } from '../api';
import { WorkspaceShell, ErrorNotice } from '../components/WorkspaceShell';
import { Field } from '../components/CatalogFields';
export function PrivacySettingsPage() {
  const query = useQuery({
    queryKey: ['privacy-requests'],
    queryFn: () => api<PrivacyRequest[]>('/privacy/requests'),
    refetchInterval: 5000,
  });
  const [kind, setKind] = useState('export'),
    [confirmed, setConfirmed] = useState(false),
    [command, setCommand] = useState(() => crypto.randomUUID()),
    [busy, setBusy] = useState(false),
    [error, setError] = useState<unknown>();
  async function download(request: PrivacyRequest) {
    setBusy(true);
    setError(undefined);
    try {
      const response = await fetch(`/api/v1/privacy/requests/${request.id}/download`, {
        credentials: 'include',
        cache: 'no-store',
      });
      if (!response.ok)
        throw new Error((await response.json()).error?.message ?? 'Export could not be downloaded');
      const url = URL.createObjectURL(await response.blob()),
        anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = `CraveCart-data-${request.id}.json`;
      anchor.click();
      setTimeout(() => URL.revokeObjectURL(url), 60000);
    } catch (cause) {
      setError(cause);
    } finally {
      setBusy(false);
    }
  }
  return (
    <WorkspaceShell
      title="Privacy requests"
      description="Verified account exports and retention-aware account closure."
    >
      <ErrorNotice error={error ?? query.error} />
      <p>
        <Link className="inline-link" to="/login?returnTo=%2Fsettings%2Fprivacy">
          Sign in again to verify your identity
        </Link>
      </p>
      <form
        className="workspace-panel"
        onSubmit={(event) => {
          event.preventDefault();
          if (!confirmed) return;
          setBusy(true);
          setError(undefined);
          void api('/privacy/requests', {
            method: 'POST',
            headers: { 'Idempotency-Key': command },
            body: { kind, confirmed: true },
          })
            .then(async () => {
              setCommand(crypto.randomUUID());
              setConfirmed(false);
              await query.refetch();
            })
            .catch(setError)
            .finally(() => setBusy(false));
        }}
      >
        <Field label="Request type">
          <select
            className="form-input"
            value={kind}
            onChange={(event) => {
              setKind(event.target.value);
              setConfirmed(false);
              setCommand(crypto.randomUUID());
            }}
          >
            <option value="export">Copy of my personal data</option>
            <option value="delete">Account deletion review</option>
          </select>
        </Field>
        <p>
          A recent verified sign-in is required. An independent reviewer authorizes fulfilment.
          Exports are private, encrypted while stored and available for seven days. Download an
          export before requesting closure.
        </p>
        <p>
          Approved deletion ends account access after obligation checks. Financial, dispute and
          verification records may remain for the reviewed retention period; the result lists
          retained categories. Active orders and partner obligations must be resolved first.
        </p>
        <label className="check-label">
          <input
            type="checkbox"
            checked={confirmed}
            onChange={(event) => setConfirmed(event.target.checked)}
          />
          I confirm this request concerns my own account.
        </label>
        <button className="red-button" disabled={busy || !confirmed}>
          Submit privacy request
        </button>
      </form>
      {query.isPending && <p role="status">Loading privacy requests…</p>}
      {query.data?.map((request) => (
        <article
          className="workspace-panel"
          key={request.id}
          data-testid={`privacy-request-${request.id}`}
        >
          <h2>
            {request.kind === 'export'
              ? 'Personal data export request'
              : 'Account deletion request'}
          </h2>
          <p>
            {request.status.replaceAll('_', ' ')} ·{' '}
            {new Date(request.requestedAt).toLocaleString('en-IN')}
          </p>
          <p>{request.message}</p>
          <p className="small-help">
            Reference: {request.id} · Completed owner steps: {request.progress}
          </p>
          {request.retained.length > 0 && (
            <ul>
              {request.retained.map((value) => (
                <li key={value}>{value}</li>
              ))}
            </ul>
          )}
          {request.status === 'READY' &&
            request.downloadExpiresAt &&
            Date.parse(request.downloadExpiresAt) > Date.now() && (
              <button className="red-button" disabled={busy} onClick={() => void download(request)}>
                Download private export
              </button>
            )}
          {['AWAITING_REVIEW', 'PREFLIGHT', 'BLOCKED'].includes(request.status) && (
            <button
              className="outline-button"
              disabled={busy}
              onClick={() => {
                setBusy(true);
                setError(undefined);
                void api(`/privacy/requests/${request.id}/cancel`, {
                  method: 'POST',
                  headers: { 'Idempotency-Key': crypto.randomUUID() },
                  body: { expectedVersion: request.version },
                })
                  .then(() => query.refetch())
                  .catch(setError)
                  .finally(() => setBusy(false));
              }}
            >
              Cancel privacy request
            </button>
          )}
        </article>
      ))}
      <Link className="inline-link" to="/support">
        Contact support about a privacy request
      </Link>
    </WorkspaceShell>
  );
}
export function PrivacyAdminPage() {
  const [page, setPage] = useState(1),
    [selected, setSelected] = useState<PrivacyRequest>(),
    [reason, setReason] = useState(''),
    [command, setCommand] = useState(() => crypto.randomUUID()),
    [busy, setBusy] = useState(false),
    [error, setError] = useState<unknown>();
  const query = useQuery({
    queryKey: ['admin-privacy', page],
    queryFn: () =>
      api<{ requests: PrivacyRequest[]; total: number; retentionConfigured: boolean }>(
        `/admin/privacy/requests?page=${page}`,
      ),
    refetchInterval: 5000,
  });
  async function decide(action: 'approve' | 'reject' | 'retry') {
    if (!selected) return;
    setBusy(true);
    setError(undefined);
    try {
      await api(`/admin/privacy/requests/${selected.id}/decision`, {
        method: 'POST',
        headers: { 'Idempotency-Key': command },
        body: { expectedVersion: selected.version, action, reason },
      });
      setSelected(undefined);
      setReason('');
      setCommand(crypto.randomUUID());
      await query.refetch();
    } catch (cause) {
      setError(cause);
    } finally {
      setBusy(false);
    }
  }
  return (
    <WorkspaceShell
      role="admin"
      title="Privacy reviews"
      description="Independently review verified requests and track owner-scoped fulfilment."
    >
      <ErrorNotice error={error ?? query.error} />
      {query.data && !query.data.retentionConfigured && (
        <p className="commerce-banner">
          Deletion approval is disabled until the operator configures a reviewed financial retention
          period. Publish the reviewed privacy notice in Policies & settings.
        </p>
      )}
      {query.isPending && <p role="status">Loading privacy requests…</p>}
      {query.data?.requests.length === 0 && <p>No privacy requests.</p>}
      {query.data?.requests.map((request) => (
        <article
          className="workspace-panel"
          key={request.id}
          data-testid={`privacy-review-${request.id}`}
        >
          <h2>{request.kind === 'export' ? 'Account export' : 'Account closure'}</h2>
          <p>
            {request.status.replaceAll('_', ' ')} · {request.id}
          </p>
          <Link className="inline-link" to={`/admin/users/${request.userId}`}>
            Inspect requesting account
          </Link>
          <p>{request.message}</p>
          <p>Completed owner steps: {request.progress}</p>
          {request.reviewReason && <p>Review reason: {request.reviewReason}</p>}
          {request.retained.length > 0 && (
            <ul>
              {request.retained.map((value) => (
                <li key={value}>{value}</li>
              ))}
            </ul>
          )}
          {['AWAITING_REVIEW', 'BLOCKED'].includes(request.status) && (
            <button
              className="outline-button"
              disabled={busy}
              onClick={() => {
                setSelected(request);
                setReason('');
                setCommand(crypto.randomUUID());
              }}
            >
              Review privacy request
            </button>
          )}
        </article>
      ))}
      {selected && (
        <div className="workspace-panel">
          <h2>Review {selected.kind} request</h2>
          <p>{selected.id}</p>
          <Field label="Privacy review reason">
            <textarea
              className="form-input"
              value={reason}
              maxLength={500}
              minLength={5}
              onChange={(event) => setReason(event.target.value)}
            />
          </Field>
          <div className="button-row">
            {selected.status === 'BLOCKED' ? (
              <button
                className="red-button"
                disabled={busy || reason.trim().length < 5}
                onClick={() => void decide('retry')}
              >
                Retry reviewed request
              </button>
            ) : (
              <>
                <button
                  className="red-button"
                  disabled={busy || reason.trim().length < 5}
                  onClick={() => void decide('approve')}
                >
                  Approve privacy request
                </button>
                <button
                  className="outline-button"
                  disabled={busy || reason.trim().length < 5}
                  onClick={() => void decide('reject')}
                >
                  Reject privacy request
                </button>
              </>
            )}
            <button className="text-link" disabled={busy} onClick={() => setSelected(undefined)}>
              Close review
            </button>
          </div>
        </div>
      )}
      {query.data && query.data.total > 20 && (
        <nav aria-label="Privacy request pages">
          <button
            className="outline-button"
            disabled={page === 1}
            onClick={() => setPage(page - 1)}
          >
            Previous requests
          </button>
          <span> Page {page} </span>
          <button
            className="outline-button"
            disabled={page * 20 >= query.data.total}
            onClick={() => setPage(page + 1)}
          >
            Next requests
          </button>
        </nav>
      )}
    </WorkspaceShell>
  );
}

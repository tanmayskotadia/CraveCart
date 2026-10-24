import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import type { Refund, PricingPolicy } from '@cravecart/contracts';
import { api } from '../api';
import { ErrorNotice, WorkspaceShell } from '../components/WorkspaceShell';
import { Field, money } from '../components/CatalogFields';
interface Report {
  mode: string;
  balances: Array<{
    mode: string;
    currency: string;
    debitMinor: number;
    creditMinor: number;
    balanced: boolean;
    accounts: Record<string, number>;
  }>;
  unbalancedGroups: number;
  missingPostingGroups: number;
  overRefundedCaptures: number;
  unmatchedEvents: number;
  scope: string;
  attempts: Array<{
    id: string;
    orderId: string;
    gateway: string;
    state: string;
    lastError: string | null;
    amountMinor: number;
  }>;
  refunds: Refund[];
  jobs: Array<{ _id: string; state: string; processed: number; ids: string[] }>;
}
export function FinancePage() {
  const query = useQuery({
    queryKey: ['finance'],
    queryFn: () => api<Report>('/admin/finance'),
    refetchInterval: 10000,
  });
  const policy = useQuery({
    queryKey: ['pricing-policy'],
    queryFn: () => api<PricingPolicy | null>('/admin/commerce/policy'),
  });
  const [reason, setReason] = useState('');
  const [reference, setReference] = useState('');
  const [target, setTarget] = useState('');
  const [kind, setKind] = useState('payment');
  const [error, setError] = useState<unknown>();
  const [busy, setBusy] = useState(false);
  async function perform(path: string, body: unknown) {
    setBusy(true);
    setError(undefined);
    try {
      await api(path, { method: 'POST', body });
      await query.refetch();
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }
  return (
    <WorkspaceShell
      role="admin"
      title="Finance & reconciliation"
      description="Verified captures, refunds and balanced postings. Test and live accounts remain separate."
    >
      <ErrorNotice error={error ?? query.error ?? policy.error} />
      {query.data && (
        <>
          <p className="commerce-banner">
            Environment: {query.data.mode}. {query.data.scope}
          </p>
          <div className="workspace-panel">
            <h2>Ledger balances</h2>
            <p>
              Missing postings: {query.data.missingPostingGroups} · Over-refunded captures:{' '}
              {query.data.overRefundedCaptures} · Unbalanced posting groups:{' '}
              {query.data.unbalancedGroups} · Unmatched webhook events: {query.data.unmatchedEvents}
            </p>
            {query.data.balances.map((b) => (
              <div key={b.mode + b.currency}>
                <h3>
                  {b.mode} · {b.currency} · {b.balanced ? 'Balanced' : 'REVIEW REQUIRED'}
                </h3>
                <p>
                  Debits {money(b.debitMinor)} · Credits {money(b.creditMinor)}
                </p>
                {Object.entries(b.accounts).map(([name, value]) => (
                  <p key={name}>
                    {name}: {money(value)}
                  </p>
                ))}
              </div>
            ))}
            {query.data.balances.length === 0 && <p>No money posted.</p>}
          </div>
          <div className="workspace-panel">
            <h2>Reconciliation controls</h2>
            <p>
              Verify your authenticator before changing financial records. Reasons are retained in
              the audit trail.
            </p>
            <Field label="Operator reason">
              <textarea
                className="form-input"
                minLength={5}
                maxLength={500}
                value={reason}
                onChange={(e) => setReason(e.target.value)}
              />
            </Field>
            <button
              className="red-button"
              disabled={busy || reason.trim().length < 5}
              onClick={() => void perform('/admin/finance/reconcile', { reason })}
            >
              Recheck provider records
            </button>
            <h3>Recover an uncertain provider response</h3>
            <p>
              Link only a reference confirmed in your provider dashboard. The server checks its
              amount and ownership.
            </p>
            <Field label="Reference type">
              <select className="form-input" value={kind} onChange={(e) => setKind(e.target.value)}>
                <option value="payment">Payment attempt</option>
                <option value="refund">Refund</option>
              </select>
            </Field>
            <Field label="CraveCart record ID">
              <input
                className="form-input"
                value={target}
                onChange={(e) => setTarget(e.target.value)}
              />
            </Field>
            <Field label="Provider reference">
              <input
                className="form-input"
                value={reference}
                onChange={(e) => setReference(e.target.value)}
              />
            </Field>
            <button
              className="outline-button"
              disabled={busy || reason.trim().length < 5 || !target || !reference}
              onClick={() =>
                void perform(
                  `/admin/finance/attach-${kind === 'refund' ? 'refund-' : ''}reference`,
                  {
                    [kind === 'refund' ? 'refundId' : 'attemptId']: target,
                    providerId: reference,
                    reason,
                  },
                )
              }
            >
              Verify and link reference
            </button>
            {query.data.jobs.map((j) => (
              <p key={j._id}>
                {j.state} · {j.processed}/{j.ids.length} checked
              </p>
            ))}
          </div>
          <div className="workspace-panel">
            <h2>Recent payment attempts</h2>
            {query.data.attempts.map((a) => (
              <article className="cart-line" key={a.id}>
                <div>
                  <Link to={`/admin/orders/${a.orderId}`}>
                    {a.gateway} · {money(a.amountMinor)}
                  </Link>
                  <p>
                    {a.state} · {a.lastError ?? 'No provider exception'}
                  </p>
                  <small>{a.id}</small>
                </div>
              </article>
            ))}
          </div>
        </>
      )}
      {policy.isSuccess && (
        <PricingPolicyForm
          policy={
            policy.data ?? {
              enabled: false,
              approvedForLive: false,
              platformFeeMinor: 0,
              taxBps: 0,
              taxLabel: 'Tax policy pending approval',
              quoteSeconds: 300,
              paymentSeconds: 600,
              cancellationSeconds: 300,
              maxOrderMinor: 10000000,
              version: 0,
              development: false,
            }
          }
          saved={() => void policy.refetch()}
        />
      )}
    </WorkspaceShell>
  );
}
function PricingPolicyForm({ policy, saved }: { policy: PricingPolicy; saved: () => void }) {
  const [draft, setDraft] = useState(policy);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>();
  return (
    <form
      className="workspace-panel"
      onSubmit={(e) => {
        e.preventDefault();
        setBusy(true);
        setError(undefined);
        const { version, development: _dev, ...input } = draft;
        void api<PricingPolicy>('/admin/commerce/policy', {
          method: 'PUT',
          body: { expectedVersion: version, policy: input, reason },
        })
          .then((p) => {
            setDraft(p);
            saved();
          })
          .catch(setError)
          .finally(() => setBusy(false));
      }}
    >
      <h2>Pricing policy</h2>
      <ErrorNotice error={error} />
      <p>
        Tax applies to discounted item subtotal. Configure only after finance review; development
        defaults do not establish tax compliance.
      </p>
      <label>
        <input
          type="checkbox"
          checked={draft.enabled}
          onChange={(e) => setDraft({ ...draft, enabled: e.target.checked })}
        />{' '}
        Enable checkout
      </label>
      <label>
        <input
          type="checkbox"
          checked={draft.approvedForLive}
          onChange={(e) => setDraft({ ...draft, approvedForLive: e.target.checked })}
        />{' '}
        Finance approval for live pricing
      </label>
      {(
        [
          'platformFeeMinor',
          'taxBps',
          'quoteSeconds',
          'paymentSeconds',
          'cancellationSeconds',
          'maxOrderMinor',
        ] as const
      ).map((name) => (
        <Field
          label={
            {
              platformFeeMinor: 'Platform fee in paise',
              taxBps: 'Tax rate in basis points (100 = 1%)',
              quoteSeconds: 'Quote validity in seconds',
              paymentSeconds: 'Payment deadline in seconds',
              cancellationSeconds: 'Cancellation window in seconds',
              maxOrderMinor: 'Maximum order total in paise',
            }[name]
          }
          key={name}
        >
          <input
            className="form-input"
            type="number"
            min={0}
            value={draft[name]}
            onChange={(e) => setDraft({ ...draft, [name]: Number(e.target.value) })}
            required
          />
        </Field>
      ))}
      <Field label="Tax label">
        <input
          className="form-input"
          value={draft.taxLabel}
          onChange={(e) => setDraft({ ...draft, taxLabel: e.target.value })}
          required
        />
      </Field>
      <Field label="Policy change reason">
        <input
          className="form-input"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          minLength={5}
          maxLength={500}
          required
        />
      </Field>
      <button className="red-button" disabled={busy}>
        Save reviewed policy
      </button>
    </form>
  );
}
export function RefundsPage() {
  const { refundId } = useParams();
  const query = useQuery({
    queryKey: ['admin-refunds', refundId],
    queryFn: async () =>
      refundId
        ? [await api<Refund>(`/admin/refunds/${refundId}`)]
        : api<Refund[]>('/admin/refunds'),
    refetchInterval: 5000,
  });
  return (
    <WorkspaceShell
      role="admin"
      title="Refunds"
      description="A request is complete only after the provider confirms it."
    >
      <ErrorNotice error={query.error} />
      {query.data?.length === 0 && <p>No refunds in this environment.</p>}
      {query.data?.map((r) => (
        <article className="workspace-panel" key={r.id}>
          <h2>
            {money(r.amountMinor)} · {r.state}
          </h2>
          <p>
            {r.gateway} · {r.mode} · {r.reason}
          </p>
          <p>{r.lastError}</p>
          <p>Provider reference: {r.providerId ?? 'Pending'}</p>
          <Link to={`/admin/orders/${r.orderId}`}>View order</Link>
          {!refundId && (
            <p>
              <Link to={`/admin/refunds/${r.id}`}>Refund details</Link>
            </p>
          )}
        </article>
      ))}
    </WorkspaceShell>
  );
}

import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import {
  policyKindSchema,
  type PolicyAdmin,
  type PolicyContent,
  type PolicyKind,
  type PublishedPolicy,
} from '@cravecart/contracts';
import { api } from '../api';
import { useSession } from '../components/SessionProvider';
import { WorkspaceShell, ErrorNotice } from '../components/WorkspaceShell';
import { Field, money } from '../components/CatalogFields';
const blank: PolicyContent = {
  title: '',
  body: '',
  businessName: '',
  businessAddress: '',
  supportEmail: '',
  grievanceContact: '',
};
export function SettingsPage() {
  const [kind, setKind] = useState<PolicyKind>('terms');
  const query = useQuery({
    queryKey: ['admin-settings'],
    queryFn: () =>
      api<{ policies: PolicyAdmin[]; commerceMode: string; financeThresholdMinor: number }>(
        '/admin/settings',
      ),
  });
  const record = query.data?.policies.find((policy) => policy.kind === kind);
  return (
    <WorkspaceShell
      role="admin"
      title="Policies & settings"
      description="Reviewed business policies, published versions and operating configuration."
    >
      <ErrorNotice error={query.error} />
      {query.isPending && <p role="status">Loading settings…</p>}
      {query.data && (
        <div className="workspace-panel">
          <p>Payment mode: {query.data.commerceMode}</p>
          <p>
            Independent refund approval threshold:{' '}
            {query.data.financeThresholdMinor === 0
              ? 'Every discretionary refund'
              : money(query.data.financeThresholdMinor)}
          </p>
          <p className="small-help">
            Private credentials are configured in hosting settings. Live checkout requires published
            terms, privacy and cancellation policies. A different authorized reviewer must publish
            each draft.
          </p>
        </div>
      )}
      <Field label="Policy to manage">
        <select
          className="form-input"
          value={kind}
          onChange={(event) => setKind(event.target.value as PolicyKind)}
        >
          {policyKindSchema.options.map((value) => (
            <option key={value} value={value}>
              {value}
            </option>
          ))}
        </select>
      </Field>
      {record && (
        <PolicyEditor
          key={`${kind}:${record.version}`}
          record={record}
          saved={() => query.refetch()}
        />
      )}
    </WorkspaceShell>
  );
}
function PolicyEditor({ record, saved }: { record: PolicyAdmin; saved: () => Promise<unknown> }) {
  const { session } = useSession();
  const [content, setContent] = useState<PolicyContent>(
    () => record.draft ?? record.published ?? blank,
  );
  const [reason, setReason] = useState('');
  const [key] = useState(() => crypto.randomUUID());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>();
  const canWrite = session?.principal.permissions.includes('staff:write');
  const unchanged =
    record.draft &&
    Object.keys(blank).every(
      (field) =>
        content[field as keyof PolicyContent] === record.draft![field as keyof PolicyContent],
    );
  async function submit(publish: boolean) {
    setBusy(true);
    setError(undefined);
    try {
      // Published metadata must never be posted back as editable content.
      const body = Object.fromEntries(
        Object.keys(blank).map((field) => [field, content[field as keyof PolicyContent]]),
      );
      await api(`/admin/settings/policies/${record.kind}${publish ? '/publish' : ''}`, {
        method: publish ? 'POST' : 'PUT',
        headers: { 'Idempotency-Key': key },
        body: { expectedVersion: record.version, reason, ...(publish ? {} : { content: body }) },
      });
      await saved();
    } catch (cause) {
      setError(cause);
    } finally {
      setBusy(false);
    }
  }
  return (
    <form
      className="workspace-panel"
      onSubmit={(event) => {
        event.preventDefault();
        void submit(false);
      }}
    >
      <h2>{record.kind} policy</h2>
      <p>
        {record.published ? `Published version ${record.published.version}` : 'Not published'} ·
        Editor version {record.version}
      </p>
      {record.published && (
        <Link
          className="inline-link"
          target="_blank"
          rel="noopener noreferrer"
          to={`/legal/${record.kind}?revision=${record.published.id}`}
        >
          View published policy
        </Link>
      )}
      <ErrorNotice error={error} />
      {(
        [
          'title',
          'businessName',
          'businessAddress',
          'supportEmail',
          'grievanceContact',
          'body',
        ] as const
      ).map((field) => (
        <Field
          key={field}
          label={
            {
              title: 'Policy title',
              businessName: 'Legal business name',
              businessAddress: 'Registered business address',
              supportEmail: 'Support email',
              grievanceContact: 'Grievance contact',
              body: 'Policy text',
            }[field]
          }
        >
          {field === 'body' || field === 'businessAddress' ? (
            <textarea
              className="form-input"
              rows={field === 'body' ? 16 : 3}
              disabled={!canWrite || busy}
              value={content[field]}
              onChange={(event) => setContent({ ...content, [field]: event.target.value })}
              maxLength={field === 'body' ? 50000 : 1000}
              required
            />
          ) : (
            <input
              className="form-input"
              type={field === 'supportEmail' ? 'email' : 'text'}
              disabled={!canWrite || busy}
              value={content[field]}
              onChange={(event) => setContent({ ...content, [field]: event.target.value })}
              maxLength={field === 'grievanceContact' ? 500 : 254}
              required
            />
          )}
        </Field>
      ))}
      {canWrite && (
        <>
          <Field label="Policy change or review reason">
            <textarea
              className="form-input"
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              minLength={5}
              maxLength={500}
              required
            />
          </Field>
          <div className="button-row">
            <button className="red-button" disabled={busy || reason.trim().length < 5}>
              Save policy draft
            </button>
            <button
              className="outline-button"
              type="button"
              disabled={
                busy ||
                reason.trim().length < 5 ||
                !unchanged ||
                record.draftBy === session?.principal.userId
              }
              onClick={() => void submit(true)}
            >
              Publish reviewed draft
            </button>
          </div>
          <p className="small-help">
            Publish the exact saved draft after review. Its author cannot publish it; changed text
            must be saved and independently reviewed again.
          </p>
        </>
      )}
    </form>
  );
}
export function PolicyPage({ kind }: { kind: PolicyKind }) {
  const [params] = useSearchParams();
  const revision = params.get('revision');
  const query = useQuery({
    queryKey: ['policy', kind, revision],
    queryFn: () =>
      api<PublishedPolicy>(
        `/policies/${kind}${revision ? `?revision=${encodeURIComponent(revision)}` : ''}`,
      ),
    retry: false,
  });
  return (
    <section className="page-width" style={{ paddingBlock: 48, maxWidth: 850 }}>
      {query.isPending && <p role="status">Loading policy…</p>}
      {query.error && (
        <>
          <h1>This policy is not available yet</h1>
          <ErrorNotice error={query.error} />
          <Link className="inline-link" to="/help">
            Get help
          </Link>
        </>
      )}
      {query.data && (
        <>
          <p className="eyebrow">CraveCart policies</p>
          <h1>{query.data.title}</h1>
          <p>
            Version {query.data.version} · Published{' '}
            {new Date(query.data.publishedAt).toLocaleDateString('en-IN', {
              timeZone: 'Asia/Kolkata',
            })}
          </p>
          <p>
            {query.data.businessName}
            <br />
            {query.data.businessAddress}
          </p>
          <div style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', lineHeight: 1.9 }}>
            {query.data.body}
          </div>
          <p>
            Support:{' '}
            <a className="inline-link" href={`mailto:${query.data.supportEmail}`}>
              {query.data.supportEmail}
            </a>
          </p>
          <p>Grievance contact: {query.data.grievanceContact}</p>
        </>
      )}
    </section>
  );
}
export function HelpPage() {
  const capabilities = useQuery({
    queryKey: ['auth-capabilities'],
    queryFn: () => api<{ methods: string[]; developmentDelivery: boolean }>('/auth/capabilities'),
  });
  return (
    <section className="message-page page-width">
      <p className="eyebrow">CraveCart support</p>
      <h1>A little help, right here.</h1>
      <div className="help-questions">
        <details>
          <summary>How do I order food?</summary>
          <p>
            Choose your city and delivery address, browse available restaurants, add dishes and
            review your current total at checkout. Restaurant hours, stock and delivery zones
            determine availability. Payment confirmation comes from the payment provider.
          </p>
          <Link className="inline-link" to="/location">
            Choose your location
          </Link>
        </details>
        <details>
          <summary>How does delivery tracking work?</summary>
          <p>
            After the kitchen marks your food ready, an available approved delivery partner can
            accept it. Track their latest reported GPS location on your order page. Stale locations
            are labelled; a map position is not proof of delivery. Share your delivery code only
            after receiving your food.
          </p>
          <Link className="inline-link" to="/orders">
            Open your orders
          </Link>
        </details>
        <details>
          <summary>Why didn’t I receive a login code?</summary>
          <p>
            {capabilities.data?.developmentDelivery
              ? 'This environment uses labelled development verification. No real SMS or email is sent; the verification screen explains how to continue.'
              : capabilities.data?.methods.length
                ? `Use a configured ${capabilities.data.methods.join(' or ')} contact method. Check your details and spam folder, then wait for the resend timer. Never share a code with support or a rider.`
                : 'Contact verification is temporarily unavailable. Please try again later.'}
          </p>
          <Link className="inline-link" to="/login">
            Sign in
          </Link>
        </details>
        <details>
          <summary>How do I resolve an order or refund issue?</summary>
          <p>
            Open the relevant order to see the current status, cancellation options and refund
            record. Support can review an issue; a support reply does not itself complete a refund.
          </p>
          <Link className="inline-link" to="/support">
            Contact support
          </Link>
        </details>
        <details>
          <summary>Where can I read the policies?</summary>
          <p>
            <Link className="inline-link" to="/legal/terms">
              Terms
            </Link>{' '}
            ·{' '}
            <Link className="inline-link" to="/legal/privacy">
              Privacy
            </Link>{' '}
            ·{' '}
            <Link className="inline-link" to="/legal/cancellations">
              Cancellations and refunds
            </Link>
          </p>
        </details>
      </div>
    </section>
  );
}

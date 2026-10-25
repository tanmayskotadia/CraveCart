import { useRef, useState, type FormEvent, type ReactNode } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import {
  type SupportTicket,
  type OperationMessage,
  type Review,
  type Statement,
} from '@cravecart/contracts';
import { api } from '../api';
import { WorkspaceShell, ErrorNotice } from '../components/WorkspaceShell';
import { useSession } from '../components/SessionProvider';
type Page<T> = { total: number; page: number } & T;
const money = (minor: number) =>
  new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR' }).format(minor / 100);
const today = () => new Date(Date.now() + 19800000).toISOString().slice(0, 10);
function useAction() {
  const [pending, setPending] = useState(false),
    [error, setError] = useState<unknown>(),
    keys = useRef(new Map<string, string>());
  async function run<T>(path: string, body: object, after?: (value: T) => void, method = 'POST') {
    const signature = JSON.stringify([path, body]);
    const key = keys.current.get(signature) ?? crypto.randomUUID();
    keys.current.set(signature, key);
    setPending(true);
    setError(undefined);
    try {
      const result = await api<T>(path, { method, body, headers: { 'Idempotency-Key': key } });
      keys.current.delete(signature);
      after?.(result);
    } catch (e) {
      setError(e);
    } finally {
      setPending(false);
    }
  }
  return { pending, error, run };
}
function Form({ children, onSubmit }: { children: ReactNode; onSubmit: () => void }) {
  return (
    <form
      className="operations-form"
      onSubmit={(e: FormEvent) => {
        e.preventDefault();
        onSubmit();
      }}
    >
      {children}
    </form>
  );
}
function Pagination({ total, page, size = 25 }: { total: number; page: number; size?: number }) {
  const [params, setParams] = useSearchParams();
  const change = (next: number) => {
    const copy = new URLSearchParams(params);
    copy.set('page', String(next));
    setParams(copy);
  };
  return (
    <div className="operations-pagination">
      <button className="outline-button" disabled={page <= 1} onClick={() => change(page - 1)}>
        Previous
      </button>
      <span>
        Page {page} · {total} records
      </span>
      <button
        className="outline-button"
        disabled={page * size >= total}
        onClick={() => change(page + 1)}
      >
        Next
      </button>
    </div>
  );
}
export function SupportPage({ admin = false }: { admin?: boolean }) {
  const { ticketId } = useParams(),
    [params] = useSearchParams(),
    page = Number(params.get('page') ?? 1),
    prefix = admin ? '/admin/support/tickets' : '/support/tickets';
  const list = useQuery({
    queryKey: ['support', admin, page],
    queryFn: () => api<Page<{ tickets: SupportTicket[] }>>(prefix + '?page=' + page),
    enabled: !ticketId,
    refetchInterval: 15000,
  });
  const detail = useQuery({
    queryKey: ['support-detail', admin, ticketId, page],
    queryFn: () =>
      api<{ ticket: SupportTicket; messages: OperationMessage[]; total: number; page: number }>(
        prefix + '/' + ticketId + '?page=' + page,
      ),
    enabled: !!ticketId,
    refetchInterval: 10000,
  });
  const [subject, setSubject] = useState(''),
    [category, setCategory] = useState('order'),
    [orderId, setOrderId] = useState(params.get('orderId') ?? ''),
    [text, setText] = useState(''),
    [reason, setReason] = useState(''),
    action = useAction();
  const t = detail.data?.ticket;
  return (
    <WorkspaceShell
      role={admin ? 'admin' : undefined}
      title={t ? t.subject : admin ? 'Support inbox' : 'Help from our team'}
      description="A private conversation with support. Never share passwords, payment credentials or delivery verification codes."
    >
      <p>
        <Link to={admin ? '/admin/support' : '/support'}>All support tickets</Link>
      </p>
      <ErrorNotice error={list.error ?? detail.error ?? action.error} />
      {ticketId ? (
        detail.isPending ? (
          <p role="status">Loading conversation…</p>
        ) : (
          t && (
            <>
              <div className="operations-toolbar">
                <span className="status-badge">{t.state.replaceAll('_', ' ')}</span>
                <span>
                  Opened {new Date(t.createdAt).toLocaleString('en-IN')} · Version {t.version}
                </span>
              </div>
              {t.orderId && <p>Linked order: {t.orderId}</p>}
              <ol className="operations-messages">
                {detail.data?.messages.map((m) => (
                  <li key={m.id} className={m.author === 'agent' ? 'agent' : ''}>
                    <strong>
                      {m.author === 'agent' ? 'CraveCart support' : admin ? 'Requester' : 'You'}
                    </strong>
                    <p>{m.text}</p>
                    <time>{new Date(m.at).toLocaleString('en-IN')}</time>
                  </li>
                ))}
              </ol>
              <Pagination total={detail.data?.total ?? 0} page={page} size={50} />
              {t.state !== 'CLOSED' && (
                <>
                  <Form
                    onSubmit={() =>
                      void action.run(
                        prefix + '/' + t.id + '/messages',
                        { text, expectedVersion: t.version },
                        () => {
                          setText('');
                          void detail.refetch();
                        },
                      )
                    }
                  >
                    <label>
                      Message
                      <textarea
                        className="form-input"
                        required
                        minLength={1}
                        maxLength={2000}
                        value={text}
                        onChange={(e) => setText(e.target.value)}
                      />
                    </label>
                    <button className="red-button" disabled={action.pending}>
                      Send message
                    </button>
                  </Form>
                  <Form
                    onSubmit={() =>
                      void action.run(
                        prefix + '/' + t.id + '/state',
                        {
                          expectedVersion: t.version,
                          state: admin ? 'RESOLVED' : 'CLOSED',
                          reason,
                        },
                        () => void detail.refetch(),
                      )
                    }
                  >
                    <label>
                      {admin ? 'Resolution reason' : 'Closing reason'}
                      <input
                        className="form-input"
                        required
                        minLength={5}
                        maxLength={500}
                        value={reason}
                        onChange={(e) => setReason(e.target.value)}
                      />
                    </label>
                    <button className="outline-button" disabled={action.pending}>
                      {admin ? 'Mark resolved' : 'Close ticket'}
                    </button>
                    {admin && (
                      <button
                        type="button"
                        className="outline-button"
                        disabled={action.pending || reason.trim().length < 5}
                        onClick={() =>
                          void action.run(
                            prefix + '/' + t.id + '/state',
                            { expectedVersion: t.version, state: 'ESCALATED', reason },
                            () => void detail.refetch(),
                          )
                        }
                      >
                        Escalate ticket
                      </button>
                    )}
                  </Form>
                </>
              )}
              {t.resolution && <p className="service-notice">{t.resolution}</p>}
            </>
          )
        )
      ) : (
        <>
          {list.isPending ? (
            <p role="status">Loading support tickets…</p>
          ) : list.data?.tickets.length ? (
            list.data.tickets.map((ticket) => (
              <Link
                className="operations-ticket workspace-panel"
                key={ticket.id}
                to={admin ? '/admin/support/' + ticket.id : '/support/tickets/' + ticket.id}
              >
                <span className="status-badge">{ticket.state.replaceAll('_', ' ')}</span>
                <h2>{ticket.subject}</h2>
                <p>
                  {ticket.category} · {new Date(ticket.updatedAt).toLocaleString('en-IN')}
                </p>
              </Link>
            ))
          ) : (
            <p>No support tickets yet.</p>
          )}
          <Pagination total={list.data?.total ?? 0} page={page} />
          {!admin && (
            <section className="workspace-panel">
              <h2>Start a conversation</h2>
              <Form
                onSubmit={() =>
                  void action.run<SupportTicket>(
                    prefix,
                    { subject, category, orderId: orderId.trim() || null, text },
                    () => {
                      setSubject('');
                      setText('');
                      void list.refetch();
                    },
                  )
                }
              >
                <label>
                  Subject
                  <input
                    className="form-input"
                    value={subject}
                    onChange={(e) => setSubject(e.target.value)}
                    required
                    minLength={5}
                    maxLength={120}
                  />
                </label>
                <label>
                  Category
                  <select
                    className="form-input"
                    value={category}
                    onChange={(e) => setCategory(e.target.value)}
                  >
                    {['order', 'payment', 'account', 'restaurant', 'delivery', 'other'].map((c) => (
                      <option key={c}>{c}</option>
                    ))}
                  </select>
                </label>
                <label>
                  Order ID (optional)
                  <input
                    className="form-input"
                    value={orderId}
                    onChange={(e) => setOrderId(e.target.value)}
                    maxLength={36}
                  />
                </label>
                <label>
                  How can we help?
                  <textarea
                    className="form-input"
                    value={text}
                    onChange={(e) => setText(e.target.value)}
                    required
                    minLength={5}
                    maxLength={2000}
                  />
                </label>
                <button className="red-button" disabled={action.pending}>
                  Create support ticket
                </button>
              </Form>
            </section>
          )}
        </>
      )}
    </WorkspaceShell>
  );
}
export function OrderMessagesPage() {
  const { orderId } = useParams(),
    [params] = useSearchParams(),
    page = Number(params.get('page') ?? 1),
    path = '/orders/' + orderId + '/messages';
  const query = useQuery({
    queryKey: ['order-messages', orderId, page],
    queryFn: () =>
      api<{ version: number; canMessage: boolean; messages: OperationMessage[]; total: number }>(
        path + '?page=' + page,
      ),
    refetchInterval: 4000,
  });
  const [text, setText] = useState(''),
    [report, setReport] = useState(''),
    [reason, setReason] = useState(''),
    action = useAction();
  return (
    <WorkspaceShell
      title="Delivery conversation"
      description="Messages are shared with the customer and assigned rider. Keep delivery codes private until the verified handover."
    >
      <ErrorNotice error={query.error ?? action.error} />
      <p>
        <Link to={'/support?orderId=' + orderId}>Contact support about this order</Link>
      </p>
      {query.isPending ? (
        <p role="status">Loading messages…</p>
      ) : (
        query.data && (
          <>
            <ol className="operations-messages">
              {query.data.messages.map((m) => (
                <li key={m.id}>
                  <strong>{m.author === 'rider' ? 'Delivery partner' : 'Customer'}</strong>
                  <p>{m.text}</p>
                  <time>{new Date(m.at).toLocaleString('en-IN')}</time>
                  <button className="text-link" onClick={() => setReport(m.id)}>
                    Report message
                  </button>
                </li>
              ))}
            </ol>
            {!query.data.messages.length && <p>No messages yet.</p>}
            <Pagination total={query.data.total} page={page} size={50} />
            {query.data.canMessage ? (
              <Form
                onSubmit={() =>
                  void action.run(path, { text, expectedVersion: query.data!.version }, () => {
                    setText('');
                    void query.refetch();
                  })
                }
              >
                <label>
                  Message to delivery participant
                  <textarea
                    className="form-input"
                    value={text}
                    onChange={(e) => setText(e.target.value)}
                    required
                    maxLength={2000}
                  />
                </label>
                <button className="red-button" disabled={action.pending}>
                  Send delivery message
                </button>
              </Form>
            ) : (
              <p>
                Delivery messaging is closed. Your existing conversation remains available here.
              </p>
            )}
            {report && (
              <Form
                onSubmit={() =>
                  void action.run(path + '/' + report + '/report', { reason }, () => {
                    setReport('');
                    setReason('');
                  })
                }
              >
                <label>
                  Report reason
                  <input
                    className="form-input"
                    required
                    minLength={5}
                    maxLength={500}
                    value={reason}
                    onChange={(e) => setReason(e.target.value)}
                  />
                </label>
                <button className="outline-button" disabled={action.pending}>
                  Submit message report
                </button>
              </Form>
            )}
          </>
        )
      )}
    </WorkspaceShell>
  );
}
export function OrderReviewPage() {
  const { orderId } = useParams(),
    path = '/orders/' + orderId + '/reviews',
    action = useAction(),
    [rating, setRating] = useState(5),
    [text, setText] = useState('');
  const query = useQuery({
    queryKey: ['own-review', orderId],
    queryFn: () => api<{ eligible: boolean; review: Review | null }>(path),
  });
  return (
    <WorkspaceShell
      role="customer"
      title="How was your food?"
      description="One review per delivered order. Share your experience without including private contact details."
    >
      <ErrorNotice error={query.error ?? action.error} />
      {query.isPending ? (
        <p role="status">Checking your order…</p>
      ) : query.data?.review ? (
        <ReviewCard review={query.data.review} />
      ) : query.data?.eligible ? (
        <Form onSubmit={() => void action.run(path, { rating, text }, () => void query.refetch())}>
          <label>
            Rating
            <select
              className="form-input"
              value={rating}
              onChange={(e) => setRating(Number(e.target.value))}
            >
              {[5, 4, 3, 2, 1].map((n) => (
                <option key={n} value={n}>
                  {n} out of 5
                </option>
              ))}
            </select>
          </label>
          <label>
            Your review
            <textarea
              className="form-input"
              required
              minLength={5}
              maxLength={1500}
              value={text}
              onChange={(e) => setText(e.target.value)}
            />
          </label>
          <button className="red-button" disabled={action.pending}>
            Publish review
          </button>
        </Form>
      ) : (
        <p>You can review this order after delivery.</p>
      )}
    </WorkspaceShell>
  );
}
function MessageReports() {
  const [page, setPage] = useState(1),
    [reason, setReason] = useState(''),
    action = useAction();
  const query = useQuery({
    queryKey: ['message-reports', page],
    queryFn: () =>
      api<Page<{ reports: Array<{ id: string; orderId: string; text: string; reason: string }> }>>(
        '/admin/message-reports?page=' + page,
      ),
  });
  return (
    <section>
      <h2>Reported delivery messages</h2>
      <ErrorNotice error={query.error ?? action.error} />
      <label>
        Message moderation reason
        <input
          className="form-input"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          maxLength={500}
        />
      </label>
      {query.isPending ? (
        <p>Loading message reports…</p>
      ) : query.data?.reports.length ? (
        query.data.reports.map((r) => (
          <article className="workspace-panel" key={r.id}>
            <p>{r.text}</p>
            <small>
              Report: {r.reason} · Order {r.orderId}
            </small>
            <div className="button-row">
              {[true, false].map((hidden) => (
                <button
                  key={String(hidden)}
                  className="outline-button"
                  disabled={action.pending || reason.trim().length < 5}
                  onClick={() =>
                    void action.run(
                      '/admin/message-reports/' + r.id + '/resolve',
                      { hidden, reason },
                      () => void query.refetch(),
                    )
                  }
                >
                  {hidden ? 'Remove reported message' : 'Keep message and resolve'}
                </button>
              ))}
            </div>
          </article>
        ))
      ) : (
        <p>No open message reports.</p>
      )}
      <div className="button-row">
        <button className="outline-button" disabled={page <= 1} onClick={() => setPage(page - 1)}>
          Previous reports
        </button>
        <button
          className="outline-button"
          disabled={page * 25 >= (query.data?.total ?? 0)}
          onClick={() => setPage(page + 1)}
        >
          Next reports
        </button>
      </div>
    </section>
  );
}
function ReviewCard({ review, children }: { review: Review; children?: ReactNode }) {
  return (
    <article className="workspace-panel">
      <strong>{review.rating} / 5 · Verified delivered order</strong>
      <p>{review.text}</p>
      <time>{new Date(review.at).toLocaleDateString('en-IN')}</time>
      {review.moderation === 'HIDDEN' && <p>Hidden after moderation</p>}
      {review.response && (
        <blockquote>
          <strong>Restaurant response</strong>
          <p>{review.response}</p>
        </blockquote>
      )}
      {children}
    </article>
  );
}
export function PublicReviews({ slug }: { slug: string }) {
  const [page, setPage] = useState(1),
    query = useQuery({
      queryKey: ['public-reviews', slug, page],
      queryFn: () =>
        api<Page<{ reviews: Review[] }>>('/restaurants/' + slug + '/reviews?page=' + page),
    });
  return (
    <section className="restaurant-reviews">
      <h2>Customer reviews</h2>
      <ErrorNotice error={query.error} />
      {query.isPending ? (
        <p>Loading reviews…</p>
      ) : query.data?.reviews.length ? (
        query.data.reviews.map((r) => (
          <ReviewCard key={r.id} review={r}>
            <ReviewReport reviewId={r.id} />
          </ReviewCard>
        ))
      ) : (
        <p>No verified reviews yet.</p>
      )}
      <div className="button-row">
        <button className="outline-button" disabled={page <= 1} onClick={() => setPage(page - 1)}>
          Previous reviews
        </button>
        <button
          className="outline-button"
          disabled={page * 25 >= (query.data?.total ?? 0)}
          onClick={() => setPage(page + 1)}
        >
          Next reviews
        </button>
      </div>
    </section>
  );
}
function ReviewReport({ reviewId }: { reviewId: string }) {
  const { session } = useSession(),
    [open, setOpen] = useState(false),
    [reason, setReason] = useState(''),
    [sent, setSent] = useState(false),
    action = useAction();
  if (!session) return <Link to="/login?returnTo=%2Fsupport">Sign in to report a review</Link>;
  return (
    <div>
      <ErrorNotice error={action.error} />
      {sent ? (
        <p role="status">Review report received.</p>
      ) : open ? (
        <Form
          onSubmit={() =>
            void action.run('/reviews/' + reviewId + '/report', { reason }, () => setSent(true))
          }
        >
          <label>
            Review report reason
            <input
              className="form-input"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              required
              minLength={5}
              maxLength={500}
            />
          </label>
          <button className="outline-button" disabled={action.pending}>
            Send review report
          </button>
        </Form>
      ) : (
        <button className="text-link" onClick={() => setOpen(true)}>
          Report review
        </button>
      )}
    </div>
  );
}
function ReviewResponse({
  review,
  path,
  onDone,
  moderate = false,
}: {
  review: Review;
  path: string;
  onDone: () => void;
  moderate?: boolean;
}) {
  const [text, setText] = useState(''),
    action = useAction();
  return (
    <ReviewCard review={review}>
      <ErrorNotice error={action.error} />
      <Form
        onSubmit={() =>
          void action.run(
            path,
            moderate
              ? {
                  expectedVersion: review.version,
                  hidden: review.moderation !== 'HIDDEN',
                  reason: text,
                }
              : { expectedVersion: review.version, text },
            () => {
              setText('');
              onDone();
            },
          )
        }
      >
        <label>
          {moderate ? 'Moderation reason' : 'Restaurant reply'}
          <textarea
            className="form-input"
            required
            minLength={5}
            maxLength={moderate ? 500 : 1000}
            value={text}
            onChange={(e) => setText(e.target.value)}
          />
        </label>
        <button className="outline-button" disabled={action.pending}>
          {moderate
            ? review.moderation === 'HIDDEN'
              ? 'Restore review'
              : 'Hide review'
            : 'Save restaurant reply'}
        </button>
      </Form>
    </ReviewCard>
  );
}
export function ReviewsPage({ admin = false }: { admin?: boolean }) {
  const { restaurantId } = useParams(),
    [params] = useSearchParams(),
    page = Number(params.get('page') ?? 1),
    path = admin ? '/admin/reviews' : '/seller/restaurants/' + restaurantId + '/reviews';
  const query = useQuery({
    queryKey: ['reviews', admin, restaurantId, page],
    queryFn: () =>
      api<Page<{ reviews: Array<Review & { reportCount?: number }> }>>(path + '?page=' + page),
  });
  return (
    <WorkspaceShell
      role={admin ? 'admin' : 'seller'}
      title={admin ? 'Review moderation' : 'Customer feedback'}
      description="Reviews require a completed order. Moderation preserves the original record and its audit history."
    >
      <ErrorNotice error={query.error} />
      {query.isPending ? (
        <p>Loading reviews…</p>
      ) : query.data?.reviews.length ? (
        query.data.reviews.map((r) => (
          <div key={r.id}>
            {admin && (
              <p>
                {r.reportCount ?? 0} reports · Restaurant {r.restaurantId}
              </p>
            )}
            <ReviewResponse
              review={r}
              moderate={admin}
              path={admin ? path + '/' + r.id + '/moderation' : path + '/' + r.id + '/response'}
              onDone={() => void query.refetch()}
            />
          </div>
        ))
      ) : (
        <p>No reviews yet.</p>
      )}
      <Pagination total={query.data?.total ?? 0} page={page} />
      {admin && <MessageReports />}
    </WorkspaceShell>
  );
}
function usePeriod() {
  const [params, setParams] = useSearchParams(),
    from = params.get('from') ?? today(),
    to = params.get('to') ?? today();
  function change(name: string, value: string) {
    const next = new URLSearchParams(params);
    next.set(name, value);
    next.delete('page');
    setParams(next);
  }
  return {
    from,
    to,
    page: Number(params.get('page') ?? 1),
    query: new URLSearchParams({ from, to, page: params.get('page') ?? '1' }).toString(),
    fields: (
      <div className="operations-toolbar">
        <label>
          From date
          <input
            type="date"
            className="form-input"
            value={from}
            onChange={(e) => change('from', e.target.value)}
          />
        </label>
        <label>
          To date
          <input
            type="date"
            className="form-input"
            value={to}
            onChange={(e) => change('to', e.target.value)}
          />
        </label>
        <span>India calendar dates · up to 93 days</span>
      </div>
    ),
  };
}
export function StatementsPage({ rider = false }: { rider?: boolean }) {
  const { restaurantId } = useParams(),
    period = usePeriod(),
    path = rider ? '/rider/earnings' : '/seller/restaurants/' + restaurantId + '/finance';
  const query = useQuery({
    queryKey: ['statement', path, period.query],
    queryFn: () => api<Statement>(path + '?' + period.query),
  });
  function download() {
    if (!query.data) return;
    const rows = [
      [
        'Order',
        'Status',
        'Created',
        'Gross INR minor',
        'Captured INR minor',
        'Refunded INR minor',
        'Delivered tip INR minor',
      ],
      ...query.data.rows.map((r) => [
        r.number,
        r.status,
        r.createdAt,
        r.grossMinor,
        r.capturedMinor,
        r.refundedMinor,
        r.tipMinor,
      ]),
    ];
    const blob = new Blob(
        [
          rows
            .map((row) => row.map((x) => '"' + String(x).replaceAll('"', '""') + '"').join(','))
            .join('\r\n'),
        ],
        { type: 'text/csv;charset=utf-8' },
      ),
      url = URL.createObjectURL(blob),
      a = document.createElement('a');
    a.href = url;
    a.download = 'CraveCart-records-page-' + period.page + '.csv';
    a.click();
    URL.revokeObjectURL(url);
  }
  return (
    <WorkspaceShell
      role={rider ? 'rider' : 'seller'}
      title={rider ? 'Delivery earnings records' : 'Restaurant financial records'}
      description="Recorded amounts and reconciliation status. A bank payout is shown only after verified settlement."
    >
      {period.fields}
      <ErrorNotice error={query.error} />
      {query.isPending ? (
        <p>Loading records…</p>
      ) : (
        query.data && (
          <>
            <p className="service-notice">{query.data.notice}</p>
            <div className="operations-metrics">
              <article>
                <span>{rider ? 'Delivered tips recorded' : 'Verified captures'}</span>
                <strong>
                  {money(rider ? query.data.totals.tipMinor : query.data.totals.capturedMinor)}
                </strong>
              </article>
              {!rider && (
                <article>
                  <span>Verified refunds</span>
                  <strong>{money(query.data.totals.refundedMinor)}</strong>
                </article>
              )}
              <article>
                <span>Payable / bank transfer</span>
                <strong>Unreconciled</strong>
              </article>
            </div>
            <button className="outline-button" onClick={download}>
              Download current page CSV
            </button>
            <div className="operations-table-wrap">
              <table className="operations-table">
                <thead>
                  <tr>
                    <th>Order</th>
                    <th>Status</th>
                    <th>{rider ? 'Delivered tips' : 'Captured'}</th>
                    {!rider && <th>Refunded</th>}
                  </tr>
                </thead>
                <tbody>
                  {query.data.rows.map((r) => (
                    <tr key={r.orderId}>
                      <td>{r.number}</td>
                      <td>{r.status.replaceAll('_', ' ')}</td>
                      <td>{money(rider ? r.tipMinor : r.capturedMinor)}</td>
                      {!rider && <td>{money(r.refundedMinor)}</td>}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {!query.data.rows.length && <p>No records in this period.</p>}
            <Pagination total={query.data.total} page={period.page} />
            <p>
              Generated {new Date(query.data.generatedAt).toLocaleString('en-IN')} ·{' '}
              {query.data.mode} environment
            </p>
          </>
        )
      )}
    </WorkspaceShell>
  );
}
type Analytics = {
  byStatus: Array<{ status: string; count: number; valueMinor: number }>;
  popular: Array<{ name: string; quantity: number }>;
  definition: string;
  generatedAt: string;
  mode: string;
};
export function ReportsPage({ admin = false }: { admin?: boolean }) {
  const action = useAction(),
    [reason, setReason] = useState('');
  const { restaurantId } = useParams(),
    period = usePeriod(),
    path = admin ? '/admin/reports' : '/seller/restaurants/' + restaurantId + '/analytics';
  const query = useQuery({
    queryKey: ['reports', path, period.from, period.to],
    queryFn: () =>
      api<Analytics>(path + '?' + new URLSearchParams({ from: period.from, to: period.to })),
  });
  return (
    <WorkspaceShell
      role={admin ? 'admin' : 'seller'}
      title={admin ? 'Marketplace reports' : 'Restaurant analytics'}
      description="Current order outcomes, with explicit time and value definitions."
    >
      {period.fields}
      <ErrorNotice error={query.error ?? action.error} />
      {query.isPending ? (
        <p>Loading report…</p>
      ) : (
        query.data && (
          <>
            <p>{query.data.definition}</p>
            {admin && (
              <Form
                onSubmit={() =>
                  void action.run<{ exportId: string; report: Analytics }>(
                    '/admin/reports/export',
                    { from: period.from, to: period.to, reason },
                    (result) => {
                      const blob = new Blob([JSON.stringify(result, null, 2)], {
                          type: 'application/json',
                        }),
                        url = URL.createObjectURL(blob),
                        link = document.createElement('a');
                      link.href = url;
                      link.download = 'CraveCart-report-' + result.exportId + '.json';
                      link.click();
                      URL.revokeObjectURL(url);
                    },
                  )
                }
              >
                <label>
                  Report export reason
                  <input
                    className="form-input"
                    required
                    minLength={5}
                    maxLength={500}
                    value={reason}
                    onChange={(e) => setReason(e.target.value)}
                  />
                </label>
                <button className="outline-button" disabled={action.pending}>
                  Download audited report
                </button>
              </Form>
            )}
            <div className="operations-metrics">
              {query.data.byStatus.map((s) => (
                <article key={s.status}>
                  <span>{s.status.replaceAll('_', ' ')}</span>
                  <strong>{s.count}</strong>
                  <small>{money(s.valueMinor)}</small>
                </article>
              ))}
            </div>
            {!query.data.byStatus.length && <p>No orders in this period.</p>}
            <h2>Popular delivered dishes</h2>
            {query.data.popular.map((p) => (
              <p key={p.name}>
                {p.name} · {p.quantity} portions
              </p>
            ))}
            <p>
              Generated {new Date(query.data.generatedAt).toLocaleString('en-IN')} · Asia/Kolkata ·{' '}
              {query.data.mode}
            </p>
          </>
        )
      )}
    </WorkspaceShell>
  );
}
export function HistoryPage({ rider = false }: { rider?: boolean }) {
  const { restaurantId } = useParams(),
    [params] = useSearchParams(),
    page = Number(params.get('page') ?? 1),
    path = rider ? '/rider/history' : '/seller/restaurants/' + restaurantId + '/history';
  const query = useQuery({
    queryKey: ['history', path, page],
    queryFn: () =>
      api<
        Page<{
          orders?: Array<{ id: string; number: string; status: string; createdAt: string }>;
          deliveries?: Array<{
            id: string;
            orderId: string;
            status: string;
            restaurantName: string;
            createdAt: string;
          }>;
        }>
      >(path + '?page=' + page),
  });
  const rows = query.data?.orders ?? query.data?.deliveries ?? [];
  return (
    <WorkspaceShell
      role={rider ? 'rider' : 'seller'}
      title={rider ? 'Delivery history' : 'Order history'}
    >
      <ErrorNotice error={query.error} />
      {query.isPending ? (
        <p>Loading history…</p>
      ) : rows.length ? (
        rows.map((r) => (
          <article className="workspace-panel" key={r.id}>
            <h2>{'number' in r ? r.number : r.restaurantName}</h2>
            <p>
              {r.status.replaceAll('_', ' ')} · {new Date(r.createdAt).toLocaleString('en-IN')}
            </p>
            <Link to={'/support?orderId=' + ('orderId' in r ? r.orderId : r.id)}>Ask support</Link>
          </article>
        ))
      ) : (
        <p>No history yet.</p>
      )}
      <Pagination total={query.data?.total ?? 0} page={page} />
    </WorkspaceShell>
  );
}
export function TeamPage({ admin = false }: { admin?: boolean }) {
  const { restaurantId } = useParams(),
    path = admin ? '/admin/staff' : '/seller/restaurants/' + restaurantId + '/staff',
    action = useAction();
  const query = useQuery({
    queryKey: ['team', path],
    queryFn: () =>
      api<
        Array<{
          id?: string;
          userId?: string;
          name?: string;
          version: number;
          bundles?: string[];
          role?: string;
          active?: boolean;
          protected?: boolean;
        }>
      >(path),
  });
  const [userId, setUserId] = useState(''),
    [version, setVersion] = useState(0),
    [bundle, setBundle] = useState('support'),
    [role, setRole] = useState('kitchen'),
    [active, setActive] = useState(true),
    [reason, setReason] = useState('');
  return (
    <WorkspaceShell
      role={admin ? 'admin' : 'seller'}
      title={admin ? 'Administrative staff' : 'Restaurant team'}
      description={
        admin
          ? 'Assign limited permission bundles to existing verified accounts. Bootstrap governance accounts remain protected.'
          : 'Invite an approved seller account as a manager or kitchen colleague. Only the owner can manage team access or view finance.'
      }
    >
      <ErrorNotice error={query.error ?? action.error} />
      {query.isPending ? (
        <p>Loading team…</p>
      ) : (
        query.data?.map((m) => (
          <article className="workspace-panel" key={m.id ?? m.userId}>
            <strong>{m.name ?? m.userId}</strong>
            <p>
              {m.bundles?.join(', ') ?? m.role} ·{' '}
              {m.protected ? 'Protected governance' : m.active === false ? 'Revoked' : 'Active'}
            </p>
            <p>{m.id ?? m.userId}</p>
            <button
              className="text-link"
              disabled={m.protected}
              onClick={() => {
                setUserId(m.id ?? m.userId ?? '');
                setVersion(m.version);
                setRole(m.role ?? 'kitchen');
                setActive(m.active ?? true);
              }}
            >
              Edit access
            </button>
          </article>
        ))
      )}
      <Form
        onSubmit={() =>
          void action.run(
            admin ? path : path + '/' + userId,
            admin
              ? { userId, expectedVersion: version, bundles: active ? [bundle] : [], reason }
              : { expectedVersion: version, role, active, reason },
            () => {
              setUserId('');
              setVersion(0);
              setReason('');
              void query.refetch();
            },
            admin ? 'POST' : 'PUT',
          )
        }
      >
        <label>
          Existing account user ID
          <input
            className="form-input"
            value={userId}
            onChange={(e) => {
              setUserId(e.target.value);
              setVersion(0);
            }}
            required
            minLength={36}
            maxLength={36}
          />
        </label>
        <label>
          {admin ? 'Permission bundle' : 'Team role'}
          <select
            className="form-input"
            value={admin ? bundle : role}
            onChange={(e) => (admin ? setBundle(e.target.value) : setRole(e.target.value))}
          >
            {(admin
              ? ['support', 'analyst', 'finance', 'auditor', 'operations']
              : ['kitchen', 'manager']
            ).map((b) => (
              <option key={b}>{b}</option>
            ))}
          </select>
        </label>
        <label className="operations-check">
          <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} />{' '}
          Access enabled
        </label>
        <label>
          Access change reason
          <textarea
            className="form-input"
            required
            minLength={5}
            maxLength={500}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
          />
        </label>
        <button className="red-button" disabled={action.pending}>
          Save access
        </button>
      </Form>
    </WorkspaceShell>
  );
}
export function PromotionsPage() {
  const [params] = useSearchParams(),
    page = Number(params.get('page') ?? 1),
    query = useQuery({
      queryKey: ['promotions', page],
      queryFn: () =>
        api<
          Page<{
            offers: Array<{
              id: string;
              restaurantId: string;
              code: string;
              active: boolean;
              version: number;
              endsAt: string;
            }>;
          }>
        >('/admin/promotions?page=' + page),
    });
  const action = useAction(),
    [reason, setReason] = useState('');
  return (
    <WorkspaceShell
      role="admin"
      title="Promotion oversight"
      description="Restaurant-funded offers remain attached to the merchant’s catalog. Changes revalidate checkout quotes."
    >
      <ErrorNotice error={query.error ?? action.error} />
      <label>
        Promotion change reason
        <input
          className="form-input"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          minLength={5}
          maxLength={500}
        />
      </label>
      {query.isPending ? (
        <p>Loading promotions…</p>
      ) : query.data?.offers.length ? (
        query.data.offers.map((o) => (
          <article key={o.id} className="workspace-panel">
            <h2>{o.code}</h2>
            <p>
              {o.active ? 'Enabled' : 'Paused'} · Expires{' '}
              {new Date(o.endsAt).toLocaleString('en-IN')}
            </p>
            <p>Restaurant {o.restaurantId}</p>
            <button
              className="outline-button"
              disabled={action.pending || reason.trim().length < 5}
              onClick={() =>
                void action.run(
                  '/admin/promotions/' + o.id + '/state',
                  { expectedVersion: o.version, active: !o.active, reason },
                  () => void query.refetch(),
                )
              }
            >
              {o.active ? 'Pause promotion' : 'Enable promotion'}
            </button>
          </article>
        ))
      ) : (
        <p>No restaurant promotions yet.</p>
      )}
      <Pagination total={query.data?.total ?? 0} page={page} />
    </WorkspaceShell>
  );
}
export function OperationsAuditPage() {
  const [params] = useSearchParams(),
    page = Number(params.get('page') ?? 1),
    query = useQuery({
      queryKey: ['operations-audit', page],
      queryFn: () =>
        api<{
          entries: Array<{
            id: string;
            action: string;
            reason: string;
            actorId: string;
            at: string;
            owner: string;
          }>;
          scope: string;
        }>('/admin/audit/operations?page=' + page),
    });
  return (
    <WorkspaceShell
      role="admin"
      title="Operations audit"
      description="Recorded changes at the service that owns the data."
    >
      <ErrorNotice error={query.error} />
      {query.isPending ? (
        <p>Loading audit…</p>
      ) : (
        <>
          <p>{query.data?.scope}</p>
          {query.data?.entries.map((e) => (
            <article className="workspace-panel" key={e.owner + e.id}>
              <strong>{e.action}</strong>
              <p>{e.reason}</p>
              <small>
                {e.actorId} · {e.owner} · {new Date(e.at).toLocaleString('en-IN')}
              </small>
            </article>
          ))}
          {!query.data?.entries.length && <p>No audit entries on this page.</p>}
          <Pagination total={(page - 1) * 25 + (query.data?.entries.length ? 26 : 0)} page={page} />
        </>
      )}
    </WorkspaceShell>
  );
}

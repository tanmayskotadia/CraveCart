# Orders, checkout and financial operations

CraveCart now has server-authoritative quotes, transactional reservations, pending orders, verified payment placement, cancellation, refunds and a double-entry ledger. This is a locally verified implementation, not a live delivery launch. Restaurant acceptance, preparation, dispatch and tracking are the next milestone. Captured orders stop at `PLACED`.

## Local walkthrough

Start the MongoDB replica set, build and run the services using the root README. `.env.example` explicitly selects `COMMERCE_MODE=development`. The code default is `disabled`. Keep `DEV_ADAPTERS=true` for the simulator; it is rejected in production.

1. Seed the labelled fictional catalog or approve a seller and publish a menu. Choose an address inside a configured zone shared with the restaurant.
2. Add dishes, open `/cart`, and select **Proceed to checkout**.
3. On `/checkout`, optionally enter an offer or tip and select **Review final total**. Review the address, immutable line prices, discounts, fees and policy tax before continuing.
4. Choose Razorpay or Stripe and continue. This creates a pending order and reserves tracked stock and promotion usage atomically. It does not mark the order paid.
5. On `/orders/:orderId`, continue payment and use the clearly labelled successful/declined simulator controls. No external provider is contacted in development mode. A successful simulated capture uses the same ledger and order reducers as a verified provider result.
6. Review cancellation, enter a reason, confirm, and wait for the refund state. A refund request remains pending until its provider result is verified. Print the order receipt if needed; it is not a GST tax invoice.
7. `/orders` shows recent history. `/checkout/return?attemptId=...` displays server status and never trusts a success query parameter.

Admin pages `/admin/orders`, `/admin/orders/:orderId`, `/admin/refunds`, `/admin/refunds/:refundId` and `/admin/finance` require the appropriate finance permissions. Writes also require a recent TOTP check. Existing operators may need their explicitly managed permissions updated to include `finance:read` and `finance:write`; no public role grant exists. The bootstrap command includes them for newly provisioned operators.

## Ownership and consistency

Restaurant Service owns quotes, orders, stock allocations, promotion usage and durable refund authorizations. Utils owns provider attempts, verified captures, webhook inbox, refund execution and ledger postings. Admin is a permission-checked proxy; it cannot directly assert that money was captured. Auth owns address/contact data and revocable sessions; Admin owns service zones.

Quotes expire and embed the cart version, immutable address/menu selections, pricing policy, offer, zone and fee policy versions. Checkout recomputes the quote digest and rejects stale prices or availability before reservation. MongoDB transactions serialize stock and global/per-customer promotion counters. One pending order per customer per environment is enforced with a partial unique index. The initial single-field pending-order index is migrated to include environment on startup. A quote creates at most one order; idempotency keys reject conflicting commands.

A pending deadline is fixed. The worker attempts payment reconciliation before expiry, then releases stock and promotion holds exactly once. A later capture cannot resurrect a cancelled or expired order. It creates a durable full-refund authorization. Capture also rechecks open zones, merchant publication/hours and active buyer/seller memberships. Upstream uncertainty leaves the capture awaiting delivery rather than claiming a placed order. A cart is cleared after placement only if its version still matches the quoted version.

The current cancellation policy permits pending orders or placed orders within the snapshotted policy window. An operator may authorize bounded partial refunds; total requested refunds cannot exceed captured funds. A cancelled placed order restores the tracked portions and promotion usage once. Future fulfillment states must revise stock/cancellation semantics before enabling acceptance or cooking.

## Provider environments

| Mode | Behavior |
|---|---|
| `disabled` | New quotes and payment methods unavailable; no external webhooks |
| `development` | Explicit local simulator, non-production and development adapters required |
| `test` | Real gateway adapter code with sandbox keys, signed webhooks and an explicitly configured pricing policy |
| `live` | Matching live key prefixes, `PAYMENT_LIVE_CONFIRMED=true`, development adapters off, approved non-development pricing policy and explicit approval for each real merchant |

Records and account balances carry the environment. Live mode additionally requires the Razorpay account ID and a pinned Stripe API version. Supply secrets only to backend runtime configuration, never `VITE_*`, URLs or source control. Configure `APP_ORIGIN` to the owned HTTPS frontend. All amounts are INR integer minor units; Stripe provides an additional gateway, not foreign-currency settlement in this release.

Razorpay uses Orders plus Checkout JS. Return HMAC uses the **stored** order identifier, then authenticated provider reads check captured amount, currency and linkage. Authorized payments alone do not place orders. Qualify auto-capture settings in the actual merchant account. An uncertain Razorpay order creation is not blindly repeated; an operator can link the recovered order reference only after server verification.

Stripe uses hosted Checkout Sessions, a stable creation idempotency key and matching metadata on both session and PaymentIntent. The server checks livemode, metadata, amount received and session payment status. The browser permits redirects only to `https://checkout.stripe.com`. Hosted sessions have a provider minimum lifetime longer than some local reservation deadlines; the worker expires unpaid sessions after the business deadline and compensates any later capture.

Refund creation uses a stable idempotency key for both gateways. Pending provider refunds remain pending. An ambiguous result is retried with the same key within a conservative 20-hour window; after that it requires operator reconciliation. `/admin/finance` can link a recovered payment or refund reference, with provider ownership/amount checks and an audited reason. Known final refund failures remain visible for operator/provider resolution; automatic replacement of a failed refund is not implemented and must be covered in the live operations runbook. A bounded reconciliation job revisits up to 50 attempts and resets durable refund/inbox retries; repeat jobs for a larger backlog. Never resolve an unknown result by creating an unrelated payment or refund.

## Webhooks and messaging

Provider endpoints are `POST /api/v1/webhooks/stripe` and `POST /api/v1/webhooks/razorpay`. Raw bytes survive the gateway. HMAC verification precedes parsing, Stripe timestamps have a five-minute tolerance, and mode/account checks reject mismatches. Persisted inbox rows retain whitelisted identifiers and a body hash rather than raw personal payloads. Duplicate event IDs or body hashes do not duplicate money. Reusing an event ID with different bytes is rejected. Acknowledgement occurs only after durable insertion. Webhook hints cause authenticated provider reads; hints never assert payment success themselves. During secret rotation, drain and coordinate retries for the old endpoint before replacing the configured secret; dual-secret overlap is not implemented.

Local transactions write schema-validated outbox events. RabbitMQ owner consumers bind order/payment/refund routing keys, validate messages, and commit `consumeOnce` inbox deduplication and local wake-up records before acknowledgement. Invalid or failed deliveries are dead-lettered; periodic workers and signed internal recovery converge even if the broker is down. Broker events do not directly mutate money. RabbitMQ/Redis execution and dead-letter replay remain unqualified on this machine because those services are absent. Run the real-dependency suite in Docker/CI before claiming that gate passed.

## Ledger and reconciliation

Captures debit gateway clearing and credit customer funds. Verified processed refunds reverse those entries. No revenue, merchant payout or rider earning is recognized before fulfillment. Additional verified captures receive their own postings and automatic compensation. Each capture/refund has one deterministic posting-group identity and balanced entries in the same MongoDB transaction as the financial reducer.

The finance report aggregates **all** posting groups in the active environment by currency/account, displays the latest 100 resources, and separately detects unbalanced groups, missing capture/refund postings and over-refunded captures. Balanced totals alone are not a completeness assertion. The ledger cannot be edited through an application endpoint. Current reconciliation checks provider resources for known attempts; provider settlement-file import, bank settlement matching, disputes/chargebacks and accounting export are later operational scope.

The default development pricing policy uses zero tax and zero platform fee. Configurable basis-point tax applies only to discounted item subtotal with half-up minor-unit rounding; delivery, platform fee and tip are separate lines. This is a pricing mechanism, not tax advice or a legally approved GST determination. Approve merchant tax/invoice/commission/refund treatment before live use.

## Verification commands

```powershell
npm run build
npm run typecheck
npm run lint
npm run format:check
npm test
npm run test:identity
npm run test:money
npm run test:money:providers
npm run contracts:build
npm run contracts:check
npm run test:e2e
# With the development services running:
npm run test:identity:browser
```

Money workflows use isolated real MongoDB replica-set databases, actual owner HTTP handlers and exported response schemas. The provider-boundary run substitutes provider HTTP responses while exercising real signing, adapters, inbox, order reducers and ledger logic. It makes no actual provider request or charge. Hosted sandbox/live account qualification remains required.

Official protocol references: [Stripe Checkout creation](https://docs.stripe.com/api/checkout/sessions/create), [Stripe idempotent requests](https://docs.stripe.com/api/idempotent_requests), [Razorpay Orders](https://razorpay.com/docs/api/orders/create/), [Razorpay webhook validation](https://razorpay.com/docs/webhooks/validate-test/), and [Razorpay refund idempotency](https://github.com/razorpay/markdown-docs/blob/master/api/refunds/normal-refunds-idempotent.md).

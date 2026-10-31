# CraveCart manual setup and launch checklist

Owner handoff · 26 October 2026. Use this with the [completion audit](engineering/COMPLETION-AUDIT.md) and [hosting instructions](engineering/HOSTING.md). This document contains setting names and tasks, never credentials. A successful repository test does not establish live provider activation or production approval.

## 1. What you must supply

- [ ] An owned frontend domain, public gateway HTTPS origin and public realtime HTTPS origin. Hosting target: Vercel + Render.
- [ ] MongoDB replica-set service, AMQPS RabbitMQ service/vhost, TLS Redis service and verified SMTP sender. These are separate accounts/connections; a database connection string is required even though it is not usually called an API key.
- [ ] Razorpay sandbox merchant account and API pair, separate webhook secret, and the account identity. Activate a live merchant account only after staging acceptance.
- [ ] Licensed map tiles with attribution and a publishable domain-restricted token if your map provider requires one.
- [ ] Two separate operator identities with verified contacts and authenticator MFA. Never share an admin account to simulate independent approval.
- [ ] Actual business identity, legal notices, support/grievance contacts, approved pricing/tax/refund rules, retention rules and restaurant/rider contracts.

Optional: Twilio for mobile OTP, Stripe for an additional payment gateway, VAPID browser push, and an OpenAI account for optional model interpretation. The built-in assistant does not require a model key. This web application provides foreground GPS; a native background-tracking companion is not included.

## 2. Credential and configuration inventory

Enter private settings in Render's secret environment group/dashboard. Never put them in Vercel frontend variables, Git, screenshots, browser code or chat. Use distinct sandbox and live environments/database prefixes. Provider secrets must come from your accounts; generated random strings cannot replace them.

| Setting | What you provide / where it is used |
|---|---|
| `MONGO_URI` | Atlas/managed MongoDB TLS replica-set connection string. Use scoped database credentials and network access for the six owner databases. Transactions require a replica set. |
| `MONGO_DB_PREFIX` | Environment identifier; all services must agree. Do not reuse staging financial records for live trading. |
| `RABBITMQ_URL` | `amqps://` connection with URL-encoded credentials, correct vhost and publishing/consuming permissions. AMQP transport is required, not the management dashboard URL. |
| `REDIS_URL` | `rediss://` TCP connection, ACL credentials and TLS; not a REST-only Redis endpoint. |
| `APP_ORIGIN` | Exact owned frontend HTTPS origin, without a route. Must match the browser origin and Vercel proxy arrangement. |
| `AUTH_HOSTPORT`, `RESTAURANT_HOSTPORT`, `RIDER_HOSTPORT`, `ADMIN_HOSTPORT`, `REALTIME_HOSTPORT`, `UTILS_HOSTPORT` | Private Render service discovery. The Blueprint supplies these. Do not point internal calls at Vercel or a public login page. Explicit `*_URL` upstreams are an alternative. |
| `TRUSTED_PROXY_CIDRS` | Gateway only: verified ingress proxy addresses/CIDRs. Empty trusts no forwarded addresses. Do not trust arbitrary proxies. |
| `INTERNAL_TOKEN` | Random shared internal request-signing secret, consistent across owner services/gateway. |
| `METRICS_TOKEN` | Separate random credential for protected telemetry. |
| `AUTH_SECRET` | Separate random authentication secret. |
| `AUTH_ENCRYPTION_KEY` | Separate random key for private application records/MFA/export data. Back it up securely; replacing it can make stored data unreadable. |
| `UPLOAD_ENCRYPTION_KEY` | Separate random private-document key. Restore this with the encrypted upload files. |
| `UPLOAD_DIRECTORY` | Private persistent Utils disk path; Blueprint uses `/var/lib/cravecart/uploads`. No ephemeral development directory in production. |
| `UPLOAD_SCAN_MODE`, `CLAMD_HOST`, `CLAMD_PORT` | Set `clamav`, private scanner host and qualified port (default 3310). Keep ClamAV inaccessible publicly and definitions current. |
| `SMTP_URL`, `SMTP_FROM` | Auth mail delivery credentials and verified sender address. Configure sender DNS/approval with your email provider. Test actual inbox delivery and spam/retry behavior. |
| `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_FROM_NUMBER` | Optional Auth SMS delivery. Complete provider approvals and test supported Indian recipients before enabling mobile sign-in. |
| `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET` | Utils server payment API pair; staging key starts `rzp_test_`, live key `rzp_live_`. Never expose the secret. The checkout SDK may receive the publishable key ID. |
| `RAZORPAY_WEBHOOK_SECRET` | Secret selected for your Razorpay webhook endpoint; it is separate from the API secret. |
| `RAZORPAY_ACCOUNT_ID` | Matching merchant account identifier, required for live verification. This is not a partner linked-account ID. |
| `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_API_VERSION` | Optional Utils gateway. Use matching test/live key and endpoint secret; explicitly qualify the API version for live use. Unconfigured gateways are hidden. |
| `COMMERCE_MODE` | Hosted staging: `test`. Never `development` in production. `disabled` turns commerce off. Live charging requires the additional gates below. |
| `PAYMENT_LIVE_CONFIRMED` | Keep `false` in staging; set `true` only for an explicitly approved live release. |
| `DEV_ADAPTERS`, `NODE_ENV` | Hosted values: `false`, `production`. Production rejects development adapters. |
| `FINANCE_DUAL_APPROVAL_THRESHOLD_MINOR` | INR paise, cumulative discretionary refunds per order. Default `0` requires two separate finance users for every discretionary refund. Change only under reviewed operating policy and consistently on all services. |
| `PRIVACY_RETENTION_REVIEWED` | Default `false`. Set `true` only after accountable review of retention and the published privacy notice. |
| `PRIVACY_FINANCIAL_RETENTION_DAYS` | Explicit positive days after account closure. No legal duration is invented by the application. Leave unset while unreviewed; reviewed=true requires a duration. |
| `WEB_PUSH_PUBLIC_KEY`, `WEB_PUSH_PRIVATE_KEY`, `WEB_PUSH_SUBJECT` | Optional realtime push. Generate a VAPID pair privately; private key stays server-side, public key can reach the browser. Subject is an owned mailto/HTTPS contact. |
| `ASSISTANT_PROVIDER` | `builtin` requires no model credential. Use `openai` only after provider/content review. |
| `OPENAI_API_KEY`, `ASSISTANT_MODEL` | Optional Utils-only model credential and explicitly selected model. Configure spend limits/alerts. |
| `ASSISTANT_DAILY_MESSAGES`, `ASSISTANT_DAILY_PROVIDER_CALLS` | Reviewed daily usage ceilings. They do not replace provider billing limits. |
| `ASSISTANT_WRITES_ENABLED`, `ASSISTANT_WRITES_REVIEWED` | Keep both `false` until cart/support action review. If enabled, configure consistently on Utils, Restaurant and Admin. Each write still requires an explicit user confirmation. |

Generate the five internal random secrets without displaying their values:

```powershell
npm run hosting:prepare-env
```

This creates/updates the Git-ignored `.env.hosted` and reports missing setting **names**. It preserves existing secrets. It does not create MongoDB, SMTP or payment credentials. Transfer its values privately to hosting settings; use `.env.hosted.example` as the full inventory, including settings added after an existing file was generated. Do not run a fresh secret generation on every redeploy. Keep recoverable encrypted backups of encryption keys separately from data backups.

Vercel build variables are public:

| Setting | Value |
|---|---|
| `VITE_API_ORIGIN` | Leave unset/empty with the generated same-origin `/api` rewrite. |
| `VITE_REALTIME_ORIGIN` | Exact public Render realtime HTTPS origin. WebSocket tickets connect directly here. |
| `VITE_MAP_TILE_URL` | Your licensed raster tile template including `{z}/{x}/{y}`; only a publishable restricted map token may be embedded. |
| `VITE_MAP_ATTRIBUTION` | Provider-required attribution. |

A Google Maps API key is not required for the implemented external navigation links. Map tile licensing/provider configuration is still required. No real rider movement is manufactured if GPS permission or network access fails.

## 3. Deploy staging in order

1. Provision the managed database, RabbitMQ and Redis with TLS. Verify network access from Render, durable storage, credentials and restart behavior. Set backup retention and owner alerts.
2. Review/apply [render.yaml](../render.yaml). Keep owner services private; expose gateway/realtime as designed. Review actual hosting charges before applying. The existing Blueprint is a single-instance staging topology, not a claim of nationwide high availability.
3. Attach the private persistent Utils disk and private scanner. Pin a reviewed scanner image digest. Test a clean document and the rejection of an antivirus test file. A successful upload must survive redeployment.
4. Populate server settings, use `NODE_ENV=production`, `DEV_ADAPTERS=false`, `COMMERCE_MODE=test`, `PAYMENT_LIVE_CONFIRMED=false`. Check all owner dependency readiness; a liveness response alone is insufficient.
5. Configure actual controlled origins (replace every placeholder):

   ```powershell
   npm run hosting:configure -- --app=https://YOUR-FRONTEND --api=https://YOUR-GATEWAY --realtime=https://YOUR-REALTIME
   ```

   Review the generated `apps/web/vercel.json`. Deploy Vercel using the repository's web project arrangement; set the public frontend variables above. Do not leave placeholder origins in the deployed rewrite. Verify direct SPA reloads and cookies through the first-party API proxy.
6. In the managed Auth environment run `npm run admin:bootstrap`. Supply your actual operator contact/name interactively. Repeat for a different reviewer. Both must verify their contact and enroll authenticator MFA, then save their recovery codes securely. There is no default/public admin password. Bootstrap is privileged; restrict its execution.
7. Configure payment webhooks directly to the public gateway: `/api/v1/webhooks/razorpay` and optionally `/api/v1/webhooks/stripe`. Use the matching environment/secret. Qualify captured-payment and refund events, duplicated callbacks, delayed callbacks and signed rejection behavior with the real sandbox account. Never point provider callbacks at localhost.
8. Enable provider/network alerts and restricted metrics access. Verify request IDs, useful redacted logs and a staffed escalation contact.

## 4. Complete business setup through the UI

- [ ] In **Policies & settings** (`/admin/settings`), enter actual terms, privacy and cancellation/refund notices: legal name, registered address, support email, grievance contact and reviewed policy text. One authorized MFA admin saves each draft; a different authorized MFA admin reviews/publishes it. Published revisions remain addressable. Do not publish test fixture text as real terms.
- [ ] In Finance, approve actual pricing/tax/platform-fee/cancellation settings; choose amounts under your business policy, not sample values. For live ordering the policy must explicitly be approved for live.
- [ ] In Zones, add real delivery service polygons and operating fees. India-wide discovery does not mean every address is serviceable. Customers must choose their city/address; checkout validates actual coverage.
- [ ] Register a restaurant through its own login/onboarding, upload genuine documents, review them from the separate admin workspace, then publish its own address, opening hours, menu, images, item options, prices and stock. Approval is not equivalent to blanket permission for live trading: finance must also approve merchant launch.
- [ ] Register/review a rider, including actual profile/city/documents. Test online availability from a physical device with location permission. Rider assignment begins only after the seller marks the paid order ready for pickup.
- [ ] Set restricted support/analyst/operations grants. Verify those users cannot access finance, privileged settings or unrelated private documents. Record who handles support, verification, refunds and incidents.
- [ ] Review assistant FAQ/content and human evaluation results before enabling optional write proposals or a model account.

## 5. Privacy operations and retained records

Customers use `/settings/privacy` after a recent verified sign-in. Requests are independently reviewed at `/admin/privacy`; the requesting user cannot approve their own request. Exports collect fixed owner-scoped datasets across the six services, encrypt stored parts, require a fresh sign-in to download and expire after seven days. They are a collection window, not an atomic snapshot across every database.

Deletion requires reviewed retention configuration and a published privacy notice. Preflight blocks unresolved orders/payments/active rider work and restaurant-owner offboarding obligations. Successful preflight suspends the account and revokes sessions, then waits 60 seconds before resumable owner erasure. A blocked job needs an authorized reviewer to inspect/retry it; it must never be reported as completed erasure. Completion lists retained financial/verification/dispute categories and the exact reviewed duration. Owners later minimize scoped retained records; private file deletion is queued separately.

- [ ] Approve retention duration/clock and business offboarding procedure before setting the two privacy variables. The current duration starts at closure; if your required record policy uses different per-record clocks or legal holds, implement/review that policy before enabling deletion.
- [ ] Test actual exported contents and private download; uploaded document **metadata/IDs** are included, not an archive of file binaries. Arrange verified private document delivery when required.
- [ ] Inventory legacy data, cached command results, broker/DLQ messages, operational logs, backups, email/SMS and provider-held records. The owner-scoped workflow does not assert automatic removal from these external/legacy copies. Apply a reviewed manual fulfilment/retention procedure or extend the integration before representing a universal data export/erasure capability.
- [ ] Monitor `privacy_requests` for BLOCKED/overdue work and owner `privacy_subjects` for overdue minimization; monitor Utils `privacy_file_deletions` for pending files. Review failed owner services/scanner/storage and retry through authorized operations. Keep audit/financial references; never delete financial evidence by a blanket database wipe.
- [ ] Qualify a restore procedure that reapplies closure/tombstone decisions before reopening a restored database. Define backup expiry and access controls.

## 6. Razorpay Route and partner payments: open implementation gate

Customer Razorpay/Stripe capture and refunds are implemented. **Automated partner compensation, Route linked-account binding, transfer/reversal execution and bank settlement reconciliation are not complete in this repository.** The existing restaurant/rider financial views deliberately report order/capture/refund records with UNRECONCILED status and unknown payable/commission amounts. Adding a payment key does not finish this feature. Do not mark partners paid from those figures.

Before automated bank payouts can be enabled:

- [ ] Obtain Route approval from Razorpay for the actual marketplace business. Complete each recipient's linked-account/stakeholder/product/bank/KYC onboarding and confirm activation with the provider. A checkout merchant account ID is not a linked recipient account.
- [ ] Approve versioned restaurant commission, rider compensation, tip ownership, discount funding, tax/withholding, cancellation/refund allocation, reserves, settlement timing and rounding rules. No rates or contracts should be invented in code.
- [ ] Complete/test authenticated recipient binding, independent transfer approvals, capture-backed available-balance reservations shared with refunds, crash/timeout reconciliation, reversals and recipient bank-settlement verification. Ambiguous provider timeouts must not trigger blind duplicate transfers.
- [ ] Rehearse refunds after transfer, partial/full reversals, failed recipient activation, account changes, duplicate events and mismatched settlement amounts in the real approved sandbox. Processed transfer and settled bank funds are distinct states.
- [ ] Until that work is qualified, keep payouts disabled and use an accountable reviewed external finance process. This remains an open product requirement, not a completed manual API-key task.

Provider reference: [Razorpay Route API](https://razorpay.com/docs/api/payments/route/) describes linked accounts, captured-payment transfers, reversals and settlement queries. Provider availability/approval and charges belong to your merchant contract; test mode does not prove live bank movement.

## 7. Acceptance checks before customers use it

Run a fresh release report after code/configuration changes:

```powershell
npm run contracts:build
npm run verify:release
```

The report and individual logs are under a newly generated `.local/release-...` directory. Keep its exact successful `report.json`; do not reuse a historical passing report after changing source. The suite covers repository fixtures/browser journeys. The real RabbitMQ/Redis integration checks require their actual test infrastructure and are separate from skipped external checks.

Set actual staging URLs and verify the deployed build:

```powershell
$env:RELEASE_REPORT='ABSOLUTE-PATH-TO-THE-SUCCESSFUL-report.json'
$env:HOSTED_APP_ORIGIN='https://YOUR-FRONTEND'
$env:HOSTED_API_ORIGIN='https://YOUR-GATEWAY'
$env:HOSTED_REALTIME_ORIGIN='https://YOUR-REALTIME'
$env:HOSTED_EXPECTED_BUILD=(Get-Content $env:RELEASE_REPORT | ConvertFrom-Json).buildSha256
$env:HOSTED_EXPECTED_MODE='test'
$env:HOSTED_REQUIRED_GATEWAYS='razorpay'
npm run hosting:check
npm run launch:prepare
```

Then perform and record these real-account checks:

1. Customer verifies contact → chooses a serviceable address → sees an approved restaurant/menu → adds actual items/options → accepts current policies → pays using sandbox checkout. Confirm server-authoritative totals, no duplicated order on retry and signed provider capture.
2. Seller receives the order/notification → accepts → prepares → marks ready. Confirm no rider dispatch before ready. Test rejection/cancellation/refund cases as well as the happy path.
3. Verified available rider receives an exclusive offer → accepts → navigates to pickup → proves pickup → streams actual foreground GPS → navigates to customer → confirms delivery with the delivery proof. Customer tracking must reflect actual authorized samples and show unavailable/stale states honestly.
4. Test mobile/desktop, denied/revoked GPS, poor network, reconnect, stationary heartbeat, two competing riders, wrong proof, account revocation, seller reload and persisted notifications. Screen-off/background web GPS must not be promised as guaranteed.
5. Two different finance users request/review a discretionary refund; test requester revocation, stale MFA/order version, duplicate commands and actual provider refund confirmation. Verify capture/refund ledger balances.
6. Two different staff publish a policy, check public and historic revisions, then verify policy changes invalidate an old live quote. Exercise export review/download/expiry and retention-aware closure with a disposable account; inspect owner results and retained categories.
7. Verify real SMTP/SMS delivery, licensed maps, scanned uploads after restart, authorized private files, support/messages/reviews, assistant scope and restricted staff access. Notification sound/push requires the user's browser permission/interaction.
8. Run real broker/Redis restart, outbox replay, network interruption, backup + encrypted-file/key restore, load/capacity and independent security/accessibility checks. Record observed capacity, recovery time and data-loss bounds. The current Utils disk must migrate to qualified shared private storage before horizontal scaling; scale/HA work must be load-tested rather than inferred from the microservice layout.
9. Complete the [pilot readiness record](release/PILOT-READINESS.md), [training](release/PARTNER-TRAINING.md), rollback/on-call/support ownership and launch evidence. `npm run release:gate` and `npm run launch:gate` validate reviewed evidence; do not edit results simply to force a pass.

## 8. Switch to live only after sign-off

Use a separate live configuration, matching live keys/webhook endpoint, `COMMERCE_MODE=live`, `PAYMENT_LIVE_CONFIRMED=true`, real adapters, reviewed published policies, approved pricing, explicit real merchant launch approvals and a limited supported zone. Rebuild/redeploy when public Vercel settings change. Confirm fresh build identities match on frontend, gateway and owners. Keep a tested rollback and payment-disable procedure.

Hosting, provider accounts, legal/finance decisions, real-device qualification and operator sign-off remain yours. Unfinished Route/compensation automation and the stated privacy/scale boundaries remain implementation/release work; this checklist does not turn them into completed features.

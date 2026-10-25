# Launch handbook

The application launch preparation is implemented. The owner will provision hosting. This handbook connects the application, the existing deployment guide and the rollout evidence; no accounts, domains, real charges or messages are created by preparing the handoff.

## Prepare one consistent release

Run `npm run hosting:prepare-env` to prepare the Git-ignored `.env.hosted` handoff file. It generates five independent internal authentication/encryption/metrics secrets only where blank and preserves existing values on repeat runs. Output contains names and missing-setting status only. Keep the file private, transfer required values directly to the relevant hosting secret settings, and retain encryption keys securely for backup recovery. This command does not configure hosting, rotate existing keys, create provider accounts or validate provider credentials.

Supply MongoDB replica-set credentials (`MONGO_URI`), managed RabbitMQ and Redis TLS connection URLs, the owned frontend HTTPS origin, ClamAV address and email provider settings. Add Razorpay test key ID, secret and webhook signing secret for the first hosted payment rehearsal. SMS, Stripe, browser push, map tile services and the optional model provider require their own settings if enabled. Never place private credentials in a `VITE_*` variable. Razorpay Route is the selected India payout provider; Route activation and the unfinished settlement integration are separate from ordinary checkout keys. Do not claim bank payouts from successful customer payment tests.

The public `/access` page links all four role logins. Customers register directly; restaurants and delivery partners apply for verification; administrators are bootstrapped privately. Restaurant approvals live within administration, with permissions enforced by the owner services. Use separate accounts/browser profiles for the ordering rehearsal.

Discretionary finance now defaults to two-person approval for every refund (`FINANCE_DUAL_APPROVAL_THRESHOLD_MINOR=0`). Provision two distinct authorized finance users privately, enroll MFA, and rehearse request → independent review → provider processing with test merchant funds. A requester cannot approve their own request from another session. Keep thresholds consistent across Restaurant instances and change them only under a reviewed finance policy. See [financial approvals](../engineering/FINANCIAL-APPROVALS.md). This control does not qualify Route transfers or bank settlements.

1. Configure the intended Vercel API rewrite using [the hosting guide](../engineering/HOSTING.md), then keep frontend and all seven backend processes on the same reviewed source. Configure production secrets in the hosting dashboards. Select `COMMERCE_MODE=test` for the initial rehearsal; keep assistant write tools off until their separate review.
2. Run `npm ci`, install the documented browser and contract-check prerequisites, then `npm run verify:release`. Keep the resulting report. The existing `sourceSha256` identifies the reviewed repository snapshot. The new `buildSha256` identifies deployment inputs with stable LF text normalization across Windows/Linux; generated files, credentials, local data, tests, documents and operational evidence are excluded from that deployment fingerprint. It is a consistency check, not a signed supply-chain attestation.
3. Root `npm run build` writes identical `release.json` files to the React and Platform outputs. Gateway `/health/release` compares its identity with all six owners; it returns 503 if a build is missing or differs. Realtime exposes its own identity. Frontend `/release.json` is uncached and excluded from SPA rewrites. Rebuild after any deployment-input change; do not manually edit these generated identities. A development server is not a release artifact.
4. Set `RELEASE_REPORT` to the verified report path and run `npm run launch:prepare`. The output directory contains a manifest, operating documents, empty rollout/evidence records and configuration **names only**. It is an operating packet to use with this repository, not a standalone source archive. `repositoryChecksMatchBuild=false` means the report is missing or does not cover the current deployment inputs.

Deployment input fingerprinting covers apps, packages, services, contracts, design, scripts, infrastructure, dependency locks, TypeScript build configuration, Node version and Render Blueprint. Runtime secrets, provider capabilities and ownership of domains require separate qualification.

The release runner hashes repository sources and deployment inputs again at completion. A changed snapshot fails the report even when individual test commands passed. Freeze the checkout during the final verification run; the launch gate requires both `sourceUnchanged` and `deploymentInputsUnchanged`. Do not amend successful report fields to compensate for untested edits.

## Hosted acceptance the owner performs

Deploy according to [HOSTING.md](../engineering/HOSTING.md), including persistent private uploads/scanning, TLS dependencies and an MFA-enrolled operator. Apply the generated same-origin API proxy before building. Run the following from the reviewed checkout using the actual HTTPS origins:

```powershell
$env:HOSTED_APP_ORIGIN='https://YOUR-FRONTEND'
$env:HOSTED_API_ORIGIN='https://YOUR-GATEWAY'
$env:HOSTED_REALTIME_ORIGIN='https://YOUR-REALTIME'
$env:HOSTED_EXPECTED_BUILD=(Get-Content $env:RELEASE_REPORT | ConvertFrom-Json).buildSha256
$env:HOSTED_EXPECTED_MODE='test'
$env:HOSTED_REQUIRED_GATEWAYS='razorpay'
npm run hosting:check
```

Use `razorpay,stripe` when both gateways are configured and included in the reviewed release. Preflight performs 18 read-only checks: dependency readiness; consistent frontend/gateway/six-owner/Realtime builds; SPA deep links and security headers; no-store frontend API proxy; exact test/live mode; explicit real-contact/payment adapter settings; and anonymous denial for account and merchant launch controls. Every check must pass; a missing safety boolean, HTML masquerading as JSON, wrong mode or mixed build fails. Reports are saved under `.local/hosted-checks/`. Nothing in this command sends an OTP or creates a payment, refund or order.

Then execute the role journey below with hosted sandbox merchant accounts and real contact delivery. Record provider webhook IDs/statuses and request/order references, not secret values or complete personal payloads. Repeat callback/reload/network-loss cases, file persistence after redeploy and physical rider GPS. These are separate proofs from the read-only preflight.

## Full ordering rehearsal

| Actor | Execute and record |
|---|---|
| Admin | Bootstrap/enroll MFA; review seller/rider documents; activate only the chosen real zones; review pricing; inspect role restrictions and alerts |
| Restaurant | Register/login; complete approval; set real pickup coordinates, hours and menu/options/stock; publish; verify the customer sees the actual dishes |
| Customer | Verify login; select a supported city/address inside a shared pickup/dropoff polygon; search/filter; configure required dish options; review the server-priced cart, charges and address; create one payment |
| Payment | Complete the provider sandbox checkout; verify signed callback places one order; reload/close the browser; repeat delivery of the same callback and confirm one capture/order effect |
| Restaurant | Receive visual/sound notification; accept → preparing → ready; verify pickup proof matches the assigned rider |
| Rider | Verified login, foreground GPS permission, online → accept one offer → restaurant navigation → pickup code → customer navigation → delivery code; test wrong proof and stale/offline recovery |
| Customer | Observe canonical order status and fresh/stale rider location, message the current rider, receive verified delivery, review the order or open support |
| Support/admin | Resolve a ticket, inspect delivery incident recovery, review refund and reconciliation evidence; verify messages/destinations disappear for revoked delivery access |

Repeat with both selected gateways and an approved cancellation/refund scenario. A refund API acceptance is not bank settlement. Keep reports UNRECONCILED until actual provider/bank/contract evidence supports reconciliation. Optional assistant execution needs explicit confirmation and the existing write-review settings on all required owners. FAQ and own-order assistance remain usable without a model key.

## Merchant activation and checkout pause

The admin Finance page now includes **Restaurant launch approval**. A finance reader can review the paginated real records. An authorized finance writer with fresh MFA supplies a reason, reviews the current revision and explicitly confirms approval or revocation. Approval rejects sample, unpublished, paused or inactive/unverified seller records. Concurrent changes cause a version conflict; reload and review before retrying. The decision and audit commit atomically. Seller/customer access cannot perform this review. This administrative record is not an assertion of gateway merchant approval or a bank payout contract.

Live quote creation requires this merchant approval as well as an active real zone, live gateway configuration, live-confirmation flag and an approved non-development pricing policy. Revocation blocks future live checkout; it does not cancel existing deliveries.

Admin account-detail and restaurant-detail routes read the actual selected record. Rider management opens the rider-filtered verification queue and canonical application details. Password recovery/verification aliases use the implemented passwordless login. `/settings/privacy` creates private support cases for personal-data export or account-deletion review, with explicit confirmation and a stable retry key; existing support ownership, responses and status tracking apply. The account stays active pending review. Actual cross-service fulfilment and retention decisions remain the privacy operator's responsibility.

For an intake pause, use **Enable checkout** on the existing admin pricing policy: turn it off and save with a reason and fresh MFA. New quotes/orders stop. Pre-existing valid payment attempts can still capture/place; deliveries, refunds and reconciliation continue. This path is integration-tested. Do not stop all services or change commerce mode to pause intake: doing so can break recovery of in-progress work. Zone/merchant availability changes can legitimately trigger compensation for a payment still pending; use them only when that operational condition is intended.

## Gradual rollout and observation

Stages are `internal-sandbox → invited → limited → expanded`. Nationwide discovery remains available; enable ordering only for the actual approved zone/restaurant/rider cohort. Stages and operator order ceilings are reviewed operating limits; they are **not** automatic percentage traffic routing or server-side admission caps.

Complete `rollout-plan.json` with the verified build, exact origins/mode/gateways, actual city identifiers and zone/restaurant/rider UUIDs, a bounded active-order ceiling, named release owner, current staffed coverage and training evidence. Primary and backup must differ. Do not place credentials or personal contact details in Git; reference the protected rota/contact directory in evidence.

Before expanding, complete `stage-observation.json` for the previous stage on the same build. The initial conservative advancement rule requires a 30-minute to 24-hour window finished within the last 24 hours, at least 100 observed requests and three captured-and-delivered cohort orders, less than 1% API 5xx, outbox age at most 60 seconds, and zero critical incidents, ledger imbalances, unmatched captures, duplicate assignments or no-rider orders. These are minimum pilot advancement checks, not the PRD's monthly SLO or full-load qualification. Review the policy and evidence before adoption. Null/empty measurements fail; do not enter fictional zeros.

Set `LAUNCH_PLAN_PATH`, `STAGE_OBSERVATION_PATH`, `PILOT_SIGNOFF_PATH`, `RELEASE_REPORT` and `HOSTED_CHECK_REPORT` to the completed records and run `npm run launch:gate`. It checks the earlier pilot gates, current deployment fingerprint, unique complete hosted-check evidence, origins/mode, training, staffed coverage, review freshness and previous-stage health. It deliberately fails on the supplied blank records. It performs no deployment, order-cap change, charge or notification. Evidence authenticity and approvals remain the accountable operator's responsibility.

At each stage, inspect gateway/owner errors, outbox age, payment/order exceptions, active/unassigned tasks, tracking freshness and support load. Pause immediately for money/assignment/privacy invariants, loss of safe dispatch/support coverage or a critical incident. Use the checkout pause and [incident runbooks](../engineering/INCIDENT-RUNBOOKS.md), reconcile existing work, then record the recovery review before resuming. Do not expand a cohort while exceptions are unexplained.

## On-call and follow-up

Before opening each window, the primary and backup acknowledge the shift, support/finance/security coverage is reachable, sellers/riders confirm availability, and a synthetic alert reaches the actual destination and is acknowledged. Record send/receive/ack times, routing to the backup and evidence reference. Templates and runbooks do not send notifications or prove that staffing exists.

Review the first hour at 15-minute intervals; review every active shift and at 24/72 hours after a cohort change. Record payment/refund/order counts, dispatch failures, tracking issues, support themes, provider/hosting spend and corrective owners. Reconcile finance daily during pilot. Re-run the internal/sandbox checks for a changed build before advancing. Roll back the application only to compatible source; retain domain/finance records and use compensating workflows. Service-zone expansion and India-wide coverage must follow measured capacity and partner readiness, never directory size.

## Completion boundary

The implementation, fixtures, launch tools and training material can be completed in the repository. Hosted credentials/accounts, merchant and policy approvals, actual callbacks, physical devices, backup/restore/load evidence, on-call staffing and bank settlement must be supplied or performed by their owners. [Pilot readiness](PILOT-READINESS.md) remains the evidence register; this document does not silently mark an external gate passed.

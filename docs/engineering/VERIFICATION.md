# Runtime verification

Updated: 25 October 2026. Local environment: Windows, Node 24.14.1, npm 11.11.0, Python 3.12. Docker Engine/Desktop is not installed on this machine.

## Foundation evidence (historical)

This and the following milestone sections are historical snapshots. The current hardening results appear below; older bundle warnings and lower test counts do not override the latest run.

| Check | Result | Evidence |
|---|---|---|
| Dependency installation | Passed | Locked npm workspace install; audit reported zero vulnerabilities at installation |
| Server and React production build | Passed | `npm run build`; six owners, gateway and shared packages compile; Vite produces static assets |
| Type checking | Passed | `npm run typecheck`, including application, tooling and test types |
| Lint / service import boundaries | Passed | `npm run lint`; cross-service source/repository imports prohibited |
| HTTP/safety/tracing tests | Passed: 15 tests | `npm test`; live vs ready, exact public schema, request validation/IDs, protected metrics, safe errors, invalid upstream classification, environment guards, synthetic adapters, canonical hashing, role helper and actual parent trace propagation and India calendar/closure boundaries |
| National experience | Passed: 20 tests | Chromium desktop + Pixel 7 viewport; original photo rendering, city filtering/selection/persistence, query continuity, phone/email validation, login/signup modal refresh and Escape, 18-city expansion, preview switch, protected routes, 404, keyboard navigation, outages and reduced motion |
| Formatting / configuration / naming | Passed | Prettier; parsed Compose/CI YAML structure; no numbered milestone labels in README files or project folder names |
| Live local processes | Passed | Gateway plus all six owners served liveness; React served at `http://localhost:5173` |
| Actual gateway-to-owner call | Passed | `node scripts/smoke.mjs` verified gateway → admin public snapshot and correlated UUID |
| Dependency outage behavior | Passed | Every owner and aggregate gateway readiness correctly returned unavailable with dependencies absent |
| Planning contracts | Passed | 2,115 structural/example/coverage checks; 90 routes, 199 HTTP operations, 37 broker events, 12 socket events, 19 critical CTAs, 53 traceability rows |

The foundation browser suite intercepts its capability endpoint to exercise deterministic page states. The live smoke check separately exercised actual API transport. The later sections record implemented identity, ordering and fulfillment; foundation-era capability restrictions below describe that earlier checkpoint.

The national redesign was visually inspected at 1440px desktop and 390px mobile widths, including the login dialog. The market contract now declares India/national scope rather than one global city; the selected city is independent browsing context. All generated food assets are local optimized WebP files with provenance in `design/ASSETS.md`.

## Implemented foundation scope

- npm TypeScript workspace with exact dependency lockfile, reproducible build and six independent service entry points.
- Shared contracts, validated configuration, safe HTTP runtime, structured logging and OpenTelemetry propagation/export support.
- Public read-only `GET /api/v1/platform` with authoritative unavailable capabilities; with exported shared-schema contracts; promoted identity/onboarding contracts now execute too.
- Owner-local MongoDB transaction/idempotency/outbox/inbox skeleton; confirmed/routable RabbitMQ publish with lease/backoff/exhaustion state; strict payload validation.
- Local MongoDB replica-set, RabbitMQ, Redis and service Compose configuration with persistence, healthchecks and loopback bindings.
- Realtime process with Socket.IO accepting no unauthenticated connections until the ticket flow is implemented.
- React national launch experience plus functional identity and onboarding workspaces; no fabricated authentication grants, fake payment successes or enabled ordering.
- Development-only deterministic adapters with production guardrails; non-root Docker image, CI quality/browser/dependency jobs and documented operating procedures.
- Existing numbered planning directory, handoff and script filenames renamed to descriptive names with references updated.

## Identity and onboarding evidence

| Check | Result | Evidence |
|---|---|---|
| Real MongoDB workflows | Passed: 21 tests | Isolated databases on MongoDB 8.0.17 wiredTiger replica set; real HTTP handlers, signed internal calls, transactions and exported response-schema validation |
| Complete browser workflows | Passed: 2 end-to-end scenarios | Desktop and Pixel 7 viewport through running gateway/owners: customer signup/reload/logout, admin OTP + TOTP enrollment, protected document review, seller/rider submissions and applied role grants |
| National browser regression | Passed: 20 tests | Deterministic mocked capabilities/contact challenges; city browsing, OTP-step transitions, protected links, responsive behavior, keyboard and reduced motion |
| Role and ownership enforcement | Passed | No public admin signup, unapproved partner denial, cross-user session/application/document denial, no self-review, no admin read before MFA |
| Proof/session recovery | Passed | Concurrent OTP single-use, expiry and guess limits, refresh reuse family revocation, TOTP/recovery-code reuse denial, CSRF/origin rejection, contact-change ownership |
| Distributed approval recovery | Passed | Injected auth failure after owner approval leaves activation pending; authorized retry completes the same durable operation and role grant |
| Suspension | Passed | Existing sessions immediately invalid; account restoration does not resurrect them; status-change audit recorded |
| Local documents | Passed | Valid image decode, encrypted stored bytes, development quarantine/check labels and owner-scoped access; disguised HTML rejected |

See [identity setup and detailed scope](IDENTITY-AND-ONBOARDING.md). No actual SMS/email was sent. ClamAV code is implemented but a real scanner was not available for end-to-end qualification. Browser tests use synthetic accounts, not a default administrator. These local checks were executed during this delivery; hosted CI has not been run.

## Discovery and catalog evidence

| Check | Result | Evidence |
|---|---|---|
| Integrated identity/catalog workflows | Passed: 34 tests | Real isolated MongoDB replica-set databases and actual HTTP handlers; public/seller/address/zone/cart/upload responses validated against exported schemas |
| Complete multi-role browser flows | Passed: desktop and mobile | OTP/MFA onboarding, seller menu/profile/hours/variant/modifier publication, customer address/default pin check, favorites, required add-ons, cart quantities and disabled checkout |
| Seller isolation and publication | Passed | Cross-seller substitutions denied; customer seller access denied; unpublished stores excluded; idempotent creation and conflicting replay handled |
| Exact serviceability | Passed | Same-city polygon checks, outside/invalid/reversed coordinates, inactive areas and cart revalidation; zone writes require operator permission and MFA |
| Cart consistency | Passed | Server minor-unit pricing, extra totals rejected, variant/modifier validation, aggregate stock across separate lines, explicit restaurant replacement, stale writes, versioned clear/recreate and price/zone change warnings |
| Minimum subtotal | Passed | First dish can be saved below the minimum with an actionable warning; no checkout claim |
| Public image separation | Passed | Only an owned checked catalog image becomes public; normalized WebP contains no EXIF; KYC documents rejected from the public route and catalog binding |
| Calendar rules | Passed | India weekday/date boundaries, exact closing instant, holiday closure, overlapping and unsplit overnight slots |
| Visual/navigation review | Passed locally | Desktop and mobile discovery/menu/cart layouts inspected; no horizontal overflow in the live journeys and sample menu view; exact labels and category links corrected; final live scenarios also exercised GPS denial/manual fallback and comma-separated allergen entry |
| Browser regression | Passed: 20 tests | Landing, national city navigation, OTP dialog states, protected pages, keyboard, outages and reduced motion |
| Contracts | Passed: 2,115 checks | 90 frontend routes and 199 HTTP operations; source Zod exports merged into the baseline, preserving existing operation IDs |

The development seed contains 18 explicitly labelled fictional restaurants and 72 illustrative dishes across six cities; these are not live restaurant affiliations. Sample stores/zones are excluded in production. See [discovery, catalog and cart setup](CATALOG-AND-CART.md). Checkout, reservations, payment, redemption and refunds are covered by the money milestone below; dispatch and tracking are covered by the fulfillment evidence. Licensed map tiles, live scanners/providers, scaling and hosted deployment remain separate qualification gates.

## Orders and financial evidence

| Check | Result | Evidence |
|---|---|---|
| Build, type checks, lint and formatting | Passed | Shared contracts, owners, gateway, React and test code; Vite retains a non-blocking main-bundle size warning |
| Platform unit regressions | Passed: 15 tests | Actual HTTP handlers, origin/headers, capabilities, tracing and calendar rules |
| Identity/catalog regressions | Passed: 34 tests | Real isolated MongoDB replica sets and exported response contracts |
| Development money and gateway protocol tests | Passed: 22 tests | Stock and promotion contention, stale quotes, idempotency, capture/cancel races for both methods, expiry, full/partial refunds, already-refunded cancellation, pricing policy versions, signatures, amount/linkage and environment checks; two external-provider-only cases intentionally skipped here and executed below |
| Provider-boundary money workflows | Passed: 15 tests | Actual adapters and reducers with provider HTTP fixtures plus real MongoDB; replayed signed webhooks, late capture compensation, unknown-response recovery, stable Stripe request parameters, finance permissions and balanced/missing-posting checks |
| Real desktop and mobile journeys | Passed: 2 full flows | OTP/MFA and partner approvals, catalog/address/cart, Razorpay or Stripe simulation, decline then success, reload, cancellation, processed refund, order history and admin finance dashboard |
| National UI regressions | Passed: 20 tests | Responsive layout, city/search navigation, auth dialogs, protected links, outage/retry, keyboard and reduced motion |
| Contract validation | Passed: 2,180 checks | 91 frontend routes, 211 HTTP operations, 38 broker events and explicit contract lifecycle; cancellation preview uses the implemented GET method |
| Visual review | Passed locally | Desktop/mobile order receipt and finance screenshots inspected in `.local/qa`; original CraveCart branding and red/white layout retained |

The executed suites contain **108 passing tests**. The two development-run skips are provider-boundary cases that pass in the provider run. Source and live services use the explicit development simulator locally; no actual payment, provider request or delivery was made. The raw gateway adapters are verified through HTTP fixtures, not qualified against hosted merchant accounts. RabbitMQ consumers are implemented with transactional inbox deduplication and persistent wake-ups; actual RabbitMQ/Redis delivery, Docker launch and cloud operation remain unexecuted gates below. See [orders, checkout and financial operations](ORDERS-AND-PAYMENTS.md).

## Fulfillment and hosting evidence

The current implementation connects the customer, restaurant, rider and admin using actual service handlers and durable MongoDB records. Tests use isolated temporary infrastructure and explicitly simulated payments/contact delivery; no real restaurant, charge, SMS/email or push-provider delivery was created.

| Check | Result | Evidence |
|---|---|---|
| Fulfillment and push controls | Passed: 13 tests | Real MongoDB transactions, exclusive competing rider acceptance, complete pickup/delivery, code guess lockout and restaurant renewal, privacy and ownership, GPS validation, lost assignment response recovery, bounded no-rider/operator retry, cancellation race, partial-refund preparation/rejection, additional branch approval boundary, real Socket.IO ticket replay/ownership/session revocation, push allowlist and injected transport deduplication/session revocation |
| End-to-end delivery | Passed: desktop and mobile | Isolated gateway and six owners; actual onboarding/MFA/approval, menu publication, address/cart/checkout, simulated capture, kitchen preparation, foreground GPS fixtures, rider assignment, wrong and valid pickup proof, navigation link, customer tracking, operator incident resolution and customer-code delivery; no horizontal overflow |
| National UI regression | Passed: 20 tests | Production preview, city/search continuity, login/signup, protected routes, keyboard, outage recovery and reduced motion |
| Contract registry | Passed: 2,237 checks | 93 frontend routes, 223 HTTP operations, 38 broker events, 15 socket contracts (three implemented delivery events and twelve explicitly planned), 19 critical CTAs and 53 traceability rows |
| Render configuration | Schema validation passed | Blueprint checked against Render’s official JSON schema; this does not validate account entitlement or create resources |
| Hosting preparation | Implemented | Managed dependency settings, private service discovery, persistent encrypted upload disk/scanner, Vercel API rewrite generator, read-only hosted preflight, admin bootstrap and hosting credential inventory |

Build, type checks, lint, formatting and the 15 platform tests are also rerun for this change. The current browser harness starts disposable test processes and removes its isolated databases afterward. Existing developer servers are not a deployment artifact. The Vite build retains a non-blocking main-bundle size warning. See [fulfillment details](FULFILLMENT-AND-TRACKING.md) and [Vercel/Render deployment](HOSTING.md).

## Role-operation evidence

| Check | Result | Evidence |
|---|---|---|
| Role operations and fulfillment | Passed: 21 tests | Shared real-MongoDB harness and strict response schemas; support ownership/reply/replay/closure/escalation and fresh MFA, customer–rider messages/moderation/closed delivery, verified review uniqueness/eligibility and derived public ratings, team kitchen/manager/owner isolation and revocation, dated records, promotion versions, audited export replay, limited staff grants/session revocation and restricted operator denials, plus prior fulfillment/socket/push cases |
| Platform/calendar | Passed: 17 tests | HTTP/tracing regressions plus impossible report dates, bounded/reversed ranges and exclusive India-day UTC boundaries |
| Identity/catalog | Passed: 34 tests | Existing workflows with the expanded catalog rating schema, seller access and scoped internal authentication |
| Money regression | Passed: 22, two intentional external-only skips | Existing quote/capture/refund/ledger workflows; provider-boundary tests retain their separate historical evidence above |
| Desktop/mobile role journey | Passed: 2 scenarios | Actual seven-process HTTP/Socket.IO path, customer–rider replies, verified delivery, customer review, restaurant response, requester ticket and agent reply, closure, financial records, reports and audit; production React preview and synthetic contacts/payments/GPS |
| National UI | Passed: 20 tests | Production preview; discovery/navigation/auth/outage/accessibility regressions |
| Contracts | Passed: 2,392 checks | 94 routes and 246 HTTP operations; role-operation registry promoted without marking remaining inventory as implemented |
| Quality and visual review | Passed | Build/type/lint/format checks; desktop financial records and mobile support screenshots inspected; no horizontal overflow in checked role screens. Main JS bundle retains a non-blocking size warning |

See [role operations](ROLE-OPERATIONS.md). These tests do not qualify bank payouts or contractual partner earnings: commission/payable remain null and statements explicitly show UNRECONCILED. The assistant is covered by the subsequent evidence below. Support staffing, wider message retention/deletion and hosted provider execution remain release work. No seventh owner service was introduced. Automated browser services and data are disposable.

## Assistant evidence

| Check | Result | Evidence |
|---|---|---|
| Shared assistant/role/fulfillment suite | Passed: 69 tests | 40 assistant engine/grounding cases, 27 real-MongoDB service workflows and two push allowlist tests; includes prior role/fulfillment coverage |
| Routing and approved help | Passed | Fixed 26-case intent/refusal evaluation; nine exact approved-help answer/source checks; expired/wrong-audience help and invalid navigation are rejected |
| Scoped facts and history | Passed | Own delivered/refund records, foreign conversation/order denial, privileged-action refusal, strict context schemas, encrypted/redacted text, replay/version guards, per-user concurrency and owned deletion |
| Confirmed actions | Passed | Explicit consent; no ticket/cart action before confirmation; token ownership, wrong-token and expiry checks; standard cart pricing/serviceability/version validation; same-command replay and lost-response recovery without duplicate additions |
| Streaming/cancellation | Passed | Real ephemeral Utils and gateway HTTP servers: progress arrives before the owner response, committed result is streamed, disconnect cancels work before persistence, and JSON/history recover answers |
| Model boundary | Passed with fixtures | Responses request schema, `store:false`, bounded output, no declared model tools/account records, private-topic bypass, malformed action output rejection, circuit-open fallback; no real provider request or charge |
| Production frontend journey | Passed: desktop and mobile | Existing food-delivery story plus streamed own-order answer and reload, allergy boundary, menu discovery, confirmed cart addition, consented support ticket and admin routing evaluation; temporary production bundle and services |
| Regressions | Passed | 17 platform/calendar/tracing tests, 34 identity/catalog tests, 22 money tests with two deliberate external-only skips, and 20 national UI tests |
| Contracts and quality | Passed | 2,419 checks; 94 routes, 252 HTTP operations, 38 broker and 15 socket contracts; build, type, lint, formatting and import boundaries. The Vite main-bundle size warning remains non-blocking |
| Visual review | Inspected | Desktop and mobile assistant history, source links, dish cards and confirmation summaries; screenshots in ignored `.local/qa` and no horizontal overflow in the checked journey |

See [assistant setup and limits](ASSISTANT.md). The built-in assistant needs no model key. Optional OpenAI interpretation was tested through synthetic responses only. Assistant actions remain **disabled by default** until the PRD's human review is recorded; fixture flags do not authorize production writes. Routing scores are not a production semantic-answer accuracy certification. Guest chat, real-model quality/spend qualification, deployment/SSE-proxy behavior, backup/key rotation and wider retention/deletion remain open. No paid resource, live charge, email/SMS or real support message was created by these tests.

## Hardening evidence

Executed on 25 October 2026 against isolated synthetic fixtures. `npm run verify:release` completed all 13 checks. Reports and per-command logs are retained under `.local/release-<UUID>/`; each identifies its source fingerprint and timestamps. The first complete run is `.local/release-78988bf5-3365-49a5-ba14-80ac5d19e1cc/`. Final broker/tooling refinements were checked again, including 24 platform/security tests and eight tooling tests; use the newest successful report for a release decision.

| Check | Result | Evidence / limit |
|---|---|---|
| Platform/security | Passed: 24 tests | No-store success/error/upstream policy, safe parser errors, readiness deadline/drain, in-flight consumer drain and late old-connection close with a mocked broker transport, prior role/config/tracing/calendar tests |
| Operational tooling | Passed: eight tests | Bounded probe limits/failure accounting; closed pilot gates, source/review/report completeness; TLS/namespace restore controls, corrupted data/index/TTL detection and a real-MongoDB comparator fixture |
| Identity/catalog | Passed: 34 tests | Real MongoDB replica-set workflows |
| Money | Passed: 22, two explicit external-only skips | Capture/refund/ledger/concurrency scenarios; no real merchant requests |
| Gateway adapters | Passed: 15 tests | Razorpay/Stripe protocol fixtures |
| Fulfillment/assistant | Passed: 69 tests | Real MongoDB, HTTP/Socket.IO/SSE and scoped domain workflows |
| Public browser | Passed: 22 scenarios | Desktop/mobile; includes seven-page automated axe WCAG A/AA audits on each viewport |
| Persisted four-role browser | Passed: 2 complete journeys | Desktop/mobile actual seven-process workflow; five representative authenticated screens audited on each viewport; no axe violations in checked states |
| Transport probe | Passed: 100/100, zero failures | Four concurrent loopback gateway clients, response-header p95 13.8 ms in this run; not a production capacity/SLO result |
| Restore comparator | Passed against a real synthetic MongoDB fixture | Equal records/indexes match; same-count changed values and lost indexes fail. This did not perform a backup/PITR restore |
| Build and repository checks | Passed | Build, typecheck, lint, format and 2,419 contract checks; main bundle 493.28 KB minified after route splitting, prior 525 KB warning removed |
| Pilot gate | Expected nonzero against unsigned template | Missing hosted evidence/owners cannot pass; no release approval manufactured |

The new real-broker poison-version/drain integration case is prepared for the dependency CI job but has not run here: Docker/RabbitMQ/Redis are unavailable. See [hardening scope](HARDENING.md), [operational recovery](INCIDENT-RUNBOOKS.md) and [pilot readiness](../release/PILOT-READINESS.md). No actual backup/PITR restore, deployment, live payment or independent security approval is claimed.

## Launch preparation evidence

Application work follows the owner's instruction to handle hosting separately. The hosted preflight is tested with injected protocol fixtures; it has not contacted actual Vercel, Render, OTP, payment or model-provider accounts.

| Check | Executed result / scope |
|---|---|
| Platform and configuration | 26 passing unit tests, including missing/mixed backend identity rejection, bounded draining and explicitly trusted/untrusted forwarded-IP chains; unrestricted proxy settings rejected |
| Launch/recovery tooling | 15 passing tests: cross-platform deployment fingerprints, strict hosted mode/safety/header/build checks, complete named evidence, frozen-source requirement, staffed rollout scope, stage observations and existing recovery controls |
| Commerce | 24 passing tests plus two explicit external-only skips; merchant approval/read scope, customer/seller denial, stale revision, sample/inactive-seller rejection, real account lookup, current seller role at quote creation, and checkout pause preserving an existing capture |
| Provider fixtures | 17 passing sandbox-protocol cases, including the new launch/pause cases; no real gateway account used |
| Role browser journey | Complete desktop/mobile journeys pass with actual seven-process persistence: management deep links, merchant approval/revocation, export/deletion-review support cases, reload and seven authenticated axe audit states per viewport |
| Contracts | 2,433 structural/schema checks; 94 frontend routes and 254 HTTP operations; new merchant/account contracts exported and route implementation scopes recorded |
| Repository checks | Build, types, lint and formatting pass; main bundle stays below 500 KB. The final release runner records the exact source/build fingerprints and refuses files changed during the run |
| Prepared operation | Launch handbook, partner/operations training, empty review/observation records and `launch:prepare` operating packet; `launch:gate` is expected to fail until actual evidence, staffing and reviews are supplied |

The complete report is generated under `.local/release-<UUID>/report.json` by `npm run verify:release`; use a report with all checks and both unchanged-source flags passing. Browser JSON attachments/screenshots are persisted for review. Per-check fixture results establish application behavior, not provider readiness, real field-device performance, settlement, policy approval, staffed operation or an executed live pilot. See [launch handbook](../release/LAUNCH-HANDBOOK.md).

## Owner-run qualification

| Gate | Why it is open | Next executable proof |
|---|---|---|
| Docker image/Compose launch | Docker is absent locally | Docker-capable runner executes `npm run infra:up` and `node scripts/smoke.mjs --ready` |
| Real dependency transaction/replay/ack test | RabbitMQ and Redis are not running locally; identity transactions have separate real-MongoDB coverage | Run `npm run test:integration` with documented URLs; CI includes this job |
| Hosted CI | Workflow prepared; no remote run observed | Inspect actual run result after repository publication |
| Vercel + Render staging deployment | Providers selected; accounts are not connected and managed dependency/provider secrets are not configured | Review quoted costs, connect accounts, apply hosting guide, run preflight and hosted full journey |
| Production qualification | Remaining commerce features, approved policies, live OTP delivery, real ClamAV checks, private storage/retention, HA/restore/load/security qualification remain open | Follow the quality/launch checklist |

The implementation and hosting configuration are present in the repository. Deployment, real provider delivery, physical-device GPS, licensed maps, Docker/ClamAV, broker recovery, load and production operations require the proofs above. Foreground web GPS is implemented; continuous background tracking is not claimed. CI configuration is an executable check, not evidence that the check has already run.

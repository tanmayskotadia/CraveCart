# Hardening and pilot qualification

This milestone adds executable repository checks and operational recovery procedures. The hosted pilot remains **not qualified** until the external gates in [pilot readiness](../release/PILOT-READINESS.md) have evidence and accountable reviewers. No credentials or live provider accounts were supplied during this work.

## Executable checks

`npm run verify:release` runs build, types, lint, formatting, platform/security tests, tooling tests, real-Mongo identity/catalog and money workflows, provider fixtures, fulfillment/assistant workflows, contract checks, national UI and the complete desktop/mobile delivery journey. Each step writes its exit status, timestamps and log under `.local/release-<UUID>/`; `report.json` identifies the Git revision and SHA-256 fingerprint of tracked and nonignored source at the start of the run. It stops on the first failure. Logs and browser attachments contain synthetic test data; review before sharing. Keep evidence for the exact source being released; edits after a run require review and relevant checks again.

The command deliberately excludes tests that need actual RabbitMQ/Redis and provider accounts. Run `npm run test:integration` against the isolated Compose stack or staging dependencies; CI has a separate dependency job. Its new cases exercise invalid-version dead-lettering and consumer drain with a real broker. A declared CI job is not a passing CI execution.

`npm run release:gate` reads `docs/release/pilot-signoff.json` and the report path in `RELEASE_REPORT`. It exits nonzero while any required gate, reviewed source, owner or evidence is missing. The checked-in record is intentionally unsigned. This is an operator evidence check, not cryptographic attestation or an automatic deployment restriction. A reviewer must inspect the linked evidence and approve the actual build and enabled flags.

## HTTP and shutdown changes

- All `/api` responses, including private media, errors and authenticated GETs, default to `private, no-store`. The gateway cannot inherit a public cache policy from an owner. Readiness is uncached and has an overall two-second deadline.
- Draining makes readiness fail and rejects new API requests with a retryable 503 and `Retry-After`. Liveness remains independent. Existing requests have the established ten-second process shutdown deadline; interrupted commands recover through durable idempotency/leases.
- Outbox shutdown now retains the actual running dispatch promise. Previously, an overlapping timer tick could replace it with an already-resolved skipped tick.
- RabbitMQ drain cancels consumer intake and awaits active handlers/acknowledgements before closing the connection and MongoDB. A hard process loss still relies on inbox deduplication and broker redelivery.
- Broker reconnection ignores a late close from an older connection and closes obsolete connections after channel loss; an old transport cannot clear the replacement channel.
- Unsupported request encodings return 415 rather than a misleading dependency outage. Parser failures never echo body content.
- Vercel configuration and its generator include frame, MIME, referrer and permissions headers. Geolocation stays available to the first-party rider app. These headers still require verification on the actual hosted responses.

## Accessibility and frontend performance

Playwright uses axe-core WCAG 2.0/2.1 A/AA rules against landing, city discovery and customer/seller/rider/admin authentication, on desktop and mobile. Persisted journeys additionally audit the seller kitchen, rider task, customer tracking, admin reports and assistant. Full axe results are attached to browser test output and retained by CI even on passing runs. Fixes darken supporting text and active delivery navigation, improve timeline/chat contrast and underline account-switch links. No rules are disabled and no violation severity is ignored.

The public audit uses reduced motion so it measures final colours rather than an entrance-animation frame. Existing tests exercise normal animations, keyboard skip navigation, modal dismissal, responsive overflow and reduced-motion behaviour. These checks do not certify every route or WCAG 2.2: manual screen-reader, focus order, zoom, target-size and real-device checks remain required.

Account, onboarding and verification pages now load on demand. The measured main bundle dropped from roughly 525 KB to 493 KB minified. This is build evidence, not proof of mobile Core Web Vitals; measure LCP/INP/CLS on the hosted site with representative networks and devices.

## Bounded transport measurement

Set `CAPACITY_BASE_URL` to an explicitly controlled staging HTTPS origin, then run `npm run capacity:probe`. Optional settings are `CAPACITY_PATH` (`/api/v1/platform` or `/health/ready` only), `CAPACITY_REQUESTS` (default 100, max 2,000), `CAPACITY_CONCURRENCY` (default 4, max 16) and `CAPACITY_P95_MS` (default 1,000). HTTP is allowed only for loopback tests. Redirects, credentials and arbitrary paths are rejected; it sends no cookies, credentials or mutations. The run stops after at most 60 seconds, each request has a five-second deadline, and failures or an incomplete run fail the command. Evidence records statuses and response-header p95 under `.local/probes`, never response bodies.

The isolated delivery runner executes this probe against its real gateway/owner processes before browser tests. This small transport check does **not** qualify the PRD target of 1,000 browsing sessions, 100 checkout attempts/minute and 300 tracked riders. The hosted exercise must include a declared dataset, measured resource sizes, warm-up/ramp/steady/recovery intervals, real authenticated sandbox flows, latency distributions, errors, queue ages and costs. Abort on money invariant violations, sustained errors, dependency pressure or provider quotas; reduce rollout rather than increasing limits blindly.

## Threat review

| Boundary | Implemented controls and evidence | Remaining qualification |
|---|---|---|
| Browser/session | Opaque cookies, CSRF/exact origin, refresh/revocation, TOTP/fresh privileged MFA; identity workflows | Verify Vercel proxy cookies, TLS and actual headers; manual session abuse review |
| Four roles/object IDs | Domain ownership, active memberships, limited grants/team revocation; identity and role integration cases | Independent authorization review of every release-enabled operation |
| Internal calls | Signed target/path/body/time/nonce; durable replay guard | Per-owner credentials, private network reachability and rotation rehearsal |
| Uploads | Private encryption, normalized images, bounded payloads and scanner adapter | Real ClamAV/image execution; durable volume and encryption-key restore |
| Payments | Raw signed webhook inbox, authoritative reduction, idempotency, amount/currency checks and balanced ledger tests | Both merchant sandbox callbacks; independent provider/bank reconciliation and compensation policies |
| Broker/worker loss | Transactional outbox/inbox, confirmed publish, deduplication, drain regression | Actual dependency CI job, node loss, reconnect, DLQ and backlog-drain rehearsal |
| Tracking/socket | Single-use tickets, current session/task checks, GPS bounds, terminal privacy | Physical phones, permission failure, licensed tiles and deployed reconnect behaviour |
| Assistant | Scoped fact tools, encrypted history, quotas, confirmation, writes default off; injection/provider fixture tests | Human review before writes; optional real-model semantic/privacy/budget evaluation |
| CDN/browser execution | No-store API boundary; MIME/frame/referrer/permissions headers | Hosted header/cache verification and provider-compatible frontend CSP qualification |
| Abuse/capacity | Bounded payloads and request/account limits; finite probe | Validate trusted proxy/client-IP chain and per-user fairness behind Vercel/Render. Current process-local IP limits must not be represented as distributed protection |
| Recovery/privacy | Read-only restored-data comparison; operational procedures | Actual backups/object restore, retention/deletion/export rehearsal and approved policies |

No independent penetration test, production SLO, HA or policy approval is claimed. Treat unqualified boundaries as launch blockers, even where implementation tests pass.

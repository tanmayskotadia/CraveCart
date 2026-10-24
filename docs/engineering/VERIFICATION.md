# Runtime verification

Updated: 25 October 2026. Local environment: Windows, Node 24.14.1, npm 11.11.0, Python 3.12. Docker Engine/Desktop is not installed on this machine.

## Executed results

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

The browser suite intercepts its capability endpoint to exercise deterministic page states. The live smoke check separately exercises actual API transport. Identity is separately verified by the real-database and live-browser suites below. Ordering is not implemented.

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

The local seed contains 18 explicitly labelled fictional restaurants and 72 illustrative dishes across six cities; these are not live restaurant affiliations. Sample stores/zones are excluded in production. See [discovery, catalog and cart setup](CATALOG-AND-CART.md). Ordering, reservations, payment, redemption, dispatch and tracking remain disabled/unimplemented. Community map tiles, live scanners/providers, scaling and hosted deployment remain separate qualification gates.

## Unexecuted release gates

| Gate | Why it is open | Next executable proof |
|---|---|---|
| Docker image/Compose launch | Docker is absent locally | Docker-capable runner executes `npm run infra:up` and `node scripts/smoke.mjs --ready` |
| Real dependency transaction/replay/ack test | RabbitMQ and Redis are not running locally; identity transactions have separate real-MongoDB coverage | Run `npm run test:integration` with documented URLs; CI includes this job |
| Hosted CI | Workflow is committed locally; no remote push/run requested | Inspect actual run result after repository publication |
| Staging deployment / Render-to-AWS TLS | No account, region, credentials or budget supplied | Deploy isolated services and run provider register probes N-01 through N-07 |
| Production qualification | Remaining commerce features, approved policies, live OTP delivery, real ClamAV checks, private storage/retention, HA/restore/load/security qualification remain open | Follow the quality/launch checklist |

The foundation implementation is available locally; the full infrastructure exit gate is not claimed passed. CI configuration is an executable check, not evidence that the check has already run.

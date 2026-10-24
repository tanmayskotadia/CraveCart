# Foundation verification

Date: 24 October 2026. Local environment: Windows, Node 24.14.1, npm 11.11.0, Python 3.12. Docker Engine/Desktop is not installed on this machine.

## Executed results

| Check | Result | Evidence |
|---|---|---|
| Dependency installation | Passed | Locked npm workspace install; audit reported zero vulnerabilities at installation |
| Server and React production build | Passed | `npm run build`; six owners, gateway and shared packages compile; Vite produces static assets |
| Type checking | Passed | `npm run typecheck`, including application, tooling and test types |
| Lint / service import boundaries | Passed | `npm run lint`; cross-service source/repository imports prohibited |
| HTTP/safety/tracing tests | Passed: 12 tests | `npm test`; live vs ready, exact public schema, request validation/IDs, protected metrics, safe errors, invalid upstream classification, environment guards, synthetic adapters, canonical hashing, role helper and actual parent trace propagation |
| National experience | Passed: 20 tests | Chromium desktop + Pixel 7 viewport; original photo rendering, city filtering/selection/persistence, query continuity, phone/email validation, login/signup modal refresh and Escape, 18-city expansion, preview switch, protected routes, 404, keyboard navigation, outages and reduced motion |
| Formatting / configuration / naming | Passed | Prettier; parsed Compose/CI YAML structure; no numbered milestone labels in README files or project folder names |
| Live local processes | Passed | Gateway plus all six owners served liveness; React served at `http://localhost:5173` |
| Actual gateway-to-owner call | Passed | `node scripts/smoke.mjs` verified gateway → admin public snapshot and correlated UUID |
| Dependency outage behavior | Passed | Every owner and aggregate gateway readiness correctly returned unavailable with dependencies absent |
| Planning contracts | Passed | 1,861 structural/example/coverage checks; 90 routes, 179 HTTP operations, 37 broker events, 12 socket events, 19 critical CTAs, 53 traceability rows |

The browser suite intercepts its capability endpoint to exercise deterministic page states. The live smoke check separately exercises actual API transport. Neither verifies identity or ordering because those features are not implemented yet.

The national redesign was visually inspected at 1440px desktop and 390px mobile widths, including the login dialog. The market contract now declares India/national scope rather than one global city; the selected city is independent browsing context. All generated food assets are local optimized WebP files with provenance in `design/ASSETS.md`.

## Implemented foundation scope

- npm TypeScript workspace with exact dependency lockfile, reproducible build and six independent service entry points.
- Shared contracts, validated configuration, safe HTTP runtime, structured logging and OpenTelemetry propagation/export support.
- Public read-only `GET /api/v1/platform` with authoritative unavailable capabilities; only this business API slice is implementation-ready.
- Owner-local MongoDB transaction/idempotency/outbox/inbox skeleton; confirmed/routable RabbitMQ publish with lease/backoff/exhaustion state; strict payload validation.
- Local MongoDB replica-set, RabbitMQ, Redis and service Compose configuration with persistence, healthchecks and loopback bindings.
- Realtime process with Socket.IO accepting no unauthenticated connections until the ticket flow is implemented.
- React launch experience and route shells; no fabricated authentication grants, fake payment successes or enabled ordering.
- Development-only deterministic adapters with production guardrails; non-root Docker image, CI quality/browser/dependency jobs and documented operating procedures.
- Existing numbered planning directory, handoff and script filenames renamed to descriptive names with references updated.

## Unexecuted release gates

| Gate | Why it is open | Next executable proof |
|---|---|---|
| Docker image/Compose launch | Docker is absent locally | Docker-capable runner executes `npm run infra:up` and `node scripts/smoke.mjs --ready` |
| Real dependency transaction/replay/ack test | MongoDB replica set, RabbitMQ and Redis are not running locally | Run `npm run test:integration` with documented URLs; CI includes this job |
| Hosted CI | Workflow is committed locally; no remote push/run requested | Inspect actual run result after repository publication |
| Staging deployment / Render-to-AWS TLS | No account, region, credentials or budget supplied | Deploy isolated services and run provider register probes N-01 through N-07 |
| Production qualification | Business features, approved policies, provider setup, HA/restore/load/security qualification are future milestones | Follow the quality/launch checklist |

The foundation implementation is available locally; the full infrastructure exit gate is not claimed passed. CI configuration is an executable check, not evidence that the check has already run.

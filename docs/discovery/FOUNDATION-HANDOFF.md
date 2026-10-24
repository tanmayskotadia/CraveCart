# Foundation delivery checklist

## Ready locally

National market baseline, four-role journeys, route/endpoint inventory, critical HTTP schemas, broker/socket contracts, design tokens, architecture decisions and traceability are available. External provider access is not needed for deterministic local scaffolding.

The local application foundation is now implemented. See [verification evidence](../engineering/VERIFICATION.md) and [developer setup](../engineering/LOCAL-DEVELOPMENT.md). The checklist below preserves acceptance scope and separates code delivery from infrastructure proof.

| Item | Current delivery status |
|---|---|
| F-01, F-02 | Toolchain/lockfile/workspaces implemented; build and type checks passed |
| F-03 | Public capability slice exported from runtime schema and tested; other contracts remain baselines |
| F-04 | Compose, persistence and health configuration delivered; Docker execution pending |
| F-05 | Safe HTTP runtime, IDs/logs/traces delivered; real parent-trace test passed |
| F-06 | Transaction/outbox/inbox implementation and real-dependency recovery test delivered; dependency-backed execution pending |
| F-07 | CI workflow and local quality checks delivered; hosted CI not yet executed |
| F-08 | React shell, declared routes, denied protected access and mobile/desktop browser checks passed |
| F-09 | Deterministic server-only development adapters and production guards implemented/tested |
| F-10 | Setup/probes documented; hosted staging requires accounts, selected region and approved budget |

## Foundation backlog in dependency order

| ID | Work item | Completion evidence |
|---|---|---|
| F-01 | Verify supported Node/package versions; choose workspace package manager; lock toolchain | Fresh checkout has documented reproducible install/build |
| F-02 | Create TypeScript workspace for web, six services and shared contracts/config/telemetry | Typecheck/build with no cross-service repository imports |
| F-03 | Promote first implemented HTTP slice from `baseline` to `implementation-ready`; define exact auth/error/body semantics | Generated clients only consume implementation-ready operations |
| F-04 | Compose MongoDB replica set, RabbitMQ, Redis, gateway and six service processes | Single documented start; correct readiness and local persistence |
| F-05 | Common schema validation, safe errors, request IDs, structured logs and trace propagation | Request trace spans gateway and service; no secrets in logs |
| F-06 | Outbox/inbox and idempotency skeleton on real local dependencies | Crash/replay integration test yields one effect |
| F-07 | CI lint/typecheck/build/contract validation and environment guards | Repeatable pipeline; test credentials cannot reach live providers |
| F-08 | Route shells and semantic design tokens; nonfunctional features hidden | Deep-link reload, 404, wrong-role shell and keyboard smoke |
| F-09 | Development notification/payment/maps adapters with synthetic fixtures | Deterministic fixtures, obvious development labeling |
| F-10 | Isolated staging deployment/network spike once accounts/region/budget are selected | Provider register and N-01–N-07 evidence updated truthfully |

Foundation exit requires a runnable clean checkout, six ready services, durable replay proof, contract validation and CI evidence. Full identity, catalog, checkout and assistant feature implementation belong to later phases.

## Carry-forward decisions

Resolve operating zones, providers and accounts, approved fee/tax/cancellation/payout policy, foreground/native rider scope, owned domain, budget and staffing by the milestones in [discovery](DISCOVERY.md). No arbitrary live defaults should be inserted to make a demo appear complete.

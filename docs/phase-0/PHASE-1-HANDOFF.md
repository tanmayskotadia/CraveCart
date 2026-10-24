# Phase 1 foundation handoff

## Ready locally

Chennai market baseline, four-role journeys, route/endpoint inventory, critical HTTP schemas, broker/socket contracts, design tokens, architecture decisions and traceability are available. External provider access is not needed for deterministic local scaffolding.

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

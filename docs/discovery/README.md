# Discovery — discovery and contracts

Baseline date: 24 October 2026. Market: **India-wide**, expanded by the user from the original Chennai-only pilot. Status: **local discovery/design baseline delivered; business decisions and deployed connectivity verification remain open**.

## Deliverables

| Artifact | What is concrete |
|---|---|
| [Discovery and decision register](DISCOVERY.md) | Market, pilot boundaries, policy defaults, unresolved decisions and owners |
| [Journey maps](JOURNEYS.md) | Four-role flows, assistant flow, exception paths and acceptance IDs |
| [Design specification](DESIGN-SYSTEM.md) | Color/type/spacing rules, component states and page wireframes |
| [CSS design tokens](../../design/tokens.css) | Reusable semantic tokens for the React UI |
| [Frontend route manifest](../../contracts/routes.json) | Every documented page, workspace, policy, states and redirects |
| [OpenAPI baseline](../../contracts/openapi.json) | Complete endpoint inventory, common security/errors and detailed critical schemas |
| [Broker event schemas](../../contracts/events.schema.json) | Discriminated v1 envelope and event-specific payload requirements |
| [Socket schemas](../../contracts/socket.schema.json) | Direction, payload and authorization requirements |
| [Traceability matrix](traceability.csv) | Acceptance IDs linked to journeys, routes, API operations, evidence and target phases |
| [Architecture decisions](../adr/README.md) | Ownership, sessions, reliable workflows, tracking and deployment constraints |
| [Provider and networking readiness](PROVIDERS-AND-FEASIBILITY.md) | Setup checklist, integration gates, evidence required and official research |
| [Validation report](VALIDATION.md) | Locally executed checks and limits of those checks |
| [Foundation handoff](FOUNDATION-HANDOFF.md) | Ordered foundation backlog and definition of ready |

Contract validation results are in the validation report. Runtime foundation checks are recorded separately in [engineering verification](../engineering/VERIFICATION.md); structural assertions are not runtime application tests.

## Exit gate

| Gate | Status | Evidence / remaining work |
|---|---|---|
| Market | Confirmed | User expanded scope to India-wide discovery with city-specific delivery rollout |
| Feature scope / four roles | Baseline documented | Existing PRD; no user sign-off inferred from document generation |
| Journeys and acceptance IDs | Delivered | Journey maps + traceability CSV |
| Visual design baseline | Delivered | Tokens and low-fidelity layouts; no claim of user visual approval |
| Route / API / event baseline | Delivered and locally checked | Contract files and validation report; inventory-only HTTP operations remain marked |
| Architecture decisions | Proposed baseline recorded | ADRs explain tradeoffs and rollout gates |
| Provider applications | Prepared, not submitted | Merchant entity, accounts and provider access not supplied |
| Cross-cloud feasibility | Documentation-supported option identified | No deployed endpoint, credentials or handshake test available |
| Fees / tax / cancellation / payout policy | Proposed, not approved for live use | Decision register; production configuration must fail closed |
| Tracking scope | Foreground provisional | User answered city only; background companion remains undecided |

Local foundation scaffolding is implemented with isolated development adapters. Discovery cannot be called fully business-approved or infrastructure-verified until the open gates have evidence. Do not create paid resources, submit merchant applications or publish policies from placeholder business data.

# CraveCart planning pack

**Stack:** MongoDB, Express.js, React, Node.js with TypeScript.  
**Document version:** 1.0 · 24 October 2026 · Proposed implementation baseline.  
**Status:** Planning baseline plus implemented local application foundation. Business features and hosted production qualification remain pending; see [runtime verification](./engineering/VERIFICATION.md).

Read these documents in order:

| Document | Purpose |
|---|---|
| [Product requirements](./PRD.md) | Scope, roles, workflows, business rules, measurable acceptance criteria |
| [Routes and contracts](./ROUTES-AND-CONTRACTS.md) | Frontend pages, button behavior, API inventory, events, authorization |
| [Implementation plan](./IMPLEMENTATION-PLAN.md) | Architecture, data design, engineering strategies, milestones, deployment |
| [Quality and launch checklist](./QUALITY-AND-LAUNCH.md) | Navigation audit, failure tests, security checks, release gates, operations |
| [Discovery delivery](./discovery/README.md) | India-wide discovery baseline, journeys, design tokens, machine-readable contracts, ADRs and readiness evidence |
| [Developer guide](./engineering/LOCAL-DEVELOPMENT.md) | Workspace setup, local modes, checks and real-dependency integration tests |
| [Runtime verification](./engineering/VERIFICATION.md) | Executed application checks and unexecuted infrastructure/deployment gates |

## Interpretation and assumptions

- CraveCart is an independently branded food-delivery marketplace inspired by Zomato. Use original UI, licensed images, and authorized data.
- Four product roles are required: customer, restaurant seller, rider, and admin. Three primary login entry points are customer, rider, and admin; sellers also have an explicit seller login and onboarding path. All use one identity service. This avoids omitting the restaurant operator.
- “Hallucinate between pages and buttons” is interpreted as **no broken links, invented destinations, misleading actions, or inconsistent state**. The chatbot must also avoid unsupported claims.
- The requested six backend services are retained. Order management is an explicit bounded module in Restaurant Service; payment and chatbot modules live in Utils Service. These modules can be extracted later without changing public contracts.
- Operating market: **India-wide** (the user expanded the earlier Chennai-only scope), INR, immediate single-restaurant orders. Both Razorpay and Stripe integrations are required before the full-scope release. Actual Stripe live availability and supported currencies depend on the merchant account and market; do not promise global operations merely because an adapter exists.
- Launch scope and later enhancements are distinguished so “everything” is deliverable and testable. All features explicitly requested by the user are in the full-scope release.
- The source website could not be read using the research tool. The supplied Google Drive references are shortened/incomplete, so their content was not verified or used as a specification. No paid source code is assumed available.
- SLOs, capacities, time estimates, TTLs, and business thresholds below are proposed targets, not measured results or vendor guarantees.

## Decisions to confirm before the relevant implementation milestone

| Decision | Working default | Deadline |
|---|---|---|
| City and delivery boundary | India-wide discovery confirmed; each city requires approved service polygons | Discovery / before serviceability implementation |
| Maps provider and navigation | Provider adapter; commercial maps/geocoding/directions provider selected after coverage, terms, and cost review | Tracking milestone |
| SMS/email/push providers | Provider adapters with development fakes and production credentials | Identity milestone |
| Seller/rider verification documents | Configurable market-specific requirements reviewed by operations | Onboarding milestone |
| Commission, delivery fee, taxes, cancellation policy | Versioned configuration; explicit fee lines and policy disclosure | Checkout milestone |
| Payment settlement model | Platform collection and accounting ledger; actual seller/rider disbursement via approved marketplace/payout arrangements | Payments milestone |
| Rider platform | Responsive React PWA for foreground pilot; native background-location companion required for continuous tracking commitments | Before production tracking claim |
| AI provider and data region | Server-side provider adapter, bounded usage, approved FAQ corpus | Chatbot milestone |
| Cloud regions and networking | Vercel frontend, Render services, AWS-hosted RabbitMQ, MongoDB replica set, Redis | Infrastructure milestone |
| Team and budget | Estimate assumes 3–4 experienced engineers plus part-time design, QA, and infrastructure support | Planning |

## Source notes

Research checked on 24 October 2026. These references inform specific design constraints; they do not imply the implementation has been validated.

- [RabbitMQ reliability](https://www.rabbitmq.com/docs/reliability): retransmission can duplicate deliveries; application consumers need idempotency. Publisher confirms and consumer acknowledgements inform the broker strategy.
- [Socket.IO delivery guarantees](https://socket.io/docs/v4/delivery-guarantees/): default delivery is at most once; durable business events need application-level recovery.
- [Razorpay webhook validation](https://razorpay.com/docs/webhooks/validate-test/): signature validation uses the raw body; duplicate and unordered events must be handled.
- [Stripe webhooks](https://docs.stripe.com/webhooks): use authenticated HTTPS webhook endpoints and the provider's verification and retry protocol.
- [Render WebSockets](https://render.com/docs/websocket): public WebSockets are supported; deployments can close connections.
- [Render private networking](https://render.com/docs/private-network): internal connectivity applies to eligible services in the same region/workspace; it does not automatically connect AWS networks.
- [MongoDB transactions](https://www.mongodb.com/docs/manual/core/transactions/): replica-set/sharded transactions support local domain writes plus outbox insertion.
- [MDN geolocation](https://developer.mozilla.org/en-US/docs/Web/API/Geolocation_API): secure contexts and user permission are required.
- [MDN autoplay](https://developer.mozilla.org/en-US/docs/Web/Media/Guides/Autoplay): audible playback can require user interaction; visual fallbacks are necessary.

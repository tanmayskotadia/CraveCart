# Implementation and release audit

Reviewed on 26 October 2026. Repository fixtures establish application behavior; they do not establish real provider activation, hosted capacity, bank payout or physical-device performance.

Follow-up on 29 October 2026: [signed-in journey findings and fixes](USER-JOURNEY-AUDIT.md). The owner selected [free tiers only](FREE-HOSTING-ASSESSMENT.md); the existing paid Render Blueprint must not be applied under that constraint.

| Roadmap area | Current evidence | Open exit requirements |
|---|---|---|
| Discovery and contracts | PRD, owner boundaries, typed routes and exported API/event contracts | Reviewed merchant, finance, privacy and legal policies |
| Foundation | Six domain services, gateway, MongoDB transactions, outbox/inbox, Docker and hosting definitions | Real RabbitMQ/Redis integration run, hosted networking, backup and restore qualification |
| Identity and onboarding | Separate role entry, contact verification, MFA, protected uploads, admin approval, ownership tests | Hosted SMS/email/scanner execution and review |
| Discovery and catalog | Seller-created menus, options, prices, current addresses and service zones | Hosted merchant/catalog acceptance and reviewed discovery scope |
| Orders and money | Provider adapters, signed capture/refund paths, balanced ledger, preview/confirm reorder; independent discretionary refund approval with MFA, expiry, current authority/version checks and idempotency | Reviewed financial threshold policy, real provider callbacks and hosted independent-review rehearsal |
| Fulfillment and tracking | Paid-order notifications; accept → prepare → ready → exclusive assignment → verified pickup → verified delivery; authorized maps, foreground GPS and reconnect recovery | Licensed tile configuration, physical GPS/network/screen tests, real broker/Redis outage tests |
| Full role operations | Support, private messages, reviews, team scopes, reports and financial records | Approved compensation and Razorpay Route transfer/settlement/reversal integration; real retention, policy content and scope qualification |
| Assistant | Grounded help/menu/own-order tools, explicit write proposals, bounded optional model use | Reviewed content, human evaluation and optional model account qualification |
| Hardening and pilot | Automated repository/browser/accessibility checks, bounded probes, recovery and incident tools | Independent security review, hosted load/fault/recovery evidence and operator sign-off |
| Launch | Build identities, preflight, training and rollout tools | Owner hosting/configuration, approved policies, staffed support/on-call, real sandbox then approved live pilot |

The roadmap is **not fully closed**. A working delivery story must not be used to mark the remaining implementation or external exit gates complete. Open implementation includes compensation and Route settlements. Policy publishing and owner-scoped privacy fulfilment are implemented, with scope and qualification limits documented below. Do not describe gross sales or customer capture as partner payable earnings or completed bank settlement.

## Audit work ledger

| Item | Implementation status | Evidence and remaining boundary |
|---|---|---|
| Independent financial approval | Implemented and verified in repository fixtures | [Owner enforcement and UI](FINANCIAL-APPROVALS.md); integration checks cover self-review, read-only/customer denial, stale MFA, cumulative limits, concurrent decisions, retry, expiry, changed orders, revoked requester and audit before/after values. Desktop/mobile journeys use two separate MFA-enabled admin accounts and track a labelled simulated provider refund. Default threshold is zero; approved operating policy and actual merchant rehearsal remain open. |
| Partner compensation and Route settlement | Open | Requires versioned approved compensation/allocation rules and linked-account, transfer, reversal and settlement reconciliation. Do not invent rates or mark customer capture as partner payout. |
| Cross-service privacy fulfilment | Owner-scoped implementation; qualification and legacy scope remain open | Verified intake, independent review, encrypted expiring export downloads and resumable retention-aware closure across six services. Active obligations block closure, sessions are revoked before owner erasure, financial categories are disclosed and retention minimization is queued. Export binaries, legacy cached command results, logs, broker copies, backups and provider-held data require the explicit reviewed procedures in the manual checklist. Do not represent this as universal erasure. |
| Reviewed policy/settings publishing | Implemented; operator content required | Versioned drafts, independent MFA publishing, immutable public revisions, required business contacts, live quote policy binding and explicit checkout acceptance. Actual terms and retention duration require accountable review; fixture content is not a production policy. |
| Hosted qualification | Open | Provider accounts/keys, licensed maps, real broker/Redis execution, physical devices, load, backup/object/key restore and operator approval are separate from repository evidence. |

## Runtime data and configuration

Order identities, item selections/prices, payment states, fulfillment transitions, rider assignments, addresses and GPS come from the owning services. Production forbids development payment/contact/scan adapters and excludes sample catalog records from live merchant approval. Test fixtures intentionally use labelled synthetic contacts, coordinates and prices in isolated disposable databases.

Shared geographic metadata, UI wording, safety limits and deployment defaults are configuration/code, not simulated order data. Initial city selection must come from explicit customer choice or the rider's verified profile. No hardcoded rider position, delivered timer, made-up route or promise of ETA is permitted.

For hosting supply private MongoDB, RabbitMQ, Redis, email, scanner and payment settings from the provider accounts. Configure `VITE_REALTIME_ORIGIN`, `VITE_MAP_TILE_URL` and required attribution for the frontend. Publishable map keys may reach the browser; database/payment/encryption secrets must not. The ignored `.env.hosted` helper generates internal secrets only and never creates provider credentials.

## Manual handoff

The [manual setup and launch checklist](../MANUAL-SETUP-AND-LAUNCH.md) lists every private/public setting, provider ownership, deployment order, independent review, privacy scope, actual delivery acceptance and remaining Route/scale work. Provider credentials have not been invented or included.

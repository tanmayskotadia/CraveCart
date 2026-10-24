# CraveCart quality and launch checklist

No boxes are pre-checked: this repository currently contains planning documents only. During implementation, attach build/commit, environment, test case, evidence link, owner and date to each release gate.

## 1. Traceability and navigation audit

Maintain one matrix linking `requirement ID → route → UI action → API/owner → authorization → state transition → test → telemetry`. Suggested implementation artifact: `docs/traceability.csv`. No visible button or menu entry is complete without a defined result and failure state.

| Journey | Required route/action checks | Pass condition |
|---|---|---|
| Guest discovery | Home → location → search → restaurant → configure dish → cart | Filters survive back/forward; unknown/closed/unserviceable cases work |
| Authentication | Customer/seller/rider/admin sign-in → verification → intended workspace | Safe returnTo; refresh/logout/revocation; no redirect loops |
| Customer checkout | Cart → address → quote → payment → return → order | No duplicate order/payment effects; price changes require review |
| Seller operation | Application → approval → menu → order accept → ready → pickup | Unauthorized IDs denied; transitions and sound/visual alerts accurate |
| Rider operation | Application → approval → online → offer → pickup → navigation → completion | Single assignment, stage-correct destination, proof and incident handling |
| Customer tracking | Order → tracking → messages → support | Ownership enforced; reload/reconnect converge; stale GPS labeled |
| Financial recovery | Rejection/cancellation → refund request → approval → provider outcome | Exact amount/currency ledger balance and visible pending/failed states |
| Admin control | Verification/order/ticket/refund/report/settings | Grant-specific access, reasons, audit and two-person finance threshold |
| Assistant | FAQ → own-order query → proposal → confirm → result/handoff | Grounded response, true action outcome, valid links, no role bypass |
| Profile/privacy | Addresses, preferences, sessions, export/deletion request | Ownership, validation, retained state on failure, safe confirmation |

For **every frontend route**:

- [ ] Direct URL load and browser refresh succeed on Vercel.
- [ ] Guest, correct role, incorrect role, suspended role and unverified role behave correctly.
- [ ] Breadcrumbs, browser back/forward and safe login return paths work.
- [ ] Missing/invalid/other-user resource IDs have safe error states.
- [ ] Loading, empty, offline, timeout, validation and dependency-failure states are usable.
- [ ] Every primary/secondary action has success/error feedback and a real command/destination.
- [ ] Form inputs survive recoverable errors; repeated clicks cannot duplicate effects.
- [ ] Keyboard/focus/screen reader checks pass; mobile layout has no blocked controls.
- [ ] Demo placeholders and unimplemented actions are hidden from the production build.

Implement a typed route registry and an action inventory, then run Playwright journeys against real persisted fixtures. Link crawling catches missing destinations; it does not prove mutations, payment correctness or permissions. Mocked end-to-end tests do not replace a staging provider-sandbox run.

## 2. Essential automated checks

### Domain tests

- [ ] Order transition matrix covers every actor/status/transition combination, including denied changes.
- [ ] Money calculations test integer rounding, discount caps, tax/fee allocation, currency and partial refunds.
- [ ] Modifier constraints, cart replacement, quote expiry, stock/promotion reservations and release are correct.
- [ ] Dispatch scoring/eligibility, offer expiry, OTP expiry/attempts and role policies are tested.

### Real dependency integration and concurrency

- [ ] Transactions commit domain changes with outbox events atomically; rollback leaves neither partial state.
- [ ] Publisher crash after confirm/before marking sent creates safe duplicate delivery.
- [ ] Consumer crash after commit/before ack produces one business effect after retry.
- [ ] Unknown event version/poison payload enters DLQ without blocking healthy work.
- [ ] Event gaps/out-of-order versions cause authoritative resync rather than state regression.
- [ ] Two customers buying the final limited item cannot exceed capacity.
- [ ] Two riders accepting the same offer/order produce one active assignment.
- [ ] One rider accepting two offers concurrently produces at most one active task.
- [ ] Seller acceptance vs timeout/cancellation has one valid outcome and correct compensation.
- [ ] Delivery completion replay does not duplicate earnings, notifications or settlement entries.

### Gateway matrix: run for both Razorpay and Stripe

| Scenario | Expected result |
|---|---|
| Valid capture and verified return | One captured payment; one placed order |
| Forged return/success callback | No paid transition |
| Invalid signature or wrong merchant/amount/currency/reference | Reject/quarantine; no fulfillment |
| Duplicate webhook | Acknowledge safely; no duplicate ledger/order effects |
| Reordered events | Reducer converges using verified authoritative status |
| Webhook before browser return | Order still resolves correctly |
| Browser closes after paying | Durable capture processing places eligible order |
| Provider timeout after creating attempt | Reconcile existing reference before retrying |
| Capture arrives after order expiry/cancellation | No resurrection; refund/exception workflow |
| Two payable attempts capture due to a race | One fulfillment; extra capture compensated and alerted |
| Partial refund/repeated refund submit | Refunded amount never exceeds capture minus prior refunds |
| Refund API accepted but settlement delayed | Show submitted/pending until verified success |
| Refund or dispute after payout statement | Ledger adjustment and clear finance exception |

### Realtime, maps and devices

- [ ] Customer cannot subscribe to another order or seller/rider/admin room.
- [ ] Suspended/reassigned users lose authorized subscriptions and location visibility.
- [ ] Disconnect during every order phase, redeploy realtime, reconnect and compare UI with canonical snapshot.
- [ ] Multiple realtime instances receive room events correctly; adapter/transport affinity works under load.
- [ ] Old/duplicate GPS sequences cannot move the marker backward as a fresh update.
- [ ] Invalid coordinates, future/stale timestamps, poor accuracy and implausible jumps are handled.
- [ ] GPS denied, network loss, provider routing failure and quota exhaustion have usable fallbacks.
- [ ] Navigation points to restaurant before pickup and customer after pickup; cancelled task cannot expose destination.
- [ ] Sound disabled/blocked still shows accessible order/offer alerts; acknowledgement stops repeats.
- [ ] Real Android/iOS foreground tests pass; if continuous background tracking is claimed, native screen-off/background/battery-saver tests pass too.

### Assistant evaluation

- [ ] Fixed tests cover supported FAQs, policy versioning, menu availability and own-order/refund facts.
- [ ] Other-user order IDs, invented roles, prompt injection in messages/menu/FAQ and arbitrary tool names fail safely.
- [ ] No tool can issue payments/refunds or approve privileged actions.
- [ ] Action proposals require bound explicit confirmation; stale/replayed confirmations do nothing.
- [ ] Provider timeout, malformed output, quota exhaustion and unavailable retrieval fall back to support/FAQ.
- [ ] No secret/OTP/KYC/card details or unnecessary location history enter prompts/logs.
- [ ] Claimed completion is backed by a successful domain result; links resolve to existing authorized routes.
- [ ] PRD evaluation thresholds are met and human-reviewed before enabling confirmed write tools.

## 3. Production release gates

| Gate | Required evidence | Accountable owner |
|---|---|---|
| Scope | All P0/P1 requirements traced; every UI action functional | Product + engineering |
| Functional correctness | Four-role full journey and adverse payment/dispatch race suite | QA + backend |
| Access/security | Threat review; object-level auth tests; MFA; scans; no unresolved critical vulnerabilities | Security/engineering |
| Provider readiness | Live merchant approvals, signed webhook setup, maps/OTP/storage quotas, controlled live payment/refund test | Operations + finance |
| Continuous tracking claim | Physical native-background tests, or explicitly foreground-limited launch scope | Mobile + product |
| Capacity | Named test dataset/load, latency/availability results and resource/cost profile meet PRD targets | Infrastructure |
| Resilience | Broker node loss, worker restart, dependency outage, reconnect and backlog drain verified | Infrastructure + backend |
| Recovery | Actual database/object restore, RPO/RTO measured, secrets restore/rotation documented | Infrastructure |
| Finance | Captures/refunds/fees/commissions/tips reconcile; payout status reflects provider evidence | Finance + backend |
| Privacy/policy | Approved notices, retention, verification access, export/deletion procedures and operating policies | Operations + qualified reviewers |
| UX/accessibility | Route audit; mobile/browser/device coverage; no critical accessibility blockers | Design + QA |
| Operations | Named on-call and support coverage, escalation paths, trained sellers/riders, runbooks rehearsed | Operations |
| Deployment | Staging parity, isolated secrets, repeatable deployment, migrations and rollback rehearsed | Release owner |

Evidence status is `not started`, `in progress`, `passed`, or `failed`. An unexecuted check is not “passed.” If a required gate fails, keep the rollout internal or explicitly limit pilot claims until remedied.

## 4. Observability and alerts

Dashboards must connect request ID, order ID, payment reference, correlation ID and event ID without exposing sensitive payloads.

| Signal | Initial alert rule to tune in pilot | First response |
|---|---|---|
| Critical API errors | Sustained error-budget burn; p95 latency above target | Inspect dependency/trace; rollback or disable affected capability |
| Captured money with unplaced order | Unresolved beyond reconciliation threshold | Inspect saga and provider; prevent duplicate fulfillment, compensate |
| Ledger imbalance | Any unbalanced posting group/currency | Halt affected finance workflow and investigate |
| Outbox oldest age | >60 seconds sustained | Check broker reachability, confirms and workers |
| DLQ | Any financial event; increasing nonfinancial backlog | Investigate cause; audited replay after fix |
| Broker disk/memory/cluster | Provider-specific safe threshold or lost quorum | Protect disk, restore capacity; durable producers retain outbox |
| Dispatch | No assignment beyond configured service SLA | Operations intervention; restrict zone/order intake if necessary |
| Location | No accepted sample >30 seconds on active task | Mark stale; diagnose rider/network; follow incident workflow |
| Refund backlog | Past published/provider operational window | Finance escalation and truthful customer update |
| Assistant | Error rate, unsafe tool attempts, budget threshold | Disable tool/provider flag; support fallback |
| External cost/quota | Maps/OTP/AI/storage threshold and forecast | Throttle nonessential usage; preserve ordering/support |

Do not page on every expected client failure. Track provider errors separately, define severity and ownership, and test alert delivery before launch.

## 5. Runbook inventory

Each runbook states trigger, impact, diagnostic queries/dashboards, safe actions, escalation owner, customer communication, recovery checks and post-incident reconciliation.

1. Gateway outage or elevated payment failures.
2. Payment captured but order missing/pending.
3. Refund stuck, duplicate callback or amount mismatch.
4. RabbitMQ outage, quorum loss, outbox buildup and DLQ replay.
5. MongoDB failover/restore and index/backfill rollback.
6. Realtime redeploy, disconnected clients and Redis fanout loss.
7. No riders, restaurant delay, rider accident/unavailability or food already picked up.
8. GPS permissions/stale tracking and maps quota failure.
9. Document exposure, credential compromise and session revocation.
10. AI provider outage, fabricated response report or unauthorized tool attempt.
11. Privacy export/deletion request across service-owned data.
12. Deployment rollback, reconciliation and gradual rollout pause.

## 6. Final sign-off record template

```text
Release / build:
Scope and enabled feature flags:
Operating city / service zones:
Production provider capabilities:
Tracking mode and verified devices:
Requirement traceability evidence:
Functional / security / load / restore results:
Financial reconciliation evidence:
Known issues and approved mitigations:
Support / on-call contacts:
Rollback trigger and procedure:
Product / engineering / QA / operations / finance approvers:
Launch date and review date:
```

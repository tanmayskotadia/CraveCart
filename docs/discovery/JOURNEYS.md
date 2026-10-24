# Journey maps and acceptance baseline

These are implementation acceptance targets. `Designed` in traceability does not mean a user journey has already run.

## Customer — find food and receive it

| Step | Route / user action | System responsibility | Exception / recovery |
|---|---|---|---|
| Discover | `/` → `/location` → `/search` | Location consent/manual entry; serviceability; deterministic filters | GPS denied → manual entry; unserved zone → honest empty state |
| Choose | `/restaurants/:slug` → configure dish | Published menu, modifier constraints, availability | Closed/sold-out → explain and offer other dishes |
| Review | `/cart` → `/checkout` | One restaurant, address, server quote and disclosed policy | New restaurant → confirm replace; expired quote → explicit review |
| Pay | Place and pay → `/checkout/return` | Idempotent pending order/attempt; verified capture | Pending/abandoned/late webhook → truthful state and reconciliation |
| Follow | `/orders/:orderId` → `/orders/:orderId/track` | Current timeline and authorized rider location | Reconnect → snapshot; stale GPS → label; no-rider → support |
| Finish | Delivery OTP → receipt/review | Verified completion; receipt and review eligibility | Wrong OTP → limited attempts; incident → support |

**Acceptance P0-CUST-01:** No browser callback can mark an order paid. **P0-CUST-02:** Retry/refresh cannot duplicate payable order effects. **P0-CUST-03:** Another user's order/address cannot be read by substituting an ID. **P0-CUST-04:** Cancellation and late capture converge to a compensation/exception outcome without fulfillment resurrection.

## Seller — onboard and fulfill

`/seller/register → /seller/onboarding → admin review → /seller/restaurants → dashboard → menu → orders → order detail`.

1. Submit a complete application and safe document references; show pending/rejected/requested-changes states.
2. Approved owner configures hours, menu/modifiers, availability and permitted staff.
3. New paid order produces a durable inbox entry plus visible alert and optional enabled sound.
4. Accept with prep estimate or reject with reason; server resolves concurrent seller sessions and timeout.
5. Mark preparing/ready; pickup is confirmed against current assignment and proof.
6. Review sales, commission/refund adjustments and settlement status independently of bank payout success.

**P0-SELL-01:** Unapproved/suspended restaurants cannot take orders. **P0-SELL-02:** Restaurant membership and action grant are checked on every mutation. **P0-SELL-03:** Seller reject/timeout triggers durable compensation, and a sound-blocked browser still exposes the incoming order.

## Rider — accept and deliver

`/rider/register → /rider/onboarding → admin review → /rider/dashboard → /rider/offers → delivery detail → navigation → pickup → delivery verification`.

1. Approved rider enables availability; permissions/network/task checks determine dispatch eligibility.
2. Offer shows expiry, approximate route and earning components, with no premature full customer address.
3. Atomic acceptance creates one active assignment; losing/expired offers show a clear conflict.
4. Navigate to restaurant; verify pickup; switch navigation destination only after applied pickup.
5. Publish authorized timestamped location; customer sees last-update freshness.
6. Complete using proof/OTP; wait for order-authority outcome before showing success/earnings.
7. Customer unavailable, vehicle issue or food-in-transit incident goes to support; going offline cannot silently discard the task.

**P0-RIDE-01:** At most one active assignment per rider/order. **P0-RIDE-02:** Unauthorized/stale location cannot update an active task. **P0-RIDE-03:** Queued completion is not delivered status. **P0-RIDE-04:** Background tracking is not advertised for the foreground web pilot.

## Admin — verify and resolve

`/admin/login + MFA → dashboard → verifications / live orders / support / refunds → evidence → scoped action → audit`.

- Verifier reviews protected documents, requests changes or records a reasoned decision; domain owner applies it and reports outcome.
- Operations monitors aged orders and no-rider incidents; manual assignment reuses normal eligibility/conflict checks.
- Support agent reviews linked order/ticket and proposes a remedy; finance grants govern money movement.
- Refund above configured threshold requires two distinct authorized approvers; provider submission stays pending until verified outcome.
- Settings/promotions/zone changes are versioned; exports are permissioned, time-limited and audited.

**P0-ADMIN-01:** No public admin registration or self-granted role. **P0-ADMIN-02:** Requested asynchronous action is distinct from applied result. **P0-ADMIN-03:** Finance approval separation and complete audit context are enforced.

## Assistant — answer using verified facts

`/assistant → question → approved FAQ / authorized read tool → grounded answer → optional proposed cart/ticket action → explicit confirmation → domain result`.

Guest scope is FAQ only. Signed-in data uses server identity and normal ownership rules. If retrieval/provider fails, show real FAQ/support routes. Cancellation uses the normal order policy flow; no assistant tool can issue refunds/payments or approve privileged actions.

**P0-AI-01:** The assistant never claims an unexecuted action succeeded. **P0-AI-02:** Cross-user queries and prompt-injection tool attempts fail. **P0-AI-03:** Confirmation binds user, payload and expiry and is consumed once.

## Navigation acceptance

**P0-NAV-01:** Each documented route has unique identity, access policy, shell and loading/empty/error/offline states. **P0-NAV-02:** Each critical CTA resolves to a declared route or API operation with recovery behavior. **P0-NAV-03:** Deep-link refresh, browser history, unknown IDs, denied roles and unknown routes have deterministic outcomes.

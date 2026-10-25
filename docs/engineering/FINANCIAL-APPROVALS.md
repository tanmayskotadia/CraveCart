# Independent financial approval

Discretionary administrative refunds are owned by Restaurant Service. Admin Service forwards authenticated commands; it cannot bypass the owner's threshold, current finance permissions, MFA, capture, version and amount checks. Automatic policy cancellations, duplicate/late capture compensation and their existing refund recovery remain separate workflows.

## Configuration and accounts

`FINANCE_DUAL_APPROVAL_THRESHOLD_MINOR` is the cumulative per-order threshold in integer INR paise. The production-safe default is **0**, requiring independent approval for every discretionary refund. A positive threshold must come from a reviewed finance policy and must be identical across Restaurant Service instances. The authorized/refund-requested amount plus the new amount is compared with the threshold, so smaller sequential requests do not bypass it. Pending proposals reserve no money and change neither the order version nor its authorized refund amount.

The two actions require **different user identities**, not merely two sessions of one administrator. Both need `finance:write` and fresh MFA when performing their action. Provision the additional authorized reviewer through the private administration bootstrap/access procedure; there is no public admin registration or default account. Read-only finance accounts can inspect requests but cannot create or decide them. No new provider API key is needed for approval itself; existing configured refund adapters execute the resulting authorized intent.

## Request and review

1. On an admin order, enter the amount/reason and request refund authorization. Under-threshold amounts retain the existing direct authorization behavior. Amounts meeting the threshold create a persistent `PENDING` approval bound to the captured order version, mode, exact amount, requester and threshold snapshot. The response explicitly distinguishes a pending request from an authorized refund.
2. The independent reviewer opens **Financial approvals** on `/admin/finance`, checks the original reason and amount, verifies their authenticator if required, and approves or rejects with a review reason. The requester cannot review their own request. Requests expire after 15 minutes; expiry is enforced by the owner, not a browser timer.
3. Approval checks that the original requesting session/account still has finance authority and that the captured order version and remaining balance are unchanged. A changed order, expired request or revoked requester requires a fresh request. Rejection authorizes no money and can close a request whose requester is unavailable.
4. Approval atomically creates one refund intent, updates the order and records the review. The approval becomes `AUTHORIZED`; this does **not** mean the payment gateway completed a refund. Existing refund workers, reconciliation and ledger workflows track provider execution separately. Decisions do not invoke providers inside a MongoDB transaction.

Command identities bind the actor, request and decision payload. Retrying the same command returns its stored result; read the approval list/order for current state. Concurrent decisions cannot authorize twice. A second command with changed payload/version conflicts after the first wins. Authorization results remain replayable after the proposal's expiry because no additional intent is created.

## Data, audit and interfaces

`financial_approvals` retains request/review history and does not use a TTL that would erase financial evidence. The requesting session identifier is private and is excluded from response schemas. Public finance records contain the order reference, amount, reasons, status, requester/reviewer identities, expiry and resulting refund intent identity.

- `POST /api/v1/admin/orders/:orderId/refund` returns either direct authorization or a pending approval.
- `GET /api/v1/admin/finance/approvals?page=1` returns at most 20 current-mode records with an explicit total and configured threshold.
- `POST /api/v1/admin/finance/approvals/:approvalId/decision` accepts an expected approval version, approve/reject decision, review reason and idempotency key.

Signed owner commands also enforce Admin caller identity. Request/review audits include both actor references where relevant, amount, threshold/mode, order/approval/refund identities, reasons, before/after values and a canonical request correlation ID. The exact schemas are exported in the commerce contract.

## Verification boundaries

Integration fixtures exercise independent MFA-enabled accounts, self-approval/customer denial, stale MFA, concurrent decisions, replay, expiry, changed orders, revoked requesting authority, rejection and cumulative limits. Browser coverage exercises the default two-person policy through both login sessions, approval UI, persistent outcome, accessibility and a labelled simulated provider refund. Real merchant refund execution, operating policy review and bank settlements remain external or separately tracked requirements. This workflow does not implement Razorpay Route payouts.

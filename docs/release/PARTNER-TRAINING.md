# Partner and operations training

Run these drills against the hosted **sandbox** with synthetic people/orders and the reviewed release. A trainer records the operator/role, build, date, scenario result, incident/reference and remaining issue. Use actual provider sandbox callbacks and physical rider phones for qualification. Never collect passwords, OTPs, recovery codes or private keys in the training record. Each role demonstrates both completion and one recovery case before public orders.

## Restaurant operator

1. Open `/seller/login`, verify the contact, complete onboarding/documents and wait for admin approval. Explain which account owns the restaurant and which team grant is needed for kitchen versus catalog/finance access.
2. Set pickup coordinates, address, city, working hours/holidays and preparation time. Add a menu image, dish/category, integer price, vegetarian/allergen information, stock, required variants/modifier limits and availability. Preview the published customer menu and configure a real cart item. Check that an unpublished or unavailable item cannot be bought.
3. Enable sound after user interaction and identify the visual order/inbox fallback. Accept a real sandbox order, start preparation and mark ready; do not mark pickup before verifying the assigned rider and stage-specific proof.
4. Rehearse declining an order, missing an item, a stale edit and an offline/reload during preparation. Use the existing incident/support flow and the approved cancellation/refund policy. An uncertain outcome is checked against canonical state before another command is sent.
5. Inspect history, verified customer reviews and scoped responses. Invite only existing approved team accounts with the correct role, then demonstrate removal revokes access. Explain that recorded customer charges are not the restaurant's bank payout.

**Pass evidence:** verified onboarding, published configured dish visible to customer, one accepted→ready→verified-pickup order, visual alert with sound blocked, one recovery result and scoped team access. Admin commercial launch approval is a separate reviewed action in the Finance workspace.

## Delivery partner

1. Open `/rider/login`, complete approved onboarding, then use a physical phone with browser geolocation permission. Demonstrate online/offline state and a fresh accepted location before taking an offer.
2. Accept one delivery, read the current stage and destination, open navigation to the restaurant, verify pickup with its code, then navigate to the customer. Work while safely stationary when interacting with the app. Foreground web tracking needs the app open; continuous screen-off tracking is not promised.
3. Complete delivery with the customer's stage-specific code. Demonstrate a wrong code, attempt limit/renewal, rejected stale location and denied geolocation. Sound disabled must leave a visible actionable offer/status.
4. Disconnect/reconnect and reload an active task. Verify the authoritative assignment before repeating an uncertain command. Report an incident for unavailability or food already collected; do not arrange a second assignment outside the dispatch flow.
5. After delivery/cancellation/reassignment, verify customer destination and rider location access are appropriately revoked. Inspect own history and accounting records without interpreting captured customer totals as rider earnings.

**Pass evidence:** physical-device permission/foreground trace, single assignment, stage-correct navigation, wrong/right pickup and delivery proof, stale/offline recovery, terminal privacy and one reported incident. Location fixtures in automated tests do not substitute for this drill.

## Support and dispatcher

1. Sign in through `/admin/login`, enroll MFA, use the assigned limited permission bundle and verify another role's private data cannot be opened by changing an ID.
2. Read an owned/authorized support case, identify order/payment/delivery stage from canonical data, reply, request missing information, escalate with a reason, resolve and verify customer closure. Keep personal data out of general incident logs.
3. Moderate a reported delivery message or review through the protected action and audit. Preserve original evidence; distinguish a support response from a financial adjustment.
4. Handle no-rider backlog, restaurant delay, stale tracking and an uncertain task operation through `/admin/delivery-operations`. Check the existing operation ID/outcome before retrying. Never force a second active assignment or invent an ETA.
5. Rehearse an assistant handoff: customer reviews and consents to the summary, confirms the proposal, and opens the resulting ticket. Explain what information was transferred and verify no complete chat history was silently copied.

**Pass evidence:** limited-role denial, one customer conversation, one escalation/closure, one dispatch recovery, privacy-safe incident record and consented assistant handoff.

## Finance and release operator

1. Verify the exact build via `/health/release` and `/release.json`, read the selected payment mode and confirm the provider account/webhook belongs to the environment. Keep gateway, admin/session and encryption credentials in the hosting settings.
2. Review a real published merchant in `/admin/finance`, supply the reason and explicit confirmation for launch approval, then revoke and verify a stale review fails. Only the authorized finance writer with fresh MFA can change the flag.
3. Rehearse the pricing-policy checkout pause while a sandbox payment is pending: new checkout stops; the original valid callback still resolves; fulfillment/refund services remain available. Resume only after a reviewed current policy and coverage are confirmed.
4. Reconcile captured, late/duplicate, cancelled, partially refunded and failed/uncertain outcomes using the provider record and protected finance tools. Check balanced posting groups and remaining refundable amounts. Do not create a new payment/refund identity to resolve an unknown first attempt, edit balances directly or claim settlement from an accepted API request.
5. Rehearse secret/session revocation, rollback with compatible consumers/contracts, alert acknowledgement/backup escalation and the database/upload/key restore runbook. Complete the pilot/launch evidence records and demonstrate that missing or failed evidence keeps the gate closed.

**Pass evidence:** MFA/grant controls, merchant review/revocation, intake pause/recovery, matched provider/refund/ledger records, acknowledged alert/backup drill and independent recovery evidence. Real charges/refunds need a separately approved live merchant exercise; none are executed by repository verification.

## Training record

| Field | Record |
|---|---|
| Build / environment / payment mode | |
| Trainer / participant / role | |
| Scenario and actual evidence reference | |
| Expected outcome / actual outcome | |
| Failure/recovery demonstrated | |
| Open issue / accountable owner / next review | |
| Trainer acceptance / UTC date | |

Reference the completed records from `rollout-plan.json`. Attendance alone is not a passing drill. Keep contacts, private screenshots and provider data in the protected operating evidence store.

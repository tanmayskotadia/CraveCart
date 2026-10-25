# Incident and recovery runbooks

Use staging for destructive drills. Production actions require the assigned incident commander and existing operating authority. Record UTC start/end, affected service/zone, exact build/configuration, request/correlation IDs, actions and verification. Keep provider credentials, contact details, OTPs, messages and full payloads out of incident logs. Named people and alert destinations must be assigned before pilot approval.

## Gateway or dependency outage

**Trigger:** failed readiness, elevated 5xx, errors or latency beyond the pilot budget. **Impact:** discovery, checkout or workspaces may be unavailable. **Owner:** infrastructure on-call, with the relevant domain owner.

Check gateway and each owner's `/health/live` and `/health/ready`, protected metrics, deployment changes and provider status. A process can be live while dependencies are unavailable. Compare platform errors with provider failures; do not expose dependency URLs. Pause affected city intake through approved service-zone controls if fulfillment cannot be supported. Roll back the specific known-bad build/configuration, retaining persistent disks and databases. Recheck readiness, login, catalog and a sandbox order; reconcile uncertain payments and domain commands before resuming. Support communicates the affected capability and next update time without inventing a restoration estimate.

## Captured payment, missing order, refund mismatch

**Trigger:** finance exception, unmatched capture or old reconciliation job. **Impact:** money may be captured while fulfillment is unresolved. **Owner:** finance incident lead and Restaurant/Utils owners.

Use the protected finance UI and authoritative provider dashboard to match merchant, reference, amount, currency and state. Inspect the existing attempt, webhook inbox, command and reconciliation status using the incident's correlation IDs. A browser success page is not payment evidence. Reconcile the existing operation/reference; never create a replacement payment or refund to test whether the first succeeded. Late/duplicate captures must follow existing compensation paths without resurrecting cancelled orders. Failed/uncertain refunds stay visibly pending/manual-review until provider evidence resolves them. Retain the original ledger and audit; corrections use compensating entries, not direct balance edits. Verify the sum of debits/credits per posting group/currency and refund totals against captures. Statements remain UNRECONCILED until fees, contracts and provider/bank evidence agree. Support sends a verified status, not a promised bank arrival date.

## RabbitMQ loss, poison message or outbox backlog

**Trigger:** owner readiness down, oldest outbox age above 60 seconds, failed outbox record, financial DLQ entry or growing backlog. **Owner:** infrastructure and producing/consuming domain owners.

Check TLS/network reachability, broker disk/memory alarms and queue consumer health through restricted management access. Do not log connection strings. Preserve durable queues, outbox and inbox records. Restore connectivity/capacity, then verify confirmed publishing and consumer acknowledgement. Unknown versions/invalid events go to the owner's dead queue; inspect a redacted classification, fix the producer/consumer mismatch, and replay only the reviewed original event ID with an audit record. Never delete inbox records or generate fresh IDs to force reapplication. The automatic outbox retry budget is bounded; failed records need reviewed recovery rather than silent deletion. Check duplicates have one domain effect and the oldest backlog age returns to normal. Reconcile payment/order/task projections after recovery. Quorum/node-loss qualification remains separate from the single-node Compose test.

## MongoDB and encrypted-file restore drill

**Trigger:** scheduled rehearsal or database/storage loss. **Owner:** infrastructure recovery lead, service owners and finance reviewer. **Targets:** demonstrate RPO ≤15 minutes and RTO ≤60 minutes; these are acceptance targets, not measured results yet.

1. In an isolated staging environment, record a checkpoint containing an order, capture/refund ledger, delivery, support record, encrypted upload and unsent outbox event. Record times, aggregate versions and counts without personal content. Stop source writers, timers and consumers for a consistent comparison; TTL expiry must also be controlled during the exercise.
2. Use the managed database provider's supported snapshot/PITR facility and its documented restore workflow. Record backup checkpoint, restore request and ready times. Restore all six owner databases into a new isolated cluster or mapped namespace prefix `cc_restore_<32 lowercase hex>`. Never restore over the active namespace. Do not connect restored services to live payment/OTP/push endpoints.
3. Restore the private upload disk/object snapshot and the matching encryption keys from the controlled secret backup. Preserve permissions and ownership. A database-only restore cannot prove encrypted documents are recoverable. Do not rotate away the only key needed to read retained ciphertext.
4. Configure `RESTORE_SOURCE_URI`, `RESTORE_TARGET_URI`, `RESTORE_SOURCE_PREFIX` and `RESTORE_TARGET_PREFIX` using secret-managed environment values; reader grants are sufficient. Run `npm run recovery:check`. Remote connections require TLS. The verifier reads every collection in all six databases and compares record counts, BSON content hashes, collection options and index definitions, including TTL/unique settings. Empty owner databases fail. Unsupported collection types fail rather than being silently omitted. It emits owner pass/fail and collection counts, never documents, hashes or credentials. It performs no backup, restore, writes or deletion.
5. Start recovered services with isolated sandbox dependencies. Check role/session boundaries, decrypt/download the test upload, replay a pending outbox event and a commit-before-ack event, then verify one business effect. Clear/rebuild derived Redis caches and have clients resync canonical snapshots; Redis is not financial truth. Match captures, refunds, ledger and active assignments against the checkpoint.
6. Record recovered checkpoint lag as RPO, and incident declaration to usable verified application as RTO. Attach provider evidence, verifier report and browser/finance results. A matching fixture comparison is not a successful disaster-recovery drill. Keep failure evidence; fix and rehearse again before approval.
7. Only after the recovery lead verifies the recovered namespace is disposable may it be removed. Rehearse production cutover/rollback separately using the provider's supported mechanism; this verifier deliberately has no destructive cleanup command.

## Realtime, Redis, GPS and maps

**Trigger:** disconnect spikes, stale GPS, failed Redis readiness or tile/routing quota errors. **Owner:** Realtime/Rider on-call and dispatch operations.

Clients must retain HTTP canonical recovery and show location freshness. Reconnect with a new single-use authorized ticket; do not reuse an old room credential or promise continuous screen-off tracking. A Redis restart must not replace MongoDB order/task truth. Verify revoked/cancelled/reassigned tasks cannot expose a destination or location. Confirm rider permissions, foreground tab/network, accepted sequence/time/accuracy and provider quota. Never fabricate a position, road route or ETA. Give riders the validated external navigation link and dispatch/support escalation when maps fail. On redeploy, exercise resubscription and compare the browser state with authoritative snapshots. Physical Android/iOS and licensed map qualification are required before pilot.

## No rider, restaurant delay or delivery incident

**Trigger:** unassigned-order SLA, preparation delay, rider problem or uncertain assignment. **Owner:** dispatch operations, restaurant support and the relevant domain owner.

Inspect the admin delivery-operations queue, current authoritative order/task and pending command outcome. Retry an existing uncertain operation with its stable ID before issuing another. Use the bounded dispatch retry path; never manually set a second active rider. Contact the involved participants through the approved support channel. Food already picked up must use the incident/recovery procedure rather than pretending it returned to the kitchen. If safe completion is unavailable, use the approved cancellation/refund policy and preserve custody/audit records. Pause the affected zone when operational capacity is exhausted. Verify terminal state stops location/address sharing and finance exceptions are reconciled.

## Document exposure or compromised credentials

**Trigger:** suspicious upload access, secret exposure or account takeover. **Owner:** security incident lead and affected owner on-call.

Restrict the affected capability, preserve access/audit evidence, suspend the compromised account and revoke sessions through the protected governance flow. Review actual scope before making customer statements. Rotate provider/internal/session credentials using hosting secret settings and a coordinated deploy; test new access and rejection of the old credential. Encryption-key changes require migration of retained ciphertext or a reviewed versioned-key plan; replacing the environment key blindly loses data. Re-scan/review exposed uploads and restore least-privilege grants. Required privacy notifications and policy decisions belong to qualified operating reviewers, not this runbook.

## Assistant provider failure or unsafe response

**Trigger:** quota/budget alert, provider error spike, fabricated-response report or tool abuse. **Owner:** assistant operator and support lead.

Disable assistant writes on Utils/Restaurant/Admin and switch the optional provider to `builtin` through a coordinated configuration release. Preserve scoped FAQ/own-order/support access where safe. Inspect redacted classifications and consented support evidence, never raw secrets or entire histories. Reproduce with synthetic input, verify source audience/expiry and domain entitlement, then run routing/provider-failure/action tests. Human review must approve any renewed write enablement; neither evaluation percentages nor a model claim constitutes that approval.

## Privacy request and deployment rollback

**Trigger:** verified export/deletion request or regression after release. **Owner:** privacy operations/domain owners, or release/on-call lead for rollback.

For privacy requests, verify identity and enumerate all six owner stores, private uploads, messages, assistant history, backups and finance retention obligations. Use scoped existing export/delete capabilities; assistant deletion alone does not delete orders/support/legal records. A complete cross-service account deletion workflow is an open pilot gate, so do not claim completion from a single collection deletion.

For rollback, pause rollout/intake for the affected cohort, deploy the last compatible image, preserve database/upload volumes and secrets, and keep additive contracts compatible. Never roll back finance by restoring old balances over new captures. Check readiness, auth, sandbox checkout, dispatch/reconnect, backlog age and ledger/provider reconciliation. Record customer impact, support update and a follow-up owner before closing the incident.

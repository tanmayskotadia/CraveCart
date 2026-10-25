# Pilot readiness

**Decision: not approved for a public/live pilot.** Repository hardening is implemented; hosted and operational acceptance is pending. National discovery remains the product scope. A controlled pilot can enable only reviewed, staffed service zones; a city-directory entry does not establish serviceability.

| Gate | Current evidence | Evidence still needed / accountable role |
|---|---|---|
| Repository automation | Reproducible `verify:release` runner, source fingerprint, per-check logs and browser attachments | Passing report for the chosen release build; engineering/QA |
| Scope/navigation | Typed routes/contracts, national UI and persisted four-role journey | Audit every release-enabled P0/P1 route and failure action; product/QA |
| Security | Ownership/MFA/replay/payment/privacy regression tests, drain and cache fixes, threat review | Independent review, hosted proxy/client-IP/header validation, real scanner/image and secret rotation; security/infrastructure |
| Providers | Razorpay/Stripe signed-event fixtures; real adapter code | Hosted merchant sandbox, OTP, upload, push and licensed maps checks; controlled live merchant qualification only when approved; operations/finance |
| Capacity | Finite read-only gateway probe and evidence tooling | PRD browsing/checkout/tracking load, device CWV, resource sizing and cost measurements; infrastructure |
| Resilience | Real-Mongo races, gateway/SSE cancellation, consumer-drain regression; real broker tests prepared in CI | Actual RabbitMQ/Redis job, dependency/node loss, reconnect/backlog drain; infrastructure/backend |
| Recovery | Read-only six-owner restore comparator; real-Mongo comparator fixtures; database/object/key drill procedure | Actual managed backup/PITR restore and upload decryption with measured RPO/RTO; infrastructure |
| Finance | Balanced ledger/refund/capture invariants and protected reconciliation UI | Merchant/bank settlement comparison, fee/commission/compensation contracts and reviewed exceptions; finance |
| Accessibility | Automated WCAG A/AA checks over public pages and representative four-role screens | Manual screen-reader/keyboard/zoom/target-size audit and real phones; design/QA |
| Tracking | Foreground GPS validation and authenticated socket/browser tests | Physical Android/iOS, permission/network loss and deployed reconnect; product/QA |
| Privacy | Private uploads, scoped messaging and encrypted assistant history/deletion | Approved notices, retention, cross-service export/deletion and backup procedure; privacy operations |
| Operations | Incident runbooks and evidence template | Named on-call, working alert destinations, seller/rider training, support coverage and rehearsals; operations |
| Deployment | Vercel/Render configuration and preflight tools | Real staging deployment, private TLS dependencies, disk/scanner and rollback rehearsal; release owner |

Run `npm run verify:release` for repository evidence. For the actual release decision, set `RELEASE_REPORT` to its report path, complete [the sign-off record](pilot-signoff.json) with the exact `sourceSha256`, named release owner, UTC review time, and evidence/owner for each gate, then run `npm run release:gate`. It intentionally fails against the untouched template. Do not replace pending gates with placeholder approvals. The checker verifies completeness, source linkage and review freshness; an authorized reviewer still evaluates the evidence itself.

Assistant writes remain off by default until the documented human review. Statements remain UNRECONCILED and cannot imply bank payouts. Native background tracking, production HA and independent security/policy approval have not been demonstrated. No provider keys are needed for the new automated hardening checks; actual hosted qualification needs the existing hosting/provider settings in [the hosting guide](../engineering/HOSTING.md), configured through the dashboards.

See [hardening implementation](../engineering/HARDENING.md), [runbooks](../engineering/INCIDENT-RUNBOOKS.md), [verification evidence](../engineering/VERIFICATION.md) and [quality checklist](../QUALITY-AND-LAUNCH.md).

Launch handoff tooling and partner/operations training are now implemented: see [the launch handbook](LAUNCH-HANDBOOK.md) and [training drills](PARTNER-TRAINING.md). The owner will handle hosting. New merchant approval, intake-pause acceptance, deployment build identities, strict hosted preflight and the staged launch gate provide application and operational preparation; they do not fill pending external evidence or name real staff automatically.

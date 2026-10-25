# Role operations

CraveCart now provides server-backed support, order conversations, verified reviews, scoped restaurant teams, administrative permission bundles and reporting. These extend the existing six owners; no additional service or model-provider credential is required.

## Customer and delivery conversations

- `/support` lists the signed-in requester’s tickets and creates a ticket. An optional order link is authorized against the order owner before creation. `/support/tickets/:ticketId` shows a private, paginated conversation.
- `/admin/support` and `/admin/support/:ticketId` require `support:read`. Replies require `support:write`; administrative resolution requires a freshly verified authenticator and a reason.
- Ticket states are OPEN, AWAITING_CUSTOMER, ESCALATED, RESOLVED and CLOSED. Authorized operators can escalate with fresh MFA and a visible reason. Requester replies reopen resolved tickets; closed tickets accept no further messages. Requesters can close their own ticket. A resolution records a visible reason; it does not initiate refunds, cancel an order or complete delivery.
- Messages and state changes use idempotency plus expected versions. Concurrent or stale replies return a reload instruction. Lists use 25-record pages and conversations use 50-message pages. Initial ticket creation is limited to ten requests per requester per hour; support replies to sixty per hour.
- `/orders/:orderId/messages` is restricted to the order customer and currently assigned rider. During an active assigned delivery either can send up to thirty messages per minute. After completion, existing history remains available to those entitled parties; new messages are denied. Every fetch and send checks the current session and the Restaurant authority. Seller communications use support.
- Order messages recover through four-second polling and durable ordered history. They do not claim the planned Socket.IO chat event protocol is implemented. The existing delivery-status Socket.IO protocol is unchanged.
- Message reports go to the administrative review screen. An authorized operator can remove a reported message from the participant view or retain it and resolve the report. The original stays in the protected owner store with a moderation audit. No message attachments, anonymous rooms or unscanned document sharing are enabled.

Message text is rendered as text, never HTML. Do not share payment credentials, passwords, contacts or verification codes through these conversations. Storage retention and deletion schedules need operator approval before a live release; this implementation does not claim a configured cross-service privacy-deletion workflow or an SLA guarantee.

## Verified feedback

Customers can submit one rating and review through `/orders/:orderId/review` after authoritative delivery. The unique order index, ownership check, idempotency and transaction prevent duplicate or foreign reviews. Reviews cannot be purchased by creating an unpaid order.

Published restaurant pages show paginated visible reviews. Public search ratings and rating filters derive from visible verified reviews in the current commerce environment; no invented rating is stored. Hidden reviews are excluded from public aggregates. Review text has no customer contact or account identifier in the public response.

Managers and owners can respond through `/seller/restaurants/:restaurantId/reviews`. They cannot rewrite customer feedback. Signed-in readers can report a review. `/admin/reviews` exposes review reports and reported order messages to support operators. Hide/restore actions require fresh MFA, a reason and current version, with owner-local audit records.

## Restaurant and administrative teams

Restaurant owners manage `/seller/restaurants/:restaurantId/staff`. Current team invitations target **existing active approved seller accounts**; inviting an ordinary customer does not bypass partner verification. Maximum fifty team records per restaurant.

- Kitchen members can read and act on that restaurant’s orders and read its history.
- Managers can also maintain the catalog and respond to reviews/view analytics.
- Only the owner can manage team membership or read restaurant financial records.
- Grants are restaurant-scoped. Changing an ID cannot extend them to another business. Revocation takes effect on the next request. The listing identifies owner/manager/kitchen access so restricted tools are omitted from workspace cards.

`/admin/team` manages existing verified accounts through limited support, analyst, read-only finance, auditor and operations bundles. The server allowlist defines the actual grants. These bundles cannot grant governance, financial execution or arbitrary permissions. Changes require `staff:write`, fresh MFA, expected version and an audit reason, and revoke the target’s existing sessions. New team members must authenticate and enroll/verify their own authenticator for administrative access.

Bootstrap governance accounts cannot be changed or suspended through ordinary administrative screens. Self-grant changes are denied. Existing installations need their operator permissions refreshed using the managed `admin:bootstrap` procedure; no default account or public administrator registration is introduced.

## Reporting and financial scope

Routes:

- Seller `/seller/restaurants/:restaurantId/history`, `/analytics` and `/finance`.
- Rider `/rider/history` and `/rider/earnings`.
- Admin `/admin/reports`, `/admin/promotions`, `/admin/audit`; existing operating-zone and finance-policy tools remain available.

Reports accept explicit India calendar dates, an inclusive date range of at most 93 days, a generation timestamp and commerce environment. Aggregations cover the entire selected order-created-date cohort; row tables are paginated separately. Impossible/reversed dates and oversized ranges are rejected.

Order counts are grouped by current authoritative status. Values include all checkout components; they are not net platform revenue. Popular dish quantities include delivered orders only. Current captured and refunded figures come from verified financial state in the order authority. This is a current-state cohort report, not a historical event-time accounting balance.

Restaurant statements show gross order values, verified captures and refunds, and delivered-order tip amounts. Rider statements expose only their own assignment-related delivered tip records, with customer capture/refund figures suppressed. The download button labels its CSV as the **current page**, not the complete period.

**Commission, contractual rider base earnings, refund allocation of tips and bank settlement are not configured.** Payable and commission fields remain null and settlement status is UNRECONCILED. Customer delivery charges are never presented as rider earnings. These are accounting records, not proof of a bank transfer. Approved party agreements, versioned compensation snapshots, settlement-provider integration and reconciliation are required before payable balances or paid statements can be advertised.

Admin reports can be downloaded as an aggregate JSON snapshot with permission, fresh MFA, reason and a committed export audit. The download has no customer addresses, contacts or individual payment references. Replaying the command returns the same export identity and snapshot.

Promotion oversight operates on real restaurant-funded offers. Authorized operators can pause/re-enable an existing offer with expected version, fresh MFA and reason. The offer version invalidates stale checkout use. This does not create an unconfigured platform-funded campaign budget.

`/admin/audit` merges bounded pages of Admin, Restaurant and Auth owner journals. Each owner commits its own relevant action with the data change where transactional. Audit entries are append-only through application APIs, not a claim of externally tamper-proof archival storage. Delivery-message moderation remains recorded in the Realtime owner journal.

## Verification and deployment

`npm run test:fulfillment` now includes role-operation workflows and exported response checks alongside the delivery, concurrency, code and socket cases. `npm run test:delivery:browser` builds an isolated production React bundle with that run’s test service origins, then runs customer–rider messaging, delivery, customer review, restaurant response, support handoff, financial records and admin reports on desktop/mobile against temporary services. The production preview avoids development hot-reload interference. `npm test` includes reporting-day boundary tests.

Production uses the existing [Vercel/Render configuration](HOSTING.md) and managed MongoDB databases. Deploy all owners and the frontend together after contract checks. No credentials are added to the browser bundle. Hosted provider execution, retention/deletion policy, operational staffing, compensation/settlement policy, backup/restore, load and real-device qualification remain launch gates. The assistant is the next roadmap milestone and is not enabled by this change.


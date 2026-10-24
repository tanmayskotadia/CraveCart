# CraveCart routes and contracts

This is the implementation inventory, not a claim that routes already exist. Phase 0 now provides a checked [machine-readable baseline](../contracts/README.md), including OpenAPI, a page/action manifest and event schemas. Inventory-only HTTP operations must be refined before implementation or client generation.

## 1. Routing conventions

- React Router handles the SPA; Vercel rewrites application paths to its entry document while preserving static assets. Preview, staging and production must all pass deep-link tests.
- API base: `/api/v1`. Public API traffic passes through the gateway; `/socket.io` reaches Realtime Service. Gateway prefix routing must be explicit.
- `:id` means an opaque validated identifier, never authorization. Slugs are display/discovery identifiers. Lists use cursor pagination and bounded page size.
- Protected routes require a valid session and server policies. Guest login redirects use allowlisted local `returnTo` paths only.
- Common protected routes `/notifications`, `/settings`, `/settings/sessions`, `/settings/privacy`, `/support`, `/support/tickets/:ticketId`, `/assistant` render inside the active role shell.
- Redirect `/driver/*` to documented `/rider/*` equivalents, preserve safe IDs, and never maintain two competing route trees.
- Seller and rider unverified accounts can access onboarding/settings/support but cannot access operational actions.

## 2. Frontend pages

### Public and authentication

| Route | Access | Purpose and primary actions |
|---|---|---|
| `/` | Public | Location selector, search, nearby discovery; restaurant card → detail |
| `/location` | Public | GPS/manual address and map pin → serviceability → safe return |
| `/search` | Public | Query/filter/sort in URL; dish result → restaurant and dish anchor |
| `/restaurants/:slug` | Public | Restaurant/menu/reviews; configure dish → cart |
| `/offers` | Public | Offer terms; browse eligible restaurants |
| `/help` | Public | Approved FAQs and support entry |
| `/legal/terms` | Public | Versioned terms |
| `/legal/privacy` | Public | Privacy notice |
| `/legal/cancellations` | Public | Cancellation/refund policy |
| `/login` | Guest | Customer sign-in; seller/rider entry links |
| `/signup` | Guest | Customer registration and verified contact |
| `/verify` | Pending auth challenge | OTP verify/resend; no OTP in URL |
| `/forgot-password` | Guest, if passwords enabled | Non-enumerating recovery request |
| `/reset-password` | Valid recovery flow | Reset then session review/login |
| `/workspaces` | Authenticated | Select only granted roles |
| `/seller/login` | Guest | Seller sign-in → seller workspace or onboarding |
| `/seller/register` | Applicant | Seller application start |
| `/rider/login` | Guest | Rider sign-in |
| `/rider/register` | Applicant | Rider application start |
| `/admin/login` | Admin identity | Sign-in and MFA; no self-service admin signup |
| `/403` | Any | Explain denied access; allowed workspace link |
| `*` | Any | 404 with home/search/back links |

### Customer workspace

| Route | Purpose and actions |
|---|---|
| `/cart` | Guest cart or authenticated own cart; edit/remove/configure lines, replace restaurant, apply coupon → checkout |
| `/checkout` | Address, verified quote, tip/method, policy acknowledgement → payment initiation |
| `/checkout/return` | Provider return; inspect backend payment state → order or recoverable pending view |
| `/orders` | Own paginated order history; view/reorder |
| `/orders/:orderId` | Detail/timeline; cancellation/refund request, receipt, support |
| `/orders/:orderId/track` | Live map, freshness, rider message, support |
| `/orders/:orderId/review` | Delivered-order rating/text form |
| `/orders/:orderId/messages` | Authorized order conversation |
| `/favorites` | Saved restaurants → menu |
| `/profile` | Name/contact/preferences; sensitive changes require reauthentication |
| `/addresses` | Add/edit/delete/default; list with empty state |
| `/addresses/new` | Manual/map address → validate and save |
| `/addresses/:addressId/edit` | Edit owned address; placed-order snapshot unaffected |

### Seller workspace

Seller operational pages use `restaurantId` explicitly; `/seller` redirects to onboarding, restaurant selector or selected dashboard.

| Route | Purpose and actions |
|---|---|
| `/seller/onboarding` | Application/document submission and review status |
| `/seller/restaurants` | Owned restaurant selector; add approved branch flow |
| `/seller/restaurants/:restaurantId/dashboard` | Active summary, pause/resume, alerts |
| `/seller/restaurants/:restaurantId/orders` | Incoming/active/history tabs; status filters |
| `/seller/restaurants/:restaurantId/orders/:orderId` | Accept/reject/prepare/ready/pickup verification and issue report |
| `/seller/restaurants/:restaurantId/menu` | Category/dish list; availability controls |
| `/seller/restaurants/:restaurantId/menu/new` | Create dish/variants/modifiers |
| `/seller/restaurants/:restaurantId/menu/:itemId/edit` | Edit owned dish |
| `/seller/restaurants/:restaurantId/profile` | Restaurant information and media |
| `/seller/restaurants/:restaurantId/hours` | Weekly hours, holiday closures |
| `/seller/restaurants/:restaurantId/staff` | Invite/revoke members and grants |
| `/seller/restaurants/:restaurantId/analytics` | Sales/fulfillment/quality filters |
| `/seller/restaurants/:restaurantId/finance` | Commission, refunds, settlement statements |
| `/seller/restaurants/:restaurantId/reviews` | Read reviews, report abuse, permitted response |

### Rider workspace

| Route | Purpose and actions |
|---|---|
| `/rider` | Redirect to application or dashboard |
| `/rider/onboarding` | Identity, vehicle, documents, review status |
| `/rider/dashboard` | Availability, permission health, current delivery |
| `/rider/offers` | Expiring offers; accept/decline |
| `/rider/deliveries/:deliveryId` | Authoritative delivery steps, OTP, incidents |
| `/rider/deliveries/:deliveryId/navigate` | Pickup/drop map and external navigation launch |
| `/rider/history` | Completed/failed delivery history |
| `/rider/earnings` | Earnings breakdown and payout statements |
| `/rider/profile` | Rider contact/vehicle settings; reverify material changes |

### Admin workspace

| Route | Purpose and required grant |
|---|---|
| `/admin` | Dashboard redirect |
| `/admin/dashboard` | Operations and business summary; dashboard-read |
| `/admin/verifications` | Seller/rider queue; verification-read |
| `/admin/verifications/:applicationId` | Protected documents, approve/reject/request changes; verification-write |
| `/admin/users` | Search/status/roles; user-management |
| `/admin/users/:userId` | Scoped profile, suspension, role review; user-management |
| `/admin/restaurants` | Marketplace restaurant management |
| `/admin/restaurants/:restaurantId` | Status, verification, configuration and incidents |
| `/admin/riders` | Availability, verification and incident filters |
| `/admin/riders/:riderId` | Scoped operational history and status |
| `/admin/orders` | Live board, delays, exceptions |
| `/admin/orders/:orderId` | Timeline, assignment, escalation and policy-approved intervention |
| `/admin/support` | Ticket queue and SLA filters |
| `/admin/support/:ticketId` | Agent messages, assignment and resolution |
| `/admin/refunds` | Requests, approvals, execution failures; finance grants |
| `/admin/refunds/:refundId` | Evidence, separate approval/execution audit |
| `/admin/settlements` | Statements and payout reconciliation |
| `/admin/promotions` | Versioned coupons/campaigns |
| `/admin/zones` | Service polygons and operating settings |
| `/admin/reports` | Defined metrics and audited exports |
| `/admin/settings` | Fee/policy/feature configuration; configuration-write |
| `/admin/team` | Privileged grant administration; super-admin |
| `/admin/audit` | Immutable administrative history; audit-read |
| `/admin/assistant` | FAQ versions, evaluation results and tool flags |

## 3. Critical button contracts

Every additional action must be registered with the same fields in the implementation route/action manifest.

| Action | Command or destination | Success | Failure/recovery |
|---|---|---|---|
| Use my location | Browser permission → serviceability API | Set selected location | Manual entry; explain denied/unavailable |
| Add dish | Variant validation → cart-line command | Updated badge/cart | Preserve choices; explain unavailable option |
| Replace cart | Confirm → atomic replace command | New restaurant cart | Old cart preserved if operation fails |
| Apply offer | Coupon code → quote | Display validated discount | Inline reason; retain cart |
| Place and pay | Idempotent order + payment attempt | Hosted checkout | Retriable pending state; never silently retry a charge |
| Payment return | Backend payment/order lookup | Order details | Processing screen with bounded polling and support |
| Cancel order | Policy preview → explicit confirmation → command | Cancelled or request submitted | Explain conflict/current stage |
| Track order | `/orders/:id/track` | Current snapshot + authorized room | Snapshot/polling with stale status |
| Reorder | Current catalog validation → proposed cart | Review changed lines | Identify missing dishes; no implicit payment |
| Seller accept | Expected-version command | Confirmed order state | Refetch on conflict; no optimistic irreversible state |
| Seller reject | Reason + confirmation | Rejected and refund pending | Current state and support escalation |
| Mark ready | Expected-version command | Ready state | Explain prerequisites |
| Rider online | Approval/permission/health check → command | Dispatch eligible | Explicit unmet requirement |
| Accept delivery | Offer ID + version/idempotency | Assigned delivery | Expired/already claimed feedback |
| Navigate | Authorized task coordinate → provider link/map | Correct pickup/drop destination | Address fallback; never redirect to an invented location |
| Confirm pickup/delivery | OTP/proof + expected version | Persisted transition | Rate-limited validation; incident path |
| Refund approval | MFA/reason/approval rules → command | Approved/submitted state | No false success; finance exception |
| Chatbot action | Server proposal → user confirms token | Structured result and real link | No mutation; explain expiry/error |
| Logout | Revoke session → local cache clear | Appropriate login page | Clear sensitive UI; retry revocation safely |

## 4. API conventions

- Validate requests with shared Zod schemas; publish OpenAPI 3.1 for HTTP and versioned JSON schemas for broker/socket messages.
- Success envelope: `{ data, meta?: { nextCursor, requestId } }`. Error: `{ error: { code, message, fields?, requestId, retryable } }`. Never return stack traces or sensitive provider bodies.
- HTTP codes: 400 malformed, 401 unauthenticated, 403 unauthorized, 404 absent or concealed resource, 409 conflict/version/idempotency mismatch, 410 expired offer/quote, 422 business validation, 429 rate limited, 503 dependency unavailable.
- Money/order/dispatch commands require `Idempotency-Key`. Scope by user + operation; persist request hash/result. Same key with changed payload returns 409. Use durable business unique keys as well, so expiry cannot cause a duplicate financial effect.
- State changes accept `expectedVersion`; enforce compare-and-set. Never trust a client-supplied role, price, distance, ETA, fee, commission, or assigned rider.
- Cookie-authenticated mutations require CSRF defense and strict Origin checks. Signed webhooks are exempt from session CSRF and use provider verification.
- Gateway routing is deployment configuration, not a second business implementation. Owner services enforce all policy even if gateway checks exist.

## 5. HTTP API inventory

Each path below is relative to `/api/v1`; when a row lists multiple methods, each method is an individual endpoint to implement/document. `Own` always includes object ownership verification.

### Auth Service

| Method | Path | Access/purpose |
|---|---|---|
| POST | `/auth/register` | Public customer/applicant registration; rate limited |
| POST | `/auth/login` | Public contact/password login; no client-selected grants |
| POST | `/auth/otp/request` | Public, anti-abuse challenge |
| POST | `/auth/otp/verify` | Challenge-bound verification |
| POST | `/auth/refresh` | Rotating refresh session; reuse detection |
| POST | `/auth/logout` | Current session revocation |
| POST | `/auth/recovery/request` | Non-enumerating recovery |
| POST | `/auth/recovery/reset` | Single-use recovery token |
| POST | `/auth/mfa/enroll`, `/auth/mfa/verify` | Authenticated enrollment/step-up; challenge-bound |
| GET | `/auth/me` | Identity, current roles and profile |
| PATCH | `/auth/me` | Own profile; verified workflow for contact changes |
| POST | `/auth/contact-changes` | Request new verified contact; step-up |
| POST | `/auth/contact-changes/:challengeId/confirm` | Complete verified contact change |
| GET | `/auth/sessions` | Own sessions |
| DELETE | `/auth/sessions/:sessionId` | Revoke owned session |
| POST | `/auth/sessions/revoke-all` | Revoke all with reauthentication |
| POST | `/auth/workspace` | Select granted active role |
| GET, POST | `/auth/privacy-requests` | Own data export/deletion requests |

### Restaurant Service: catalog and customer domain

| Method | Path | Access/purpose |
|---|---|---|
| GET | `/serviceability` | Public bounded location query |
| GET | `/restaurants` | Public location/search/filter/cursor |
| GET | `/restaurants/:restaurantId` | Public profile |
| GET | `/restaurants/by-slug/:slug` | Public stable lookup |
| GET | `/restaurants/:restaurantId/menu` | Public published menu |
| GET | `/restaurants/:restaurantId/reviews` | Public moderated reviews |
| GET | `/search` | Public dishes/restaurants; safe query limits |
| GET | `/offers` | Public eligible promotion terms |
| GET, POST | `/addresses` | Customer own list/create |
| PATCH, DELETE | `/addresses/:addressId` | Customer own update/delete |
| GET | `/favorites` | Customer own list |
| PUT, DELETE | `/favorites/:restaurantId` | Customer own save/remove |
| GET | `/cart` | Customer own persistent cart |
| POST | `/cart/lines` | Customer add line |
| PATCH, DELETE | `/cart/lines/:lineId` | Customer own line |
| POST | `/cart/replace` | Customer explicit restaurant replacement |
| DELETE | `/cart` | Customer explicit clear |
| POST | `/cart/quote` | Authoritative pricing and validation |
| POST | `/orders` | Customer quote → payment-pending order; idempotent |
| GET | `/orders` | Customer own paginated history |
| GET | `/orders/:orderId` | Customer own details |
| GET | `/orders/:orderId/tracking` | Own authorized snapshot; redacted by phase |
| POST | `/orders/:orderId/cancellation-preview` | Own policy/amount evaluation |
| POST | `/orders/:orderId/cancel` | Own permitted cancellation; expected version |
| POST | `/orders/:orderId/reorder` | Own order → proposed current cart |
| GET | `/orders/:orderId/receipt` | Own sanitized receipt/download |
| POST | `/orders/:orderId/reviews` | Own delivered order; unique per order |
| PATCH | `/reviews/:reviewId` | Own review within edit policy |
| POST | `/reviews/:reviewId/reports` | Authenticated abuse report |

### Restaurant Service: seller domain

| Method | Path | Access/purpose |
|---|---|---|
| GET, POST | `/seller/applications` | Own applications/status/submission |
| PATCH | `/seller/applications/:applicationId` | Own draft or requested changes |
| GET, POST | `/seller/restaurants` | Owned restaurants/branch application |
| GET, PATCH | `/seller/restaurants/:restaurantId` | Membership-scoped profile |
| PUT | `/seller/restaurants/:restaurantId/hours` | Owner/configuration grant |
| POST | `/seller/restaurants/:restaurantId/availability` | Authorized pause/resume |
| GET, POST | `/seller/restaurants/:restaurantId/categories` | Menu-read/write grants |
| PATCH, DELETE | `/seller/restaurants/:restaurantId/categories/:categoryId` | Owned category, safe references |
| GET, POST | `/seller/restaurants/:restaurantId/menu-items` | Menu-read/write grants |
| PATCH, DELETE | `/seller/restaurants/:restaurantId/menu-items/:itemId` | Versioned owned menu item |
| POST | `/seller/restaurants/:restaurantId/menu-items/:itemId/availability` | Stock/sold-out command |
| GET | `/seller/restaurants/:restaurantId/orders` | Assigned restaurant orders |
| GET | `/seller/restaurants/:restaurantId/orders/:orderId` | Matching restaurant/order |
| POST | `/seller/restaurants/:restaurantId/orders/:orderId/actions` | Allowlisted accept/reject/preparing/ready; expected version |
| GET, POST | `/seller/restaurants/:restaurantId/staff` | Owner/staff-management grant |
| PATCH, DELETE | `/seller/restaurants/:restaurantId/staff/:membershipId` | Role ceiling; no privilege escalation |
| GET | `/seller/restaurants/:restaurantId/analytics` | Scoped metrics |
| GET | `/seller/restaurants/:restaurantId/finance` | Finance grant; Utils financial projection |
| POST | `/seller/restaurants/:restaurantId/reviews/:reviewId/reply` | Scoped moderation policy |

### Rider Service

| Method | Path | Access/purpose |
|---|---|---|
| GET, POST | `/rider/application` | Own onboarding/status |
| PATCH | `/rider/application` | Own permitted changes |
| GET, PATCH | `/rider/profile` | Own profile; verification impact enforced |
| POST | `/rider/availability` | Approved rider, active-task constraints |
| GET | `/rider/offers` | Own unexpired offers |
| POST | `/rider/offers/:offerId/accept` | Atomic exclusive assignment |
| POST | `/rider/offers/:offerId/decline` | Own offer |
| GET | `/rider/deliveries` | Own delivery history/current task |
| GET | `/rider/deliveries/:deliveryId` | Assigned rider only |
| POST | `/rider/deliveries/:deliveryId/arrive` | Valid assignment and phase |
| POST | `/rider/deliveries/:deliveryId/pickup` | Pickup verification; idempotent workflow |
| POST | `/rider/deliveries/:deliveryId/complete` | OTP/proof; order module acknowledges completion |
| POST | `/rider/deliveries/:deliveryId/incidents` | Assigned task incident |
| POST | `/rider/location` | Rate-limited authenticated HTTP fallback |
| GET | `/rider/earnings` | Own financial projection |

### Utils Service: payments, uploads, communications, support, assistant

| Method | Path | Access/purpose |
|---|---|---|
| GET | `/payment-methods` | Market/currency/account capability rules |
| POST | `/payments/attempts` | Customer-owned payment-pending order; idempotent |
| GET | `/payments/attempts/:attemptId` | Owner payment status |
| POST | `/payments/attempts/:attemptId/verify` | Verify provider return proof; not browser assertion |
| POST | `/webhooks/razorpay` | Raw-body signature validation; no session required |
| POST | `/webhooks/stripe` | Raw-body signature/timestamp verification |
| GET | `/refunds/:refundId` | Customer owning order or authorized finance role |
| GET | `/statements` | Own seller/rider statements; scoped filters |
| GET | `/statements/:statementId/download` | Short-lived authorized export |
| POST | `/uploads/intents` | Purpose/type/size-scoped presigned upload |
| POST | `/uploads/:uploadId/complete` | Verify object; quarantine/scan before use |
| GET | `/uploads/:uploadId/access` | Authorized short-lived read URL |
| GET | `/notifications` | Own persisted notifications |
| PATCH | `/notifications/:notificationId` | Own read state |
| GET, PUT | `/notification-preferences` | Own sound/push/email preferences |
| POST, DELETE | `/push-subscriptions` | Own device registration/revocation |
| GET | `/support/faqs` | Approved public FAQ content |
| GET, POST | `/support/tickets` | Own tickets/create with order ownership |
| GET | `/support/tickets/:ticketId` | Owner or assigned support grant |
| POST | `/support/tickets/:ticketId/messages` | Authorized participant; optional scanned attachments |
| POST | `/assistant/conversations` | Guest FAQ or authenticated scoped context |
| GET | `/assistant/conversations/:conversationId` | Owner or guest session token |
| POST | `/assistant/conversations/:conversationId/messages` | Rate-limited; SSE response stream supported |
| POST | `/assistant/actions/:actionId/confirm` | Bound single-use confirmation token |
| POST | `/assistant/conversations/:conversationId/handoff` | Authenticated, consented ticket creation |

### Realtime Service

| Method | Path | Access/purpose |
|---|---|---|
| POST | `/realtime/tickets` | Authenticated short-lived one-use socket handshake ticket |
| GET | `/conversations?orderId=:id` | Authorized order conversation lookup |
| GET | `/conversations/:conversationId/messages` | Authorized cursor history |
| POST | `/conversations/:conversationId/messages` | Authenticated participant; durable/idempotent message |
| POST | `/conversations/:conversationId/reports` | Participant abuse report |

### Admin Service

Admin endpoints are control-plane commands. They call authenticated internal owner-service commands or publish durable requested-action workflows; Admin Service never writes another service's collections directly. Return `202 + operationId` for asynchronous operations and expose status.

| Method | Path | Required grant/purpose |
|---|---|---|
| GET | `/admin/dashboard` | Dashboard-read |
| GET | `/admin/verifications` | Verification-read |
| GET | `/admin/verifications/:applicationId` | Verification-read, protected documents |
| POST | `/admin/verifications/:applicationId/decision` | Verification-write; reason/version |
| GET | `/admin/users`, `/admin/users/:userId` | User-read |
| POST | `/admin/users/:userId/status` | User-write; suspension reason |
| GET | `/admin/restaurants`, `/admin/restaurants/:restaurantId` | Restaurant-read |
| POST | `/admin/restaurants/:restaurantId/status` | Restaurant-write |
| GET | `/admin/riders`, `/admin/riders/:riderId` | Rider-read |
| POST | `/admin/riders/:riderId/status` | Rider-write |
| GET | `/admin/orders`, `/admin/orders/:orderId` | Operations-read |
| POST | `/admin/orders/:orderId/assignment` | Dispatch-write; eligibility/conflict validation |
| POST | `/admin/orders/:orderId/interventions` | Policy-scoped cancellation/incident commands |
| GET | `/admin/support/tickets` | Support-read |
| PATCH | `/admin/support/tickets/:ticketId` | Support-write assignment/status |
| POST | `/admin/support/tickets/:ticketId/messages` | Support-write |
| GET | `/admin/refunds`, `/admin/refunds/:refundId` | Finance-read |
| POST | `/admin/refunds` | Refund-request with evidence and amount bounds |
| POST | `/admin/refunds/:refundId/approve` | Finance-approve, two-person threshold rule |
| POST | `/admin/refunds/:refundId/execute` | Finance-execute, idempotent |
| GET | `/admin/settlements` | Finance-read |
| POST | `/admin/settlements/:settlementId/reconcile` | Finance-write; provider evidence |
| GET, POST | `/admin/promotions` | Promotion-read/write |
| PATCH | `/admin/promotions/:promotionId` | Promotion-write; version |
| GET, POST | `/admin/zones` | Zone-read/write |
| PATCH | `/admin/zones/:zoneId` | Zone-write |
| GET | `/admin/reports` | Report-read, bounded queries |
| POST | `/admin/exports` | Export grant, audited asynchronous job |
| GET, PATCH | `/admin/settings` | Configuration grants; versioned values |
| GET, POST | `/admin/team` | Super-admin, step-up |
| PATCH, DELETE | `/admin/team/:membershipId` | Super-admin, no sole-owner lockout |
| GET | `/admin/audit` | Audit-read |
| GET, POST | `/admin/assistant/content` | Assistant-content grants |
| PATCH | `/admin/assistant/content/:contentId` | Version/publish controls |
| GET | `/admin/assistant/evaluations` | Assistant management |
| GET | `/admin/operations/:operationId` | Authorized async operation status |

All services expose `/health/live`, `/health/ready` and a protected metrics endpoint outside the user API. Readiness checks required dependencies with deadlines and avoids cascading load. Internal `/internal/v1/*` contracts cover identity revocation, domain verification decisions, catalog reservations, payment outcomes, dispatch validation, fulfillment transitions, configuration distribution, support commands and scoped read projections. Each must carry service identity, caller context, deadline, correlation ID and an idempotency key for mutations.

## 6. RabbitMQ contracts

Topic exchange: `cravecart.domain.v1`. Each consuming service owns its durable queue and bindings. Location telemetry uses a separate bounded/ephemeral fanout path; it must not fill financial/order queues.

```json
{
  "eventId": "uuid",
  "eventType": "order.placed.v1",
  "schemaVersion": 1,
  "occurredAt": "UTC ISO-8601 timestamp",
  "producer": "restaurant-service",
  "aggregate": { "type": "order", "id": "opaque-id", "version": 3 },
  "correlationId": "request-or-workflow-id",
  "causationId": "command-or-event-id",
  "data": { "orderId": "opaque-id", "restaurantId": "opaque-id" }
}
```

| Events | Producer | Primary consumers/effects |
|---|---|---|
| `identity.roles-changed.v1`, `identity.suspended.v1` | Auth | All policy caches/revocation; Realtime disconnects |
| `seller.application-submitted.v1`, `rider.application-submitted.v1` | Restaurant/Rider | Admin verification projection |
| `verification.decided.v1` | Admin | Owner applies decision idempotently; emits applied/failed outcome |
| `verification.applied.v1`, `verification.failed.v1` | Restaurant/Rider | Admin records owner-applied verification outcome or actionable failure |
| `restaurant.availability-changed.v1`, `menu.updated.v1` | Restaurant | Cache/search projection invalidation |
| `order.payment-pending.v1` | Restaurant | Metrics/recovery projections |
| `payment.captured.v1`, `payment.failed.v1` | Utils | Restaurant applies verified payment outcome |
| `order.placed.v1` | Restaurant | Seller notification, realtime, admin projection |
| `order.accepted.v1`, `order.preparing.v1`, `order.ready.v1` | Restaurant | Rider dispatch, realtime, customer notification |
| `delivery.assigned.v1`, `delivery.arrived.v1` | Rider | Order assignment projection, realtime, notifications |
| `delivery.pickup-requested.v1`, `delivery.completion-requested.v1` | Rider | Restaurant validates phase/version and pickup/completion prerequisites |
| `delivery.operation-rejected.v1` | Restaurant | Rider resolves pending pickup/completion as rejected without inventing success |
| `order.picked-up.v1`, `order.out-for-delivery.v1`, `order.delivered.v1` | Restaurant | Rider confirms task state, Utils ledger, realtime, reports |
| `order.cancelled.v1`, `order.rejected.v1`, `order.expired.v1` | Restaurant | Release reservations, withdraw dispatch, Utils refund decision |
| `delivery.incident-opened.v1`, `delivery.failed.v1` | Rider | Admin/support/order incident workflow |
| `refund.requested.v1`, `refund.submitted.v1`, `refund.succeeded.v1`, `refund.failed.v1` | Utils | Order financial projection, admin, customer notification |
| `settlement.updated.v1` | Utils | Seller/rider finance projections |
| `support.ticket-created.v1`, `support.ticket-updated.v1` | Utils | Admin, realtime, notification routing |
| `notification.created.v1` | Utils | Realtime/push delivery; inbox remains source |

Requested vs applied events must remain distinct. A rider completion request cannot credit earnings until the order authority emits delivery completion. Services reject unknown schema versions safely. Do not assume queue arrival order across producers; use aggregate versions, gap detection and authoritative resync.

## 7. Socket.IO contracts

- One-use handshake ticket in the auth payload; not a long-lived JWT query parameter. Validate Origin, expiry, active session and role.
- Server authorizes joins to `user:{id}`, `restaurant:{id}`, `rider:{id}`, `order:{id}` and administrative rooms. Never accept arbitrary client room names.
- Revalidate grants on reconnect and sensitive room joins; revoke subscriptions on account suspension, cancellation, assignment change and completion.

| Direction | Event | Contract |
|---|---|---|
| Client → server | `order.subscribe` | `{orderId,lastEventId?}`; authorize then snapshot/catch-up acknowledgement |
| Client → server | `order.unsubscribe` | Leave authorized subscription |
| Client → server | `rider.location.update` | `{deliveryId,lat,lng,accuracy,capturedAt,sequence}`; assignment check, server receive time, rate limit |
| Server → client | `order.status.updated` | `{eventId,orderId,version,status,occurredAt}` |
| Server → client | `rider.location.updated` | Redacted task-scoped coordinate/freshness; discard stale sequence |
| Server → client | `delivery.offer.created` | Offer ID, expiry, safe route/earning summary |
| Server → client | `delivery.offer.withdrawn` | Offer ID and reason |
| Server → client | `delivery.assignment.updated` | Delivery/version/state |
| Server → client | `notification.created` | Persisted notification ID/category/link |
| Server → client | `message.created` | Persisted message ID/conversation/sequence |
| Client → server | `message.read` | Authorized conversation + last read message ID |
| Server → client | `system.resync-required` | Fetch canonical snapshot; no speculative state |

All mutation-like socket events have acknowledgement/error envelopes. Message sending uses the durable HTTP command, then socket fanout. Business changes are persisted before emission. Reconnect fetches snapshots and durable message history; location uses the latest accepted sample rather than replaying an obsolete trajectory. Browser sound is enabled with an explicit user interaction and always has an in-app visual fallback.

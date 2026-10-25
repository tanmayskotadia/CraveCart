# Fulfillment and tracking

The implemented flow connects the same customer, restaurant, rider and order authority. The intended deployment is Vercel + Render with managed data services; see [hosting and keys](HOSTING.md). Automated tests use disposable services and data and do not stand in for an actual hosted deployment.

## Customer journey

Sign-in uses the shared CraveCart modal and opens city-based food discovery. Cuisine inspiration and merchant cards link to real search results; seller-created published menus are authoritative. The page does not invent restaurant brands, reviews, offers, dining bookings or delivery ETAs. A customer chooses a serviceable address, reviews a server-priced quote and completes verified payment. The receipt links to `/orders/:orderId/track`.

Tracking shows kitchen acceptance/preparation, rider assignment, latest authorized rider location with freshness/accuracy, and final delivery. A customer-only delivery code becomes visible after verified pickup. It can be renewed by the authenticated customer; location sharing and code exposure end at terminal state. Receipts and cancellation retain their existing version and financial controls.

## Restaurant journey

The same login design opens `/seller/restaurants`. A seller can submit a restaurant application, publish its approved profile/hours/menu/dishes, and submit additional branches through verification. One unapproved application per seller is enforced; approved branches do not bypass verification for a new branch.

`/seller/restaurants/:restaurantId/orders` and its detail route show the restaurant’s paid orders. Versioned allowlisted actions accept, prepare, mark ready or reject before pickup. The restaurant shares its separate pickup code only at actual handover. Rejection releases tracked stock/promotion reservations once and requests only the remaining refundable amount. Partial financial adjustments do not permanently block legitimate preparation; full refunds require review rather than handing over new food. The seller never receives the customer’s delivery code or unrelated private drop-off details.

## Dispatch and rider journey

Approved active riders go online in a supported city and explicitly grant foreground GPS. The server checks the current authenticated stream, timestamps, sequence, accuracy, cadence and plausible movement. Recent accurate locations feed a managed MongoDB geospatial candidate query; nearby candidates are ranked by distance bucket and least-recent assignment. Redis holds a short-lived task-location cache, with MongoDB as durable fallback. No location is fabricated when either source is unavailable.

After acceptance, dispatch searches in 3/6/10 km rounds, offering up to three candidates per round for 20 seconds. Previously offered candidates cool down for that dispatch generation. After three rounds with no assignment, the order exposes `NO_RIDER` to the customer/merchant and can be retried by a permission-checked, freshly MFA-verified operator. This initial durable MongoDB GEO implementation does not claim an unimplemented Redis GEO ranking service.

Rider Service claims an expiring offer and creates a durable pending operation in one local transaction. Unique active rider/order constraints and Restaurant Service’s authoritative rider lock prevent double assignment. The owner rechecks order state, payment and rider membership before assignment. Lost responses retry the same operation identity; a pending result is never labelled delivered or assigned by the UI before confirmation.

The rider opens the active delivery, uses validated Google Maps navigation to the current pickup/drop stage, verifies pickup with the restaurant code, starts delivery and completes with the customer code. Each proof is random, encrypted for its entitled recipient, HMAC-checked, expiring and limited to five failed attempts. Completion requires current order version and assignment. Proofs are not exposed in rider responses, notifications or logs. A rejected/expired proof can be renewed by the entitled merchant/customer rather than bypassed by the rider. GPS is not proof of delivery.

Incidents remain explicit open records. `/admin/delivery-operations` exposes active tasks, uncertain confirmations and open incidents to dispatch operators. A fresh MFA check and audit reason are required to retry the **original** pending operation, restart pre-pickup dispatch or record incident resolution. Resolving an incident does not complete delivery, refund money or reassign food in transit.

## Realtime and notifications

`POST /realtime/tickets` issues a one-use 60-second ticket for the current session. Socket.IO accepts only the exact frontend Origin and valid tickets. `delivery:subscribe` accepts an order ID, never an arbitrary room name; a role/ownership check returns `delivery:snapshot` or a safe denial. The server rechecks session and entitlement every three seconds. Reconnect mints a new ticket and fetches an authoritative snapshot; version ordering prevents rollback. HTTP polling remains available if the socket is unavailable.

Seller/rider sound is opt-in after user interaction and deduplicated by resource/event identity. Important updates have a persistent per-user inbox. Optional VAPID-based Web Push uses browser opt-in, allowlisted HTTPS push providers, generic encrypted content, bounded retries, a stable notification tag and revocable-session binding. Expired subscriptions are removed. No actual push provider delivery is claimed tested without configured credentials and devices.

Task location history is downsampled, assignment-scoped and currently has a seven-day TTL; approve retention before live launch. Terminal state revokes location access immediately at the authority. Browser tracking is foreground best-effort: mobile OS suspension, denied permission or network loss must show unavailable/stale status, not continuous background tracking. A native companion and physical-device tests are required for a screen-off guarantee.

## Verification

```powershell
npm run test:fulfillment
npm run test:delivery:browser
npm run test:identity
npm run test:money
npm run test:money:providers
npm run contracts:build
npm run contracts:check
```

The delivery browser runner starts an isolated temporary replica set and test services, creates UUID-scoped test accounts, runs real customer/merchant/rider desktop and mobile journeys, then removes those services and records. It deliberately uses development-only contact/payment adapters and browser GPS fixtures; production guards reject those adapters. Hosted acceptance must use real provider sandbox webhooks and actual devices. No charge, email, SMS or push is sent by the isolated test journey.

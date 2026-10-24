# Discovery, catalog and cart

CraveCart now connects national discovery to published restaurant menus, seller catalog tools, exact delivery-pin checks, favorites, offers and persistent customer carts. Ordering and payment remain disabled: a cart is a saved selection, with no reservation, delivery promise or payment attempt.

## Try it locally

Start the database and application as described in [local development](LOCAL-DEVELOPMENT.md). To add fictional development listings:

```powershell
npm run seed:catalog
```

This idempotent development-only script creates 18 labelled sample restaurants, 72 illustrative dishes, offers and six cart-testing areas in Chennai, Mumbai, Delhi, Bengaluru, Hyderabad and Kochi. It preserves existing edits and creates no administrator, orders or real merchant affiliation. The runtime excludes sample restaurants and sample zones in production. Do not migrate sample records into live merchant data.

Select one of these cities from the homepage. Browse or search restaurants, open a menu, sign up, and add a default address in that city. For a Chennai test pin, use latitude `13.081`, longitude `80.271`; this is an approximate development fixture, not a verified delivery address. Choose variants and add-ons, add dishes, and open your cart. Checkout clearly remains unavailable.

## Customer pages

| Page | Working behavior |
|---|---|
| `/search?city=…&q=…` | Restaurant and dish search; cuisine, dietary, price-for-two, preparation time, rating and open filters; stable sort and 12-result pagination; query state in the URL |
| `/restaurants/:slug` | Restaurant details, hours and closure dates, real menu groups, seller-declared dietary/allergen labels, variants, required/optional add-ons, available stock, active offers, favorites and add-to-cart |
| `/addresses` | Own address book, default selection, edit and confirmed removal |
| `/addresses/new`, `/addresses/:addressId/edit` | Recipient, Indian phone, street, apartment, landmark, instructions, city, PIN and exact coordinates; GPS optional, manual entry always available |
| `/favorites` | Own saved published restaurants; open a restaurant to remove it from favorites |
| `/offers?city=…` | Active restaurant promotions with caps, minimum subtotal, expiry and menu links |
| `/cart` | Persistent single-restaurant selection, quantity/removal, address change, current validation issues, explicit price refresh and confirmed clear |

There are no invented reviews, ratings, delivery ETAs or restaurant counts. Until reviews are implemented, rating is `null` with count zero; rating filters truthfully return no qualifying results. Preparation times and approximate cost for two are seller-supplied. Library photographs are illustrative; sample listings carry visible development labels.

## Seller tools

Approved sellers open **My restaurants → Manage menu / Restaurant details**. An approved application creates an unpublished draft restaurant. Its pickup pin starts unconfigured; a valid pin, opening hours and an available dish are required before publication.

| Page | Working behavior |
|---|---|
| `/seller/restaurants` | Own approved restaurant workspaces |
| `/seller/restaurants/:restaurantId/menu` | Category-grouped dish inventory, price, stock, sold-out toggle, edit and confirmed removal; offer creation/editing |
| `/seller/restaurants/:restaurantId/menu/new`, `/menu/:itemId/edit` | Dish/category, description, integer-minor-unit prices, allergens, dietary labels, photo, stock cap, variants and modifier groups with min/max constraints |
| `/seller/restaurants/:restaurantId/profile` | Public description, cuisines, pickup address/pin, image, cost/minimum order, preparation estimate, weekly hours, closed dates, publication and pause reason |
| `/seller/restaurants/:restaurantId/hours` | Weekly slots and closure dates using the same versioned restaurant resource |

Multiple slots support breaks. Overnight hours must be split across days; closing at `00:00` means the end of that day. Hours and holiday dates are evaluated in `Asia/Kolkata`. Offer dates are entered in India time and stored as UTC instants.

Every mutation checks the current seller membership and restaurant ownership. One seller cannot edit another seller's restaurant, dish or offer by substituting an ID. Settings, dishes and offers use expected-version checks. Menu and offer creation use idempotency keys; a key replay with a different payload returns conflict. Catalog changes and `menu.updated.v1` outbox records commit in the same owner-local transaction. Soft-deleted dishes remain unavailable to carts without rewriting old selections.

## Exact serviceability

Admin's **Operating zones** page is `/admin/zones`. Operators need `zones:read` or `zones:write`; writes also require fresh MFA and a reason. Existing operators provisioned before these permissions were added can be deliberately updated through `npm run admin:bootstrap`, which revokes their old sessions. There is no public privileged signup.

Zone records hold an India city, GeoJSON polygon, activation state, weekly hours, fee-policy version, delivery fee and configured travel estimate. Polygon storage uses a `2dsphere` index. Creation/editing and the reasoned audit entry are transactional; stale versions conflict. The UI closes the polygon ring automatically and the database rejects invalid geometry.

The public pin check requires city and coordinates. Cart validation additionally requires the restaurant pickup pin and the customer's **owned** saved address to intersect the same active, currently open polygon. Missing configuration, inactive/closed areas, another city, unknown addresses and upstream outages fail closed. A city selection alone is never a serviceability grant. Fee-policy data is configuration, not a final checkout quote.

## Cart rules and consistency

- Cart ownership comes from the authenticated session, never a client-supplied user ID.
- The request accepts item/variant/option IDs, quantities, preparation requests and an owned address ID. Client totals and unknown fields are rejected. Server menu records determine integer INR prices.
- Exactly one valid variant is required when variants exist. Modifier IDs must belong to that dish; unavailable/duplicate choices and min/max violations fail. Stock limits apply to the aggregate quantity across separate lines, preventing split-line bypass.
- Changing restaurants requires a visible replace-cart confirmation. The old cart remains intact when validation fails or the customer keeps it.
- Expected-version compare-and-swap prevents lost updates across tabs. Clearing retains an incremented empty-cart tombstone, preventing stale writes after clear/recreate.
- Reads recheck menu versions, current prices, availability, ownership, area and hours. Stale stored prices stay visible with a review warning until the customer explicitly refreshes the selection. A minimum-subtotal warning allows building a cart gradually.
- No stock is reserved, no tax/delivery fee is presented as final, and no promotion is redeemed. The next order/quote milestone must revalidate everything transactionally before accepting money.

## Maps and images

Address and pickup forms support GPS permission, manual coordinates and an optional Leaflet pin picker. Map tiles are requested only after the user opens the map. GPS denial does not prevent saving a manually positioned address. Map-provider outages leave coordinates usable; no geocoder or fabricated address lookup is used.

Development uses attributed OpenStreetMap tiles for interactive local browsing. Production requires an explicitly configured, licensed `VITE_MAP_TILE_URL`; without one, manual coordinates remain available. Qualify the chosen provider, capacity, attribution and privacy policy before deployment. The public community tile service is not an unlimited production dependency. No map tiles are prefetched for offline use.

Verified sellers can upload PNG/JPEG catalog photographs through the existing encrypted quarantine/scanning flow. Saving a checked **catalog-image** allows a public image route; that route re-encodes to bounded WebP and strips metadata. Ownership, purpose, MIME and scan state are checked. Verification documents cannot be bound or served as public catalog images. Development format checks remain explicitly distinct from production malware clearance. Configure persistent private storage, ClamAV, image-processing capacity, quotas, retention and backups before accepting live merchant assets.

## Executing APIs

Public paths are under `/api/v1`; the gateway routes to the owning service. Request/response schemas and authorization metadata for the promoted subset are exported in `contracts/catalog.openapi.json` and merged into `contracts/openapi.json` while preserving existing operation IDs.

| Owner | Methods and paths |
|---|---|
| Auth | `GET/POST /addresses`, `PATCH/DELETE /addresses/:addressId` |
| Admin | `POST /serviceability`, `GET/POST /admin/zones`, `PATCH /admin/zones/:zoneId` |
| Restaurant | `GET /restaurants`, `/restaurants/:slug`, `/offers?city=…` |
| Restaurant | `GET /seller/restaurants`, `/seller/restaurants/:restaurantId/catalog`; `PUT /seller/restaurants/:restaurantId` |
| Restaurant | `POST /seller/restaurants/:restaurantId/items`; `PUT/DELETE /seller/restaurants/:restaurantId/items/:itemId` |
| Restaurant | `POST /seller/restaurants/:restaurantId/offers`; `PUT /seller/restaurants/:restaurantId/offers/:offerId` |
| Restaurant | `GET /favorites`, `PUT /favorites/:restaurantId` |
| Restaurant | `GET/PUT/DELETE /cart` |
| Utils | Existing authenticated upload routes with `purpose: catalog-image`; public `GET /media/:uploadId` only after purpose/ownership/scan checks and binding |

Authenticated mutations require session-bound CSRF plus the controlled app origin. Internal membership/address/zone/image commands are signed, audience/path/body-bound and replay-protected; they are not exposed by the gateway. Services do not read each other's databases during requests.

## Validation and remaining gates

Run `npm run test:identity` for the integrated identity/catalog MongoDB workflows, `npm test` for HTTP/unit checks, `npm run test:e2e` for deterministic browser regression, and `npm run test:identity:browser` against the running stack for real multi-role desktop/mobile journeys. See [verification evidence](VERIFICATION.md) for the executed results.

The current city discovery implementation deliberately bounds evaluation to 500 published candidate restaurants and 200 dishes per restaurant; exceeding the candidate limit returns an explicit capacity error rather than silently dropping restaurants. A larger indexed search projection, distributed rate/usage limits, CDN/image-processing qualification, provider licensing, actual malware scanning and measured load/restore tests remain scale/release gates. Favorites query only their own bounded IDs. The existing Docker/broker/staging gates remain open; successful local MongoDB tests do not prove deployment readiness.

Design references: [MongoDB geospatial intersection](https://www.mongodb.com/docs/manual/reference/operator/query/geointersects/), [MongoDB atomic updates](https://www.mongodb.com/docs/manual/core/write-operations-atomicity/), [Leaflet stable distribution](https://leafletjs.com/download), and [OpenStreetMap tile policy](https://operations.osmfoundation.org/policies/tiles/).

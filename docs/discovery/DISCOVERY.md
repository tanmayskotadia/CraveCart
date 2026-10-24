# Discovery and decision register

## Product baseline

- Market: India-wide. City discovery includes Chennai and other Indian cities; delivery activates independently per approved city/zone. Currency: INR. Locale: `en-IN`; operating timezone: `Asia/Kolkata`. Store instants in UTC and render the operating timezone explicitly in seller/admin reports.
- Four workspaces: customer, restaurant seller, rider, admin. Seller entry is distinct even though the original request mentioned three primary logins.
- Immediate delivery from one restaurant per order. No COD, batch delivery, scheduled order or multi-restaurant cart in the initial release.
- Core stack: React/Express/Node with TypeScript and MongoDB. Six independent services retain the boundaries in ADR-001.
- English UI first; translation keys and Unicode-safe text throughout. Tamil is a candidate locale requiring translation/content review, not an implemented promise.
- Pilot serviceability is **deny by default** until an approved polygon and operational capacity are configured. Do not infer delivery availability from a city-directory entry or invent neighborhood coverage.
- No real restaurant menu, brand, rider identity or customer data may be copied into fixtures without authorization. Development data must be visibly synthetic.

## Decisions

`Confirmed` means direct user input. `Engineering baseline` means a reversible implementation choice. `Proposed` requires business confirmation before live use. `Open` means the missing fact has not been invented.

| ID | Decision | Status and baseline | Owner / latest safe decision point |
|---|---|---|---|
| D-01 | Launch market | Confirmed: India-wide, INR; supersedes the earlier Chennai-only decision | Product; complete |
| D-02 | Service areas, delivery hours and capacity | Open: no live zones enabled; polygon configuration required | Operations; before pilot serviceability |
| D-03 | Customer authentication | Engineering baseline: phone/email OTP; password recovery conditional on enabling passwords | Engineering; identity contracts |
| D-04 | Rider tracking mode | Proposed: foreground React PWA pilot; native companion undecided | Product; before continuous-tracking commitment |
| D-05 | Checkout quote lifetime | Proposed: 5 minutes in development; explicit expiry returned to client | Product/engineering; checkout |
| D-06 | Seller acceptance deadline | Proposed: 120 seconds in development; reject/compensate on expiry | Operations; fulfillment |
| D-07 | Dispatch | Proposed: 20-second offers, 3 search rounds; escalation, no fake assignment | Operations; dispatch |
| D-08 | Fees and commissions | Open: versioned policy configuration; synthetic development values only | Finance/product; before payments |
| D-09 | Taxes, invoices and merchant of record | Open: qualified market review and merchant identity needed | Finance; before live checkout |
| D-10 | Cancellation policy | Proposed: free before seller acceptance; later support review; disclose exact approved rules before pay | Product/operations; before live checkout |
| D-11 | Refund timeline and amount | Open: gateway-supported method and approved customer policy; never promise an invented bank timeline | Finance/support; before live refunds |
| D-12 | Payout/settlement arrangement | Open: approved seller/rider payout onboarding; ledger is not bank transfer | Finance; before settlement implementation |
| D-13 | Payment gateways | Required: Razorpay + Stripe adapters; only configured live capabilities shown | Finance/engineering; gateway onboarding |
| D-14 | Maps / routing | Open provider selection after coverage across the selected Indian operating cities, terms, quota and cost check | Engineering/product; tracking |
| D-15 | OTP/email/push | Open providers; development adapters with delivery disabled outside test destinations | Engineering; identity |
| D-16 | AI provider/model/data region | Open; read-only tools and approved FAQ first | Product/engineering; assistant |
| D-17 | Production topology | Engineering baseline: Vercel + Render + AWS RabbitMQ; networking proof mandatory | Infrastructure; before staging foundation exit |
| D-18 | Verification documents | Open: purpose, authorized reviewer, retention and accepted evidence | Operations; onboarding |
| D-19 | Domain, legal entity and support contacts | Open; no fabricated domain ownership/contact published | Product; production setup |
| D-20 | Budget/team | Open; existing 18–24 week estimate assumes 3–4 engineers plus support roles | Product; scheduling |

## Policy implementation rules

Represent policy as versioned configuration containing market, currency, zone IDs, effective time, fee/commission/tax definitions, cancellation rules and approver. Bind the policy version to quotes, placed orders and ledger calculations. Never recalculate a past order under a newly edited fee policy.

Development configuration may use explicit `mode: development` synthetic values. Production startup/readiness must reject absent approved policy, absent provider capability and absent service polygons. Values in this document are not customer-facing terms.

## Discovery acceptance IDs

- **P0-DISC-01:** India is represented as the national market, with independent city and zone configuration; UI/report timezone is explicit; serviceability is disabled without an approved zone.
- **P0-DISC-02:** All four workspaces have clear entry points and backend policy requirements; role switching cannot create grants.
- **P0-DISC-03:** Each unresolved business decision has an owner, deadline and safe development fallback.
- **P0-DISC-04:** No live-provider setup or production-readiness claim is inferred from the existence of the design baseline.

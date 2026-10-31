# Signed-in user journey audit

Reviewed on 29 October 2026. These checks use isolated synthetic accounts, a disposable MongoDB replica set and the actual application services. Payment capture, OTP delivery and physical GPS inputs are labelled test fixtures; this is not evidence of live provider activation.

## Corrections

- Checkout selects an available configured gateway instead of assuming Razorpay. The mobile journey exercises a Stripe-only capability response.
- Contact verification allows correcting the proposed contact without reloading. Confirmation requires a six-digit code.
- Cart and checkout share the account-scoped query key. Captured payments invalidate saved cart data, cart entry refreshes server state and successful reorder invalidates the cart before returning. The journey returns through the sidebar immediately after payment without reloading and verifies the empty cart.
- Notification read failures show an accessible error and restore the retry button. A deliberately failed update is followed by a successful retry.

## Coverage

The browser journey performs customer signup, partner onboarding and independent admin approval, merchant menu publication, address serviceability, dish customization, checkout, declined-payment recovery, captured payment, restaurant notification and sound, preparation, rider assignment, pickup verification, moving location updates, delivery verification, reviews, order messages, support, reports, refund approval, published policies and privacy intake/review.

The added navigation walk switches into each workspace through the UI and verifies the server-reported workspace. It waits for the menu, requires nonempty links, clicks each link and checks its destination, page heading, application errors and horizontal overflow. The full-permission fixtures expose 12 customer links, 6 restaurant links, 11 rider links and 19 admin links: 48 per screen size. Route names and paths visited are recorded in `test-results/delivery/**/workspace-walk-*.json`.

Run `npm run test:delivery:browser` for both desktop and mobile. Earlier checks that recorded zero links or used customer navigation for partner accounts are not accepted as evidence of partner navigation coverage. The prior release report predates these fixes and must not be represented as a fresh complete release gate.

Final verification for this follow-up passed: production build, type checking, lint/ownership boundaries, formatting and both expanded browser journeys. Each screen size visited 48 workspace links (96 visits total). The journeys also verified immediate cart refresh after payment, Stripe-only gateway selection, contact correction and notification failure/retry. Accessibility assertions in the delivery journey passed. Physical GPS and gateway execution remain fixtures as described above. The complete release gate was not rerun for this follow-up.

## Deployment boundary

Rechecked before the GitHub push on 31 October 2026: type checking, lint/import boundaries, formatting, 32 unit tests, 74 fulfillment/assistant/privacy tests, 18 tooling tests, 2,536 contract checks, production build and both desktop/mobile delivery journeys passed. The kitchen completion assertion now brings its tab to the foreground before waiting for the polled status, accounting for browser suspension of background timers. This run still uses isolated test services and simulated providers; it is not hosted acceptance or a complete release-gate run.

The owner selected free tiers only. See [free hosting assessment](FREE-HOSTING-ASSESSMENT.md). Atlas organization AI-client access is now enabled. Following the owner's resume, the free cluster reached `IDLE` and MCP database connectivity was verified. Existing data was preserved. On 31 October 2026, creation of the restricted staging application user succeeded after approval settings were corrected. Its seven staging database roles and Cluster0 scope were verified, and the generated runtime URI was saved privately in the Git-ignored `.env.hosted`. Connectivity from a deployed backend remains unverified.

Vercel team access was subsequently approved and the Node version corrected to 24.x. A protected frontend-only preview is now READY; its asset and SPA-route HTTP checks passed. The project currently uses static settings for compiled asset uploads, rather than a linked Git source build. See [hosted setup status](HOSTED-SETUP-STATUS.md) for the exact URL, checks and remaining backend boundary. Render access to the confirmed workspace works; no CraveCart services were found there at inspection. Paid resources remain unprovisioned. Provisioning remains dependent on suitable infrastructure and credentials.

Razorpay Route compensation, transfers, reversals and settlement reconciliation remain unfinished. Live provider callbacks, actual GPS/device behavior, broker/Redis fault tests, recovery/load qualification and broader privacy retention scope retain the open requirements in the [completion audit](COMPLETION-AUDIT.md).

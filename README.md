# CraveCart

Food discovery and delivery for India, built with MongoDB, Express, React and Node.js using TypeScript. The repository contains a React application, six independently runnable backend services, an API gateway, shared contracts, local infrastructure and automated checks.

The application includes India-wide discovery, real OTP accounts and sessions, authenticator MFA, account security, seller/rider onboarding, private document uploads and admin verification. Restaurant and rider access opens only after approval. Discovery now includes restaurant and dish search, menus and add-ons, addresses and exact zone checks, favorites, offers, seller catalog management and server-priced carts. Checkout now includes expiring quotes, stock and offer reservations, orders, Razorpay/Stripe adapters, verified webhooks, cancellation, refunds and a balanced financial ledger. Fulfillment now includes the seller kitchen board, exclusive rider assignment, pickup and delivery codes, customer tracking, notifications and operator incident recovery. The grounded assistant includes approved help, menu discovery, own-order/refund facts, reviewed cart/support proposals and optional server-side model interpretation. Live provider and deployment qualification remain required before launch.

## Host on Vercel and Render

Start with the [manual setup and launch checklist](docs/MANUAL-SETUP-AND-LAUNCH.md) for every credential, provider account, business setting and acceptance task. The [hosting guide](docs/engineering/HOSTING.md) describes the Vercel/Render topology. Deployment requires your provider accounts and credentials; this repository does not imply a live production deployment.

Read the [complete delivery journey](docs/engineering/FULFILLMENT-AND-TRACKING.md), [role operations](docs/engineering/ROLE-OPERATIONS.md), [assistant setup](docs/engineering/ASSISTANT.md) and [PRD](docs/PRD.md). Support conversations, delivery messages, verified reviews, restaurant teams, limited administrative grants, reports and accounting records are implemented. Bank payouts and contractual compensation remain subject to policy and provider configuration. Use `.env.hosted.example` for backend settings. Production rejects development codes, synthetic payments and developer upload storage.

## Development and isolated verification

Use Node **24.14.1** and npm **11.11.0**. Install Docker with Compose v2 for the dependency stack.

```powershell
npm ci
Copy-Item .env.example .env
npm run build
docker compose --env-file .env -f infra/compose/compose.yaml up -d --wait mongo mongo-init rabbitmq redis
npm run dev
```

Open [CraveCart](http://localhost:5173). Without Docker, run `npm run dev:database` in a separate terminal before `npm run dev` to use persistent MongoDB and the identity/onboarding features. The first launch downloads a verified MongoDB binary. Overall readiness remains 503 until RabbitMQ and Redis are also available.

Local OTPs are displayed explicitly as development codes; no SMS/email is sent. Use `npm run admin:bootstrap` to provision an operator, then enroll MFA through the admin login. See the identity guide below for the complete workflow and production requirements.

Run `npm run seed:catalog` to add clearly labelled fictional restaurants in six cities for local discovery and cart testing. This creates no orders or live merchant affiliations.

## Validate

For the hosting handoff, start with [launch preparation](docs/release/LAUNCH-HANDBOOK.md) and [partner training](docs/release/PARTNER-TRAINING.md). `npm run launch:prepare` creates an operating packet with the current build identity and configuration names. `npm run launch:gate` checks the actual reviewed release, hosted evidence, staffing and rollout scope; it performs no deployment.

Run `npm run verify:release` for a reproducible repository report and per-check logs. See [hardening checks](docs/engineering/HARDENING.md), [recovery runbooks](docs/engineering/INCIDENT-RUNBOOKS.md) and [pilot readiness](docs/release/PILOT-READINESS.md). Hosted/provider/recovery qualification remains pending; `npm run release:gate` fails until the release evidence and reviewed sign-off are complete.

```powershell
python -m pip install -r scripts/requirements-contracts.txt
npm run typecheck
npm run lint
npm run format:check
npm test
npm run test:identity
npm run test:money
npm run test:money:providers
npm run test:fulfillment
npm run test:delivery:browser
npm run contracts:build
npm run contracts:check
npx playwright install chromium
npm run test:e2e
```

The real-dependency integration suite has separate setup; see the guide below. Exact runtime and development package versions are committed in `package-lock.json`.

## Documentation

- [Hosted deployment and keys](docs/engineering/HOSTING.md)
- [Kitchen, rider delivery and tracking](docs/engineering/FULFILLMENT-AND-TRACKING.md)
- [Checkout, payments, refunds and finance](docs/engineering/ORDERS-AND-PAYMENTS.md)
- [Discovery, seller menus, addresses and cart](docs/engineering/CATALOG-AND-CART.md)
- [Identity, onboarding and administrator setup](docs/engineering/IDENTITY-AND-ONBOARDING.md)
- [Local development and integration tests](docs/engineering/LOCAL-DEVELOPMENT.md)
- [Verification results and remaining gates](docs/engineering/VERIFICATION.md)
- [Operations and deployment prerequisites](docs/engineering/OPERATIONS.md)
- [Discovery and architecture](docs/discovery/README.md)
- [Product requirements](docs/PRD.md)
- [Routes and API contracts](contracts/README.md)
- [Implementation roadmap](docs/IMPLEMENTATION-PLAN.md)

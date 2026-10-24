# CraveCart

Food discovery and delivery for India, built with MongoDB, Express, React and Node.js using TypeScript. The repository contains a React application, six independently runnable backend services, an API gateway, shared contracts, local infrastructure and automated checks.

The application includes India-wide discovery, real OTP accounts and sessions, authenticator MFA, account security, seller/rider onboarding, private document uploads and admin verification. Restaurant and rider access opens only after approval. Discovery now includes restaurant and dish search, menus and add-ons, addresses and exact zone checks, favorites, offers, seller catalog management and server-priced carts. Ordering, delivery tracking, payments and the assistant remain upcoming work. Live provider and deployment qualification remain required before launch.

## Run locally

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

```powershell
python -m pip install -r scripts/requirements-contracts.txt
npm run typecheck
npm run lint
npm run format:check
npm test
npm run test:identity
npm run contracts:build
npm run contracts:check
npx playwright install chromium
npm run test:e2e
```

The real-dependency integration suite has separate setup; see the guide below. Exact runtime and development package versions are committed in `package-lock.json`.

## Documentation

- [Discovery, seller menus, addresses and cart](docs/engineering/CATALOG-AND-CART.md)
- [Identity, onboarding and administrator setup](docs/engineering/IDENTITY-AND-ONBOARDING.md)
- [Local development and integration tests](docs/engineering/LOCAL-DEVELOPMENT.md)
- [Verification results and remaining gates](docs/engineering/VERIFICATION.md)
- [Operations and deployment prerequisites](docs/engineering/OPERATIONS.md)
- [Discovery and architecture](docs/discovery/README.md)
- [Product requirements](docs/PRD.md)
- [Routes and API contracts](contracts/README.md)
- [Implementation roadmap](docs/IMPLEMENTATION-PLAN.md)

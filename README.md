# CraveCart

Food discovery and delivery for India, built with MongoDB, Express, React and Node.js using TypeScript. The repository contains a React application, six independently runnable backend services, an API gateway, shared contracts, local infrastructure and automated checks.

The application currently provides the launch experience and protected workspace entry points. Customer ordering, identity, seller operations, delivery tracking, payments and the assistant remain upcoming feature work. The interface does not simulate successful orders or sign-ins.

## Run locally

Use Node **24.14.1** and npm **11.11.0**. Install Docker with Compose v2 for the dependency stack.

```powershell
npm ci
Copy-Item .env.example .env
npm run build
docker compose --env-file .env -f infra/compose/compose.yaml up -d --wait mongo mongo-init rabbitmq redis
npm run dev
```

Open [CraveCart](http://localhost:5173). Without Docker, the build and `npm run dev` launch the web/API shell, but dependency readiness returns 503. Hosted setup and real-dependency recovery verification require the infrastructure described in the development guide.

## Validate

```powershell
python -m pip install -r scripts/requirements-contracts.txt
npm run typecheck
npm run lint
npm run format:check
npm test
npm run contracts:build
npm run contracts:check
npx playwright install chromium
npm run test:e2e
```

The real-dependency integration suite has separate setup; see the guide below. Exact runtime and development package versions are committed in `package-lock.json`.

## Documentation

- [Local development and integration tests](docs/engineering/LOCAL-DEVELOPMENT.md)
- [Verification results and remaining gates](docs/engineering/VERIFICATION.md)
- [Operations and deployment prerequisites](docs/engineering/OPERATIONS.md)
- [Discovery and architecture](docs/discovery/README.md)
- [Product requirements](docs/PRD.md)
- [Routes and API contracts](contracts/README.md)
- [Implementation roadmap](docs/IMPLEMENTATION-PLAN.md)

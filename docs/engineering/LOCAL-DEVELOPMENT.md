# Local development

## Toolchain

Node **24.14.1** (LTS family), npm **11.11.0**, Python **3.12+** for planning contract validation, and Docker Engine/Desktop with Compose v2 for the dependency stack. Exact npm versions are committed in `package-lock.json`; use `npm ci`, not an unlocked reinstall. The available machine has Node/npm/Python; Docker was not installed when this foundation was prepared.

```powershell
npm ci
python -m pip install -r scripts/requirements-contracts.txt
Copy-Item .env.example .env
npm run build
```

After installation, choose a mode below. Open [CraveCart](http://localhost:5173). The browser calls the gateway through Vite's `/api` proxy. `infra:up` starts gateway and backend containers too; `dev` starts host backend processes on the same ports, so **use one backend mode at a time**:

- Container mode: `npm run infra:up`, then `npm run dev --workspace @cravecart/web` only.
- Host mode: start only infrastructure with the command below, then `npm run dev` for all host services and web.

```powershell
docker compose --env-file .env -f infra/compose/compose.yaml up -d --wait mongo mongo-init rabbitmq redis
npm run dev
```

To preview the web/API shell without Docker, run `npm run build` then `npm run dev`; all service liveness routes work, but dependency readiness correctly returns 503. For working identity/onboarding without Docker, start `npm run dev:database` in a separate terminal first. Sign-in uses explicit local development codes; ordering remains disabled. See [identity and onboarding](IDENTITY-AND-ONBOARDING.md) for operator provisioning, MFA, documents and production gates.

For labelled fictional menus and cart-testing areas, run `npm run seed:catalog`. See [catalog and cart setup](CATALOG-AND-CART.md) for merchant tools, exact pin checks, map configuration and remaining production gates.

## Ports and checks

| Process | Host port | Purpose |
|---|---|---|
| React/Vite | 5173 | UI and API proxy |
| Gateway | 4000 | Public API ingress and aggregate readiness |
| Auth / Restaurant / Rider | 4001 / 4002 / 4003 | Independent owner processes |
| Admin / Realtime / Utils | 4004 / 4005 / 4006 | Independent owner processes |
| MongoDB | 27017 | Local single-node replica set for transactions |
| RabbitMQ / management | 5672 / 15672 | Development broker; local-only credentials |
| Redis | 6379 | Development cache/connection dependency |

All Compose host bindings are loopback. MongoDB advertises its container name within the replica set, so host clients use `directConnection=true`. Do not reuse this development network/credential configuration in production. `infra:down` preserves named volumes; deleting volumes is a separate destructive action.

```powershell
npm run typecheck
npm run lint
npm run format:check
npm test
npm run contracts:build
npm run contracts:check
npx playwright install chromium
npm run test:e2e
node scripts/smoke.mjs
```

The browser suite uses deterministic intercepted capability responses and a built Vite preview. The separate smoke command checks actual gateway-to-admin traffic. Unit HTTP tests create temporary localhost servers; restricted environments may require permission to access loopback sockets.

## Real-dependency recovery test

Start MongoDB replica set, RabbitMQ and Redis first, then set these variables in the test shell:

```powershell
$env:MONGO_URI='mongodb://127.0.0.1:27017/?directConnection=true&replicaSet=rs0'
$env:RABBITMQ_URL='amqp://cravecart:local-only@127.0.0.1:5672/cravecart'
$env:REDIS_URL='redis://127.0.0.1:6379'
npm run test:integration
```

The suite creates an isolated test database and temporary queue, verifies atomic rollback, idempotency payload conflicts, uncertain publish/retry and commit-before-ack redelivery. It drops only its generated test database/queue after execution. It fails when required dependency configuration is missing; it never silently substitutes memory fakes. CI starts the same Compose environment and requires readiness/recovery proof.

## Repository boundaries

Six domain services depend on the shared platform runtime. `packages/contracts` owns runtime Zod schemas for the implemented public capability slice. `packages/persistence` provides owner-local transactions/outbox/inbox using the official MongoDB driver; domain-specific Mongoose models can be added with identity/catalog implementation without exposing collections across owners. `packages/observability` owns logging/tracing. `packages/adapters` contains server-only synthetic development adapters. `apps/web` imports no persistence or server provider credentials.

## Formatting and contracts

`npm run format` formats application/tooling files. `npm run contracts:build` exports the implemented Zod HTTP schema, then regenerates the planning inventory and traceability. The capability endpoint and exported identity/onboarding and catalog/cart subsets are implementation-ready. Promote later endpoints individually with full schema, authorization and behavior tests; do not generate production clients from inventory placeholders.

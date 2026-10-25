# Foundation operations

See [current hardening controls](HARDENING.md), [incident/recovery procedures](INCIDENT-RUNBOOKS.md) and [pilot acceptance](../release/PILOT-READINESS.md) for the release run, actual remaining qualification and incident ownership.

## Health, tracing and shutdown

- `/health/live` proves the process is serving HTTP, independent of MongoDB/RabbitMQ/Redis availability.
- `/health/ready` on each owner checks its configured dependencies with deadlines; gateway readiness aggregates all six owners. A missing dependency returns 503 rather than pretending the platform is ready.
- `/metrics` requires a distinct bearer metrics credential. Current metrics include completed HTTP request count; do not mistake this foundation counter for the complete business SLO dashboard.
- Requests get a canonical UUID, preserved through gateway-to-owner calls. OpenTelemetry forwards W3C trace context. Logs contain classification, request/trace IDs and status, not request bodies, secrets or dependency URLs.
- Set `OTEL_EXPORTER_OTLP_TRACES_ENDPOINT` to an isolated collector to export spans. Without it, no trace exporter sends network requests.
- SIGTERM/SIGINT stop accepting HTTP, disconnect sockets, await claimed outbox work, close dependencies and flush telemetry. Host development runner terminates its own children.

## Durable work

Domain writes and outbox insertion share an owner-local transaction. Dispatch claims a lease, publishes with confirm and mandatory routing, then marks sent. Five failed attempts retain a `failed` record for operator review and emit an error classification. Never mark that work delivered or delete it to silence an alert.

Consumers use `consumeOnce` inside local transactions and acknowledge RabbitMQ only after it returns successfully. The integration test demonstrates the commit-before-ack crash path. Domain queue subscriptions, event handlers and bounded retry/DLQ policies must be implemented with the corresponding business slices; no sample worker mutates a real order. Each service declares its own durable queue and dead-letter queue; no wildcard business bindings are enabled automatically.

## Staging deployment prerequisites

The repository provides a non-root multi-stage Docker build and local Compose topology. Production/staging accounts and credentials have not been supplied, so no hosted deployment or AWS broker handshake is claimed.

Before deploying the shared image separately for each service:

1. Select controlled app/API domains and HTTPS origin. Build web with `VITE_API_ORIGIN` pointing to the approved API origin when using separate hosts; never place secrets in Vite variables.
2. Configure a separate owner database credential per service, authenticated TLS RabbitMQ/Redis and isolated staging data. The local Compose stack intentionally uses local-only development credentials and a single-node MongoDB replica set.
3. Set `NODE_ENV=production`, `DEV_ADAPTERS=false`, distinct random `INTERNAL_TOKEN` and `METRICS_TOKEN`, TLS dependency URLs, exact `APP_ORIGIN`, `HOST=0.0.0.0`, platform `PORT` and `SERVICE_NAME`.
4. Start each service using `node services/<owner>/dist/index.js`; start gateway using `node apps/gateway/dist/index.js`. Gateway additionally requires explicit `AUTH_URL`, `RESTAURANT_URL`, `RIDER_URL`, `ADMIN_URL`, `REALTIME_URL`, `UTILS_URL`.
5. Keep owner ingress private; expose gateway and later authenticated realtime transport only. Current Socket.IO connections are rejected until ticket authentication is implemented.
6. Pin production base/dependency images to reviewed digests and run image scanning. Development Compose tags are major-version references, not immutable production image pins.
7. Perform the provider register's TLS/isolation/reconnect/HA checks, restore drill and measured resource/cost qualification before declaring staging/production gates passed.

The Docker image installs production runtime dependencies only after its build step. Services share the base runtime image but execute independently and retain exclusive database ownership. This is a foundation deployment artifact, not a configured production marketplace.

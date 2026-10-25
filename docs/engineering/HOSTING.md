# Vercel and Render deployment

This repository prepares a hosted staging release: React on Vercel, seven application processes on Render (gateway and six owners), a private ClamAV scanner, managed MongoDB/RabbitMQ/Redis, and a private persistent upload disk. No production business data belongs in a developer `.local` directory. Temporary test databases are unrelated to deployment storage.

Actual deployment requires installed/connected Vercel and Render integrations or authenticated provider CLIs, access to the Git repository, provider credentials, and approval of the compute/storage plan. Configuration files and passing tests do not mean these resources have been created. Do not call the application live until the hosted acceptance journey passes.

## Credentials and settings

Set backend values in the **cravecart-hosted** Render environment group. Use [.env.hosted.example](../../.env.hosted.example) as the inventory, not as a file to commit filled secrets into.

| Required setting | What to configure |
|---|---|
| `MONGO_URI` | Managed MongoDB replica-set connection using verified TLS (`mongodb+srv://...`); use a scoped database account and backups |
| `MONGO_DB_PREFIX` | `cravecart_staging` for sandbox; use a separate prefix and preferably separate cluster/account for live production |
| `RABBITMQ_URL` | Managed AMQPS broker URI including its vhost; topic exchanges, durable queues and publisher confirms must be supported |
| `REDIS_URL` | Managed Redis **TCP/TLS** URI (`rediss://...`), not a REST-only API URL |
| `SMTP_URL`, `SMTP_FROM` | Real SMTP credentials and a verified sender; email verification works without SMS. Configure delivery/DNS at the mail provider |
| `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET` | Razorpay **test-mode** API pair for staging (`rzp_test_...`) |
| `RAZORPAY_WEBHOOK_SECRET`, `RAZORPAY_ACCOUNT_ID` | Configure the matching test account and signed webhook endpoint |
| `APP_ORIGIN` | Exact Vercel frontend HTTPS origin; no wildcard. Preview deployments need their own matching environment |
| Five application secrets | Blueprint generates distinct `INTERNAL_TOKEN`, `METRICS_TOKEN`, `AUTH_SECRET`, `AUTH_ENCRYPTION_KEY`, `UPLOAD_ENCRYPTION_KEY`; keep these in hosting secret settings |
| `UPLOAD_DIRECTORY` | `/var/lib/cravecart/uploads`, backed by the Utils service’s Render disk; encrypted files never go into the ephemeral application checkout |
| `CLAMD_HOST`, `CLAMD_PORT` | Blueprint wires the private scanner hostname and port 3310; keep scanner traffic on the private network |

Optional settings:

- `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_FROM_NUMBER` enable real phone verification when the messaging account and sender are approved. Without SMS configuration, the shared login UI offers configured email verification.
- `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` enable Stripe sandbox alongside Razorpay. Pin `STRIPE_API_VERSION` before qualifying live Stripe. An unconfigured gateway stays hidden.
- `WEB_PUSH_PUBLIC_KEY`, `WEB_PUSH_PRIVATE_KEY`, `WEB_PUSH_SUBJECT` enable opt-in browser push. Generate a VAPID pair privately (`npx web-push generate-vapid-keys --json`) and store the private key only in Render. Use an owned `mailto:` or HTTPS contact subject. Push content is generic; it is bound to a revocable session and expires quickly.
- Vercel build variables: `VITE_REALTIME_ORIGIN` is the public Render Realtime HTTPS origin; `VITE_MAP_TILE_URL` is a licensed tile URL template, and `VITE_MAP_ATTRIBUTION` is the provider-required attribution. Restrict any public map key by frontend domain/API. External Google Maps navigation links do not require an app Directions API key. The application does not fabricate a road-route ETA.

Never put backend payment, SMTP, encryption or VAPID private keys into `VITE_*`, Git, screenshots or chat. Only publishable map keys and the VAPID public key may reach the browser.

## Deployment sequence

Configure `TRUSTED_PROXY_CIDRS` on the gateway only after verifying the actual ingress peer/forwarded-IP chain for the chosen deployment. It accepts explicit proxy IPs/CIDRs, not `true`, numeric hop counts or unrestricted `/0` networks. Empty trusts no forwarded client addresses. Do not copy fixture/documentation IP ranges into production. The gateway signs the resolved client IP for Auth; qualify both the Vercel proxy path and direct public gateway ingress so spoofed forwarding headers cannot bypass limits. Contact/account limits remain separate from gateway IP limits.

1. Commit and push the reviewed source to the linked CraveCart repository. Render reads remote Git, not an uncommitted local checkout. Do not overwrite unrelated existing services with a Blueprint sync.
2. Create the Vercel project with root directory `apps/web`; enable monorepo access to workspace files outside that root. Record its final frontend HTTPS origin.
3. Review [render.yaml](../../render.yaml). It uses Singapore services, private internal host/port discovery and HMAC-authenticated owner calls. The gateway and Realtime service are public web services. Other owners and the scanner are private. The template uses paid always-on compute so worker timers and WebSockets do not depend on a sleeping free instance.
4. Configure the environment group and apply the Blueprint after reviewing provider costs. Obtain the public gateway and Realtime HTTPS origins.
5. Configure the Vercel same-origin API proxy using the actual origins:

   ```powershell
   npm run hosting:configure -- --app=https://YOUR-FRONTEND --api=https://YOUR-GATEWAY --realtime=https://YOUR-REALTIME
   ```

   This writes the concrete `apps/web/vercel.json` routes. Commit/push that routing change and deploy the frontend. Keep `VITE_API_ORIGIN` **unset** for this proxy arrangement; cookies belong to the frontend’s first-party origin. Set `VITE_REALTIME_ORIGIN` separately because WebSockets connect directly to Render using one-use tickets, not API cookies. Owned app/API subdomains are also supported when same-site cookie/CORS behavior is explicitly qualified.
6. Bootstrap an actual operator by running `npm run admin:bootstrap` in the managed Auth service environment. The command uses `MONGO_DB_PREFIX`, verifies the operator contact at login and requires authenticator enrollment. It creates no public/default admin account.
7. In the admin UI, create real operating zones and explicitly approve a staging pricing policy. Register a restaurant and rider, scan and review their documents, publish the merchant’s own menu and hours, and use an address inside a shared configured zone. For live ordering, an authorized finance operator reviews **Restaurant launch approval** on `/admin/finance`, then confirms with fresh MFA and a reason. The flag is versioned and audited; direct database editing is not the launch workflow. Production rejects development adapters and excludes fictional sample merchants. No live city-wide coverage is inferred from the city directory.
8. In Razorpay configure `https://YOUR-GATEWAY/api/v1/webhooks/razorpay` with the matching secret and captured/refund events. Configure Stripe’s direct gateway webhook similarly if enabled. Gateway raw bytes are verified before parsing. Qualify capture settings and signed delivery from the actual account.
9. Run the read-only hosted preflight:

   ```powershell
   $env:HOSTED_APP_ORIGIN='https://YOUR-FRONTEND'
   $env:HOSTED_API_ORIGIN='https://YOUR-GATEWAY'
   $env:HOSTED_REALTIME_ORIGIN='https://YOUR-REALTIME'
   $env:HOSTED_EXPECTED_BUILD=(Get-Content $env:RELEASE_REPORT | ConvertFrom-Json).buildSha256
   $env:HOSTED_EXPECTED_MODE='test'
   $env:HOSTED_REQUIRED_GATEWAYS='razorpay'
   npm run hosting:check
   ```

   Set `RELEASE_REPORT` to the actual successful `verify:release` report first. Preflight verifies 18 named checks covering dependency readiness, matching deployment build identities, SPA/proxy routes and headers, explicit real-contact adapters, exact payment mode/selected gateways and anonymous access denial. Reports are saved under `.local/hosted-checks/`. It does **not** send email, charge a card, prove authenticated cookie refresh or replace the browser/GPS/provider acceptance journey. See [launch preparation](../release/LAUNCH-HANDBOOK.md).
10. Complete the full journey on the hosted staging site with real sandbox webhooks, actual email/SMS, a physical rider device, real licensed tiles, socket reconnect, account revocation and scanned uploads. Check persistence after a Utils redeploy and exercise dependency outages. Record provider callback URLs, retention, backups/restore, scanner image digest and operational ownership.

## Costs and production gates

The grounded assistant works with no model credential using `ASSISTANT_PROVIDER=builtin`. Optional OpenAI interpretation needs `OPENAI_API_KEY` and an explicitly qualified `ASSISTANT_MODEL` on **Utils only**, with provider spend limits/alerts. Do not expose either through frontend build variables. Assistant cart/ticket execution defaults off; review [assistant confirmation controls](ASSISTANT.md) before enabling the two review flags on Utils, Restaurant and Admin. Hosted SSE/disconnect behavior and actual model-provider qualification remain deployment checks.

Role operations use the same deployment topology and need no additional API key. Before hosted acceptance, refresh the existing operator’s permission list through the managed bootstrap procedure, verify restricted support/analyst staff access, and approve message retention/deletion and support staffing policies. [Role operations](ROLE-OPERATIONS.md) defines reporting and financial-record limits; no commission, rider contract or bank payout is inferred from these records.

Razorpay test mode simulates money. Live gateway fees are separate from hosting. The Blueprint specifies seven `0.5c-512mb` application services and a `1c-2g` scanner, plus 6 GB of persistent disks. At Render’s published rates checked 25 October 2026, that is approximately **US$75.50/month** before managed MongoDB/RabbitMQ/Redis, bandwidth, tax and any Vercel/provider charges. Confirm the actual provider quote before applying; no paid resource has been created by writing this template.

The template is a single-instance staging topology. Utils uses a private disk and cannot simply be horizontally scaled; migrate to qualified shared private object storage before doing so. Realtime uses websocket-only connections with per-connection authorized snapshots and HTTP fallback, so it does not rely on sticky HTTP-polling sessions or an unqualified in-memory broadcast adapter. Load, HA, broker replay, physical-device/background behavior, financial settlement matching and live operational qualification remain release gates. Pin the scanner’s stable image to a qualified digest for a controlled production release.

Switching to live charging is a separate explicit action: `COMMERCE_MODE=live`, `PAYMENT_LIVE_CONFIRMED=true`, matching live keys/webhooks, an approved non-development pricing policy and explicit real-merchant approval are required. Clear or isolate staging tasks and records; do not re-use staging financial identities. Foreground web tracking cannot promise reliable screen-off GPS.

Sources: [Render Blueprint schema and reference](https://render.com/docs/blueprint-spec), [Render WebSockets](https://render.com/docs/websocket), [Render persistent disks](https://render.com/docs/disks), [Render pricing](https://render.com/pricing), [Vercel rewrites](https://vercel.com/docs/routing/rewrites), [Razorpay pricing](https://razorpay.com/pricing/).

# Hosted setup status

## Access recheck — 31 October 2026

Later on 31 October, the owner requested MongoDB Atlas's app-specific **Allow read actions** permission mode and enabled interactive chat approvals. The subsequent creation succeeded and was verified with the database-user listing: `cravecart_staging_app` has `readWrite` only on the seven `cravecart_staging_*` runtime databases and is scoped to `Cluster0`. The server-generated credential was saved as `MONGO_URI` in the existing Git-ignored `.env.hosted`, without displaying it. The earlier failed attempts below are historical. Runtime connectivity from a deployed backend has not yet been verified. The owner reconfirmed free-only hosting and will handle Git pushes.

- The owner explicitly confirmed Render workspace `My Workspace`. Its service inventory contains two unrelated services and no CraveCart backend. No existing service was changed.
- Vercel project inspection succeeded; the recorded frontend preview remains READY and the project reports `live: false`.
- Atlas project and cluster inspection succeeded: existing FREE `Cluster0` is unpaused and IDLE. Its existing administrator user and IP access list were preserved.
- Creation of `cravecart_staging_app`, restricted to Cluster0 and the seven staging runtime databases, was attempted. Atlas reported that required write confirmation was not received, so the operation was not performed. No application password was returned or stored.
- AWS STS identity verification succeeded. No AWS resources were provisioned.
- GitHub connector repository lookup returned 404. Local authenticated Git transport successfully read the configured remote HEAD; this does not verify push permission.
- The recorded free-only budget constraint remains unresolved. The current Blueprint requires seven `0.5c-512mb` services, one `1c-2g` scanner and 6 GB of disks. At Render's checked rates ($7, $25 and $0.25/GB/month), this is an estimated $75.50/month before RabbitMQ, Redis, email, bandwidth, tax or other charges. No paid resources were created. Source: https://render.com/pricing.

These are access checks and a failed user-creation attempt, not a backend deployment or end-to-end acceptance result.

Updated on 30 October 2026. This records provider operations that actually completed. It is not a production-launch approval.

## Vercel

- Project: `cravecart`, ID `prj_kBcpNIVKoYQOMSfOXPsN496bIsIX`.
- Team access was approved; Node version is 24.x.
- Successful preview deployment: `dpl_Hybo6YB3kigtcXrfkxBXkqCJnQFW`.
- URL: https://cravecart-bsbl4ts28-tanmay17.vercel.app/
- State: READY. Preview target, no production aliases assigned to this deployment.
- This is a compiled frontend-only upload through MCP. The project currently uses static/Other settings with the upload at its root. Git source is not linked; pushes do not automatically deploy this working tree.
- Deployment Protection remains enabled. Open the URL using the owning Vercel account.
- The earlier attempt `dpl_8JmWRzqepRzNMPW99qjoMchndx72` failed because its source root did not match the uploaded compiled files; do not use its URL as the working deployment.

Authenticated MCP HTTP verification returned 200 for the root HTML, `/search?city=chennai`, `/images/indian-feast.webp`, the main JavaScript bundle and `/release.json`. Release metadata returned `Cache-Control: no-store`, and the deployed fingerprint was `607f225d473a6ca3101fb028dbca95b6e14dee6b1dd613d8518ea31114f31a6b`. The preview is marked `noindex, nofollow`.

`/api/v1/platform` returned 404 with `Cache-Control: private, no-store`. There is no hosted backend, API proxy, real login, checkout or live delivery on this preview. Do not describe frontend asset checks as hosted end-to-end verification. The separately recorded desktop/mobile delivery tests use isolated services and fixtures.

For future source builds, switch the project back to Vite with root `apps/web`, Node 24.x, install command `cd ../.. && npm ci`, build command `cd ../.. && npm run build`, output `dist`, and source files outside the root enabled. Link only the reviewed repository state. Configure a real backend proxy and browser origins before claiming working authentication or ordering.

## MongoDB Atlas

- Organization AI-client access is enabled and verified.
- Existing project `cravecart`, FREE `Cluster0`, AWS Mumbai, resumed by the owner and verified IDLE.
- MCP database connectivity and collection-name listing succeeded. Existing `cravecart.users` data was preserved.
- The requested `cravecart_staging_app` user was **not created**: the connector reported that its write confirmation was not received. No generated application password or authenticated runtime URI was stored.
- Intended permissions are `readWrite` only on `cravecart_staging_auth`, `cravecart_staging_restaurant`, `cravecart_staging_rider`, `cravecart_staging_admin`, `cravecart_staging_realtime`, `cravecart_staging_utils` and `cravecart_staging_gateway`, restricted to Cluster0. Gateway persistence also creates its own operational collections, so six owner databases alone are insufficient for this repository's shared runtime URI.
- Existing administrator credentials must not be substituted for this application user. Network access must be configured for the actual backend deployment; do not open every IP address to compensate for missing hosting configuration.

## Still required

Atlas write confirmation; restricted runtime credentials; a viable backend hosting arrangement within the owner's free-only budget; RabbitMQ and Redis; real contact delivery; private document storage/scanning; licensed maps and sandbox payment configuration. Razorpay Route compensation/transfers/settlement implementation and the other open launch requirements remain in the completion audit.

The paid Render Blueprint remains unapplied. See [free hosting assessment](FREE-HOSTING-ASSESSMENT.md) and [manual setup checklist](../MANUAL-SETUP-AND-LAUNCH.md).

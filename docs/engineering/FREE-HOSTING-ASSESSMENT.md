# Free hosting assessment

Owner constraint, 29 October 2026: free tiers only. Do not apply the existing paid `render.yaml` or upgrade any existing service under this instruction.

## Current architecture

The backend Blueprint defines seven application processes (gateway and six domain services), a ClamAV scanner and persistent private upload storage. Five domain processes and the scanner are private services. MongoDB, RabbitMQ, Redis, verified contact delivery, licensed maps and sandbox payment settings are separate dependencies.

## Verified Render limits

The [official free-service documentation](https://render.com/docs/free), checked on 29 October 2026, states:

- Free web services share 750 instance hours per workspace each month. Existing unrelated services also consume that allowance.
- Private services do not have a free compute plan. Free web services cannot receive private-network traffic.
- Free services sleep after idle periods and have cold starts. They are not recommended for production applications.
- Free web services have no persistent disks; uploaded files are lost on restart, redeploy or spin-down.
- Outbound SMTP ports 25, 465 and 587 are blocked on free web services. The existing SMTP adapter therefore needs a provider-supported alternative port or an HTTPS email adapter before hosted login can be assumed to work.
- Free Key Value storage is in-memory and is lost on restart.
- Usage overages can incur charges when a payment method exists. Free compute alone does not enforce a zero-dollar account budget; review usage/spending controls before deployment.

Changing private services into public free web services, replacing encrypted upload storage or removing malware scanning is not an equivalent deployment. Any such preview needs explicit architecture work, authentication/network review and accurate feature limits; do not simply change every plan to `free`.

## Work that can proceed without paid provisioning

Prepare the Vercel frontend, SPA routing and public configuration. Keep unavailable backend capabilities explicit. This alone is a frontend preview, not a working hosted food-delivery service.

The `cravecart` Vercel project and protected frontend-only preview have been created through MCP after team authorization. See [hosted setup status](HOSTED-SETUP-STATUS.md). On 31 October 2026, creation of the restricted MongoDB runtime user succeeded after approval settings were corrected; its connection string is saved privately in the Git-ignored `.env.hosted`. A working hosted backend or backend-to-database connectivity must not be assumed from the frontend preview or user creation.

Atlas organization AI-client access is now enabled and verified through MCP. The owner resumed the existing FREE `Cluster0` in AWS Mumbai. Atlas subsequently reported `paused: false`, `IDLE`, and MongoDB 8.0.34; MCP connection and database/collection listing succeeded. The existing `cravecart.users` collection was inspected by name only and preserved. The separate `cravecart_staging_app` user is verified with read/write roles on the six owner databases plus the gateway staging database, scoped to Cluster0. This does not verify network connectivity from a deployed backend. The existing administrator account remains separate from application credentials.

Obtain approved free RabbitMQ/Redis accounts, a working contact-delivery channel and suitable private document storage/scanning. Verify current provider allowances rather than assuming free plans exist or cover the entire application.

Keep live payment charging disabled during preview. Merchant activation, Route approval, real payment fees and domain ownership are separate from hosting compute.

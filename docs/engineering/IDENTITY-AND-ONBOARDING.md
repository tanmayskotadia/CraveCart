# Identity and partner onboarding

CraveCart now has persistent accounts, revocable sessions, authenticator MFA, customer account settings, seller/rider applications, private verification documents, and an admin review workflow. These run through the gateway and their owning services against a real MongoDB replica set. The national discovery design remains in place. Selecting a city does not activate delivery serviceability.

## Start locally

Use Node 24.14.1 and npm 11.11.0. Copy `.env.example` to `.env` only if you have not already configured it, then run `npm ci` and `npm run build`.

For host development without Docker, keep these in two separate terminals:

```powershell
# Terminal A: persistent, single-node MongoDB replica set
npm run dev:database

# Terminal B: six services, gateway and React
npm run dev
```

Open [CraveCart](http://localhost:5173). The database launcher downloads a checksum-verified MongoDB 8.0.17 binary on first use; allow time and disk space for the Windows download. Database files and cached binaries stay in ignored `.local/`. Stop the launcher normally to preserve its data. Do not start it alongside a Docker MongoDB instance already using port 27017.

Alternatively start MongoDB, RabbitMQ and Redis with the infrastructure command in [Local development](LOCAL-DEVELOPMENT.md). The MongoDB-only mode supports identity and onboarding, but aggregate readiness remains 503 until RabbitMQ and Redis are available. Outbox events remain durable; this mode does not prove broker delivery.

With `DEV_ADAPTERS=true`, login and signup show a clearly labelled local development code. No SMS or email is sent. Accounts and sessions are real and survive reloads. Unconfigured live delivery returns an error instead of a fabricated success. Do not expose the development environment publicly.

## Workspaces and access

| Workspace | Entry and working pages | Access |
|---|---|---|
| Customer | `/signup`, `/login`, `/profile`, `/settings`, `/settings/sessions`, `/workspaces` | Verified contact; customers may enroll MFA |
| Restaurant | `/seller/register`, `/seller/login`, `/seller/onboarding`, `/seller/restaurants` | Application is available to authenticated customers; restaurant access needs approval |
| Delivery partner | `/rider/register`, `/rider/login`, `/rider/onboarding`, `/rider/dashboard` | Application is available to authenticated customers; rider access needs approval |
| Admin | `/admin/login`, `/admin/dashboard`, `/admin/verifications`, `/admin/verifications/:applicationId`, `/admin/users`, `/admin/audit` | Operator-provisioned membership, specific permissions and verified MFA |

Seller/rider registration initially grants **customer only**. A submitted application cannot grant a role. There is no public administrator signup, role picker that grants privileges, shared default administrator, or password bypass. Protected links enforce both role and object ownership on the backend. The frontend preserves safe internal return paths and rejects external/unauthorized destinations.

To provision your first operator locally:

```powershell
npm run admin:bootstrap
```

Enter the operator's contact and display name at the prompts. This is a database-operator command, not an HTTP signup route. It revokes existing sessions for that account. Sign in at `/admin/login`, verify the contact, enroll an authenticator, and store the eight recovery codes privately. Enrollment QR codes are rendered locally. Every recovery code is single-use. Administrative writes and document access require MFA verified within five minutes; the dashboard provides a verification action when another check is needed.

## HTTP routes that execute now

All public paths below are relative to `/api/v1`. JSON success responses use `{data, meta: {requestId}}`; errors use the shared structured error envelope. Mutations require the configured `Origin`. Authenticated mutations also require `X-CSRF-Token` from the current session. Upload content is binary, not a JSON envelope.

| Owner | Methods and paths | Behavior |
|---|---|---|
| Auth | `GET /auth/capabilities` | Available contact delivery methods and explicit development mode |
| Auth | `POST /auth/register`, `/auth/login`, `/auth/otp/request` | Rate-limited contact challenge; registration requires name |
| Auth | `POST /auth/otp/verify` | Consume contact proof; return session or required MFA challenge |
| Auth | `GET /auth/me`, `PATCH /auth/me` | Current principal/session; update own display name |
| Auth | `GET /auth/csrf`, `POST /auth/refresh`, `/auth/logout` | CSRF acquisition, rotating refresh, immediate logout |
| Auth | `GET /auth/sessions`, `DELETE /auth/sessions/:sessionId`, `POST /auth/sessions/revoke-all` | Owner-scoped session management; revoke-all needs recent authentication |
| Auth | `POST /auth/workspace` | Switch to an already granted workspace |
| Auth | `POST /auth/mfa/challenge`, `/auth/mfa/enroll`, `/auth/mfa/verify` | Enrollment, step-up and single-use recovery proof |
| Auth | `POST /auth/contact-changes`, `/auth/contact-changes/:challengeId/confirm` | Owner-bound new-contact proof and revocation of other sessions |
| Restaurant | `GET/POST /seller/applications`, `PATCH /seller/applications/:applicationId`, `POST /seller/applications/:applicationId/submit` | Own draft, versioned changes, explicit idempotent submission |
| Restaurant | `GET /seller/restaurants` | Own approved businesses after role activation |
| Rider | `GET/POST /rider/application`, `PATCH /rider/application/:applicationId`, `POST /rider/application/:applicationId/submit` | Own rider application and resubmission |
| Rider | `GET /rider/profile` | Own approved delivery profile |
| Utils | `POST /uploads/intents`, `PUT /uploads/:uploadId/content`, `POST /uploads/:uploadId/complete` | One-use upload token, encrypted quarantine and document check |
| Utils | `GET /uploads/:uploadId/access`, `/uploads/:uploadId/content` | Private owner or authorized verifier metadata/content; audited download |
| Admin | `GET /admin/dashboard`, `/admin/verifications`, `/admin/verifications/:applicationId` | Live owner-backed queue, detail, audit and operation state |
| Admin | `POST /admin/verifications/:applicationId/decision` | Versioned, reasoned decision; no self-review; idempotency key required |
| Admin | `GET /admin/operations/:operationId`, `POST /admin/operations/:operationId/retry` | Durable completion status and authorized retry |
| Admin | `GET /admin/users`, `POST /admin/users/:userId/status`, `GET /admin/audit` | Permissioned accounts, suspension/restoration, append-only audit |

Typed client-ready contracts for the promoted subset are exported into `contracts/identity.openapi.json` and merged into `contracts/openapi.json`. Other executing routes in this table retain baseline contract status until their complete exported schemas are promoted; do not generate a production client from their baseline placeholders. Internal signed routes are deliberately absent from the public gateway.

## Consistency and recovery

OTP challenges expire after five minutes, have five guesses and a 45-second resend cooldown. Codes, access tokens, refresh tokens and recovery codes are stored as hashes; MFA secrets and uploaded content are encrypted. Access lasts 15 minutes and refresh sessions last up to 30 days. Production cookies are Secure, HttpOnly, SameSite=Lax and host-only. Refresh reuse revokes its session family. Logout, session revocation and suspension invalidate backend authorization immediately. Restoring an account does not resurrect revoked sessions.

Each owner stores its own application. Draft edits require `expectedVersion`; a stale edit returns conflict and the UI preserves unsaved values until explicit reload. Submission requires `Idempotency-Key` and owner-bound checked documents. Decisions follow `DRAFT → SUBMITTED → APPROVED / REJECTED / CHANGES_REQUESTED`; rejected or changes-requested applications can be edited and submitted again.

Admin records a durable operation and audit before requesting an owner decision. Approval is complete only when the owner and auth role grant are applied. An interrupted role grant leaves activation pending; it does not silently grant access or lose the application. Automatic retries are bounded to five attempts with backoff. A revoked/expired approver session or stale MFA requires a new verifier check and explicit retry. The operation page distinguishes pending, failed and applied outcomes. Retry is idempotent and checks for conflicting decisions.

Documents accept PNG, JPEG and PDF only, up to 5 MB each and five attachments. Image bytes are decoded and bounded, declared extensions are not trusted, and PDFs receive structural checks. A single-use token and authenticated CSRF-protected PUT precede encrypted quarantine. Development checks report `DEVELOPMENT_REVIEWABLE`, **not malware-clean**. Production requires a reachable ClamAV INSTREAM scanner; an unavailable scanner leaves the file quarantined and offers a retry. Admin document access requires fresh MFA, uses authenticated downloads and records an access audit; files have no public object URL.

## Production configuration and qualification

Set `NODE_ENV=production`, `DEV_ADAPTERS=false`, a controlled HTTPS `APP_ORIGIN`, verified TLS dependency URLs, and explicit service upstream URLs for every owner that calls another service. Use five distinct random secrets of at least 32 characters: `INTERNAL_TOKEN`, `METRICS_TOKEN`, `AUTH_SECRET`, `AUTH_ENCRYPTION_KEY`, `UPLOAD_ENCRYPTION_KEY`. Keep them outside the frontend and repository. Rotate keys with a planned re-encryption/session-revocation procedure; replacing encryption keys makes existing encrypted documents/MFA secrets unreadable.

Configure `SMTP_URL` with `SMTP_FROM` for email and/or `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_FROM_NUMBER` for SMS. Delivery adapters exist but live provider registration, sender approval, delivery receipts, abuse thresholds and actual SMS/email delivery have not been qualified here.

Set `UPLOAD_SCAN_MODE=clamav`, `CLAMD_HOST`, `CLAMD_PORT`, and a private persistent `UPLOAD_DIRECTORY` writable only by the utils runtime. Compose includes an upload volume; its development topology is not production infrastructure. Deploy a maintained scanner with current signatures and test clean/infected/unavailable outcomes in staging. Shared storage or object-storage adaptation is required before horizontally scaling utils. Define document retention/deletion, orphan cleanup, storage quotas, backups and restore procedures before collecting real verification documents. The present local implementation does not constitute a full KYC/compliance service.

Host frontend and API under the same site with an HTTPS API origin, or proxy `/api` through the frontend's controlled domain. Unrelated Vercel/Render default domains are cross-site: SameSite cookies will not provide the intended session transport. Qualify origin/cookie behavior, ingress rate limits across replicas, service credentials, TLS and private routing in staging. Do not weaken CSRF or cookie defaults to work around hosting.

Live scanner/provider tests, Docker execution, hosted deployment, queue recovery, load/restore/security review and approved business policies remain release gates. Discovery, catalog tools, addresses and carts now execute; see [catalog and cart](CATALOG-AND-CART.md). Ordering, payments, dispatch, tracking, notifications and chatbot behavior remain later roadmap work.

## Verification

```powershell
npm run build
npm run typecheck
npm run lint
npm test
npm run test:identity
npm run test:e2e
# Requires `dev:database` and `dev` already running:
npm run test:identity:browser
```

`test:identity` creates isolated databases on a real MongoDB replica set (downloads its own binary if no URI is supplied). To reuse the local instance, set `IDENTITY_TEST_MONGO_URI` to its replica-set URI. The live browser suite uses synthetic UUID-scoped accounts, local development delivery and a test-only database-provisioned verifier. It removes its own user/application/document fixtures; it never provisions a default runtime administrator or sends real messages. Tracing is disabled for this suite to avoid capturing authenticator enrollment secrets.

Security design references: [OWASP sessions](https://cheatsheetseries.owasp.org/cheatsheets/Session_Management_Cheat_Sheet.html), [OWASP CSRF](https://cheatsheetseries.owasp.org/cheatsheets/Cross-Site_Request_Forgery_Prevention_Cheat_Sheet.html), [OWASP uploads](https://cheatsheetseries.owasp.org/cheatsheets/File_Upload_Cheat_Sheet.html), and [RFC 6238](https://datatracker.ietf.org/doc/html/rfc6238). These inform implementation; they are not an independent security certification.

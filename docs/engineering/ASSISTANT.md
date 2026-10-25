# Grounded assistant

The assistant lives at `/assistant` inside the current account workspace. `/admin/assistant` manages approved help and records synthetic routing evaluations. Utils owns conversations, proposals, the optional model adapter and tool audit; the existing Auth, Restaurant and Admin owners retain their data and command authority. There is no seventh backend service.

## Available behavior

- Answer versioned help about payments, cancellation, tracking, account security, serviceability and appropriate partner guidance, with source links and check timestamps.
- Discover up to eight listed dishes in the selected Indian city from a bounded search of published menus and active seller memberships. Cards show base prices and link to the real restaurant. Required variants or add-ons lead to the normal menu chooser.
- Read the signed-in customer’s own current order stage, payment state, requested refunds and verified refunded amount. No address, contact, delivery code, provider secret, bank arrival time or guaranteed ETA is returned by the assistant tool.
- Display an explicit safety boundary for allergies and medical dietary needs; seller labels are not a guarantee against cross-contact.
- Prepare a server-priced cart addition for a simple dish using the user’s default address and current cart. The assistant never guesses required variants or modifiers, or replaces another restaurant’s cart.
- Prepare a support ticket from a separately reviewed summary and explicit consent. Only that summary and an authorized linked order are transferred; the full conversation is not attached.
- Confirm an enabled proposal once, with a token bound to the account, stored payload hash and five-minute expiry. Standard domain checks run again. Unknown responses stay uncertain and retry the original command identity; the assistant does not announce success until the owner acknowledges it.
- Recover conversations and pending proposals after refresh, stop a response, delete owned assistant history, and use normal search/order/support links when information cannot be verified.

Authenticated use is required. Guest assistant sessions, image/voice input, embeddings, unrestricted web browsing and arbitrary model tools are not implemented. Public visitors can use the existing help page and sign in for account-specific assistance.

## Grounding and permissions

The account and granted roles come from fresh server sessions. Client-provided user IDs, roles or tool names are rejected. Conversation access is owner-scoped. Restaurant tools query current records and enforce order ownership, active catalog membership and current serviceability. The model cannot select another customer or supply a financial result.

The built-in intent router handles known questions. Current order/refund facts are rendered from strict owner responses; approved help is retrieved only when published, unexpired and available to the account’s roles. Menus are data, including any embedded instructions. They are rendered as text and are never added to a model prompt as executable instructions.

Links use real route patterns and an allowlist. Help editors can select only existing static help/account/partner routes. No model-provided URL is displayed. Cancel, payment, refund, verification, role and delivery-state commands have no assistant execution path.

Nine release-provided help entries describe existing product behavior; they are versioned and expire one year after first installation. They are not a legal policy approval or live-provider qualification. Operators should review and update them for the deployed service. Content changes require `assistant:write`, fresh MFA, an audit reason and expected version. Reading the management page requires `assistant:read`. Refresh existing governance accounts using the managed bootstrap procedure to add the new permissions; limited staff bundles do not silently gain them.

## Confirmation review gate

The PRD requires human review before assistant writes are enabled. Therefore these settings default to false:

```text
ASSISTANT_WRITES_ENABLED=false
ASSISTANT_WRITES_REVIEWED=false
```

The assistant remains useful for help, menus and verified own-order facts while disabled. Normal cart and support routes remain available.

Before enabling, review the actual cart and handoff proposals, expiry/version/ownership tests, pricing and serviceability checks, consent wording, unknown-response recovery and rollback procedure. Record the reviewer and evidence in your release process, then set both flags to true on **Utils, Restaurant and Admin**. A browser cannot enable this gate. Re-disable it in all three owners to stop new assistant actions. No setting enables assistant payment, refund or administrative execution.

## Optional OpenAI configuration

No external model key is needed with `ASSISTANT_PROVIDER=builtin`.

For optional interpretation of general ambiguous questions, set these **server-side on the Utils Render service**:

| Setting | Purpose |
|---|---|
| `ASSISTANT_PROVIDER=openai` | Enable the optional intent classifier |
| `OPENAI_API_KEY` | Secret API credential from your own provider project |
| `ASSISTANT_MODEL` | Explicit supported model identifier chosen and qualified by the operator |
| `ASSISTANT_DAILY_PROVIDER_CALLS` | Maximum reserved provider requests across the Utils database per UTC day; default 100 |
| `ASSISTANT_DAILY_MESSAGES` | Per-account assistant message allowance per UTC day; default 60 |

Never place the API key in a `VITE_*` variable, Git, screenshots or chat. Do not enable the provider on every service through a shared secret group. Other owners can keep the default built-in setting.

The adapter uses the Responses API with a strict JSON classification schema, `store:false`, a 160-output-token cap, a 500-character input cap, a six-second timeout and a circuit breaker after three failures. Only allowlisted help/menu/unknown classifications are accepted. It sends a redacted standalone general question, not account facts, order records, conversation history, menus, addresses, documents or tool results. Known private-topic questions bypass this adapter. Redaction is best-effort, not proof that arbitrary user text contains no personal data; the UI asks users to keep private details out of chat.

A failed, incomplete, malformed, refused, over-budget or circuit-open response falls back to built-in help/search/support. There is no unrestricted generated answer or model-driven tool loop. Provider project spend limits and cost alerts must be configured and qualified in the provider dashboard. The local request cap is not a currency-denominated spend guarantee, and `store:false` is not a claim of zero provider retention.

Official references checked for the implementation: [structured outputs](https://developers.openai.com/api/docs/guides/structured-outputs), [text generation](https://developers.openai.com/api/docs/guides/text), and [data controls](https://developers.openai.com/api/docs/guides/your-data). No model API was called with real credentials during verification.

## Persistence, limits and transport

Questions/answers and action payloads, summaries and confirmation tokens are encrypted using the existing Auth encryption secret. Conversation titles are generic topic labels. Stored questions redact recognizable email, Indian phone, payment-number, six-digit code and order-reference patterns. Tool audit stores identities, kind/outcome/provider/prompt version and timestamps, not message bodies or account facts.

Conversation/request records have a thirty-day TTL; proposals have their own thirty-day TTL. Expiry makes a proposal non-executable after five minutes. Deleting a conversation transactionally removes its proposals and request-cache entries; it does not delete a consented support ticket or undo a confirmed cart change. Independent TTL expiry does not cascade synchronously across collections; all action access also requires the owning conversation to exist. Backup retention, encryption-key recovery and wider account-deletion obligations require operator qualification.

Limits include ten new conversations and twenty proposal requests per account per UTC day, fifty turns per conversation, thirty proposals per conversation, and one in-flight response per account. Durable leases recover interrupted work. User questions are capped at 1,500 characters and the browser stream parser caps response bytes. Direct standard product routes stay available during assistant quota or provider outages.

Message POST supports either JSON or SSE. A progress frame is followed by the committed typed result; unverified model tokens are not streamed to users. The gateway forwards Accept, streams chunks and propagates disconnect cancellation. Reload/JSON recovery works even when a hosting proxy buffers streaming. Hosted Vercel/Render buffering, timeout and disconnect behavior still need a deployed acceptance test.

## Evaluation and release evidence

`npm run test:assistant` uses the shared isolated fulfillment/role harness plus assistant tests. The runtime admin evaluation runs a fixed **26-case synthetic intent/refusal suite** and records actual results. Unit grounding checks separately compare **nine approved help answers** and citations to their versioned source. Integration cases cover live own-order/refund facts, foreign data denial, message replay/version conflicts, encrypted/redacted storage, consent, token/expiry/price/cart guards, lost-response confirmation recovery, provider schema/fallback/circuit controls, and real gateway SSE/cancellation.

The complete browser journey adds own-order answers and refresh recovery, allergy safety, menu discovery, confirmed cart addition, consented support handoff and admin evaluation to the existing customer–restaurant–rider story. It runs a production React bundle with temporary service origins on desktop and mobile. Contact/payment/GPS inputs remain synthetic, and action flags are enabled only in that isolated test environment.

Routing accuracy is not an end-to-end real-model answer score. These fixtures do not certify a ≥95% production semantic-answer target, native tracking, real support staffing or live provider billing. Before launch, review representative multilingual/ambiguous questions, unsupported claims, suspended accounts, real model refusal/budget behavior, retention/restore, hosted SSE and human-reviewed write enablement. The next roadmap milestone is system hardening and pilot qualification, not an automatic production launch.


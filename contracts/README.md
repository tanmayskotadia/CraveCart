# Discovery contracts

Version: `0.1.0`. `GET /platform` and the promoted identity/onboarding, catalog/cart and checkout/payment operations are implemented and exported from shared Zod schemas. The remaining operations retain their declared baseline status. See [identity runtime coverage](../docs/engineering/IDENTITY-AND-ONBOARDING.md) for all executing endpoints. JSON files support scripts and contract tooling without a YAML dependency.

| File | Purpose |
|---|---|
| [routes.json](routes.json) | Frontend page identity, access/workspace policy, states and aliases |
| [actions.json](actions.json) | Every critical CTA linked to real declared API operations, success and recovery behavior |
| [commerce.openapi.json](commerce.openapi.json) | Exported quote, order, payment, refund, pricing policy and financial operations contracts |
| [catalog.openapi.json](catalog.openapi.json) | Exported client-ready discovery, addresses, zones, seller catalog, uploads and cart contracts |
| [identity.openapi.json](identity.openapi.json) | Exported client-ready identity/onboarding subset merged into OpenAPI |
| [openapi.json](openapi.json) | OpenAPI 3.1 endpoint inventory and critical request/response schemas |
| [events.schema.json](events.schema.json) | JSON Schema 2020-12 discriminated domain events |
| [socket.schema.json](socket.schema.json) | Logical Socket.IO event descriptors, directions and data schemas |

## HTTP lifecycle

- `inventory-only`: method/path/owner/policy listed. Request/query/response details must be completed before implementing the endpoint.
- `critical-baseline`: concrete schemas for high-risk ordering/payment/delivery commands; still requires review, exact semantics and example-based implementation tests.
- `provider-defined`: webhook body/signature protocol belongs to the provider. Preserve raw bytes and use current official verification rules. The schema does not pretend to describe every provider payload.
- The promoted capability and identity operations have `x-client-generation-ready: true`. Promote another operation to `implementation-ready` only after its full schemas, errors, authorization, idempotency, pagination/query semantics and examples are reviewed and tested. Then set the generation flag for that operation.

No generic response placeholder may be used as a production client type. `GET /orders/{orderId}` currently models the critical summary, not all menu/address/timeline fields required by the detail page. Complete that resource during the order slice. `POST /rider/location` is schema-detailed but remains provisional; do not use browser timestamps/coordinates as delivery proof.

The market is India-wide with INR pricing. Discovery cities are independent of approved city-specific delivery zones. Provider payload adapters, amount/currency/reference checks, normalized phone validation, membership checks, quote math and OTP/verification attempt limits require domain logic beyond JSON Schema.

## Ownership, security and async semantics

- Public catalog access does not grant personal-data access. Backend ownership is required on every ID lookup.
- OpenAPI cookie schemes describe credential transport, not permission. `x-authorization` records policy intent. CSRF/origin enforcement and domain setup follow ADR-002.
- A provider-signed webhook uses no user cookie security; signature verification and durable inbox are mandatory.
- `202` means an operation is durably accepted, not that delivery/refund/verification has finished. Rider operation status is visible on the authorized delivery resource; administrative operation status uses `/admin/operations/{operationId}`.
- Proof IDs in events refer to short-lived access-controlled server proofs. Never publish raw OTP, contact/address, KYC or provider secrets.
- New `verification.applied.v1`, `verification.failed.v1` and `delivery.operation-rejected.v1` outcomes close requested/applied failure paths left implicit in the original narrative. Any new payload version requires schema and consumer review.
- JSON payloads cannot authenticate a producer; broker identity/permissions and internal caller authentication enforce producer ownership.
- Socket schemas describe `{event,direction,data}` for validation/tooling. Actual Socket.IO emits the event name and data separately. Acknowledgements are required for client events.

## Regeneration and validation

The planning route inventory plus `scripts/build_contracts.py` define the unimplemented inventory. `packages/contracts/src/index.ts` is canonical for the implemented capability endpoint; `scripts/export-contracts.ts` exports it into `platform.openapi.json`, which the planning generator merges without overwriting its readiness status. Regeneration overwrites generated JSON and traceability; do not hand-edit them. The identity exporter adds its promoted subset and preserves existing operation IDs. Migrate remaining endpoints individually into the shared runtime schema package.

```powershell
npm run contracts:build
python scripts/validate_contracts.py
```

The validator checks inventory coverage, references, route/action links, schema positive/negative examples, traceability and token contrast. It is not a full third-party OpenAPI conformance validator, runtime E2E suite, hosted connectivity test or visual accessibility certification.

Route `runtimeStatus` distinguishes available local workflows, partial delivery against the broader product design, and planned screens. `implemented: true` denotes the available local workflow, not production qualification. Cart access currently requires an authenticated owner; guest-cart and checkout policy remains recorded as planned scope. Critical cart actions now reference the executing PUT /cart operation.

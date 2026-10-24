# ADR-001: six services with exclusive ownership

Status: proposed baseline. Date: 24 October 2026.

## Context

The requested architecture names six services, but orders, payments and assistant workflows still require explicit owners. Shared collections would make independent deployment and policy enforcement unreliable.

## Decision

- Auth owns identities/sessions/grants. Restaurant owns seller/catalog/cart/quote/orders and is the exclusive order-state authority. Rider owns availability/offers/assignments/task workflow.
- Admin owns control-plane cases/configuration/audit and operational projections. Realtime owns sockets/conversations/messages. Utils owns isolated payment, upload, notification, support and assistant modules.
- Give each owner separate database credentials. Local transactions may span an owner's collections; never build a cross-service database transaction.
- Admin uses authenticated owner commands and tracks requested/applied/failed operations. It cannot update another owner's collection.
- Share versioned schemas, generated clients, policy helpers and UI primitives, not service repositories or mutable models.

## Alternatives and consequences

A modular monolith would reduce operational work but does not meet the requested independent-service boundary. A dedicated Order/Payments/Assistant service could improve later ownership but would exceed six services now. Keep those modules extractable behind contracts; record a future ADR before extraction.

## Validation

Dependency checks reject cross-service model imports; database credentials are tested for denial against other owners; event/API contracts identify owner; order mutations are only applied by Restaurant Service.

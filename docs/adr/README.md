# Architecture decision records

Status: proposed engineering baseline; implementation and deployment evidence are still required. Changes must update the relevant ADR and contracts rather than silently changing a service's responsibilities.

| Record | Decision |
|---|---|
| [ADR-001](001-service-ownership.md) | Six services with exclusive domain ownership |
| [ADR-002](002-sessions-and-authorization.md) | Revocable sessions and object-scoped authorization |
| [ADR-003](003-reliable-workflows.md) | Outbox/inbox, explicit sagas and idempotent financial effects |
| [ADR-004](004-tracking-and-realtime.md) | Durable state plus realtime projections; foreground web pilot |
| [ADR-005](005-deployment-and-networking.md) | Vercel/Render/AWS topology gated on authenticated TLS connectivity |

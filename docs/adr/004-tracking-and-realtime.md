# ADR-004: realtime projections and tracking scope

Status: proposed baseline; native background scope remains open. Date: 24 October 2026.

## Decision

Treat Socket.IO as a low-latency projection over durable business state. Clients reconcile snapshots/versions after reconnect and use bounded polling when needed. Persistent messages/notifications have cursor recovery. Latest locations are short-lived samples with age/accuracy/sequence, not a durable stream of order transitions.

Use React PWA foreground tracking for the development/pilot baseline. Do not claim continuous background or screen-off web tracking. A native companion needs its own approved scope, platform permissions, physical-device tests and privacy review before such a commitment.

Location access is limited to assigned tasks and entitled participants; completion/cancellation/reassignment revokes exposure. Sound requires user enablement and always has a visual counterpart. Maps/geocoding/directions are behind adapters with validated destination coordinates and budget controls.

## Tradeoffs and validation

Foreground scope keeps the initial stack MERN but limits rider reliability when the device suspends the browser. Validate stale labels, permissions denied, assignment revocation, duplicate/out-of-order samples, reconnect and routing failures. Select a Socket.IO adapter only after proving multi-instance fanout/recovery and transport-affinity behavior.

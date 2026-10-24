# ADR-005: cloud topology and network proof

Status: proposed; documentation feasibility only. Date: 24 October 2026.

## Decision

Retain Vercel React hosting, Render gateway/domain/realtime services, MongoDB replica set, Redis and AWS-hosted Docker RabbitMQ. Prefer controlled first-party app/API DNS. Isolate development/staging/production identities, queues, buckets, databases and provider accounts.

For Render-to-AWS AMQP, first evaluate supported private connectivity for the chosen region/plan and a compatible AWS endpoint. If unavailable, qualify narrow egress allowlisting plus TLS hostname verification and distinct least-privilege broker users. Shared regional egress ranges alone do not authenticate callers. Never expose broker management or cluster internode ports publicly.

Production broker availability needs durable storage and quorum-node failure testing; one Docker host is a pilot limitation. Do not create or pay for infrastructure during Discovery without a selected account/budget. Prepare exact networking configuration in the infrastructure milestone; no IPs, region availability or account entitlements are invented here.

## Evidence and limitations

[Render private network documentation](https://render.com/docs/private-network) describes same-region/workspace communication and eligible private-link integration. [Outbound IP documentation](https://render.com/docs/outbound-ip-addresses) describes service-specific egress discovery and shared ranges. [RabbitMQ production guidance](https://www.rabbitmq.com/docs/production-checklist) informs storage, isolation, monitoring and clustering design. Checked 24 October 2026.

No handshake, failover, cost or latency measurement has run against user infrastructure. The [feasibility checklist](../discovery/PROVIDERS-AND-FEASIBILITY.md) defines required proof before staging exit.

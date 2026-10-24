# ADR-003: reliable workflows and money effects

Status: proposed baseline. Date: 24 October 2026.

## Decision

Use local MongoDB transactions to commit business changes plus outbox records. Publishers use confirms and consumers acknowledge after durable idempotent local effects. Each owner tracks processed event IDs and stable business keys. Queue retries use capped backoff and DLQ; replay is audited.

Keep order, payment/refund and assignment states separate. Restaurant coordinates order fulfillment; Utils verifies captures/refunds and owns the ledger; Rider requests pickup/completion and waits for order-authority outcome. Late captures after cancellation initiate compensation rather than restore fulfillment. Provider calls run from durable operations and reconciliation, outside database transactions.

Use minor-unit money, immutable pricing/address/policy snapshots and balanced per-currency ledger postings. Quotes and reservations expire explicitly. Concurrent commands use expected versions and unique active-assignment/payment-effect keys.

## Tradeoffs

This adds workers, temporary pending states and reconciliation. It avoids incorrectly assuming RabbitMQ or multiple databases provide an end-to-end exactly-once transaction. A socket event is a notification, never the business commit.

## Validation

Crash at publish/ack boundaries; replay provider/broker events; reorder versions; race cancellation/capture and rider acceptance; verify one fulfillment and balanced ledger. Broker outage must retain unshipped outbox work.

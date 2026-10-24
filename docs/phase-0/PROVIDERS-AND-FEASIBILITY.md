# Provider readiness and network feasibility

## Provider application register

No provider accounts or merchant applications have been created/submitted. The project has no supplied legal entity, account access, payment credentials or approved budget. Prepare integrations locally without fabricating these facts.

| Integration | Readiness | Information / setup required | Acceptance evidence |
|---|---|---|---|
| Razorpay | Application checklist prepared | Merchant/entity identity, supported business model, settlement account, test/live keys, separate webhook secrets | Approved live capability; signed test capture/refund; ledger match |
| Stripe | Application checklist prepared | Account-country eligibility, intended currencies/markets, merchant/payout arrangement, test/live configuration | Enabled capability in actual account; verified webhook and refund; only supported methods shown |
| Seller/rider payouts | Model open | Recipient onboarding, collection/disbursement terms, fee/tax responsibility, provider approval | Payout reference reconciles to statement; failed payout remains unpaid |
| Maps | Provider open | Chennai geocoding/routing coverage, permitted display/caching, restricted keys, quotas and budget | Real-address route tests, API restrictions and quota-failure fallback |
| OTP/SMS | Provider open | Verified sender/template setup where required, delivery coverage, abuse limits | Allowlisted test recipients, expiry/resend/attempt tests, delivery monitoring |
| Email | Provider open | Owned sending domain, sender identity and deliverability setup | Domain verification and transactional test delivery |
| Push | Provider open | Web push service/configuration and supported devices | Permission-denied fallback; revoked subscription cleanup |
| AI | Provider open | Data use/region review, credential, model choice, usage budget | Grounded evaluation, tool attacks, provider-down fallback and cost alarm |
| Object storage | Account open | Private buckets, upload/read policies, quarantine/scan, retention | Unsafe file rejected; unauthorized KYC access denied |
| MongoDB/Redis | Accounts open | Regions, isolation, replica-set/HA settings, backup and capacity budget | Transactions, failover, authorized access and restore proof |
| Vercel/Render/AWS | Accounts open | Workspace/account, region, DNS, plan/budget, deployment identity | Staging deployment and broker networking proof |

Do not place secrets or identity documents in this register. Collect them through provider-owned onboarding and deployment secret settings.

## Network spike: evidence required

Documentation indicates possible architectures; it does not prove the chosen accounts/regions support them. Render documents same-region/workspace private service networking and eligible [private connectivity](https://render.com/docs/private-network). It also documents [outbound IP discovery](https://render.com/docs/outbound-ip-addresses), noting regional ranges are shared. Check plan, region and exact service settings when provisioning.

| Probe | Procedure | Pass criterion | Current evidence |
|---|---|---|---|
| N-01 DNS/TLS | From a real staging Render worker, connect to selected broker DNS with CA/hostname verification | TLS handshake succeeds; wrong hostname/untrusted certificate fails | Not run |
| N-02 Network isolation | Test approved client and unapproved source; inspect security rules | Only intended ingress reaches AMQPS; management/internode ports inaccessible publicly | Not run |
| N-03 Broker identity | Per-service users/vhost permissions; test forbidden read/write/configure | Least-privilege operations succeed; wrong credentials/queue permissions fail | Not run |
| N-04 Delivery | Publish confirmed event, consume/commit/ack; replay same ID | Durable receipt and one business effect | Not run |
| N-05 Reconnect | Interrupt connection; restart broker/worker; restore | Bounded retries, outbox retained, eventual drain without duplicate effects | Not run |
| N-06 HA | Lose one node in selected quorum deployment | Availability/data-loss behavior meets documented release target | Not run |
| N-07 Latency/cost | Measure representative message size/rate and round-trip latency | Fits named SLO and approved egress/resource budget | Not run |

Production RabbitMQ configuration must follow verified [production deployment guidance](https://www.rabbitmq.com/docs/production-checklist), including durable storage, capacity and monitoring. Account-specific topology, exact ports/rules, deployment automation and resource sizes will be reviewed during infrastructure implementation.

## Phase 0 conclusion

**Documentation feasibility: identified. Deployed feasibility: unverified.** This does not block local Phase 1 development. It blocks claiming the production topology has been proven or enabling live paid ordering without the remaining gates.

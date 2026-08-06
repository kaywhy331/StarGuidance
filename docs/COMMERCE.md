# Commerce verification

StarGuidance commerce is test-mode only on this branch and is hidden in the safe beta. Checkout and webhook processing both fail closed unless `ENABLE_PROFILE_REPORTS=true`; the UI additionally requires `NEXT_PUBLIC_ENABLE_PROFILE_REPORTS=true`. Both flags default false. When enabled, Checkout and the webhook still reject a live Stripe secret, and the webhook rejects `livemode: true` events. Removing those guards requires an approved price, refund/chargeback policy, Terms and Privacy Notice, launch region, support process, and a separate reviewed production change.

## Implemented lifecycle

| Provider event                                                                             | Durable behavior                                                                                         |
| ------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------- |
| `checkout.session.completed` / `checkout.session.async_payment_succeeded` with paid status | Marks the persisted order paid, grants one entitlement, generates one report, and records an audit event |
| `checkout.session.async_payment_failed` / `checkout.session.expired`                       | Marks the order failed and revokes any entitlement                                                       |
| `charge.refunded` for the full charge amount                                               | Marks the order refunded, revokes the entitlement, and immediately withholds the report                  |
| `charge.refunded` for part of the charge amount                                            | Records an audit event but does not silently choose an access policy                                     |
| `charge.dispute.created`                                                                   | Marks the order disputed and immediately revokes access                                                  |
| `charge.dispute.closed`                                                                    | Records the outcome for review; even a win does not silently restore access before policy approval       |

Ownership comes from the persisted order. Signed event metadata or payment-intent lookup may locate that order, but cannot supply a user or profile snapshot. Checkout copies only the internal order ID to provider metadata; no birth facts, question text, derived profile, or report prose is sent.

Webhook event claims use a five-minute database lease. Concurrent delivery is ignored while a claim is active, a caught processing failure releases the claim for Stripe retry, a crashed worker can be reclaimed after the lease expires, and a completed event is permanently deduplicated. Fulfillment is idempotent at the entitlement and report boundaries.

## Credentialed Stripe test

Use an owner-controlled Stripe test account and a public staging webhook endpoint. Never place key values, webhook payloads, customer email addresses, Checkout URLs, or dashboard screenshots in GitHub logs or the PR.

1. In an isolated commerce rehearsal only, configure `ENABLE_PROFILE_REPORTS=true`, `NEXT_PUBLIC_ENABLE_PROFILE_REPORTS=true`, `PAYMENTS_PROVIDER=stripe`, and test values for `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_PROFILE_REPORT_PRICE_ID`, and `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` in the narrowest deploy-preview scope.
2. Subscribe the endpoint to the lifecycle events listed above. Confirm the endpoint is HTTPS and the signing secret belongs to that exact endpoint.
3. Buy the report with a Stripe test card. Confirm one pending order becomes paid, one active entitlement and one ready report exist, and a repeated browser request/event creates no duplicate.
4. Replay the completed event, deliver two copies concurrently, and force one processing failure before retry. Confirm only the failed attempt is retried and fulfillment remains singular.
5. Perform a full test refund. Confirm the order is refunded, the entitlement is revoked, and both direct report fetch and report listing withhold access.
6. Exercise partial refund and dispute open/close scenarios. Confirm their audit actions match the table and have an approved operator resolution.
7. Confirm export includes the commercial record, account deletion removes user-owned commerce rows, and provider/finance retention follows the approved policy.

Automated signature, reconciliation, replay, refund, dispute, and revocation tests exist locally and in CI. Those checks are not a substitute for the credentialed owner-run procedure above; its redacted evidence must be attached to the exact release candidate.

Public launch also requires a durable asynchronous report job with retry/status handling, report access from account history, and an accessible PDF generated from the same structured source as the web report. The current synchronous local/test fulfillment and browser-printable page do not satisfy those requirements and must not be marketed as completed paid fulfillment.

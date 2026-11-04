import "server-only";

import { randomUUID } from "node:crypto";

import type { ApplicationRepositories, StoredOrder } from "@starguidance/database";
import type Stripe from "stripe";

import { tryRecordProductEvent } from "./product-telemetry";

type CommerceRepositories = Pick<
  ApplicationRepositories,
  "orders" | "entitlements" | "reports" | "reportFulfillment" | "audit"
>;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export interface StripeEventDependencies {
  stripe: Stripe;
  repositories: CommerceRepositories;
}

export class StripeReconciliationError extends Error {
  constructor() {
    super("STRIPE_EVENT_NOT_RECONCILED");
    this.name = "StripeReconciliationError";
  }
}

export function isStripeTestSecret(secretKey: string): boolean {
  return secretKey.startsWith("sk_test_");
}

function objectId(value: string | { id: string } | null): string | undefined {
  return typeof value === "string" ? value : value?.id;
}

function assertPersistedOrder(
  order: StoredOrder | undefined,
  providerSessionId: string,
  metadataOrderId: string | undefined,
  clientReferenceId: string | null,
): StoredOrder {
  if (
    !order ||
    order.provider !== "stripe" ||
    order.providerSessionId !== providerSessionId ||
    metadataOrderId !== order.id ||
    clientReferenceId !== order.id
  )
    throw new StripeReconciliationError();
  return order;
}

async function orderForSession(
  repositories: CommerceRepositories,
  session: Stripe.Checkout.Session,
): Promise<StoredOrder> {
  const metadataOrderId = session.metadata?.orderId;
  const current = await repositories.orders.getByProviderSession(session.id);
  if (current)
    return assertPersistedOrder(current, session.id, metadataOrderId, session.client_reference_id);
  // Replacing an expired Checkout session deliberately changes the order's
  // current provider_session_id. A later signed event for the superseded
  // session can still be located by the opaque order ID we originally wrote,
  // but ownership/snapshot state continues to come only from the stored row.
  if (
    !metadataOrderId ||
    !UUID.test(metadataOrderId) ||
    session.client_reference_id !== metadataOrderId
  )
    throw new StripeReconciliationError();
  const superseded = await repositories.orders.getByProviderReference(metadataOrderId);
  if (!superseded || superseded.provider !== "stripe") throw new StripeReconciliationError();
  return superseded;
}

async function orderForPaymentIntent(
  paymentIntent: string | { id: string } | null,
  dependencies: StripeEventDependencies,
): Promise<StoredOrder> {
  const paymentIntentId = objectId(paymentIntent);
  if (!paymentIntentId) throw new StripeReconciliationError();
  const sessions = await dependencies.stripe.checkout.sessions.list({
    payment_intent: paymentIntentId,
    limit: 2,
  });
  const [session] = sessions.data;
  if (!session || sessions.data.length !== 1) throw new StripeReconciliationError();
  return orderForSession(dependencies.repositories, session);
}

async function audit(
  repositories: CommerceRepositories,
  order: StoredOrder,
  action: string,
): Promise<void> {
  await repositories.audit.record({
    userId: order.userId,
    action,
    targetType: "order",
    targetId: order.id,
    metadata: { provider: "stripe" },
  });
}

async function fulfill(order: StoredOrder, dependencies: StripeEventDependencies): Promise<void> {
  const existing = await dependencies.repositories.reports.getByOrder(order.userId, order.id);
  if (!existing) {
    const now = new Date().toISOString();
    await dependencies.repositories.reportFulfillment.enqueuePaid({
      orderId: order.id,
      userId: order.userId,
      snapshotId: order.snapshotId,
      reportId: randomUUID(),
      entitlementId: randomUUID(),
      createdAt: now,
    });
  }
  // If fulfillment committed but this audit write failed, Stripe retries the
  // event. Auditing the existing-report path makes that retry complete the
  // durable receipt rather than silently accepting the event without it.
  await audit(dependencies.repositories, order, "payment.fulfillment_queued");
}

async function revoke(
  order: StoredOrder,
  status: "failed" | "refunded" | "disputed",
  action: string,
  repositories: CommerceRepositories,
): Promise<void> {
  await repositories.orders.setStatus(order.id, status);
  await repositories.entitlements.revokeByOrder(order.id);
  await repositories.orders.clearReportSource(order.id);
  await audit(repositories, order, action);
}

/**
 * Applies only provider-authenticated facts to the persisted order. User and
 * snapshot ownership always come from that order, never event metadata.
 */
export async function processStripeEvent(
  event: Stripe.Event,
  dependencies: StripeEventDependencies,
): Promise<void> {
  if (
    event.type === "checkout.session.completed" ||
    event.type === "checkout.session.async_payment_succeeded"
  ) {
    const session = event.data.object;
    if (session.payment_status === "paid") {
      const order = await orderForSession(dependencies.repositories, session);
      await fulfill(order, dependencies);
      await tryRecordProductEvent({
        idempotencyKey: `order:${order.id}:purchase-completed`,
        name: "purchase_completed",
        properties: {
          productId: "profile-report-v1",
          provider: "stripe",
          statusClass: "completed",
        },
      });
    }
    return;
  }

  if (event.type === "checkout.session.expired") {
    const session = event.data.object;
    const order = await orderForSession(dependencies.repositories, session);
    await audit(
      dependencies.repositories,
      order,
      order.providerSessionId === session.id
        ? "payment.checkout_expired"
        : "payment.superseded_session_closed",
    );
    // Expiration means no payment occurred, but it is intentionally not an
    // order failure: the return route can replace this session on the same
    // order. Keeping it pending also removes the race where the expiration
    // webhook clears the source while that replacement is being attached.
    return;
  }

  if (event.type === "checkout.session.async_payment_failed") {
    const session = event.data.object;
    const order = await orderForSession(dependencies.repositories, session);
    if (order.providerSessionId !== session.id)
      return audit(dependencies.repositories, order, "payment.superseded_session_closed");
    await revoke(order, "failed", "payment.failed", dependencies.repositories);
    await tryRecordProductEvent({
      idempotencyKey: `order:${order.id}:payment-failed`,
      name: "payment_failed",
      properties: {
        productId: "profile-report-v1",
        provider: "stripe",
        statusClass: "failed",
        errorClass: "provider_rejected",
      },
    });
    return;
  }

  if (event.type === "charge.refunded") {
    const charge = event.data.object;
    const order = await orderForPaymentIntent(charge.payment_intent, dependencies);
    if (charge.amount_refunded >= charge.amount) {
      await revoke(order, "refunded", "payment.refunded", dependencies.repositories);
    } else {
      await audit(dependencies.repositories, order, "payment.partial_refund.received");
    }
    return;
  }

  if (event.type === "charge.dispute.created") {
    const order = await orderForPaymentIntent(event.data.object.payment_intent, dependencies);
    await revoke(order, "disputed", "payment.disputed", dependencies.repositories);
    return;
  }

  if (event.type === "charge.dispute.closed") {
    const dispute = event.data.object;
    const order = await orderForPaymentIntent(dispute.payment_intent, dependencies);
    // Restoring access after a won dispute is an owner commerce-policy choice.
    // Keep access revoked and create a durable review signal either way.
    await audit(
      dependencies.repositories,
      order,
      dispute.status === "won" ? "payment.dispute_won_requires_review" : "payment.dispute_closed",
    );
  }
}

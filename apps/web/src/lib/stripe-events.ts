import "server-only";

import { randomUUID } from "node:crypto";

import type { ApplicationRepositories, StoredOrder } from "@starguidance/database";
import type Stripe from "stripe";

type CommerceRepositories = Pick<ApplicationRepositories, "orders" | "entitlements" | "audit">;

export interface StripeEventDependencies {
  stripe: Stripe;
  repositories: CommerceRepositories;
  generateReport(input: { userId: string; snapshotId: string; orderId: string }): Promise<unknown>;
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
): StoredOrder {
  if (
    !order ||
    order.provider !== "stripe" ||
    order.providerSessionId !== providerSessionId ||
    metadataOrderId !== order.id
  )
    throw new StripeReconciliationError();
  return order;
}

async function orderForSession(
  repositories: CommerceRepositories,
  session: Stripe.Checkout.Session,
): Promise<StoredOrder> {
  return assertPersistedOrder(
    await repositories.orders.getByProviderSession(session.id),
    session.id,
    session.metadata?.orderId,
  );
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
  await dependencies.repositories.orders.setStatus(order.id, "paid");
  await dependencies.repositories.entitlements.grant({
    id: randomUUID(),
    userId: order.userId,
    snapshotId: order.snapshotId,
    orderId: order.id,
    status: "active",
    createdAt: new Date().toISOString(),
  });
  await dependencies.generateReport({
    userId: order.userId,
    snapshotId: order.snapshotId,
    orderId: order.id,
  });
  await audit(dependencies.repositories, order, "payment.fulfilled");
}

async function revoke(
  order: StoredOrder,
  status: "failed" | "refunded" | "disputed",
  action: string,
  repositories: CommerceRepositories,
): Promise<void> {
  await repositories.orders.setStatus(order.id, status);
  await repositories.entitlements.revokeByOrder(order.id);
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
    if (session.payment_status === "paid")
      await fulfill(await orderForSession(dependencies.repositories, session), dependencies);
    return;
  }

  if (
    event.type === "checkout.session.async_payment_failed" ||
    event.type === "checkout.session.expired"
  ) {
    const order = await orderForSession(dependencies.repositories, event.data.object);
    await revoke(order, "failed", "payment.failed", dependencies.repositories);
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

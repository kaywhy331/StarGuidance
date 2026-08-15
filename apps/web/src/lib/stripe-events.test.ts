import type { ApplicationRepositories, StoredOrder } from "@starguidance/database";
import type Stripe from "stripe";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { processStripeEvent, type StripeEventDependencies } from "./stripe-events";

const order: StoredOrder = {
  id: "7be0594c-0dce-4fa7-8cab-4f48bf54e35b",
  userId: "2ae1a2ff-e5db-4e31-a504-ad0d8f82780d",
  snapshotId: "f312677a-88af-4765-95bb-50c61f185a8b",
  provider: "stripe",
  providerSessionId: "cs_test_starguidance",
  idempotencyKey: "00000000-0000-4000-8000-000000000002",
  status: "pending",
  createdAt: "2026-08-04T00:00:00.000Z",
};

const session = {
  id: order.providerSessionId,
  object: "checkout.session",
  client_reference_id: order.id,
  metadata: { orderId: order.id },
  payment_status: "paid",
} as unknown as Stripe.Checkout.Session;

const repositories = {
  orders: {
    getByProviderSession: vi.fn(),
    getByProviderReference: vi.fn(),
    clearReportSource: vi.fn(),
    setStatus: vi.fn(),
  },
  entitlements: {
    grant: vi.fn(),
    revokeByOrder: vi.fn(),
  },
  reports: { getByOrder: vi.fn() },
  reportFulfillment: { enqueuePaid: vi.fn() },
  audit: { record: vi.fn() },
};
const listSessions = vi.fn();

function event(type: Stripe.Event.Type, object: unknown): Stripe.Event {
  return {
    id: `evt_${type}`,
    object: "event",
    api_version: "2026-06-30.basil",
    created: 1_700_000_000,
    data: { object },
    livemode: false,
    pending_webhooks: 1,
    request: null,
    type,
  } as Stripe.Event;
}

function dependencies(): StripeEventDependencies {
  return {
    repositories: repositories as unknown as Pick<
      ApplicationRepositories,
      "orders" | "entitlements" | "reports" | "reportFulfillment" | "audit"
    >,
    stripe: {
      checkout: { sessions: { list: listSessions } },
    } as unknown as Stripe,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  repositories.orders.getByProviderSession.mockResolvedValue(order);
  repositories.orders.getByProviderReference.mockResolvedValue(order);
  listSessions.mockResolvedValue({ data: [session] });
  repositories.reports.getByOrder.mockResolvedValue(undefined);
  repositories.reportFulfillment.enqueuePaid.mockResolvedValue({ id: "report" });
});

describe("Stripe event reconciliation", () => {
  it("fulfills a paid Checkout session from persisted ownership", async () => {
    await processStripeEvent(event("checkout.session.completed", session), dependencies());

    expect(repositories.reportFulfillment.enqueuePaid).toHaveBeenCalledWith(
      expect.objectContaining({
        orderId: order.id,
        userId: order.userId,
        snapshotId: order.snapshotId,
      }),
    );
    expect(repositories.orders.setStatus).not.toHaveBeenCalled();
    expect(repositories.entitlements.grant).not.toHaveBeenCalled();
    expect(repositories.audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: "payment.fulfillment_queued" }),
    );
  });

  it("does not duplicate fulfillment but still records the retried paid event", async () => {
    repositories.reports.getByOrder.mockResolvedValue({ id: "report" });

    await processStripeEvent(
      event("checkout.session.async_payment_succeeded", session),
      dependencies(),
    );

    expect(repositories.reportFulfillment.enqueuePaid).not.toHaveBeenCalled();
    expect(repositories.audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: "payment.fulfillment_queued" }),
    );
  });

  it("uses the staged source when profile deletion has already nulled snapshot lineage", async () => {
    const detachedOrder = { ...order, snapshotId: null };
    repositories.orders.getByProviderSession.mockResolvedValue(detachedOrder);

    await processStripeEvent(event("checkout.session.completed", session), dependencies());

    expect(repositories.reportFulfillment.enqueuePaid).toHaveBeenCalledWith(
      expect.objectContaining({ snapshotId: null }),
    );
  });

  it("does not let a superseded session expiration fail its replacement order", async () => {
    const replacementOrder = { ...order, providerSessionId: "cs_test_replacement" };
    repositories.orders.getByProviderSession.mockResolvedValue(undefined);
    repositories.orders.getByProviderReference.mockResolvedValue(replacementOrder);

    await processStripeEvent(
      event("checkout.session.expired", { ...session, payment_status: "unpaid" }),
      dependencies(),
    );

    expect(repositories.orders.getByProviderReference).toHaveBeenCalledWith(order.id);
    expect(repositories.orders.setStatus).not.toHaveBeenCalled();
    expect(repositories.entitlements.revokeByOrder).not.toHaveBeenCalled();
    expect(repositories.audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: "payment.superseded_session_closed" }),
    );
  });

  it("keeps the current expired Checkout resumable on the same pending order", async () => {
    await processStripeEvent(
      event("checkout.session.expired", { ...session, payment_status: "unpaid" }),
      dependencies(),
    );

    expect(repositories.orders.setStatus).not.toHaveBeenCalled();
    expect(repositories.orders.clearReportSource).not.toHaveBeenCalled();
    expect(repositories.audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: "payment.checkout_expired" }),
    );
  });

  it("revokes report access after a full refund", async () => {
    await processStripeEvent(
      event("charge.refunded", {
        object: "charge",
        amount: 2400,
        amount_refunded: 2400,
        payment_intent: "pi_test_starguidance",
      }),
      dependencies(),
    );

    expect(listSessions).toHaveBeenCalledWith({
      payment_intent: "pi_test_starguidance",
      limit: 2,
    });
    expect(repositories.orders.setStatus).toHaveBeenCalledWith(order.id, "refunded");
    expect(repositories.entitlements.revokeByOrder).toHaveBeenCalledWith(order.id);
    expect(repositories.orders.clearReportSource).toHaveBeenCalledWith(order.id);
    expect(repositories.audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: "payment.refunded", userId: order.userId }),
    );
  });

  it("records a partial refund without silently choosing an access policy", async () => {
    await processStripeEvent(
      event("charge.refunded", {
        object: "charge",
        amount: 2400,
        amount_refunded: 400,
        payment_intent: "pi_test_starguidance",
      }),
      dependencies(),
    );

    expect(repositories.orders.setStatus).not.toHaveBeenCalled();
    expect(repositories.entitlements.revokeByOrder).not.toHaveBeenCalled();
    expect(repositories.audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: "payment.partial_refund.received" }),
    );
  });

  it("revokes immediately when a dispute opens", async () => {
    await processStripeEvent(
      event("charge.dispute.created", {
        object: "dispute",
        payment_intent: "pi_test_starguidance",
      }),
      dependencies(),
    );

    expect(repositories.orders.setStatus).toHaveBeenCalledWith(order.id, "disputed");
    expect(repositories.entitlements.revokeByOrder).toHaveBeenCalledWith(order.id);
  });

  it("fails closed when provider metadata does not match the persisted order", async () => {
    repositories.orders.getByProviderSession.mockResolvedValue(order);
    await expect(
      processStripeEvent(
        event("checkout.session.completed", {
          ...session,
          metadata: { orderId: "a113f4eb-19b0-4c83-bfe7-c78c3354a73f" },
        }),
        dependencies(),
      ),
    ).rejects.toThrow("STRIPE_EVENT_NOT_RECONCILED");
    expect(repositories.reportFulfillment.enqueuePaid).not.toHaveBeenCalled();
  });
});

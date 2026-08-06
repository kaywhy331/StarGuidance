import Stripe from "stripe";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { localStore } from "@/lib/local-store";
import { POST } from "./route";

const webhookSecret = "whsec_local_signature_test";

beforeEach(() => {
  vi.stubEnv("APP_ENV", "test");
  vi.stubEnv("RUNTIME_ADAPTER", "local");
  vi.stubEnv("ALLOW_LOCAL_RUNTIME_ADAPTER", "true");
  vi.stubEnv("PAYMENTS_PROVIDER", "stripe");
  vi.stubEnv("ENABLE_PROFILE_REPORTS", "true");
  vi.stubEnv("STRIPE_SECRET_KEY", "sk_test_local_only");
  vi.stubEnv("STRIPE_WEBHOOK_SECRET", webhookSecret);
  localStore.webhookEvents.clear();
  localStore.orders.clear();
});

afterEach(() => vi.unstubAllEnvs());

describe("Stripe webhook boundary", () => {
  it("fails closed while profile reports are disabled", async () => {
    vi.stubEnv("ENABLE_PROFILE_REPORTS", "false");

    const response = await POST(
      new Request("http://localhost/api/stripe/webhook", {
        method: "POST",
        body: "{}",
        headers: { "stripe-signature": "synthetic" },
      }),
    );

    expect(response.status).toBe(503);
    expect(localStore.webhookEvents.size).toBe(0);
  });

  it("rejects an invalid signature without processing an event", async () => {
    const response = await POST(
      new Request("http://localhost/api/stripe/webhook", {
        method: "POST",
        body: "{}",
        headers: { "stripe-signature": "invalid" },
      }),
    );
    expect(response.status).toBe(400);
  });

  it("accepts and idempotently ignores a correctly signed unrelated event", async () => {
    const payload = JSON.stringify({
      id: "evt_local_signature_test",
      object: "event",
      api_version: "2026-06-30.basil",
      created: 1_700_000_000,
      data: { object: { id: "cus_local", object: "customer" } },
      livemode: false,
      pending_webhooks: 1,
      request: null,
      type: "customer.created",
    });
    const signature = Stripe.webhooks.generateTestHeaderString({
      payload,
      secret: webhookSecret,
    });
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const response = await POST(
        new Request("http://localhost/api/stripe/webhook", {
          method: "POST",
          body: payload,
          headers: { "stripe-signature": signature },
        }),
      );
      expect(response.status).toBe(200);
    }
    expect(localStore.webhookEvents.get("evt_local_signature_test")?.attemptCount).toBe(1);
  });

  it("releases a failed event so Stripe can retry it", async () => {
    const payload = JSON.stringify({
      id: "evt_retry_after_order_race",
      object: "event",
      api_version: "2026-06-30.basil",
      created: 1_700_000_000,
      data: {
        object: {
          id: "cs_test_not_persisted_yet",
          object: "checkout.session",
          livemode: false,
          metadata: { orderId: "f431c480-ab9a-4c53-8604-2c84d772e75c" },
          payment_status: "paid",
        },
      },
      livemode: false,
      pending_webhooks: 1,
      request: null,
      type: "checkout.session.completed",
    });
    const signature = Stripe.webhooks.generateTestHeaderString({
      payload,
      secret: webhookSecret,
    });

    for (let attempt = 0; attempt < 2; attempt += 1) {
      const response = await POST(
        new Request("http://localhost/api/stripe/webhook", {
          method: "POST",
          body: payload,
          headers: { "stripe-signature": signature },
        }),
      );
      expect(response.status).toBe(500);
    }
    expect(localStore.webhookEvents.get("evt_retry_after_order_race")).toMatchObject({
      attemptCount: 2,
      lastFailureCode: "processing_failed",
      processed: false,
    });
  });

  it("rejects live-mode events on the test-only commerce boundary", async () => {
    const payload = JSON.stringify({
      id: "evt_live_rejected",
      object: "event",
      api_version: "2026-06-30.basil",
      created: 1_700_000_000,
      data: { object: { id: "cus_live", object: "customer" } },
      livemode: true,
      pending_webhooks: 1,
      request: null,
      type: "customer.created",
    });
    const signature = Stripe.webhooks.generateTestHeaderString({ payload, secret: webhookSecret });
    const response = await POST(
      new Request("http://localhost/api/stripe/webhook", {
        method: "POST",
        body: payload,
        headers: { "stripe-signature": signature },
      }),
    );
    expect(response.status).toBe(400);
    expect(localStore.webhookEvents.has("evt_live_rejected")).toBe(false);
  });
});

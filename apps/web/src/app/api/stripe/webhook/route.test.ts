import Stripe from "stripe";
import { afterEach, describe, expect, it, vi } from "vitest";

import { POST } from "./route";

const webhookSecret = "whsec_local_signature_test";

afterEach(() => vi.unstubAllEnvs());

describe("Stripe webhook boundary", () => {
  it("rejects an invalid signature without processing an event", async () => {
    vi.stubEnv("APP_ENV", "test");
    vi.stubEnv("STRIPE_SECRET_KEY", "sk_test_local_only");
    vi.stubEnv("STRIPE_WEBHOOK_SECRET", webhookSecret);
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
    vi.stubEnv("APP_ENV", "test");
    vi.stubEnv("STRIPE_SECRET_KEY", "sk_test_local_only");
    vi.stubEnv("STRIPE_WEBHOOK_SECRET", webhookSecret);
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
  });
});

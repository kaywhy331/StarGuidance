import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireUser: vi.fn(),
  assertRateLimit: vi.fn(),
  assertSameOrigin: vi.fn(),
  createCheckoutSession: vi.fn(),
  getActiveProfile: vi.fn(),
  getByIdempotencyKey: vi.fn(),
  createOrder: vi.fn(),
  listReports: vi.fn(),
  grantEntitlement: vi.fn(),
}));

vi.mock("stripe", () => ({
  default: class Stripe {
    checkout = { sessions: { create: mocks.createCheckoutSession } };
  },
}));

vi.mock("@/lib/auth", () => ({
  requireUser: mocks.requireUser,
}));

vi.mock("@/lib/persistence", () => ({
  persistenceFor: () => ({
    repositories: {
      birthProfiles: { getActive: mocks.getActiveProfile },
      orders: {
        getByIdempotencyKey: mocks.getByIdempotencyKey,
        create: mocks.createOrder,
      },
      reports: { list: mocks.listReports },
      entitlements: { grant: mocks.grantEntitlement },
    },
  }),
}));

vi.mock("@/lib/report", () => ({ generateProfileReport: vi.fn() }));
vi.mock("@/lib/request-security", () => ({
  assertRateLimit: mocks.assertRateLimit,
  assertSameOrigin: mocks.assertSameOrigin,
}));

import { POST } from "./route";

const snapshotId = "548e8158-2b54-4d28-a6bd-b6a4223f820b";
const key = "00000000-0000-4000-8000-000000000001";
const returnedOrderId = "c44b29e6-77eb-45c7-9890-51ba5e778f26";

function request(idempotencyKey = key): Request {
  return new Request("https://staging.invalid/api/reports/checkout", {
    method: "POST",
    headers: { "idempotency-key": idempotencyKey },
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requireUser.mockResolvedValue({
    id: "f1336b0d-9fb6-4903-b0f1-dba2e26e6143",
    email: "private@example.invalid",
  });
  vi.stubEnv("PAYMENTS_PROVIDER", "stripe");
  vi.stubEnv("STRIPE_SECRET_KEY", "sk_test_local_only");
  vi.stubEnv("STRIPE_PROFILE_REPORT_PRICE_ID", "price_test_profile_report");
  vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://staging.invalid");
  mocks.getActiveProfile.mockResolvedValue({ snapshot: { id: snapshotId } });
  mocks.getByIdempotencyKey.mockResolvedValue(undefined);
  mocks.listReports.mockResolvedValue([]);
  mocks.createCheckoutSession.mockResolvedValue({
    id: "cs_test_starguidance",
    metadata: { orderId: returnedOrderId },
    url: "https://checkout.stripe.test/session",
  });
});

afterEach(() => vi.unstubAllEnvs());

describe("Stripe Checkout boundary", () => {
  it("persists the order ID returned by an idempotently replayed Stripe request", async () => {
    const response = await POST(request());
    expect(response.status).toBe(200);

    const call = mocks.createCheckoutSession.mock.calls.at(0);
    expect(call).toBeDefined();
    const [parameters, options] = call as [
      { metadata: { orderId: string }; payment_intent_data: { metadata: { orderId: string } } },
      { idempotencyKey: string },
    ];
    expect(parameters.metadata.orderId).toBe(parameters.payment_intent_data.metadata.orderId);
    expect(options).toEqual({
      idempotencyKey: "f1336b0d-9fb6-4903-b0f1-dba2e26e6143:00000000-0000-4000-8000-000000000001",
    });
    expect(mocks.createOrder).toHaveBeenCalledWith(
      expect.objectContaining({
        id: returnedOrderId,
        snapshotId,
        providerSessionId: "cs_test_starguidance",
      }),
    );
    expect(await response.json()).toEqual({
      checkoutUrl: "https://checkout.stripe.test/session",
      orderId: returnedOrderId,
      adapter: "stripe",
    });
  });

  it("rejects user-controlled idempotency text instead of persisting it", async () => {
    const response = await POST(request("someone@example.com"));
    expect(response.status).toBe(400);
    expect(mocks.createCheckoutSession).not.toHaveBeenCalled();
  });

  it("refuses a live secret on the test-only checkout path", async () => {
    vi.stubEnv("STRIPE_SECRET_KEY", "sk_live_not_allowed");
    const response = await POST(request());
    expect(response.status).toBe(503);
    expect(mocks.createCheckoutSession).not.toHaveBeenCalled();
  });

  it("does not persist a Checkout session with no redirect URL", async () => {
    mocks.createCheckoutSession.mockResolvedValue({
      id: "cs_test_no_url",
      metadata: { orderId: returnedOrderId },
      url: null,
    });
    const response = await POST(request());
    expect(response.status).toBe(502);
    expect(mocks.createOrder).not.toHaveBeenCalled();
  });

  it("reports an unauthenticated request as 401", async () => {
    mocks.requireUser.mockRejectedValueOnce(new Error("UNAUTHENTICATED"));

    const response = await POST(request());

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "Authentication required." });
  });

  it("reports an invalid origin as 403", async () => {
    mocks.assertSameOrigin.mockImplementationOnce(() => {
      throw new Error("INVALID_ORIGIN");
    });

    const response = await POST(request());

    expect(response.status).toBe(403);
    expect(mocks.createCheckoutSession).not.toHaveBeenCalled();
  });

  it("reports a rate limit as 429 with a bounded retry interval", async () => {
    mocks.assertRateLimit.mockImplementationOnce(() => {
      throw new Error("RATE_LIMITED");
    });

    const response = await POST(request());

    expect(response.status).toBe(429);
    expect(response.headers.get("retry-after")).toBe("60");
    expect(mocks.createCheckoutSession).not.toHaveBeenCalled();
  });

  it("reports a Stripe transport failure as 502 without persisting an order", async () => {
    mocks.createCheckoutSession.mockRejectedValueOnce(new Error("provider detail"));

    const response = await POST(request());

    expect(response.status).toBe(502);
    expect(await response.json()).toEqual({
      error: "Stripe Checkout is temporarily unavailable.",
    });
    expect(mocks.createOrder).not.toHaveBeenCalled();
  });

  it("does not misclassify a persistence failure as authentication", async () => {
    mocks.getActiveProfile.mockRejectedValueOnce(new Error("database detail"));

    const response = await POST(request());

    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({
      error: "Checkout could not be prepared. Try again shortly.",
    });
    expect(mocks.createCheckoutSession).not.toHaveBeenCalled();
  });
});

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireUser: vi.fn(),
  assertCurrentPolicyConsents: vi.fn(),
  assertRateLimit: vi.fn(),
  assertSameOrigin: vi.fn(),
  createCheckoutSession: vi.fn(),
  retrieveCheckoutSession: vi.fn(),
  getActiveProfile: vi.fn(),
  getByIdempotencyKey: vi.fn(),
  getOrder: vi.fn(),
  listOrders: vi.fn(),
  replaceProviderSession: vi.fn(),
  createOrder: vi.fn(),
  getReportByOrder: vi.fn(),
  grantEntitlement: vi.fn(),
  prepareReportSource: vi.fn(),
  generateReport: vi.fn(),
}));

vi.mock("stripe", () => ({
  default: class Stripe {
    checkout = {
      sessions: {
        create: mocks.createCheckoutSession,
        retrieve: mocks.retrieveCheckoutSession,
      },
    };
  },
}));

vi.mock("@/lib/auth", () => ({
  requireUser: mocks.requireUser,
  assertCurrentPolicyConsents: mocks.assertCurrentPolicyConsents,
  POLICY_RECONSENT_REQUIRED: "POLICY_RECONSENT_REQUIRED",
}));

vi.mock("@/lib/persistence", () => ({
  persistenceFor: () => ({
    repositories: {
      birthProfiles: { getActive: mocks.getActiveProfile },
      orders: {
        getByIdempotencyKey: mocks.getByIdempotencyKey,
        get: mocks.getOrder,
        list: mocks.listOrders,
        replaceProviderSession: mocks.replaceProviderSession,
        create: mocks.createOrder,
      },
      reports: { getByOrder: mocks.getReportByOrder },
      entitlements: { grant: mocks.grantEntitlement },
    },
  }),
}));

vi.mock("@/lib/report", () => ({
  generateProfileReport: mocks.generateReport,
  prepareProfileReportSource: mocks.prepareReportSource,
}));
vi.mock("@/lib/request-security", () => ({
  assertRateLimit: mocks.assertRateLimit,
  assertSameOrigin: mocks.assertSameOrigin,
}));
vi.mock("@/lib/runtime-configuration", () => ({
  getRuntimeConfiguration: async () => ({
    commerce: {
      stripePriceId: process.env.STRIPE_PROFILE_REPORT_PRICE_ID,
      currency: "USD",
      priceMinor: 2900,
    },
    features: { profileReportsEnabled: process.env.ENABLE_PROFILE_REPORTS === "true" },
  }),
  profileReportsEnabled: (configuration: { features: { profileReportsEnabled: boolean } }) =>
    process.env.ENABLE_PROFILE_REPORTS === "true" && configuration.features.profileReportsEnabled,
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
  vi.stubEnv("ENABLE_PROFILE_REPORTS", "true");
  vi.stubEnv("STRIPE_SECRET_KEY", "sk_test_local_only");
  vi.stubEnv("STRIPE_PROFILE_REPORT_PRICE_ID", "price_test_profile_report");
  vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://staging.invalid");
  mocks.getActiveProfile.mockResolvedValue({ snapshot: { id: snapshotId } });
  mocks.getByIdempotencyKey.mockResolvedValue(undefined);
  mocks.listOrders.mockResolvedValue([]);
  mocks.getReportByOrder.mockResolvedValue(undefined);
  mocks.replaceProviderSession.mockResolvedValue(true);
  mocks.prepareReportSource.mockResolvedValue("encrypted-derived-source");
  mocks.generateReport.mockResolvedValue({ id: "local-report" });
  mocks.createCheckoutSession.mockResolvedValue({
    id: "cs_test_starguidance",
    metadata: { orderId: returnedOrderId },
    url: "https://checkout.stripe.test/session",
  });
  mocks.retrieveCheckoutSession.mockResolvedValue({
    id: "cs_test_starguidance",
    status: "open",
    url: "https://checkout.stripe.test/session",
  });
});

afterEach(() => vi.unstubAllEnvs());

describe("Stripe Checkout boundary", () => {
  it("fails closed while profile reports are disabled", async () => {
    vi.stubEnv("ENABLE_PROFILE_REPORTS", "false");

    const response = await POST(request());

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({
      error: "Profile reports are not available in this beta.",
    });
    expect(mocks.requireUser).not.toHaveBeenCalled();
    expect(mocks.createCheckoutSession).not.toHaveBeenCalled();
  });

  it.each(["", "strpie"])(
    "fails closed when the enabled payment provider is %j",
    async (provider) => {
      vi.stubEnv("PAYMENTS_PROVIDER", provider);

      const response = await POST(request());

      expect(response.status).toBe(503);
      expect(await response.json()).toEqual({
        error: "Profile report payments are not configured for this environment.",
      });
      expect(mocks.requireUser).not.toHaveBeenCalled();
      expect(mocks.createOrder).not.toHaveBeenCalled();
      expect(mocks.grantEntitlement).not.toHaveBeenCalled();
      expect(mocks.generateReport).not.toHaveBeenCalled();
    },
  );

  it("rejects local fulfillment in a hosted runtime", async () => {
    vi.stubEnv("PAYMENTS_PROVIDER", "local");
    vi.stubEnv("APP_ENV", "test");
    vi.stubEnv("RUNTIME_ADAPTER", "local");
    vi.stubEnv("ALLOW_LOCAL_RUNTIME_ADAPTER", "true");
    vi.stubEnv("SITE_ID", "hosted-site");

    const response = await POST(request());

    expect(response.status).toBe(503);
    expect(mocks.requireUser).not.toHaveBeenCalled();
    expect(mocks.createOrder).not.toHaveBeenCalled();
    expect(mocks.grantEntitlement).not.toHaveBeenCalled();
    expect(mocks.generateReport).not.toHaveBeenCalled();
  });

  it("permits local fulfillment only in an explicitly authorized local test runtime", async () => {
    vi.stubEnv("PAYMENTS_PROVIDER", "local");
    vi.stubEnv("APP_ENV", "test");
    vi.stubEnv("RUNTIME_ADAPTER", "local");
    vi.stubEnv("ALLOW_LOCAL_RUNTIME_ADAPTER", "true");
    vi.stubEnv("SITE_ID", "");
    vi.stubEnv("SITE_NAME", "");

    const response = await POST(request());

    expect(response.status).toBe(201);
    expect(await response.json()).toEqual({ reportId: "local-report", adapter: "local" });
    expect(mocks.createOrder).toHaveBeenCalledWith(
      expect.objectContaining({ provider: "local", status: "paid" }),
    );
    expect(mocks.grantEntitlement).toHaveBeenCalledOnce();
    expect(mocks.generateReport).toHaveBeenCalledOnce();
    expect(mocks.createCheckoutSession).not.toHaveBeenCalled();
  });

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
      idempotencyKey:
        "f1336b0d-9fb6-4903-b0f1-dba2e26e6143:548e8158-2b54-4d28-a6bd-b6a4223f820b:purchase:0",
    });
    expect(mocks.createOrder).toHaveBeenCalledWith(
      expect.objectContaining({
        id: returnedOrderId,
        snapshotId,
        providerSessionId: "cs_test_starguidance",
      }),
      "encrypted-derived-source",
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

  it("returns the live URL for a cancelled-but-open Checkout session", async () => {
    mocks.getByIdempotencyKey.mockResolvedValue({
      id: returnedOrderId,
      userId: "f1336b0d-9fb6-4903-b0f1-dba2e26e6143",
      snapshotId,
      provider: "stripe",
      providerSessionId: "cs_test_starguidance",
      idempotencyKey: key,
      status: "pending",
    });

    const response = await POST(request());

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      checkoutUrl: "https://checkout.stripe.test/session",
      orderId: returnedOrderId,
      status: "pending",
      adapter: "stripe",
    });
    expect(mocks.retrieveCheckoutSession).toHaveBeenCalledWith("cs_test_starguidance");
    expect(mocks.createCheckoutSession).not.toHaveBeenCalled();
  });

  it("replaces an expired session without replacing its order", async () => {
    mocks.getByIdempotencyKey.mockResolvedValue({
      id: returnedOrderId,
      userId: "f1336b0d-9fb6-4903-b0f1-dba2e26e6143",
      snapshotId,
      provider: "stripe",
      providerSessionId: "cs_test_expired",
      idempotencyKey: key,
      status: "pending",
    });
    mocks.retrieveCheckoutSession.mockResolvedValue({
      id: "cs_test_expired",
      status: "expired",
      url: null,
    });
    mocks.createCheckoutSession.mockResolvedValue({
      id: "cs_test_replacement",
      metadata: { orderId: returnedOrderId },
      status: "open",
      url: "https://checkout.stripe.test/replacement",
    });

    const response = await POST(request());

    expect(response.status).toBe(200);
    expect(mocks.replaceProviderSession).toHaveBeenCalledWith(
      "f1336b0d-9fb6-4903-b0f1-dba2e26e6143",
      returnedOrderId,
      "cs_test_expired",
      "cs_test_replacement",
    );
    expect(mocks.createOrder).not.toHaveBeenCalled();
    expect(await response.json()).toEqual(
      expect.objectContaining({
        checkoutUrl: "https://checkout.stripe.test/replacement",
        orderId: returnedOrderId,
      }),
    );
  });

  it("returns an existing paid report instead of selling the same snapshot twice", async () => {
    mocks.listOrders.mockResolvedValue([
      {
        id: returnedOrderId,
        userId: "f1336b0d-9fb6-4903-b0f1-dba2e26e6143",
        snapshotId,
        provider: "stripe",
        providerSessionId: "cs_test_paid",
        idempotencyKey: "00000000-0000-4000-8000-000000000099",
        status: "paid",
      },
    ]);
    mocks.getReportByOrder.mockResolvedValue({ id: "report-ready", status: "ready" });

    const response = await POST(request());

    expect(await response.json()).toEqual({
      reportId: "report-ready",
      status: "paid",
      reportStatus: "ready",
      adapter: "stripe",
    });
    expect(mocks.createCheckoutSession).not.toHaveBeenCalled();
  });

  it("uses a new provider attempt after a terminal order without reusing a payable session", async () => {
    mocks.listOrders.mockResolvedValue([
      {
        id: returnedOrderId,
        userId: "f1336b0d-9fb6-4903-b0f1-dba2e26e6143",
        snapshotId,
        provider: "stripe",
        providerSessionId: "cs_test_failed",
        idempotencyKey: "00000000-0000-4000-8000-000000000099",
        status: "failed",
      },
    ]);

    const response = await POST(request());

    expect(response.status).toBe(200);
    expect(mocks.createCheckoutSession.mock.calls.at(0)?.[1]).toEqual({
      idempotencyKey:
        "f1336b0d-9fb6-4903-b0f1-dba2e26e6143:548e8158-2b54-4d28-a6bd-b6a4223f820b:purchase:1",
    });
  });

  it("recovers a paid report after profile deletion using only the retained order", async () => {
    mocks.getByIdempotencyKey.mockResolvedValue({
      id: returnedOrderId,
      userId: "f1336b0d-9fb6-4903-b0f1-dba2e26e6143",
      snapshotId: null,
      provider: "stripe",
      providerSessionId: "cs_test_paid",
      idempotencyKey: key,
      status: "paid",
    });
    mocks.getReportByOrder.mockResolvedValue({ id: "report-retained", status: "ready" });

    const response = await POST(request());

    expect(await response.json()).toEqual({
      reportId: "report-retained",
      status: "paid",
      reportStatus: "ready",
      adapter: "stripe",
    });
    expect(mocks.getActiveProfile).not.toHaveBeenCalled();
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

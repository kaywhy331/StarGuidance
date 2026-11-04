import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./runtime", () => ({
  getRuntimeAdapter: () => "local",
  getSystemDatabaseClient: vi.fn(),
}));

import { localStore } from "./local-store";
import {
  classifyProductProvider,
  productModelVersion,
  productDurationBucket,
  productEventSchema,
  recordProductEvent,
  type ProductEvent,
} from "./product-telemetry";

beforeEach(() => localStore.productEvents.clear());

describe("privacy-safe product telemetry", () => {
  it("accepts only the closed event and property vocabulary", () => {
    expect(
      productEventSchema.safeParse({
        idempotencyKey: "browser:00000000-0000-4000-8000-000000000001",
        name: "result_viewed",
        properties: { routeClass: "result", deviceClass: "mobile" },
      }).success,
    ).toBe(true);

    for (const properties of [
      { email: "reader@example.test" },
      { birthDate: "1990-01-01" },
      { question: "Will this private thing happen?" },
      { cardId: "the-tower" },
      { pathname: "/reading/private-id" },
      { exception: "provider quoted private input" },
    ])
      expect(
        productEventSchema.safeParse({
          idempotencyKey: "browser:00000000-0000-4000-8000-000000000002",
          name: "result_viewed",
          properties,
        }).success,
      ).toBe(false);
  });

  it("reduces provider provenance to an approved provider class and model version", () => {
    expect(classifyProductProvider("groq:openai/gpt-oss-120b")).toBe("groq");
    expect(productModelVersion("groq:openai/gpt-oss-120b")).toBe("openai/gpt-oss-120b");
    expect(productModelVersion("deterministic-fallback-v1:after-groq-provider-unavailable")).toBe(
      "deterministic-fallback-v1",
    );
  });

  it("digests idempotency identifiers and collapses an exact replay", async () => {
    const event: ProductEvent = {
      idempotencyKey: "reading:00000000-0000-4000-8000-000000000003:draw",
      name: "draw_locked",
      properties: { spreadId: "three-card", cardCount: 3 },
    };

    await recordProductEvent(event);
    await recordProductEvent(event);

    expect(localStore.productEvents.size).toBe(1);
    const [storedKey] = localStore.productEvents.keys();
    expect(storedKey).toMatch(/^[0-9a-f]{64}$/);
    expect(storedKey).not.toContain("00000000-0000-4000-8000-000000000003");
  });

  it("classifies provider provenance without persisting its free-form identifier", () => {
    expect(classifyProductProvider("groq:approved-model")).toBe("groq");
    expect(classifyProductProvider("groq-gateway:approved-model")).toBe("groq-gateway");
    expect(classifyProductProvider("deterministic-fallback-v1:after-timeout")).toBe(
      "deterministic",
    );
  });

  it("maps generation time into a closed latency bucket", () => {
    expect(
      [0, 999, 1_000, 4_999, 5_000, 14_999, 15_000, 39_999, 40_000].map(productDurationBucket),
    ).toEqual(["lt_1s", "lt_1s", "1_5s", "1_5s", "5_15s", "5_15s", "15_40s", "15_40s", "gt_40s"]);
  });
});

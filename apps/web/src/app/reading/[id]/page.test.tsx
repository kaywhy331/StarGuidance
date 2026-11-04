import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getRuntimeConfiguration: vi.fn(),
  requireUser: vi.fn(),
}));

vi.mock("next/navigation", () => ({ redirect: vi.fn() }));
vi.mock("@/lib/auth", () => ({ requireUser: mocks.requireUser }));
vi.mock("@/lib/runtime-configuration", () => ({
  getRuntimeConfiguration: mocks.getRuntimeConfiguration,
}));

import ReadingResultPage from "./page";
import { ReadingResultScene } from "./reading-result-scene";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requireUser.mockResolvedValue({ requiresPolicyReconsent: false });
});

describe("result animation runtime control", () => {
  it("keeps the result accessible when the animation kill switch is active", async () => {
    mocks.getRuntimeConfiguration.mockResolvedValue({
      features: { animationsEnabled: false, animationVariant: "immersive-v1" },
    });

    const page = await ReadingResultPage({ params: Promise.resolve({ id: "reading-id" }) });

    expect(page.type).toBe(ReadingResultScene);
    expect(page.props).toMatchObject({ animationVariant: "disabled", readingId: "reading-id" });
  });
});

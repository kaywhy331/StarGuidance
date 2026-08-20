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

import { ReadingScene } from "./reading-scene";
import SessionPage from "./page";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requireUser.mockResolvedValue({ requiresPolicyReconsent: false });
});

describe("session animation runtime control", () => {
  it("forces the complete non-motion path when animations are disabled", async () => {
    mocks.getRuntimeConfiguration.mockResolvedValue({
      features: { animationsEnabled: false, animationVariant: "immersive-v1" },
    });

    const page = await SessionPage({ params: Promise.resolve({ id: "reading-id" }) });

    expect(page.type).toBe(ReadingScene);
    expect(page.props).toMatchObject({ animationVariant: "disabled", readingId: "reading-id" });
  });

  it("passes the reviewed quiet animation variant without a deploy", async () => {
    mocks.getRuntimeConfiguration.mockResolvedValue({
      features: { animationsEnabled: true, animationVariant: "quiet-v1" },
    });

    const page = await SessionPage({ params: Promise.resolve({ id: "reading-id" }) });

    expect(page.props.animationVariant).toBe("quiet-v1");
  });
});

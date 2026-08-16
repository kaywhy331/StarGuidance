import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ requireUser: vi.fn() }));
vi.mock("./auth", () => ({ requireUser: mocks.requireUser }));

import { OPERATIONAL_ACCESS_DENIED, requireOperationalRole } from "./operational-access";

const supportId = "00000000-0000-4000-8000-000000000061";
const operatorId = "00000000-0000-4000-8000-000000000062";

beforeEach(() => {
  mocks.requireUser.mockResolvedValue({ id: supportId, email: "masked@example.test" });
  vi.stubEnv("SUPPORT_USER_IDS", supportId);
  vi.stubEnv("OPERATOR_USER_IDS", operatorId);
});
afterEach(() => vi.unstubAllEnvs());

describe("operational role boundary", () => {
  it("lets support inspect but never mutate", async () => {
    await expect(requireOperationalRole("support")).resolves.toMatchObject({
      operationalRole: "support",
    });
    await expect(requireOperationalRole("operator")).rejects.toThrow(OPERATIONAL_ACCESS_DENIED);
  });

  it("lets an explicit operator inspect and mutate", async () => {
    mocks.requireUser.mockResolvedValue({ id: operatorId, email: "masked@example.test" });
    await expect(requireOperationalRole("support")).resolves.toMatchObject({
      operationalRole: "operator",
    });
    await expect(requireOperationalRole("operator")).resolves.toMatchObject({
      operationalRole: "operator",
    });
  });

  it("fails closed for an unlisted user or malformed allowlist", async () => {
    mocks.requireUser.mockResolvedValue({
      id: "00000000-0000-4000-8000-000000000063",
      email: "masked@example.test",
    });
    await expect(requireOperationalRole("support")).rejects.toThrow(OPERATIONAL_ACCESS_DENIED);
    vi.stubEnv("SUPPORT_USER_IDS", "not-a-uuid");
    await expect(requireOperationalRole("support")).rejects.toThrow(
      "OPERATIONAL_ACCESS_MISCONFIGURED",
    );
  });
});

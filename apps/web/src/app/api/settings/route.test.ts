import { beforeEach, describe, expect, it, vi } from "vitest";

import type { ConsentRecord, UserSettingsRecord } from "@starguidance/database";

const mocks = vi.hoisted(() => ({
  requireUser: vi.fn(),
  settingsGet: vi.fn(),
  settingsUpsert: vi.fn(),
  consentGrant: vi.fn(),
  consentWithdraw: vi.fn(),
  recordAudit: vi.fn(),
  assertRateLimit: vi.fn(),
}));

let settings: UserSettingsRecord | undefined;
let consents: ConsentRecord[];
const user = {
  id: "b595d548-0ad4-4f12-9c2a-559b93c239cf",
  email: "reader@example.test",
  profile: undefined,
};

vi.mock("@/lib/auth", () => ({ requireUser: mocks.requireUser }));
vi.mock("@/lib/persistence", () => ({
  persistenceFor: () => ({
    repositories: {
      settings: { get: mocks.settingsGet, upsert: mocks.settingsUpsert },
      consents: { grant: mocks.consentGrant, withdraw: mocks.consentWithdraw },
    },
  }),
  recordAudit: mocks.recordAudit,
}));
vi.mock("@/lib/request-security", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/request-security")>()),
  assertRateLimit: mocks.assertRateLimit,
}));

import { GET, PATCH } from "./route";

function patchRequest(body: Record<string, unknown>): Request {
  return new Request("https://synthetic.invalid/api/settings", {
    method: "PATCH",
    headers: {
      origin: "https://synthetic.invalid",
      host: "synthetic.invalid",
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  settings = undefined;
  consents = [];
  vi.clearAllMocks();
  mocks.requireUser.mockImplementation(async () => ({
    ...user,
    settings,
    consentRecords: consents,
  }));
  mocks.settingsGet.mockImplementation(async () => settings);
  mocks.settingsUpsert.mockImplementation(async (record: UserSettingsRecord) => {
    settings = record;
  });
  mocks.consentGrant.mockImplementation(async (_userId: string, record: ConsentRecord) => {
    const current = consents.find(
      ({ policy, version, withdrawnAt }) =>
        policy === record.policy && version === record.version && !withdrawnAt,
    );
    if (!current) consents.push({ ...record });
  });
  mocks.consentWithdraw.mockImplementation(
    async (_userId: string, policy: string, withdrawnAt: string) => {
      let changed = false;
      for (const record of consents)
        if (record.policy === policy && !record.withdrawnAt) {
          record.withdrawnAt = withdrawnAt;
          changed = true;
        }
      return changed;
    },
  );
});

describe("account settings and consent route", () => {
  it("reports an explicit re-consent state without inventing a display identity", async () => {
    const response = await GET();
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.settings).toMatchObject({ displayName: "Reader", soundEnabled: true });
    expect(body.settingsPersisted).toBe(false);
    expect(body.consents.requiredCurrent).toBe(false);
  });

  it("records every current required policy before continuing", async () => {
    const response = await PATCH(
      patchRequest({
        action: "accept-required-policies",
        termsAccepted: true,
        termsVersion: "terms-beta-2026-08-05",
        privacyAccepted: true,
        privacyVersion: "privacy-beta-2026-08-05",
        ageConfirmed: true,
        ageEligibilityVersion: "age-18-beta-2026-08-05",
      }),
    );

    expect(response.status).toBe(200);
    expect(mocks.consentGrant).toHaveBeenCalledTimes(3);
    expect((await response.json()).consents.requiredCurrent).toBe(true);
    expect(mocks.recordAudit).toHaveBeenCalledWith(
      user.id,
      "consent.required.accepted",
      "account",
      user.id,
    );
  });

  it("persists display and reading preferences while keeping marketing reversible", async () => {
    const accepted = await PATCH(
      patchRequest({
        action: "update-account-settings",
        displayName: "Nova",
        soundEnabled: true,
        reducedMotion: true,
        marketingAccepted: true,
        marketingVersion: "marketing-beta-v1",
      }),
    );
    expect((await accepted.json()).consents.marketingAccepted).toBe(true);
    expect(settings).toMatchObject({
      displayName: "Nova",
      soundEnabled: true,
      reducedMotion: true,
    });

    const withdrawn = await PATCH(
      patchRequest({
        action: "update-account-settings",
        displayName: "Nova",
        soundEnabled: false,
        reducedMotion: true,
        marketingAccepted: false,
        marketingVersion: "marketing-beta-v1",
      }),
    );
    expect((await withdrawn.json()).consents.marketingAccepted).toBe(false);
    const firstGrant = consents.find(({ policy }) => policy === "marketing");
    expect(firstGrant?.withdrawnAt).toBeDefined();

    const regranted = await PATCH(
      patchRequest({
        action: "update-account-settings",
        displayName: "Nova",
        soundEnabled: false,
        reducedMotion: true,
        marketingAccepted: true,
        marketingVersion: "marketing-beta-v1",
      }),
    );
    expect((await regranted.json()).consents.marketingAccepted).toBe(true);
    expect(consents.filter(({ policy }) => policy === "marketing")).toHaveLength(2);
    expect(consents[0]).toEqual(firstGrant);
    expect(firstGrant?.withdrawnAt).toBeDefined();
    expect(consents[1]?.withdrawnAt).toBeUndefined();
  });

  it("updates scene preferences without replacing the display name", async () => {
    settings = {
      userId: user.id,
      displayName: "Nova",
      soundEnabled: false,
      reducedMotion: false,
    };
    const response = await PATCH(
      patchRequest({
        action: "update-reading-preferences",
        soundEnabled: true,
        reducedMotion: true,
      }),
    );

    expect(response.status).toBe(200);
    expect(settings).toMatchObject({
      displayName: "Nova",
      soundEnabled: true,
      reducedMotion: true,
    });
  });
});

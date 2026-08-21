import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  adapter: vi.fn<() => "local" | "supabase">(),
  client: vi.fn(),
}));

vi.mock("./runtime", () => ({
  getRuntimeAdapter: mocks.adapter,
  getSystemDatabaseClient: () => mocks.client,
}));

import {
  defaultRuntimeConfiguration,
  getRuntimeConfiguration,
  interpretationRuntimeOptions,
  parseRuntimeConfigurationPayload,
  profileReportsEnabled,
} from "./runtime-configuration";

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("AI_PROVIDER_ALLOWED_MODELS", "approved-primary,approved-fallback");
  vi.stubEnv("AI_PROVIDER_MODEL", "approved-primary");
  vi.stubEnv("AI_PROVIDER_FALLBACK_MODELS", "approved-fallback");
  mocks.adapter.mockReturnValue("local");
  mocks.client.mockResolvedValue([]);
});

afterEach(() => vi.unstubAllEnvs());

describe("governed runtime configuration", () => {
  it("uses conservative environment defaults when no durable control plane exists", async () => {
    vi.stubEnv("ENABLE_PROFILE_REPORTS", "true");
    vi.stubEnv("STRIPE_PROFILE_REPORT_PRICE_ID", "price_reviewed_v1");
    const configuration = await getRuntimeConfiguration();

    expect(configuration.content.enabledSpreadIds).toHaveLength(6);
    expect(configuration.prompts.bundleId).toBe("reader-voice-v3");
    expect(configuration.models.primaryModel).toBe("approved-primary");
    expect(profileReportsEnabled(configuration)).toBe(true);
  });

  it("rejects unknown content, prompt, arbitrary fields, and unapproved models", () => {
    expect(() =>
      parseRuntimeConfigurationPayload("content", {
        ...defaultRuntimeConfiguration().content,
        enabledSpreadIds: ["invented-spread"],
      }),
    ).toThrow();
    expect(() =>
      parseRuntimeConfigurationPayload("prompts", {
        bundleId: "unreviewed-prompt",
        safetyPolicyVersion: "question-safety-v2",
      }),
    ).toThrow();
    expect(() =>
      parseRuntimeConfigurationPayload("features", {
        ...defaultRuntimeConfiguration().features,
        arbitraryFlag: true,
      }),
    ).toThrow();
    expect(() =>
      parseRuntimeConfigurationPayload("models", {
        liveAiEnabled: true,
        primaryModel: "unapproved-model",
        fallbackModels: [],
        disabledModels: [],
      }),
    ).toThrow("RUNTIME_MODEL_NOT_APPROVED");
  });

  it("applies one published version per domain and makes kill switches restrictive", async () => {
    mocks.adapter.mockReturnValue("supabase");
    mocks.client
      .mockResolvedValueOnce([
        {
          domain: "prompts",
          version: 2,
          payload: {
            bundleId: "reader-voice-v3-grounded",
            safetyPolicyVersion: "question-safety-v2",
          },
        },
        {
          domain: "models",
          version: 4,
          payload: {
            liveAiEnabled: true,
            primaryModel: "approved-primary",
            fallbackModels: ["approved-fallback"],
            disabledModels: ["approved-primary"],
          },
        },
      ])
      .mockResolvedValueOnce([
        { target_type: "deck", target_id: "starguidance-illustrated-v3" },
        ...defaultRuntimeConfiguration().content.enabledSpreadIds.map((target_id) => ({
          target_type: "spread",
          target_id,
        })),
        { target_type: "product", target_id: "profile-report-v1" },
      ]);

    const configuration = await getRuntimeConfiguration();
    const activeControlSql = (mocks.client.mock.calls[1]?.[0] as TemplateStringsArray).join(" ");
    expect(activeControlSql).toContain("group by id having bool_and(active)");
    expect(configuration.versions).toMatchObject({ prompts: 2, models: 4 });
    expect(interpretationRuntimeOptions(configuration)).toEqual({
      enabled: true,
      modelChain: ["approved-fallback"],
      promptBundleId: "reader-voice-v3-grounded",
    });

    configuration.models.liveAiEnabled = false;
    expect(interpretationRuntimeOptions(configuration).enabled).toBe(false);
  });
});

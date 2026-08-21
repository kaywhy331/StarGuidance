import { describe, expect, it } from "vitest";

import { normalizeProductOperationalSignals } from "./operational-signals";

describe("product operational signals", () => {
  it("maps only the fixed aggregate counters", () => {
    expect(
      normalizeProductOperationalSignals({
        auth_failures_5m: 3,
        profile_failures_5m: 2,
        generation_failures_5m: 1,
        payment_failures_15m: 4,
        slow_generations_5m: 5,
        live_generations_60m: 6,
      }),
    ).toEqual({
      authFailures5m: 3,
      profileFailures5m: 2,
      generationFailures5m: 1,
      paymentFailures15m: 4,
      slowGenerations5m: 5,
      liveGenerations60m: 6,
    });
  });

  it("fails malformed or absent counters closed to zero", () => {
    expect(
      normalizeProductOperationalSignals({
        auth_failures_5m: -1,
        profile_failures_5m: Number.NaN,
      }),
    ).toEqual({
      authFailures5m: 0,
      profileFailures5m: 0,
      generationFailures5m: 0,
      paymentFailures15m: 0,
      slowGenerations5m: 0,
      liveGenerations60m: 0,
    });
  });
});

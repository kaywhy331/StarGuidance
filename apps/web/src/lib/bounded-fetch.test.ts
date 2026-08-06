import { describe, expect, it, vi } from "vitest";

import { createBoundedFetch } from "./bounded-fetch";

describe("bounded provider fetch", () => {
  it("aborts a provider request after the configured deadline", async () => {
    let observedSignal: AbortSignal | undefined;
    const implementation = vi.fn(
      (_input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
        observedSignal = init?.signal ?? undefined;
        return new Promise((_resolve, reject) => {
          observedSignal?.addEventListener("abort", () => reject(observedSignal?.reason), {
            once: true,
          });
        });
      },
    ) as unknown as typeof fetch;

    await expect(
      createBoundedFetch(implementation, 5)("https://synthetic.invalid/provider"),
    ).rejects.toMatchObject({ name: "TimeoutError" });
    expect(observedSignal?.aborted).toBe(true);
  });

  it("preserves a caller cancellation signal", async () => {
    const implementation = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      void input;
      void init;
      return new Response(null, { status: 204 });
    });
    const controller = new AbortController();

    await createBoundedFetch(implementation as unknown as typeof fetch, 1_000)(
      "https://synthetic.invalid/provider",
      { signal: controller.signal },
    );
    const forwarded = implementation.mock.calls[0]?.[1]?.signal;
    controller.abort(new Error("caller cancelled"));

    expect(forwarded).toBeInstanceOf(AbortSignal);
    expect(forwarded?.aborted).toBe(true);
  });

  it("rejects invalid deadlines before making a request", () => {
    expect(() => createBoundedFetch(fetch, 0)).toThrow(RangeError);
  });
});

import { describe, expect, it, vi } from "vitest";

import {
  createReadingAudioProvider,
  fishAudioConfiguration,
  readingAudioAvailable,
  ReadingAudioProviderError,
} from "./reading-audio";

const configuredEnvironment = {
  READING_AUDIO_PROVIDER: "fish-audio",
  FISH_AUDIO_API_KEY: "fish-secret-key",
  FISH_AUDIO_MODEL: "s2.1-pro",
  FISH_AUDIO_REFERENCE_ID: "voice_model_12345678",
  FISH_AUDIO_TIMEOUT_MS: "30000",
};

describe("Fish Audio reading provider", () => {
  it("fails closed while the audio provider is disabled", () => {
    expect(() => fishAudioConfiguration({ READING_AUDIO_PROVIDER: "disabled" })).toThrowError(
      expect.objectContaining<Partial<ReadingAudioProviderError>>({
        code: "READING_AUDIO_DISABLED",
      }),
    );
  });

  it("requires an explicit supported model, voice, and secret", () => {
    expect(() =>
      fishAudioConfiguration({
        READING_AUDIO_PROVIDER: "fish-audio",
        FISH_AUDIO_API_KEY: "fish-secret-key",
      }),
    ).toThrowError(
      expect.objectContaining<Partial<ReadingAudioProviderError>>({
        code: "READING_AUDIO_MISCONFIGURED",
      }),
    );
  });

  it("exposes only a safe availability hint to server-rendered reading scenes", () => {
    expect(readingAudioAvailable(configuredEnvironment)).toBe(true);
    expect(readingAudioAvailable({ READING_AUDIO_PROVIDER: "fish-audio" })).toBe(false);
  });

  it("streams timestamped MP3 events with the key confined to the Fish request header", async () => {
    const event = 'data: {"audio_base64":"SUQzBA==","alignment":null,"chunk_seq":0}\n\n';
    const implementation = vi.fn<typeof fetch>(async () =>
      Promise.resolve(
        new Response(event, { status: 200, headers: { "content-type": "text/event-stream" } }),
      ),
    );
    const provider = createReadingAudioProvider(configuredEnvironment, implementation);

    const stream = await provider.stream("Reflection. Take one grounded step.");
    const payload = await new Response(stream).text();

    expect(payload).toBe(event);
    expect(implementation).toHaveBeenCalledOnce();
    const [url, init] = implementation.mock.calls[0]!;
    expect(url).toBe("https://api.fish.audio/v1/tts/stream/with-timestamp");
    const headers = new Headers(init?.headers);
    expect(headers.get("accept")).toBe("text/event-stream");
    expect(headers.get("authorization")).toBe("Bearer fish-secret-key");
    expect(headers.get("model")).toBe("s2.1-pro");
    expect(JSON.parse(String(init?.body))).toMatchObject({
      text: "Reflection. Take one grounded step.",
      reference_id: "voice_model_12345678",
      format: "mp3",
      latency: "balanced",
      chunk_length: 200,
    });
  });

  it("maps provider failures to a non-sensitive service error", async () => {
    const provider = createReadingAudioProvider(
      configuredEnvironment,
      vi.fn<typeof fetch>(async () =>
        Promise.resolve(new Response("provider account detail", { status: 402 })),
      ),
    );

    await expect(provider.stream("A valid reading section.")).rejects.toMatchObject({
      code: "READING_AUDIO_UPSTREAM_UNAVAILABLE",
      message: "READING_AUDIO_UPSTREAM_UNAVAILABLE",
    });
  });

  it("rejects an unexpected successful response type", async () => {
    const provider = createReadingAudioProvider(
      configuredEnvironment,
      vi.fn<typeof fetch>(async () =>
        Promise.resolve(new Response("not an event stream", { status: 200 })),
      ),
    );

    await expect(provider.stream("A valid reading section.")).rejects.toMatchObject({
      code: "READING_AUDIO_UPSTREAM_UNAVAILABLE",
    });
  });
});

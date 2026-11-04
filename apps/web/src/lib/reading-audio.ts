import "server-only";

import { z } from "zod";

import { createBoundedFetch } from "./bounded-fetch";

const FISH_AUDIO_TTS_URL = "https://api.fish.audio/v1/tts/stream/with-timestamp";
const DEFAULT_TIMEOUT_MS = 45_000;

const fishAudioModelSchema = z.enum(["s1", "s2-pro", "s2.1-pro", "s2.1-pro-free"]);
const referenceIdSchema = z
  .string()
  .trim()
  .min(8)
  .max(128)
  .regex(/^[A-Za-z0-9_-]+$/);
const narrationTextSchema = z.string().trim().min(1).max(6_000);

export type ReadingAudioErrorCode =
  "READING_AUDIO_DISABLED" | "READING_AUDIO_MISCONFIGURED" | "READING_AUDIO_UPSTREAM_UNAVAILABLE";

export class ReadingAudioProviderError extends Error {
  constructor(readonly code: ReadingAudioErrorCode) {
    super(code);
    this.name = "ReadingAudioProviderError";
  }
}

export interface ReadingAudioProvider {
  readonly id: "fish-audio";
  /** Fish SSE containing ordered base64 MP3 chunks and cumulative word alignments. */
  stream(text: string, signal?: AbortSignal): Promise<ReadableStream<Uint8Array>>;
}

interface FishAudioConfiguration {
  apiKey: string;
  model: z.infer<typeof fishAudioModelSchema>;
  referenceId: string;
  timeoutMs: number;
}

export type ReadingAudioEnvironment = Readonly<Record<string, string | undefined>>;

function configuredTimeout(value: string | undefined): number {
  if (!value?.trim()) return DEFAULT_TIMEOUT_MS;
  const parsed = Number.parseInt(value, 10);
  if (!Number.isSafeInteger(parsed) || parsed < 5_000 || parsed > 120_000)
    throw new ReadingAudioProviderError("READING_AUDIO_MISCONFIGURED");
  return parsed;
}

export function fishAudioConfiguration(
  environment: ReadingAudioEnvironment = process.env,
): FishAudioConfiguration {
  const provider = environment.READING_AUDIO_PROVIDER?.trim();
  if (!provider || provider === "disabled")
    throw new ReadingAudioProviderError("READING_AUDIO_DISABLED");
  if (provider !== "fish-audio") throw new ReadingAudioProviderError("READING_AUDIO_MISCONFIGURED");

  const apiKey = environment.FISH_AUDIO_API_KEY?.trim();
  const model = fishAudioModelSchema.safeParse(environment.FISH_AUDIO_MODEL?.trim());
  const referenceId = referenceIdSchema.safeParse(environment.FISH_AUDIO_REFERENCE_ID);
  if (!apiKey || !model.success || !referenceId.success)
    throw new ReadingAudioProviderError("READING_AUDIO_MISCONFIGURED");

  return {
    apiKey,
    model: model.data,
    referenceId: referenceId.data,
    timeoutMs: configuredTimeout(environment.FISH_AUDIO_TIMEOUT_MS),
  };
}

export class FishAudioReadingProvider implements ReadingAudioProvider {
  readonly id = "fish-audio" as const;
  private readonly boundedFetch: typeof fetch;

  constructor(
    private readonly configuration: FishAudioConfiguration,
    implementation: typeof fetch = fetch,
  ) {
    this.boundedFetch = createBoundedFetch(implementation, configuration.timeoutMs);
  }

  async stream(text: string, signal?: AbortSignal): Promise<ReadableStream<Uint8Array>> {
    const validatedText = narrationTextSchema.safeParse(text);
    if (!validatedText.success)
      throw new ReadingAudioProviderError("READING_AUDIO_UPSTREAM_UNAVAILABLE");

    let response: Response;
    try {
      response = await this.boundedFetch(FISH_AUDIO_TTS_URL, {
        method: "POST",
        cache: "no-store",
        headers: {
          accept: "text/event-stream",
          authorization: `Bearer ${this.configuration.apiKey}`,
          "content-type": "application/json",
          model: this.configuration.model,
        },
        body: JSON.stringify({
          text: validatedText.data,
          reference_id: this.configuration.referenceId,
          format: "mp3",
          mp3_bitrate: 128,
          sample_rate: 44_100,
          chunk_length: 200,
          latency: "balanced",
          normalize: true,
          prosody: {
            speed: 0.94,
            volume: 0,
            normalize_loudness: true,
          },
        }),
        ...(signal ? { signal } : {}),
      });
    } catch {
      throw new ReadingAudioProviderError("READING_AUDIO_UPSTREAM_UNAVAILABLE");
    }

    if (
      !response.ok ||
      !response.body ||
      !response.headers.get("content-type")?.toLowerCase().includes("text/event-stream")
    ) {
      await response.body?.cancel().catch(() => undefined);
      throw new ReadingAudioProviderError("READING_AUDIO_UPSTREAM_UNAVAILABLE");
    }
    return response.body;
  }
}

export function createReadingAudioProvider(
  environment: ReadingAudioEnvironment = process.env,
  implementation: typeof fetch = fetch,
): ReadingAudioProvider {
  return new FishAudioReadingProvider(fishAudioConfiguration(environment), implementation);
}

/** A presentation hint only. The API route repeats the full fail-closed check. */
export function readingAudioAvailable(environment: ReadingAudioEnvironment = process.env): boolean {
  try {
    fishAudioConfiguration(environment);
    return true;
  } catch {
    return false;
  }
}

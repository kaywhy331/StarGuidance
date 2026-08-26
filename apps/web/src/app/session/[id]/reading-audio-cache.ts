const AUDIO_CACHE_NAME = "starguidance-reading-audio-v2";
const AUDIO_CACHE_PATH = "/.starguidance-cache/reading-audio/v2";
const MAX_CACHED_AUDIO_BYTES = 64 * 1024 * 1024;
const MAX_CACHED_SECTIONS = 64;

export const MAX_SECTION_AUDIO_BYTES = 12 * 1024 * 1024;

export interface ReadingAudioWordTiming {
  readonly start: number;
  readonly end: number;
}

export interface ReadingAudioSection {
  readonly audio: Blob;
  readonly wordTimings: readonly ReadingAudioWordTiming[];
}

interface CachedSectionMetadata {
  readonly version: 2;
  readonly cachedAt: number;
  readonly bytes: number;
  readonly wordTimings: readonly ReadingAudioWordTiming[];
}

interface FishTimestampEvent {
  readonly audioBase64: string;
  readonly chunkSequence: number;
  readonly chunkOffset: number;
  readonly alignment?: {
    readonly segments: readonly {
      readonly text: string;
      readonly start: number;
      readonly end: number;
    }[];
  };
}

function decodeBase64(value: string): ArrayBuffer {
  if (!value || value.length > MAX_SECTION_AUDIO_BYTES * 2)
    throw new Error("Audio section is too large.");
  let decoded: string;
  try {
    decoded = atob(value);
  } catch {
    throw new Error("The audio stream was malformed.");
  }
  const buffer = new ArrayBuffer(decoded.length);
  const bytes = new Uint8Array(buffer);
  for (let index = 0; index < decoded.length; index += 1) bytes[index] = decoded.charCodeAt(index);
  return buffer;
}

function finiteNonNegative(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

function parseFishEvent(value: unknown): FishTimestampEvent {
  if (!value || typeof value !== "object") throw new Error("The audio stream was malformed.");
  const event = value as Record<string, unknown>;
  if (
    typeof event.audio_base64 !== "string" ||
    !Number.isSafeInteger(event.chunk_seq) ||
    Number(event.chunk_seq) < 0 ||
    Number(event.chunk_seq) > 256 ||
    !finiteNonNegative(event.chunk_audio_offset_sec)
  )
    throw new Error("The audio stream was malformed.");

  let alignment: FishTimestampEvent["alignment"];
  if (event.alignment !== null && event.alignment !== undefined) {
    if (!event.alignment || typeof event.alignment !== "object")
      throw new Error("The audio stream was malformed.");
    const rawSegments = (event.alignment as Record<string, unknown>).segments;
    if (!Array.isArray(rawSegments) || rawSegments.length > 4_096)
      throw new Error("The audio stream was malformed.");
    const segments = rawSegments.map((segment) => {
      if (!segment || typeof segment !== "object")
        throw new Error("The audio stream was malformed.");
      const candidate = segment as Record<string, unknown>;
      if (
        typeof candidate.text !== "string" ||
        !finiteNonNegative(candidate.start) ||
        !finiteNonNegative(candidate.end) ||
        candidate.end < candidate.start
      )
        throw new Error("The audio stream was malformed.");
      return { text: candidate.text, start: candidate.start, end: candidate.end };
    });
    alignment = { segments };
  }

  return {
    audioBase64: event.audio_base64,
    chunkSequence: Number(event.chunk_seq),
    chunkOffset: event.chunk_audio_offset_sec,
    ...(alignment ? { alignment } : {}),
  };
}

function timingsForEvent(event: FishTimestampEvent): ReadingAudioWordTiming[] {
  if (!event.alignment) return [];
  return event.alignment.segments.flatMap((segment) => {
    const words = segment.text.trim().split(/\s+/u).filter(Boolean);
    if (words.length === 0) return [];
    const duration = Math.max(0, segment.end - segment.start);
    return words.map((_, index) => ({
      start: event.chunkOffset + segment.start + (duration * index) / words.length,
      end: event.chunkOffset + segment.start + (duration * (index + 1)) / words.length,
    }));
  });
}

export async function timestampedAudioSection(response: Response): Promise<ReadingAudioSection> {
  if (!response.body) throw new Error("Audio section is empty.");
  if (!response.headers.get("content-type")?.toLowerCase().includes("text/event-stream"))
    throw new Error("The audio stream was malformed.");

  const audioParts: ArrayBuffer[] = [];
  const alignments = new Map<number, ReadingAudioWordTiming[]>();
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let received = 0;

  const processLine = (rawLine: string) => {
    const line = rawLine.endsWith("\r") ? rawLine.slice(0, -1) : rawLine;
    if (!line.startsWith("data:")) return;
    const serialized = line.slice(5).trimStart();
    if (!serialized) return;
    let rawEvent: unknown;
    try {
      rawEvent = JSON.parse(serialized);
    } catch {
      throw new Error("The audio stream was malformed.");
    }
    const event = parseFishEvent(rawEvent);
    const bytes = decodeBase64(event.audioBase64);
    received += bytes.byteLength;
    if (received > MAX_SECTION_AUDIO_BYTES) throw new Error("Audio section is too large.");
    audioParts.push(bytes);
    if (event.alignment) alignments.set(event.chunkSequence, timingsForEvent(event));
  };

  try {
    while (true) {
      const { done, value } = await reader.read();
      buffer += decoder.decode(value, { stream: !done });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      for (const line of lines) processLine(line);
      if (done) break;
    }
    if (buffer.trim()) processLine(buffer);
  } catch (cause) {
    await reader.cancel().catch(() => undefined);
    throw cause;
  }

  if (received === 0) throw new Error("Audio section is empty.");
  const wordTimings = [...alignments.entries()]
    .sort(([left], [right]) => left - right)
    .flatMap(([, timings]) => timings);
  return {
    audio: new Blob(audioParts, {
      type: response.headers.get("x-reading-audio-format") ?? "audio/mpeg",
    }),
    wordTimings,
  };
}

function validMetadata(value: unknown): value is CachedSectionMetadata {
  if (!value || typeof value !== "object") return false;
  const metadata = value as Record<string, unknown>;
  if (
    metadata.version !== 2 ||
    !finiteNonNegative(metadata.cachedAt) ||
    !finiteNonNegative(metadata.bytes) ||
    metadata.bytes === 0 ||
    metadata.bytes > MAX_SECTION_AUDIO_BYTES ||
    !Array.isArray(metadata.wordTimings) ||
    metadata.wordTimings.length > 4_096
  )
    return false;
  return metadata.wordTimings.every(
    (timing) =>
      Boolean(timing) &&
      typeof timing === "object" &&
      finiteNonNegative((timing as Record<string, unknown>).start) &&
      finiteNonNegative((timing as Record<string, unknown>).end) &&
      Number((timing as Record<string, unknown>).end) >=
        Number((timing as Record<string, unknown>).start),
  );
}

function cacheStorage(): CacheStorage | undefined {
  return typeof caches === "undefined" ? undefined : caches;
}

function cacheUrls(cacheKey: string, origin = location.origin) {
  const base = `${origin}${AUDIO_CACHE_PATH}/${encodeURIComponent(cacheKey)}`;
  return { audio: `${base}/audio`, metadata: `${base}/metadata` };
}

async function removeCachedPair(cache: Cache, urls: ReturnType<typeof cacheUrls>) {
  await Promise.all([cache.delete(urls.audio), cache.delete(urls.metadata)]);
}

export async function deleteCachedAudioSection(
  cacheKey: string,
  storage = cacheStorage(),
  origin = typeof location === "undefined" ? "https://cache.invalid" : location.origin,
): Promise<void> {
  if (!storage) return;
  try {
    const cache = await storage.open(AUDIO_CACHE_NAME);
    await removeCachedPair(cache, cacheUrls(cacheKey, origin));
  } catch {
    // Cache eviction is best-effort; playback must remain available without it.
  }
}

export async function readCachedAudioSection(
  cacheKey: string,
  storage = cacheStorage(),
  origin = typeof location === "undefined" ? "https://cache.invalid" : location.origin,
): Promise<ReadingAudioSection | undefined> {
  if (!storage) return undefined;
  try {
    const cache = await storage.open(AUDIO_CACHE_NAME);
    const urls = cacheUrls(cacheKey, origin);
    const [audioResponse, metadataResponse] = await Promise.all([
      cache.match(urls.audio),
      cache.match(urls.metadata),
    ]);
    if (!audioResponse || !metadataResponse) {
      await removeCachedPair(cache, urls);
      return undefined;
    }
    const metadata: unknown = await metadataResponse.json();
    if (!validMetadata(metadata)) {
      await removeCachedPair(cache, urls);
      return undefined;
    }
    const audio = await audioResponse.blob();
    if (audio.size !== metadata.bytes || audio.size > MAX_SECTION_AUDIO_BYTES) {
      await removeCachedPair(cache, urls);
      return undefined;
    }
    return { audio, wordTimings: metadata.wordTimings };
  } catch {
    return undefined;
  }
}

async function pruneAudioCache(cache: Cache, origin: string) {
  const requests = (await cache.keys()).filter(({ url }) => url.endsWith("/metadata"));
  const entries = await Promise.all(
    requests.map(async (request) => {
      const response = await cache.match(request);
      const metadata = response
        ? ((await response.json().catch(() => undefined)) as unknown)
        : null;
      return {
        request,
        metadata: validMetadata(metadata) ? metadata : undefined,
      };
    }),
  );
  entries.sort((left, right) => (right.metadata?.cachedAt ?? 0) - (left.metadata?.cachedAt ?? 0));
  let retainedBytes = 0;
  for (const [index, entry] of entries.entries()) {
    retainedBytes += entry.metadata?.bytes ?? MAX_SECTION_AUDIO_BYTES;
    if (!entry.metadata || index >= MAX_CACHED_SECTIONS || retainedBytes > MAX_CACHED_AUDIO_BYTES) {
      const metadataUrl = new URL(entry.request.url);
      const key = metadataUrl.pathname
        .replace(`${AUDIO_CACHE_PATH}/`, "")
        .replace(/\/metadata$/u, "");
      await removeCachedPair(cache, cacheUrls(decodeURIComponent(key), origin));
    }
  }
}

export async function writeCachedAudioSection(
  cacheKey: string,
  section: ReadingAudioSection,
  storage = cacheStorage(),
  origin = typeof location === "undefined" ? "https://cache.invalid" : location.origin,
): Promise<boolean> {
  if (!storage || section.audio.size === 0 || section.audio.size > MAX_SECTION_AUDIO_BYTES)
    return false;
  try {
    const cache = await storage.open(AUDIO_CACHE_NAME);
    const urls = cacheUrls(cacheKey, origin);
    const metadata: CachedSectionMetadata = {
      version: 2,
      cachedAt: Date.now(),
      bytes: section.audio.size,
      wordTimings: section.wordTimings,
    };
    await Promise.all([
      cache.put(
        urls.audio,
        new Response(section.audio, {
          headers: { "cache-control": "private", "content-type": section.audio.type },
        }),
      ),
      cache.put(
        urls.metadata,
        new Response(JSON.stringify(metadata), {
          headers: { "cache-control": "private", "content-type": "application/json" },
        }),
      ),
    ]);
    await pruneAudioCache(cache, origin);
    return true;
  } catch {
    return false;
  }
}

import { describe, expect, it } from "vitest";

import {
  readCachedAudioSection,
  timestampedAudioSection,
  writeCachedAudioSection,
} from "./reading-audio-cache";

function eventStream(events: readonly unknown[]) {
  return new Response(events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join(""), {
    headers: {
      "content-type": "text/event-stream; charset=utf-8",
      "x-reading-audio-format": "audio/mpeg",
    },
  });
}

function memoryCacheStorage(): CacheStorage {
  const entries = new Map<string, Response>();
  const requestUrl = (request: RequestInfo | URL) =>
    request instanceof Request
      ? request.url
      : request instanceof URL
        ? request.href
        : String(request);
  const cache = {
    delete: async (request: RequestInfo | URL) => entries.delete(requestUrl(request)),
    keys: async () => [...entries.keys()].map((url) => new Request(url)),
    match: async (request: RequestInfo | URL) => entries.get(requestUrl(request))?.clone(),
    put: async (request: RequestInfo | URL, response: Response) => {
      entries.set(requestUrl(request), response.clone());
    },
  } as unknown as Cache;
  return { open: async () => cache } as unknown as CacheStorage;
}

describe("timestamped reading audio", () => {
  it("assembles ordered audio chunks and retains only the latest alignment snapshot", async () => {
    const response = eventStream([
      {
        audio_base64: "SUQ=",
        chunk_seq: 0,
        chunk_audio_offset_sec: 0,
        alignment: null,
      },
      {
        audio_base64: "MwQ=",
        chunk_seq: 0,
        chunk_audio_offset_sec: 0,
        alignment: {
          audio_duration: 0.8,
          segments: [{ text: "The card", start: 0.1, end: 0.7 }],
        },
      },
      {
        audio_base64: "BQY=",
        chunk_seq: 1,
        chunk_audio_offset_sec: 0.8,
        alignment: {
          audio_duration: 0.5,
          segments: [{ text: "opens", start: 0, end: 0.5 }],
        },
      },
    ]);

    const section = await timestampedAudioSection(response);

    expect(section.audio.type).toBe("audio/mpeg");
    expect(new Uint8Array(await section.audio.arrayBuffer())).toEqual(
      new Uint8Array([73, 68, 51, 4, 5, 6]),
    );
    expect(section.wordTimings).toEqual([
      { start: 0.1, end: 0.4 },
      { start: 0.4, end: 0.7 },
      { start: 0.8, end: 1.3 },
    ]);
  });

  it("rejects malformed timestamp events", async () => {
    await expect(
      timestampedAudioSection(
        eventStream([
          { audio_base64: "%%%", chunk_seq: 0, chunk_audio_offset_sec: 0, alignment: null },
        ]),
      ),
    ).rejects.toThrow("malformed");
  });

  it("persists audio and word timings across cache reads", async () => {
    const storage = memoryCacheStorage();
    const section = {
      audio: new Blob([new Uint8Array([73, 68, 51, 4])], { type: "audio/mpeg" }),
      wordTimings: [
        { start: 0.1, end: 0.4 },
        { start: 0.4, end: 0.8 },
      ],
    };

    expect(
      await writeCachedAudioSection("reading:primary:0", section, storage, "https://test.local"),
    ).toBe(true);
    const restored = await readCachedAudioSection(
      "reading:primary:0",
      storage,
      "https://test.local",
    );

    expect(restored?.audio.type).toBe("audio/mpeg");
    expect(new Uint8Array(await restored!.audio.arrayBuffer())).toEqual(
      new Uint8Array([73, 68, 51, 4]),
    );
    expect(restored?.wordTimings).toEqual(section.wordTimings);
  });
});

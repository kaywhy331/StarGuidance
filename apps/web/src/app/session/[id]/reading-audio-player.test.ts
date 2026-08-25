import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

import { boundedAudioBlob, ReadingAudioPlayer } from "./reading-audio-player";

afterEach(() => vi.unstubAllGlobals());

describe("section audio buffering", () => {
  it("assembles streamed chunks as one playable MP3 section", async () => {
    const response = new Response(
      new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new Uint8Array([73, 68]));
          controller.enqueue(new Uint8Array([51, 4]));
          controller.close();
        },
      }),
      { headers: { "content-type": "audio/mpeg" } },
    );

    const blob = await boundedAudioBlob(response);

    expect(blob.type).toBe("audio/mpeg");
    expect(new Uint8Array(await blob.arrayBuffer())).toEqual(new Uint8Array([73, 68, 51, 4]));
  });

  it("rejects a declared section larger than the client memory bound", async () => {
    const response = new Response(new Uint8Array([1]), {
      headers: { "content-length": String(12 * 1024 * 1024 + 1) },
    });

    await expect(boundedAudioBlob(response)).rejects.toThrow("Audio section is too large.");
  });

  it("shows Play when voice is enabled without requesting any audio", () => {
    const fetchImplementation = vi.fn();
    vi.stubGlobal("fetch", fetchImplementation);

    const markup = renderToStaticMarkup(
      createElement(ReadingAudioPlayer, {
        activeIndex: 0,
        continuous: false,
        enabled: true,
        entries: [
          {
            type: "phase",
            sequence: 0,
            phase: "directAnswer",
            heading: "What the cards indicate",
            text: "One grounded step is available.",
          },
        ],
        readingId: "00000000-0000-4000-8000-000000000702",
        target: "primary",
      }),
    );

    expect(markup).toContain('data-testid="reading-audio-trigger"');
    expect(markup).toContain("Play audio");
    expect(fetchImplementation).not.toHaveBeenCalled();
  });
});

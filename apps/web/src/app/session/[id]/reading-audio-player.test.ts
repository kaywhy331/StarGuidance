import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  countNarrationWords,
  playbackFailure,
  ReadingAudioPlayer,
  synchronizedWordCount,
} from "./reading-audio-player";

afterEach(() => vi.unstubAllGlobals());

describe("section audio playback", () => {
  it("maps Fish timing progress onto the displayed narration words", () => {
    expect(countNarrationWords("A calm, grounded step.")).toBe(4);
    expect(
      synchronizedWordCount(
        0.61,
        2,
        [
          { start: 0.1, end: 0.4 },
          { start: 0.4, end: 0.8 },
          { start: 0.8, end: 1.2 },
          { start: 1.2, end: 1.6 },
        ],
        4,
      ),
    ).toBe(2);
  });

  it("distinguishes autoplay denial from an unsupported media response", () => {
    expect(playbackFailure(new DOMException("denied", "NotAllowedError"))).toMatchObject({
      retryable: true,
    });
    expect(playbackFailure(new DOMException("unsupported", "NotSupportedError"))).toMatchObject({
      retryable: false,
      message: expect.stringContaining("decode"),
    });
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

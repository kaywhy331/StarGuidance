"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { oracleStreamEventSchema, type OracleStreamEvent } from "@starguidance/contracts";

type PhaseEvent = Extract<OracleStreamEvent, { type: "phase" }>;
type StreamState = "idle" | "streaming" | "complete" | "failed";

interface TranscriptEntry extends PhaseEvent {
  key: string;
  target: string;
}

function TypewriterParagraph({
  entry,
  reducedMotion,
  onProgress,
  onComplete,
}: {
  entry: TranscriptEntry;
  reducedMotion: boolean;
  onProgress: () => void;
  onComplete: (text: string) => void;
}) {
  const words = entry.text.split(/\s+/);
  const [visibleWords, setVisibleWords] = useState(0);
  const announced = useRef(false);

  useEffect(() => {
    if (reducedMotion) return;
    if (visibleWords >= words.length) return;
    const timer = window.setTimeout(
      () => setVisibleWords((count) => Math.min(count + 4, words.length)),
      28,
    );
    return () => window.clearTimeout(timer);
  }, [reducedMotion, visibleWords, words.length]);

  useEffect(() => {
    onProgress();
    if (visibleWords >= words.length && !announced.current) {
      announced.current = true;
      onComplete(entry.text);
    }
  }, [entry.text, onComplete, onProgress, visibleWords, words.length]);

  const complete = reducedMotion || visibleWords >= words.length;
  return (
    <p className="oracle-entry-text">
      <span aria-hidden="true">
        {reducedMotion ? entry.text : words.slice(0, visibleWords).join(" ")}
        {!reducedMotion && !complete && <span className="oracle-cursor"> </span>}
      </span>
      {complete && <span className="sr-only">{entry.text}</span>}
    </p>
  );
}

export function OracleTranscript({
  active,
  readingId,
  target,
  reducedMotion,
  retryToken,
  onRetry,
  onStateChange,
  previewEvents,
}: {
  active: boolean;
  readingId: string;
  target: string;
  reducedMotion: boolean;
  retryToken: number;
  onRetry: () => void;
  onStateChange?: (state: StreamState) => void;
  previewEvents?: readonly PhaseEvent[] | undefined;
}) {
  const [entries, setEntries] = useState<TranscriptEntry[]>(() =>
    (previewEvents ?? []).map((event) => ({
      ...event,
      key: `${target}:${event.sequence}`,
      target,
    })),
  );
  const [streamState, setStreamState] = useState<StreamState>(previewEvents ? "complete" : "idle");
  const [followLatest, setFollowLatest] = useState(true);
  const [announcement, setAnnouncement] = useState("");
  const [progressTick, setProgressTick] = useState(0);
  const viewportRef = useRef<HTMLDivElement>(null);
  const completedTargets = useRef(new Set<string>());
  const forcedFailureRef = useRef<string | null | undefined>(undefined);
  const manualReviewRef = useRef(false);
  const previousScrollTopRef = useRef(0);

  const updateState = useCallback(
    (state: StreamState) => {
      setStreamState(state);
      onStateChange?.(state);
    },
    [onStateChange],
  );

  useEffect(() => {
    if (previewEvents || !active || (completedTargets.current.has(target) && retryToken === 0))
      return;
    const controller = new AbortController();
    let buffer = "";
    updateState("streaming");
    void (async () => {
      try {
        if (forcedFailureRef.current === undefined)
          forcedFailureRef.current = window.sessionStorage.getItem("sg:e2e-stream-fail-after");
        const forcedFailure = forcedFailureRef.current;
        const response = await fetch(
          `/api/readings/${readingId}/stream?target=${encodeURIComponent(target)}`,
          {
            cache: "no-store",
            signal: controller.signal,
            ...(forcedFailure ? { headers: { "x-e2e-stream-fail-after": forcedFailure } } : {}),
          },
        );
        if (!response.ok || !response.body) throw new Error("The oracle stream is unavailable.");
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let done = false;
        while (!done) {
          const value = await reader.read();
          done = value.done;
          buffer += decoder.decode(value.value, { stream: !done });
          const lines = buffer.split("\n");
          buffer = lines.pop() ?? "";
          for (const line of lines) {
            if (!line.trim()) continue;
            const event = oracleStreamEventSchema.parse(JSON.parse(line));
            if (event.type === "phase") {
              const key = `${target}:${event.sequence}`;
              setEntries((current) =>
                current.some((entry) => entry.key === key)
                  ? current
                  : [...current, { ...event, key, target }],
              );
            } else if (event.type === "error") {
              forcedFailureRef.current = null;
              window.sessionStorage.removeItem("sg:e2e-stream-fail-after");
              updateState("failed");
              setAnnouncement(event.message);
            } else {
              completedTargets.current.add(target);
              updateState("complete");
            }
          }
        }
      } catch (error) {
        if (!controller.signal.aborted) {
          updateState("failed");
          setAnnouncement(
            error instanceof Error
              ? error.message
              : "The oracle stream paused. Received text remains available.",
          );
        }
      }
    })();
    return () => controller.abort();
  }, [active, previewEvents, readingId, retryToken, target, updateState]);

  useEffect(() => {
    if (!followLatest) return;
    const frame = window.requestAnimationFrame(() => {
      if (manualReviewRef.current) return;
      const viewport = viewportRef.current;
      viewport?.scrollTo({ top: viewport.scrollHeight, behavior: "auto" });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [entries, followLatest, progressTick]);

  const reportProgress = useCallback(() => setProgressTick((tick) => tick + 1), []);
  const announce = useCallback((text: string) => setAnnouncement(text), []);

  return (
    <section className="oracle-transcript-shell" data-state={streamState}>
      <div
        aria-label="Streaming oracle transcript. Scroll to review earlier paragraphs."
        className="oracle-transcript"
        data-testid="oracle-transcript"
        onKeyDown={(event) => {
          if (["ArrowUp", "PageUp", "Home"].includes(event.key)) {
            manualReviewRef.current = true;
            if (event.currentTarget.scrollHeight - event.currentTarget.clientHeight > 72)
              setFollowLatest(false);
          }
        }}
        onPointerDown={() => {
          manualReviewRef.current = true;
        }}
        onScroll={(event) => {
          const viewport = event.currentTarget;
          const distance = viewport.scrollHeight - viewport.scrollTop - viewport.clientHeight;
          const movedTowardLatest = viewport.scrollTop > previousScrollTopRef.current;
          previousScrollTopRef.current = viewport.scrollTop;
          if (distance < 72 && (!manualReviewRef.current || movedTowardLatest)) {
            manualReviewRef.current = false;
            setFollowLatest(true);
          } else if (manualReviewRef.current) {
            setFollowLatest(false);
          }
        }}
        onTouchStart={() => {
          manualReviewRef.current = true;
        }}
        onWheel={(event) => {
          if (event.deltaY < 0) {
            manualReviewRef.current = true;
            if (event.currentTarget.scrollHeight - event.currentTarget.clientHeight > 72)
              setFollowLatest(false);
          }
        }}
        ref={viewportRef}
        role="region"
        tabIndex={0}
      >
        {entries.length === 0 && streamState === "streaming" && (
          <p className="oracle-awaiting">The first thread of the reading is forming…</p>
        )}
        {entries.map((entry) => (
          <article className="oracle-entry" data-phase={entry.phase} key={entry.key}>
            <h2>{entry.heading}</h2>
            <TypewriterParagraph
              entry={entry}
              onComplete={announce}
              onProgress={reportProgress}
              reducedMotion={reducedMotion}
            />
          </article>
        ))}
        <div aria-atomic="true" aria-live="polite" className="sr-only">
          {announcement}
        </div>
      </div>
      {!followLatest && (
        <button
          className="return-to-latest"
          data-testid="return-to-latest"
          onClick={() => {
            manualReviewRef.current = false;
            setFollowLatest(true);
            const viewport = viewportRef.current;
            viewport?.scrollTo({
              top: viewport.scrollHeight,
              behavior: reducedMotion ? "auto" : "smooth",
            });
          }}
          type="button"
        >
          Return to latest ↓
        </button>
      )}
      {streamState === "failed" && (
        <div className="oracle-stream-error" role="status">
          <span>Stream paused. Your received text and locked cards are safe.</span>
          <button onClick={onRetry} type="button">
            Retry transcript
          </button>
        </div>
      )}
      {streamState === "streaming" && (
        <span className="oracle-stream-status" data-testid="stream-status">
          Receiving oracle response
        </span>
      )}
    </section>
  );
}

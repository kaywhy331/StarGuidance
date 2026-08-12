"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type TouchEvent,
  type WheelEvent,
} from "react";
import {
  oracleStreamEventSchema,
  type OracleStreamEvent,
  type ReadingResult,
} from "@starguidance/contracts";

import type { DealtCardView } from "./reading-types";

type PhaseEvent = Extract<OracleStreamEvent, { type: "phase" }>;
type StreamState = "idle" | "streaming" | "complete" | "failed";

interface TranscriptEntry extends PhaseEvent {
  key: string;
  target: string;
}

function TypewriterParagraph({
  entry,
  reducedMotion,
  onComplete,
}: {
  entry: TranscriptEntry;
  reducedMotion: boolean;
  onComplete: (text: string) => void;
}) {
  const words = entry.text.split(/\s+/);
  const [visibleWords, setVisibleWords] = useState(0);
  const announced = useRef(false);
  const complete = reducedMotion || visibleWords >= words.length;

  useEffect(() => {
    if (complete) return;
    const timer = window.setTimeout(
      () => setVisibleWords((count) => Math.min(count + 4, words.length)),
      28,
    );
    return () => window.clearTimeout(timer);
  }, [complete, visibleWords, words.length]);

  useEffect(() => {
    if (!complete || announced.current) return;
    announced.current = true;
    onComplete(entry.text);
  }, [complete, entry.text, onComplete]);

  return (
    <p className="oracle-entry-text">
      <span aria-hidden="true">
        {reducedMotion ? entry.text : words.slice(0, visibleWords).join(" ")}
        {!complete && <span className="oracle-cursor"> </span>}
      </span>
      {complete && <span className="sr-only">{entry.text}</span>}
    </p>
  );
}

function StructuredSection({
  cardIndex,
  entry,
  result,
}: {
  cardIndex: number | null;
  entry: TranscriptEntry;
  result: ReadingResult;
}) {
  if (entry.phase === "openingTheme") {
    return (
      <div className="reading-section-copy opening-theme-copy">
        <p className="reading-direct-answer">{result.directAnswer}</p>
        <p>{result.centralTheme}</p>
      </div>
    );
  }

  if (entry.phase === "cardInterpretation" && cardIndex !== null) {
    const card = result.cards[cardIndex];
    if (card)
      return (
        <div className="card-interpretation-copy">
          <section>
            <h3>Traditional current</h3>
            <p>{card.traditionalMeaning}</p>
          </section>
          <section>
            <h3>Your personal lens</h3>
            <p>{card.personalizedMeaning}</p>
          </section>
          <section>
            <h3>Connection to your question</h3>
            <p>{card.questionConnection}</p>
          </section>
        </div>
      );
  }

  if (entry.phase === "overallSynthesis")
    return <p className="oracle-entry-text">{result.synthesis}</p>;

  if (entry.phase === "likelyTrajectory") {
    return (
      <div className="reading-section-copy">
        <p>{result.likelyTrajectory.summary}</p>
        <h3>Conditions shaping this path</h3>
        <ul>
          {result.likelyTrajectory.conditions.map((condition) => (
            <li key={condition}>{condition}</li>
          ))}
        </ul>
        <p className="reading-uncertainty">{result.uncertainty}</p>
      </div>
    );
  }

  if (entry.phase === "alternateTrajectory") {
    return (
      <div className="reading-section-copy">
        <p>{result.likelyTrajectory.alternateTrajectory}</p>
        <h3>Signals that could change the pattern</h3>
        <ul>
          {result.disconfirmingEvidence.map((evidence) => (
            <li key={evidence}>{evidence}</li>
          ))}
        </ul>
      </div>
    );
  }

  if (entry.phase === "userAgency") {
    return (
      <ul className="reading-agency-list">
        {result.userAgency.map((action) => (
          <li key={action}>{action}</li>
        ))}
      </ul>
    );
  }

  if (entry.phase === "reflectionPrompt")
    return <p className="reading-reflection-question">{result.reflectionQuestion}</p>;

  return <p className="oracle-entry-text">{entry.text}</p>;
}

function cardIndexFor(entries: readonly TranscriptEntry[], activeIndex: number) {
  const entry = entries[activeIndex];
  if (!entry || entry.phase !== "cardInterpretation") return null;
  return (
    entries
      .slice(0, activeIndex + 1)
      .filter(
        (candidate) =>
          candidate.target === entry.target && candidate.phase === "cardInterpretation",
      ).length - 1
  );
}

export function OracleTranscript({
  active,
  cards,
  readingId,
  result,
  target,
  reducedMotion,
  retryToken,
  onActiveCardChange,
  onRetry,
  onStateChange,
  previewEvents,
}: {
  active: boolean;
  cards: readonly DealtCardView[];
  readingId: string;
  result: ReadingResult;
  target: string;
  reducedMotion: boolean;
  retryToken: number;
  onActiveCardChange?: (index: number | null) => void;
  onRetry: () => void;
  onStateChange?: (state: StreamState) => void;
  previewEvents?: readonly PhaseEvent[] | undefined;
}) {
  const initialEntries = (previewEvents ?? []).map((event) => ({
    ...event,
    key: `${target}:${event.sequence}`,
    target,
  }));
  const [entries, setEntries] = useState<TranscriptEntry[]>(initialEntries);
  const entriesRef = useRef(initialEntries);
  const [streamState, setStreamState] = useState<StreamState>(previewEvents ? "complete" : "idle");
  const [activeIndex, setActiveIndex] = useState(0);
  const activeIndexRef = useRef(0);
  const [announcement, setAnnouncement] = useState("");
  const completedTargets = useRef(new Set<string>());
  const forcedFailureRef = useRef<string | null | undefined>(undefined);
  const wheelReadyAt = useRef(0);
  const touchOrigin = useRef<{ x: number; y: number } | undefined>(undefined);
  const viewportRef = useRef<HTMLDivElement>(null);

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
              if (entriesRef.current.some((entry) => entry.key === key)) continue;
              const next = [...entriesRef.current, { ...event, key, target }];
              entriesRef.current = next;
              setEntries(next);
              if (target !== "primary") {
                activeIndexRef.current = next.length - 1;
                setActiveIndex(next.length - 1);
              }
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
              : "The oracle stream paused. What has arrived remains available.",
          );
        }
      }
    })();
    return () => controller.abort();
  }, [active, previewEvents, readingId, retryToken, target, updateState]);

  const boundedIndex = entries.length === 0 ? 0 : Math.min(activeIndex, entries.length - 1);
  const activeEntry = entries[boundedIndex];
  const activeCardIndex = cardIndexFor(entries, boundedIndex);
  const activeCard = activeCardIndex === null ? undefined : cards[activeCardIndex];

  useEffect(() => {
    onActiveCardChange?.(activeCardIndex);
  }, [activeCardIndex, onActiveCardChange]);

  useEffect(
    () => () => {
      onActiveCardChange?.(null);
    },
    [onActiveCardChange],
  );

  const goTo = useCallback((requestedIndex: number) => {
    const currentEntries = entriesRef.current;
    if (currentEntries.length === 0) return;
    const nextIndex = Math.max(0, Math.min(requestedIndex, currentEntries.length - 1));
    activeIndexRef.current = nextIndex;
    setActiveIndex(nextIndex);
    if (viewportRef.current) viewportRef.current.scrollTop = 0;
    const next = currentEntries[nextIndex];
    if (next) setAnnouncement(`${next.heading}. ${nextIndex + 1} of ${currentEntries.length}.`);
  }, []);
  const goPrevious = () => goTo(activeIndexRef.current - 1);
  const goNext = () => goTo(activeIndexRef.current + 1);

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (["ArrowRight", "ArrowDown", "PageDown"].includes(event.key)) {
      event.preventDefault();
      goNext();
    } else if (["ArrowLeft", "ArrowUp", "PageUp"].includes(event.key)) {
      event.preventDefault();
      goPrevious();
    } else if (event.key === "Home") {
      event.preventDefault();
      goTo(0);
    } else if (event.key === "End") {
      event.preventDefault();
      goTo(entries.length - 1);
    }
  };

  const handleWheel = (event: WheelEvent<HTMLDivElement>) => {
    if (event.ctrlKey) return;
    const deltaScale = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? window.innerHeight : 1;
    const rawMovement =
      Math.abs(event.deltaY) >= Math.abs(event.deltaX) ? event.deltaY : event.deltaX;
    const movement = rawMovement * deltaScale;
    if (Math.abs(movement) < 12) return;
    const viewport = event.currentTarget;
    const canScrollUp = viewport.scrollTop > 1;
    const canScrollDown = viewport.scrollTop + viewport.clientHeight < viewport.scrollHeight - 1;
    if ((movement > 0 && canScrollDown) || (movement < 0 && canScrollUp)) return;
    event.preventDefault();
    const now = Date.now();
    if (now < wheelReadyAt.current) return;
    wheelReadyAt.current = now + (reducedMotion ? 100 : 480);
    if (movement > 0) goNext();
    else goPrevious();
  };

  const handleTouchStart = (event: TouchEvent<HTMLDivElement>) => {
    if (event.touches.length !== 1) {
      touchOrigin.current = undefined;
      return;
    }
    const touch = event.touches[0];
    if (touch) touchOrigin.current = { x: touch.clientX, y: touch.clientY };
  };
  const handleTouchEnd = (event: TouchEvent<HTMLDivElement>) => {
    const origin = touchOrigin.current;
    const touch = event.changedTouches[0];
    touchOrigin.current = undefined;
    if (!origin || !touch || event.touches.length > 0) return;
    const x = origin.x - touch.clientX;
    const y = origin.y - touch.clientY;
    if (Math.abs(x) < 42 || Math.abs(x) <= Math.abs(y)) return;
    if (x > 0) goNext();
    else goPrevious();
  };

  return (
    <section
      className="oracle-transcript-shell reading-journey-shell"
      data-loaded-section-count={entries.length}
      data-state={streamState}
      data-testid="reading-journey"
    >
      <div
        aria-label="Your reading. Scroll, swipe, or use the arrow keys to move through it."
        className="oracle-transcript reading-journey-viewport"
        data-active-card-index={activeCardIndex ?? undefined}
        data-testid="oracle-transcript"
        onKeyDown={handleKeyDown}
        onTouchCancel={() => {
          touchOrigin.current = undefined;
        }}
        onTouchEnd={handleTouchEnd}
        onTouchStart={handleTouchStart}
        onWheel={handleWheel}
        ref={viewportRef}
        role="region"
        tabIndex={0}
      >
        {entries.length === 0 && streamState === "streaming" && (
          <p className="oracle-awaiting">The opening theme is forming…</p>
        )}
        {activeEntry && (
          <article
            className="oracle-entry is-active"
            data-phase={activeEntry.phase}
            key={activeEntry.key}
          >
            {(activeCard || activeEntry.phase === "followUp") && (
              <p className="reading-section-eyebrow">
                {activeCard
                  ? `${activeCard.positionName} · ${activeCard.orientation}`
                  : "Same cards · one continuing thread"}
              </p>
            )}
            <h2>
              {activeCard
                ? `${activeCard.name}${activeCard.orientation === "reversed" ? " (R)" : ""}`
                : activeEntry.heading}
            </h2>
            {activeEntry.phase !== "followUp" ? (
              <StructuredSection cardIndex={activeCardIndex} entry={activeEntry} result={result} />
            ) : (
              <TypewriterParagraph
                entry={activeEntry}
                onComplete={setAnnouncement}
                reducedMotion={reducedMotion}
              />
            )}
          </article>
        )}
        <div aria-atomic="true" aria-live="polite" className="sr-only">
          {announcement}
        </div>
      </div>

      <nav aria-label="Reading navigation" className="reading-journey-controls">
        <button
          aria-label="Previous reading passage"
          disabled={boundedIndex === 0}
          onClick={goPrevious}
          type="button"
        >
          <span aria-hidden="true">‹</span>
        </button>
        <div>
          <span>
            {entries.length === 0 ? 0 : boundedIndex + 1} / {entries.length}
          </span>
          <i aria-hidden="true">
            <b
              style={
                {
                  "--reading-progress": entries.length
                    ? `${((boundedIndex + 1) / entries.length) * 100}%`
                    : "0%",
                } as CSSProperties
              }
            />
          </i>
        </div>
        <button
          aria-label="Next reading passage"
          disabled={entries.length === 0 || boundedIndex >= entries.length - 1}
          onClick={goNext}
          type="button"
        >
          <span aria-hidden="true">›</span>
        </button>
      </nav>

      {streamState === "failed" && (
        <div className="oracle-stream-error" role="status">
          <span>Stream paused. Your reading and locked cards are safe.</span>
          <button onClick={onRetry} type="button">
            Retry reading
          </button>
        </div>
      )}
      {streamState === "streaming" && (
        <span className="oracle-stream-status" data-testid="stream-status">
          Receiving your reading
        </span>
      )}
    </section>
  );
}

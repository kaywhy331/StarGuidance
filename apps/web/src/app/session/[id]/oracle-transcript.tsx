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

type ReadingPassage = ReadingResult["passages"][number];

const passageRoleLabels: Record<ReadingPassage["role"], string> = {
  opening: "Opening insight",
  situation: "The situation",
  underlyingPattern: "Underlying pattern",
  development: "How this develops",
  turningPoint: "Turning point",
  trajectory: "Likely trajectory",
  alternative: "Alternative path",
  agency: "Your agency",
  reflection: "Reflection",
  closing: "Closing note",
  safety: "Scope and care",
};

const cardThreadRoles = new Set<ReadingPassage["role"]>([
  "situation",
  "underlyingPattern",
  "development",
]);

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

function passagesByIds(result: ReadingResult, ids: readonly string[]) {
  const byId = new Map(result.passages.map((passage) => [passage.id, passage]));
  return ids.flatMap((id) => {
    const passage = byId.get(id);
    return passage ? [passage] : [];
  });
}

function ReadingOverview({
  activeCardIndex,
  activeIndex,
  cards,
  entries,
  onSelectCard,
  result,
}: {
  activeCardIndex: number | null;
  activeIndex: number;
  cards: readonly DealtCardView[];
  entries: readonly TranscriptEntry[];
  onSelectCard: (index: number) => void;
  result: ReadingResult;
}) {
  const opening = result.passages.find(({ role }) => role === "opening") ?? result.passages[0];
  const likely = result.passages.find(({ id }) => id === result.trajectory.likelyPassageId);
  const alternate = result.passages.find(({ id }) => id === result.trajectory.alternatePassageId);
  const passageUseCounts = new Map<string, number>();
  for (const passageId of result.cards.flatMap(({ passageIds }) => passageIds))
    passageUseCounts.set(passageId, (passageUseCounts.get(passageId) ?? 0) + 1);
  const reservedPassageIds = new Set([
    opening?.id,
    likely?.id,
    alternate?.id,
    ...result.cards.flatMap(({ passageIds }) => passageIds),
  ]);
  const synthesis = result.passages.filter(
    ({ id, role }) =>
      role === "turningPoint" ||
      ((passageUseCounts.get(id) ?? 0) > 1 && cardThreadRoles.has(role)) ||
      (!reservedPassageIds.has(id) && !["agency", "reflection", "safety"].includes(role)),
  );

  return (
    <article
      className={`reading-result-overview ${activeIndex === 0 ? "oracle-entry is-active" : ""}`}
      data-phase={activeIndex === 0 ? "narration" : undefined}
      data-testid="reading-result-overview"
    >
      <header className="reading-result-header">
        <p className="reading-section-eyebrow">Your reading</p>
        <h2>{result.title}</h2>
        {opening && (
          <p className={`reading-opening-summary ${activeIndex === 0 ? "oracle-entry-text" : ""}`}>
            {opening.text}
          </p>
        )}
      </header>

      <section aria-labelledby="locked-card-overview-heading" className="reading-card-overview">
        <div className="reading-overview-heading-row">
          <h3 id="locked-card-overview-heading">Your locked cards</h3>
          <span>Profile shaped the interpretation, never the draw.</span>
        </div>
        <div className="reading-card-strip">
          {cards.map((card, cardIndex) => {
            const passageIndex = entries.findIndex(
              (entry, index) => index > 0 && entry.cardPositionIds?.includes(card.positionId),
            );
            return (
              <button
                aria-label={`Focus ${card.positionName}: ${card.name}, ${card.orientation}`}
                aria-pressed={activeCardIndex === cardIndex}
                disabled={passageIndex < 0}
                key={card.positionId}
                onClick={() => onSelectCard(passageIndex)}
                type="button"
              >
                <small>{card.positionName}</small>
                <strong>{card.name}</strong>
                <span>{card.orientation}</span>
              </button>
            );
          })}
        </div>
      </section>

      <details className="reading-details">
        <summary>Explore the complete interpretation</summary>
        <div className="reading-details-body">
          <section aria-labelledby="card-by-card-heading">
            <h3 id="card-by-card-heading">Card by card</h3>
            <div className="reading-card-threads">
              {result.cards.map((thread) => {
                const card = cards.find(({ positionId }) => positionId === thread.positionId);
                const passages = passagesByIds(result, thread.passageIds).filter(
                  ({ id, role }) =>
                    id !== opening?.id &&
                    cardThreadRoles.has(role) &&
                    (passageUseCounts.get(id) ?? 0) === 1,
                );
                if (!card || passages.length === 0) return null;
                return (
                  <article key={thread.positionId}>
                    <p>{card.positionName}</p>
                    <h4>
                      {card.name}
                      {card.orientation === "reversed" ? " · Reversed" : ""}
                    </h4>
                    {passages.map((passage) => (
                      <p key={`${thread.positionId}-${passage.id}`}>{passage.text}</p>
                    ))}
                  </article>
                );
              })}
            </div>
          </section>

          {synthesis.length > 0 && (
            <section>
              <h3>Overall synthesis</h3>
              {synthesis.map((passage) => (
                <p key={passage.id}>{passage.text}</p>
              ))}
            </section>
          )}

          {likely && (
            <section>
              <h3>Likely trajectory</h3>
              <p>{likely.text}</p>
              <ul>
                {result.trajectory.conditions.map((condition) => (
                  <li key={condition}>{condition}</li>
                ))}
              </ul>
            </section>
          )}

          {alternate && (
            <section>
              <h3>Alternative path</h3>
              <p>{alternate.text}</p>
              <h4>What could change the pattern</h4>
              <ul>
                {result.disconfirmingEvidence.map((evidence) => (
                  <li key={evidence}>{evidence}</li>
                ))}
              </ul>
            </section>
          )}

          <section>
            <h3>Your agency</h3>
            <ul>
              {result.userAgency.map((action) => (
                <li key={action}>{action}</li>
              ))}
            </ul>
          </section>

          <section className="reading-reflection-section">
            <h3>A question to carry</h3>
            <p>{result.reflectionQuestion}</p>
          </section>

          <p className="reading-uncertainty">{result.uncertainty}</p>
        </div>
      </details>
    </article>
  );
}

function cardIndexFor(
  entries: readonly TranscriptEntry[],
  activeIndex: number,
  cards: readonly DealtCardView[],
) {
  const entry = entries[activeIndex];
  const positionId = entry?.cardPositionIds?.[0];
  if (!positionId) return null;
  const index = cards.findIndex((card) => card.positionId === positionId);
  return index >= 0 ? index : null;
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
  const activeCardIndex = boundedIndex === 0 ? null : cardIndexFor(entries, boundedIndex, cards);
  const activeCard = activeCardIndex === null ? undefined : cards[activeCardIndex];
  const activePassage = activeEntry?.passageId
    ? result.passages.find(({ id }) => id === activeEntry.passageId)
    : undefined;

  useEffect(() => {
    onActiveCardChange?.(activeCardIndex);
  }, [activeCardIndex, onActiveCardChange]);

  useEffect(
    () => () => {
      onActiveCardChange?.(null);
    },
    [onActiveCardChange],
  );

  const goTo = useCallback(
    (requestedIndex: number) => {
      const currentEntries = entriesRef.current;
      if (currentEntries.length === 0) return;
      const nextIndex = Math.max(0, Math.min(requestedIndex, currentEntries.length - 1));
      activeIndexRef.current = nextIndex;
      setActiveIndex(nextIndex);
      window.requestAnimationFrame(() => {
        const viewport = viewportRef.current;
        if (!viewport) return;
        viewport.scrollTo({
          behavior: reducedMotion ? "auto" : "smooth",
          top: nextIndex === 0 ? 0 : viewport.scrollHeight,
        });
      });
      const next = currentEntries[nextIndex];
      if (next) setAnnouncement(`${next.heading}. ${nextIndex + 1} of ${currentEntries.length}.`);
    },
    [reducedMotion],
  );
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
        <ReadingOverview
          activeCardIndex={activeCardIndex}
          activeIndex={boundedIndex}
          cards={cards}
          entries={entries}
          onSelectCard={goTo}
          result={result}
        />
        {activeEntry && boundedIndex > 0 && (
          <article
            className="oracle-entry guided-passage is-active"
            data-phase={activeEntry.phase}
            key={activeEntry.key}
          >
            <p className="reading-section-eyebrow">
              {activeEntry.phase === "followUp"
                ? "Same cards · continuing reflection"
                : [
                    activePassage ? passageRoleLabels[activePassage.role] : "Guided passage",
                    activeCard?.positionName,
                    activeCard?.orientation,
                  ]
                    .filter(Boolean)
                    .join(" · ")}
            </p>
            <h2>
              {activeEntry.phase === "followUp"
                ? activeEntry.heading
                : (activeCard?.name ??
                  (activePassage ? passageRoleLabels[activePassage.role] : activeEntry.heading))}
            </h2>
            <TypewriterParagraph
              entry={activeEntry}
              onComplete={setAnnouncement}
              reducedMotion={reducedMotion}
            />
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
          <em>Guided thread</em>
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

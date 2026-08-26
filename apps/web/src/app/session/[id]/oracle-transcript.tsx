"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import {
  oracleStreamEventSchema,
  type OracleStreamEvent,
  type ReadingResult,
} from "@starguidance/contracts";

import {
  countNarrationWords,
  ReadingAudioPlayer,
  type ReadingNarrationSnapshot,
} from "./reading-audio-player";
import type { DealtCardView, ReadingPersonalization } from "./reading-types";

type PhaseEvent = Extract<OracleStreamEvent, { type: "phase" }>;
type StreamState = "idle" | "streaming" | "complete" | "failed";

export function monotonicVisibleWordCount(current: number, requested: number, total: number) {
  return Math.min(total, Math.max(current, requested));
}

export function narrationWordTokens(text: string): readonly string[] {
  return text.match(/\S+\s*/gu) ?? (text ? [text] : []);
}

function NarratedPassage({
  active,
  currentWord,
  text,
  visibleWords,
}: {
  active: boolean;
  currentWord: boolean;
  text: string;
  visibleWords: number;
}) {
  if (!active) return <p className="oracle-entry-text">{text}</p>;
  const words = narrationWordTokens(text);
  return (
    <p aria-label={text} className="oracle-entry-text">
      <span aria-hidden="true" className="oracle-word-stream">
        {words.map((word, index) => (
          <span
            className={`oracle-word ${index < visibleWords ? "is-visible" : ""} ${
              currentWord && index === visibleWords - 1 ? "is-current" : ""
            }`}
            key={`${index}:${word}`}
          >
            {word}
          </span>
        ))}
      </span>
    </p>
  );
}

export function OracleTranscript({
  active,
  cards,
  personalization,
  readingId,
  result,
  target,
  reducedMotion,
  retryToken,
  audioEnabled,
  onActiveCardChange,
  onNarratedCardIndexesChange,
  onJourneyCompleteChange,
  onRetry,
  onStateChange,
  previewEvents,
}: {
  active: boolean;
  cards: readonly DealtCardView[];
  personalization?: ReadingPersonalization;
  readingId: string;
  result: ReadingResult;
  sigilSeed?: string;
  target: string;
  reducedMotion: boolean;
  retryToken: number;
  audioEnabled: boolean;
  onActiveCardChange?: (index: number | null) => void;
  onNarratedCardIndexesChange?: (indexes: readonly number[]) => void;
  onJourneyCompleteChange?: (complete: boolean) => void;
  onRetry: () => void;
  onStateChange?: (state: StreamState) => void;
  previewEvents?: readonly PhaseEvent[];
}) {
  const [entries, setEntries] = useState<PhaseEvent[]>(previewEvents ? [...previewEvents] : []);
  const [streamState, setStreamState] = useState<StreamState>(previewEvents ? "complete" : "idle");
  const [activeIndex, setActiveIndex] = useState(0);
  const [completeView, setCompleteView] = useState(Boolean(previewEvents));
  const [journeyComplete, setJourneyComplete] = useState(false);
  const [announcement, setAnnouncement] = useState("");
  const [narration, setNarration] = useState<ReadingNarrationSnapshot>({
    sectionIndex: null,
    state: "idle",
    visibleWordCount: 0,
    wordCount: 0,
  });
  const entriesRef = useRef(entries);
  const onJourneyCompleteChangeRef = useRef(onJourneyCompleteChange);
  const onStateChangeRef = useRef(onStateChange);

  useEffect(() => {
    onJourneyCompleteChangeRef.current = onJourneyCompleteChange;
    onStateChangeRef.current = onStateChange;
  }, [onJourneyCompleteChange, onStateChange]);

  const updateState = useCallback((next: StreamState) => {
    setStreamState(next);
    onStateChangeRef.current?.(next);
  }, []);

  const completeJourney = useCallback(() => {
    setJourneyComplete(true);
    setAnnouncement("The reading is complete. Next actions are now available.");
    onJourneyCompleteChangeRef.current?.(true);
  }, []);

  useEffect(() => {
    let timer = 0;
    if (previewEvents) {
      entriesRef.current = [...previewEvents];
      timer = window.setTimeout(() => {
        setEntries([...previewEvents]);
        setCompleteView(true);
        setJourneyComplete(false);
        onJourneyCompleteChange?.(false);
        updateState("complete");
      }, 0);
      return () => window.clearTimeout(timer);
    }
    entriesRef.current = [];
    timer = window.setTimeout(() => {
      setEntries([]);
      setActiveIndex(0);
      setCompleteView(false);
      setJourneyComplete(false);
      onJourneyCompleteChange?.(false);
    }, 0);
    return () => window.clearTimeout(timer);
  }, [onJourneyCompleteChange, previewEvents, target, updateState]);

  useEffect(() => {
    if (!active || previewEvents) return;
    const controller = new AbortController();
    const startTimer = window.setTimeout(() => updateState("streaming"), 0);
    void (async () => {
      try {
        const failure = window.sessionStorage.getItem("sg:e2e-stream-fail-after");
        const response = await fetch(
          `/api/readings/${readingId}/stream?target=${encodeURIComponent(target)}`,
          {
            cache: "no-store",
            signal: controller.signal,
            ...(failure ? { headers: { "x-e2e-stream-fail-after": failure } } : {}),
          },
        );
        if (!response.ok || !response.body) throw new Error("The reading stream is unavailable.");
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        while (true) {
          const chunk = await reader.read();
          buffer += decoder.decode(chunk.value, { stream: !chunk.done });
          const lines = buffer.split("\n");
          buffer = lines.pop() ?? "";
          for (const line of lines) {
            if (!line.trim()) continue;
            const event = oracleStreamEventSchema.parse(JSON.parse(line));
            if (event.type === "phase") {
              const next = [
                ...entriesRef.current.filter(({ sequence }) => sequence !== event.sequence),
                event,
              ].sort((left, right) => left.sequence - right.sequence);
              entriesRef.current = next;
              setEntries(next);
            } else if (event.type === "error") {
              window.sessionStorage.removeItem("sg:e2e-stream-fail-after");
              setAnnouncement(event.message);
              updateState("failed");
            } else {
              setCompleteView(true);
              updateState("complete");
            }
          }
          if (chunk.done) break;
        }
      } catch (cause) {
        if (!controller.signal.aborted) {
          setAnnouncement(cause instanceof Error ? cause.message : "The reading stream paused.");
          updateState("failed");
        }
      }
    })();
    return () => {
      window.clearTimeout(startTimer);
      controller.abort();
    };
  }, [active, previewEvents, readingId, retryToken, target, updateState]);

  const activeEntry = entries[Math.min(activeIndex, Math.max(0, entries.length - 1))];
  const activePositionId = activeEntry?.cardPositionIds?.[0];
  const activeCardIndex = activePositionId
    ? cards.findIndex(({ positionId }) => positionId === activePositionId)
    : -1;

  useEffect(() => {
    onActiveCardChange?.(completeView || activeCardIndex < 0 ? null : activeCardIndex);
  }, [activeCardIndex, completeView, onActiveCardChange]);

  const narratedCardIndexes = useMemo(() => {
    if (narration.state !== "playing" || narration.sectionIndex === null) return [];
    const entry = entries[narration.sectionIndex];
    if (!entry) return [];
    const positionIds = entry.cardPositionIds;
    if (!positionIds?.length) return cards.map((_, index) => index);
    return positionIds
      .map((positionId) => cards.findIndex((card) => card.positionId === positionId))
      .filter((index) => index >= 0);
  }, [cards, entries, narration.sectionIndex, narration.state]);

  useEffect(() => {
    onNarratedCardIndexesChange?.(narratedCardIndexes);
  }, [narratedCardIndexes, onNarratedCardIndexesChange]);

  const move = (offset: number) => {
    setActiveIndex((current) => {
      const next = Math.max(0, Math.min(current + offset, entries.length - 1));
      const entry = entries[next];
      if (entry) setAnnouncement(`${entry.heading}. ${next + 1} of ${entries.length}.`);
      return next;
    });
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (completeView) return;
    if (["ArrowRight", "ArrowDown", "PageDown"].includes(event.key)) {
      event.preventDefault();
      move(1);
    } else if (["ArrowLeft", "ArrowUp", "PageUp"].includes(event.key)) {
      event.preventDefault();
      move(-1);
    } else if (event.key === "Home") {
      event.preventDefault();
      move(-entries.length);
    } else if (event.key === "End") {
      event.preventDefault();
      move(entries.length);
    }
  };

  const narrationSequencing =
    !reducedMotion &&
    narration.sectionIndex !== null &&
    ["loading", "playing", "paused", "ended"].includes(narration.state);
  const narrationStateFor = (index: number) => {
    if (!narrationSequencing || narration.sectionIndex === null) return undefined;
    if (index < narration.sectionIndex) return "complete";
    if (index > narration.sectionIndex) return "pending";
    return narration.state === "ended" ? "complete" : "active";
  };
  const visiblePassageWords = (entry: PhaseEvent, index: number) => {
    if (!narrationSequencing || narration.sectionIndex === null) return Number.POSITIVE_INFINITY;
    if (index < narration.sectionIndex) return Number.POSITIVE_INFINITY;
    if (index > narration.sectionIndex) return 0;
    return Math.max(0, narration.visibleWordCount - countNarrationWords(`${entry.heading}.`));
  };
  const directEntryIndex = Math.max(
    0,
    entries.findIndex(({ phase }) => phase === "directAnswer"),
  );
  const directEntry = entries[directEntryIndex];

  return (
    <section
      className="oracle-transcript-shell reading-journey-shell"
      data-loaded-section-count={entries.length}
      data-reading-mode={completeView ? "complete" : "guided"}
      data-journey-complete={journeyComplete ? "true" : "false"}
      data-state={streamState}
      data-testid="reading-journey"
    >
      <div className="reading-mode-bar">
        <div aria-label="Reading format" role="group">
          <button aria-pressed={!completeView} onClick={() => setCompleteView(false)} type="button">
            <span aria-hidden="true">↝</span> Guided
          </button>
          <button
            aria-pressed={completeView}
            disabled={entries.length === 0}
            onClick={() => setCompleteView(true)}
            type="button"
          >
            <span aria-hidden="true">☰</span> Read as one story
          </button>
          <ReadingAudioPlayer
            activeIndex={activeIndex}
            continuous={completeView}
            enabled={audioEnabled}
            entries={entries}
            onNarrationChange={setNarration}
            readingId={readingId}
            target={target}
          />
        </div>
        <span>
          {streamState === "complete" ? "Spread-aware reading" : "The reading is arriving"}
        </span>
      </div>

      <div
        aria-label="Your reading. Use the arrow keys to move through guided sections."
        className="oracle-transcript reading-journey-viewport"
        data-active-card-index={activeCardIndex >= 0 ? activeCardIndex : undefined}
        data-testid="oracle-transcript"
        onKeyDown={handleKeyDown}
        role="region"
        tabIndex={0}
      >
        {completeView ? (
          <>
            <article
              className="reading-complete-story"
              data-narration-active={narrationSequencing ? "true" : "false"}
              data-testid="reading-complete-story"
            >
              <header data-narration-state={narrationStateFor(directEntryIndex)}>
                <p className="reading-section-eyebrow">Your reading</p>
                <h2>What the cards indicate</h2>
                <NarratedPassage
                  active={narrationSequencing}
                  currentWord={
                    narration.state === "playing" && narration.sectionIndex === directEntryIndex
                  }
                  text={result.directAnswer}
                  visibleWords={
                    directEntry
                      ? visiblePassageWords(directEntry, directEntryIndex)
                      : Number.POSITIVE_INFINITY
                  }
                />
              </header>
              {entries.map((entry, index) =>
                entry.phase === "directAnswer" ? null : (
                  <section
                    data-narration-state={narrationStateFor(index)}
                    data-phase={entry.phase}
                    key={`${target}:${entry.sequence}`}
                  >
                    <h3>{entry.heading}</h3>
                    <NarratedPassage
                      active={narrationSequencing}
                      currentWord={
                        narration.state === "playing" && narration.sectionIndex === index
                      }
                      text={entry.text}
                      visibleWords={visiblePassageWords(entry, index)}
                    />
                  </section>
                ),
              )}
            </article>
            {streamState === "complete" && !journeyComplete && (
              <button
                className="reading-journey-complete-action"
                data-testid="complete-reading-action"
                onClick={completeJourney}
                type="button"
              >
                <span>Reading complete</span>
                Continue to next steps
              </button>
            )}
          </>
        ) : activeEntry ? (
          <article
            className="oracle-entry guided-passage is-active"
            data-narration-state={narrationStateFor(activeIndex)}
            data-phase={activeEntry.phase}
          >
            <p className="reading-section-eyebrow">
              {activeEntry.cardPositionIds?.length
                ? "What this card contributes"
                : "What the cards indicate"}
            </p>
            <h2>{activeEntry.heading}</h2>
            <NarratedPassage
              active={narrationSequencing && narration.sectionIndex === activeIndex}
              currentWord={narration.state === "playing"}
              text={activeEntry.text}
              visibleWords={visiblePassageWords(activeEntry, activeIndex)}
            />
            <nav aria-label="Reading sections" className="reading-journey-navigation">
              <button
                aria-label="Previous reading passage"
                disabled={activeIndex === 0}
                onClick={() => move(-1)}
                type="button"
              >
                ← Previous
              </button>
              <span>
                {activeIndex + 1} of {Math.max(1, entries.length)}
              </span>
              <button
                aria-label={
                  activeIndex >= entries.length - 1 && streamState === "complete"
                    ? "Finish reading"
                    : "Next reading passage"
                }
                disabled={activeIndex >= entries.length - 1 && streamState !== "complete"}
                onClick={() => {
                  if (activeIndex >= entries.length - 1) completeJourney();
                  else move(1);
                }}
                type="button"
              >
                {activeIndex >= entries.length - 1 && streamState === "complete"
                  ? "Finish reading"
                  : "Next →"}
              </button>
            </nav>
          </article>
        ) : (
          <p className="stage-whisper" role="status">
            The complete spread is gathering into an interpretation…
          </p>
        )}

        {streamState === "failed" && (
          <div className="generation-recovery" role="alert">
            <p>
              {announcement || "The reading stream paused. Received sections remain available."}
            </p>
            <button onClick={onRetry} type="button">
              Continue the same reading
            </button>
          </div>
        )}
      </div>

      <details className="reading-details-drawer">
        <summary>Reading details and evidence</summary>
        <p>
          {result.personalizationLens
            ? "What the cards indicate is kept separate from the personalized reflection."
            : "This reading uses only the locked cards and spread positions."}
        </p>
        <ol>
          {result.cards.map((card) => (
            <li key={card.positionId}>
              <strong>{card.positionLabel}</strong>
              <span>{card.coreMeaning}</span>
              <ul>
                {card.supportingEvidence.map((evidence) => (
                  <li key={evidence}>{evidence}</li>
                ))}
              </ul>
            </li>
          ))}
        </ol>
        {personalization && result.personalizationLens && (
          <p>
            Personalized reflection used a minimized private lens from profile snapshot{" "}
            {personalization.snapshotVersion}; raw birth data was not shared with the narrator.
          </p>
        )}
      </details>

      <p aria-live="polite" className="sr-only">
        {announcement}
      </p>
      {reducedMotion && <span className="sr-only">Reduced motion is active.</span>}
    </section>
  );
}

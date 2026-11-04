"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import {
  oracleStreamEventSchema,
  type OracleStreamEvent,
  type ReadingResult,
} from "@starguidance/contracts";

import { CONNECTION_LOST_MESSAGE, SERVER_UNAVAILABLE_MESSAGE } from "@/lib/client-request";

import {
  countNarrationWords,
  ReadingAudioPlayer,
  type ReadingNarrationSnapshot,
} from "./reading-audio-player";
import type { DealtCardView, ReadingPersonalization } from "./reading-types";

type PhaseEvent = Extract<OracleStreamEvent, { type: "phase" }>;
type StreamState = "idle" | "streaming" | "complete" | "failed";

/** No bytes for this long means the stream has stalled. */
export const STREAM_IDLE_TIMEOUT_MS = 20_000;
const STREAM_PAUSED_MESSAGE =
  "The reading paused partway. What arrived is kept — you can continue.";

/** Reader-facing copy for a stream request the server refused. Server
 * `error` strings are already written for readers; anything else (HTML
 * error pages, parse failures) gets a calm fallback, never raw text. */
export function streamFailureMessage(status: number, serverError?: unknown): string {
  if (status === 0) return CONNECTION_LOST_MESSAGE;
  if (status === 401) return "Please sign in again to continue this reading.";
  if (status === 404) return "This reading could not be found.";
  if (status === 409)
    return typeof serverError === "string" && serverError
      ? serverError
      : "Your reading isn’t ready to open yet. Please try again in a moment.";
  if (status === 429) return "That was a lot at once. Please wait a moment, then continue.";
  if (status >= 500) return SERVER_UNAVAILABLE_MESSAGE;
  return STREAM_PAUSED_MESSAGE;
}

/** Parses one NDJSON line; malformed lines are skipped rather than shown. */
export function parseStreamLine(line: string): OracleStreamEvent | undefined {
  try {
    const parsed = oracleStreamEventSchema.safeParse(JSON.parse(line));
    return parsed.success ? parsed.data : undefined;
  } catch {
    return undefined;
  }
}

/** How a finished stream settles: an explicit `complete`, or — when the
 * connection simply ended — complete only if some passages arrived. */
export function settledStreamState(sawComplete: boolean, entryCount: number): StreamState {
  return sawComplete || entryCount > 0 ? "complete" : "failed";
}

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
  displayName,
  personalization,
  question,
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
  onStreamFailure,
  previewEvents,
}: {
  active: boolean;
  cards: readonly DealtCardView[];
  displayName?: string;
  personalization?: ReadingPersonalization;
  /** For a follow-up: the reader's own question, shown above its answer. */
  question?: string;
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
  /** Called with the HTTP status when the stream request is refused (0 for
   * a dropped connection), e.g. so a caller can re-save reveal progress on
   * a 409 before retrying. */
  onStreamFailure?: (status: number) => void;
  previewEvents?: readonly PhaseEvent[];
}) {
  const [entries, setEntries] = useState<PhaseEvent[]>(previewEvents ? [...previewEvents] : []);
  const [streamState, setStreamState] = useState<StreamState>(previewEvents ? "complete" : "idle");
  const [activeIndex, setActiveIndex] = useState(0);
  const [journeyComplete, setJourneyComplete] = useState(false);
  const [readingMode, setReadingMode] = useState<"section" | "all">("section");
  const [announcement, setAnnouncement] = useState("");
  const [failureMessage, setFailureMessage] = useState("");
  const [narration, setNarration] = useState<ReadingNarrationSnapshot>({
    sectionIndex: null,
    state: "idle",
    visibleWordCount: 0,
    wordCount: 0,
  });
  const entriesRef = useRef(entries);
  const onJourneyCompleteChangeRef = useRef(onJourneyCompleteChange);
  const onStateChangeRef = useRef(onStateChange);
  const onStreamFailureRef = useRef(onStreamFailure);

  useEffect(() => {
    onJourneyCompleteChangeRef.current = onJourneyCompleteChange;
    onStateChangeRef.current = onStateChange;
    onStreamFailureRef.current = onStreamFailure;
  }, [onJourneyCompleteChange, onStateChange, onStreamFailure]);

  const updateState = useCallback((next: StreamState) => {
    setStreamState(next);
    onStateChangeRef.current?.(next);
  }, []);

  const completeJourney = useCallback(() => {
    setJourneyComplete(true);
    setAnnouncement("The reading is complete. What comes next is below.");
    onJourneyCompleteChangeRef.current?.(true);
  }, []);

  useEffect(() => {
    let timer = 0;
    if (previewEvents) {
      entriesRef.current = [...previewEvents];
      timer = window.setTimeout(() => {
        setEntries([...previewEvents]);
        setActiveIndex(0);
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
      setJourneyComplete(false);
      onJourneyCompleteChange?.(false);
    }, 0);
    return () => window.clearTimeout(timer);
  }, [onJourneyCompleteChange, previewEvents, target, updateState]);

  useEffect(() => {
    if (!active || previewEvents) return;
    const controller = new AbortController();
    let idleTimer = 0;
    let stalled = false;
    const armIdleTimer = () => {
      window.clearTimeout(idleTimer);
      idleTimer = window.setTimeout(() => {
        stalled = true;
        controller.abort();
      }, STREAM_IDLE_TIMEOUT_MS);
    };
    const fail = (message: string) => {
      setFailureMessage(message);
      setAnnouncement(message);
      updateState("failed");
    };
    const startTimer = window.setTimeout(() => {
      setFailureMessage("");
      updateState("streaming");
    }, 0);
    void (async () => {
      let sawComplete = false;
      try {
        const failure = window.sessionStorage.getItem("sg:e2e-stream-fail-after");
        armIdleTimer();
        let response: Response;
        try {
          response = await fetch(
            `/api/readings/${readingId}/stream?target=${encodeURIComponent(target)}`,
            {
              cache: "no-store",
              signal: controller.signal,
              ...(failure ? { headers: { "x-e2e-stream-fail-after": failure } } : {}),
            },
          );
        } catch {
          if (controller.signal.aborted && !stalled) return;
          onStreamFailureRef.current?.(0);
          fail(stalled ? STREAM_PAUSED_MESSAGE : CONNECTION_LOST_MESSAGE);
          return;
        }
        if (!response.ok || !response.body) {
          const body = (await response.json().catch(() => ({}))) as { error?: unknown };
          onStreamFailureRef.current?.(response.status);
          fail(streamFailureMessage(response.status, body.error));
          return;
        }
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        const handle = (line: string) => {
          if (!line.trim()) return;
          const event = parseStreamLine(line);
          if (!event) return;
          if (event.type === "phase") {
            const next = [
              ...entriesRef.current.filter(({ sequence }) => sequence !== event.sequence),
              event,
            ].sort((left, right) => left.sequence - right.sequence);
            entriesRef.current = next;
            setEntries(next);
          } else if (event.type === "error") {
            window.sessionStorage.removeItem("sg:e2e-stream-fail-after");
            fail(STREAM_PAUSED_MESSAGE);
            sawComplete = true;
          } else {
            sawComplete = true;
            updateState("complete");
          }
        };
        while (true) {
          const chunk = await reader.read();
          armIdleTimer();
          buffer += decoder.decode(chunk.value, { stream: !chunk.done });
          const lines = buffer.split("\n");
          buffer = lines.pop() ?? "";
          for (const line of lines) handle(line);
          if (chunk.done) {
            handle(buffer);
            break;
          }
        }
        window.clearTimeout(idleTimer);
        if (!sawComplete) {
          const settled = settledStreamState(false, entriesRef.current.length);
          if (settled === "complete") updateState("complete");
          else fail(STREAM_PAUSED_MESSAGE);
        }
      } catch {
        window.clearTimeout(idleTimer);
        if (controller.signal.aborted && !stalled) return;
        if (entriesRef.current.length > 0 && sawComplete) return;
        fail(STREAM_PAUSED_MESSAGE);
      }
    })();
    return () => {
      window.clearTimeout(startTimer);
      window.clearTimeout(idleTimer);
      controller.abort();
    };
  }, [active, previewEvents, readingId, retryToken, target, updateState]);

  const activeEntry = entries[Math.min(activeIndex, Math.max(0, entries.length - 1))];
  const activePositionId = activeEntry?.cardPositionIds?.[0];
  const activeCardIndex = activePositionId
    ? cards.findIndex(({ positionId }) => positionId === activePositionId)
    : -1;

  useEffect(() => {
    onActiveCardChange?.(activeCardIndex < 0 ? null : activeCardIndex);
  }, [activeCardIndex, onActiveCardChange]);

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
    if (readingMode === "all") return;
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
  const handleNarrationChange = useCallback((snapshot: ReadingNarrationSnapshot) => {
    setNarration(snapshot);
    if (snapshot.sectionIndex !== null) setActiveIndex(snapshot.sectionIndex);
  }, []);
  const greetingFor = (entry: PhaseEvent | undefined) =>
    entry?.phase === "directAnswer" && displayName?.trim() && displayName.trim() !== "Reader"
      ? `For ${displayName.trim()}`
      : undefined;
  const eyebrowFor = (entry: PhaseEvent) =>
    greetingFor(entry) ??
    (entry.cardPositionIds?.length ? "What this card brings" : "Your reading");
  const onLastPassage = activeIndex >= entries.length - 1;
  const finishable = streamState === "complete" && entries.length > 0;
  const cardFor = (positionId: string) => cards.find((card) => card.positionId === positionId);

  const passageBody = (entry: PhaseEvent, index: number, inSequence: boolean) => (
    <>
      <p className="reading-section-eyebrow">{eyebrowFor(entry)}</p>
      <h2>{entry.heading}</h2>
      <NarratedPassage
        active={inSequence && narrationSequencing && narration.sectionIndex === index}
        currentWord={narration.state === "playing"}
        text={entry.text}
        visibleWords={inSequence ? visiblePassageWords(entry, index) : Number.POSITIVE_INFINITY}
      />
    </>
  );

  return (
    <section
      className="oracle-transcript-shell reading-journey-shell"
      data-loaded-section-count={entries.length}
      data-reading-mode={readingMode}
      data-journey-complete={journeyComplete ? "true" : "false"}
      data-state={streamState}
      data-testid="reading-journey"
    >
      <div className="reading-mode-bar">
        <div aria-label="Reading controls" role="group">
          <span className="reading-section-count">
            {activeEntry
              ? readingMode === "all"
                ? `${entries.length} passages`
                : `${activeIndex + 1} / ${entries.length}`
              : "Preparing"}
          </span>
          <ReadingAudioPlayer
            activeIndex={activeIndex}
            continuous
            enabled={audioEnabled}
            entries={entries}
            onNarrationChange={handleNarrationChange}
            readingId={readingId}
            target={target}
          />
        </div>
        <button
          aria-pressed={readingMode === "all"}
          className="reading-mode-toggle"
          disabled={entries.length === 0}
          onClick={() => setReadingMode((mode) => (mode === "all" ? "section" : "all"))}
          type="button"
        >
          {readingMode === "all" ? "One passage at a time" : "Read it all at once"}
        </button>
      </div>

      {question && (
        <p className="oracle-follow-up-question" data-testid="follow-up-question">
          <span>You asked</span>
          {question}
        </p>
      )}

      <div
        aria-label={
          readingMode === "all"
            ? "Your reading"
            : "Your reading. Use the arrow keys to move between passages."
        }
        className="oracle-transcript reading-journey-viewport"
        data-active-card-index={activeCardIndex >= 0 ? activeCardIndex : undefined}
        data-testid="oracle-transcript"
        onKeyDown={handleKeyDown}
        role="region"
        tabIndex={0}
      >
        {readingMode === "all" && entries.length > 0 ? (
          <div className="reading-all-passages">
            {entries.map((entry, index) => (
              <article
                className="oracle-entry guided-passage"
                data-phase={entry.phase}
                key={`${target}:${entry.sequence}`}
              >
                {passageBody(entry, index, false)}
              </article>
            ))}
            <nav aria-label="Reading sections" className="reading-journey-navigation">
              <button
                aria-label="Finish reading"
                className="reading-pager-button is-primary"
                data-testid={finishable ? "complete-reading-action" : undefined}
                disabled={!finishable}
                onClick={completeJourney}
                type="button"
              >
                {finishable ? "Finish reading" : "The reading is still arriving…"}
              </button>
            </nav>
          </div>
        ) : activeEntry ? (
          <article
            className="oracle-entry guided-passage is-active"
            data-narration-state={narrationStateFor(activeIndex)}
            data-phase={activeEntry.phase}
            data-testid="reading-active-passage"
            key={`${target}:${activeEntry.sequence}`}
          >
            {passageBody(activeEntry, activeIndex, true)}
            <nav aria-label="Reading sections" className="reading-journey-navigation">
              <button
                aria-label="Previous reading passage"
                className="reading-pager-button"
                disabled={activeIndex === 0}
                onClick={() => move(-1)}
                type="button"
              >
                <span aria-hidden="true">←</span> Previous
              </button>
              <span className="reading-pager-count">
                {activeIndex + 1} of {Math.max(1, entries.length)}
              </span>
              <button
                aria-label={onLastPassage && finishable ? "Finish reading" : "Next reading passage"}
                className={`reading-pager-button ${onLastPassage && finishable ? "is-primary" : ""}`}
                disabled={onLastPassage && !finishable}
                data-testid={onLastPassage && finishable ? "complete-reading-action" : undefined}
                onClick={() => {
                  if (onLastPassage) completeJourney();
                  else move(1);
                }}
                type="button"
              >
                {onLastPassage && finishable ? (
                  "Finish reading"
                ) : (
                  <>
                    Next <span aria-hidden="true">→</span>
                  </>
                )}
              </button>
            </nav>
          </article>
        ) : (
          <p className="stage-whisper" role="status">
            Your cards are being read together…
          </p>
        )}

        {streamState === "failed" && (
          <div className="generation-recovery" role="alert">
            <p>{failureMessage || STREAM_PAUSED_MESSAGE}</p>
            <button className="ritual-action" onClick={onRetry} type="button">
              Continue the reading
            </button>
          </div>
        )}
      </div>

      <details className="reading-details-drawer">
        <summary>Card meanings</summary>
        <ol>
          {result.cards.map((card) => {
            const dealt = cardFor(card.positionId);
            return (
              <li key={card.positionId}>
                <strong>
                  {dealt?.positionName ?? card.positionLabel}
                  {dealt ? ` · ${dealt.name}` : ""}
                  {card.orientation === "reversed" ? " · Reversed" : ""}
                </strong>
                <span>{card.coreMeaning}</span>
                {card.positionInterpretation !== card.coreMeaning && (
                  <span>{card.positionInterpretation}</span>
                )}
              </li>
            );
          })}
        </ol>
        <p>
          {result.personalizationLens
            ? "Parts of your profile shaped which themes this reading leaned into. They never changed which cards you drew or what they mean."
            : "This reading draws only on your cards and where they fell in the spread."}
          {personalization && result.personalizationLens
            ? " Your birth details themselves were never shared with the reader."
            : ""}
        </p>
      </details>

      <p aria-live="polite" className="sr-only">
        {announcement}
      </p>
    </section>
  );
}

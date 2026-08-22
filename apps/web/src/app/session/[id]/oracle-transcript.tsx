"use client";

import {
  useCallback,
  useEffect,
  useMemo,
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

import type { DealtCardView, ReadingPersonalization } from "./reading-types";
import { PrivateSigil } from "./private-sigil";

type PhaseEvent = Extract<OracleStreamEvent, { type: "phase" }>;
type StreamState = "idle" | "streaming" | "complete" | "failed";

interface TranscriptEntry extends PhaseEvent {
  key: string;
  target: string;
}

type ReadingPassage = ReadingResult["passages"][number];

const CARD_FOCUSED_PASSAGE_ROLES = new Set<ReadingPassage["role"]>([
  "situation",
  "underlyingPattern",
  "development",
]);

export function isCardFocusedGuidedPassage(role: ReadingPassage["role"]): boolean {
  return CARD_FOCUSED_PASSAGE_ROLES.has(role);
}

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

const profileSourceLabels: Readonly<Record<string, string>> = {
  numerology: "Numerology",
  dreamspell: "Dreamspell",
  westernAstrology: "Western astrology",
  bazi: "BaZi",
  planetaryAngularity: "Planetary angularity",
  nineStarKi: "Nine Star Ki",
};

function humanizeDomain(value: string) {
  return value.replaceAll(/([a-z])([A-Z])/g, "$1 $2").toLowerCase();
}

export const NARRATION_TIMING = {
  boundaryLeadWords: 2,
  maxSilentRevealSteps: 16,
  silentWordIntervalMs: 80,
  speechStartDelayMs: 520,
  spokenWordIntervalMs: 240,
} as const;

export function monotonicVisibleWordCount(current: number, requested: number, total: number) {
  return Math.max(current, Math.min(requested, total));
}

function NarratedParagraph({
  narrationKey,
  text,
  reducedMotion,
  soundEnabled,
  onComplete,
}: {
  narrationKey: string;
  text: string;
  reducedMotion: boolean;
  soundEnabled: boolean;
  onComplete: () => void;
}) {
  const words = useMemo(
    () =>
      Array.from(text.matchAll(/\S+/g), (match) => ({
        start: match.index ?? 0,
        text: match[0],
      })),
    [text],
  );
  // Put the first word on screen immediately. Speech starts only after a
  // short visual lead, so narration can never begin against an empty passage.
  const [visibleWords, setVisibleWords] = useState(
    reducedMotion ? words.length : Math.min(1, words.length),
  );
  const announced = useRef(false);
  const complete = reducedMotion || visibleWords >= words.length;

  useEffect(() => {
    if (reducedMotion || words.length === 0) return;
    let cancelled = false;
    let speechTimer: number | undefined;
    const speechApiAvailable = "speechSynthesis" in window && "SpeechSynthesisUtterance" in window;
    // Never hand a private reading to a network-backed browser voice. If the
    // device has no local voice, the visual narration keeps the same cadence
    // and the existing ritual tones remain available.
    const localEnglishVoice = speechApiAvailable
      ? window.speechSynthesis
          .getVoices()
          .find((voice) => voice.localService && voice.lang.toLowerCase().startsWith("en"))
      : undefined;
    const localNarrationAvailable = soundEnabled && localEnglishVoice !== undefined;
    // Keep the silent cinematic reveal compact even when a passage is long.
    // Phrase-sized batches reduce paint churn and prevent the entrance effect
    // from becoming the page's LCP bottleneck. Spoken narration still follows
    // word boundaries at the more deliberate voice cadence below.
    const wordsPerTick = localNarrationAvailable
      ? 1
      : Math.max(1, Math.ceil(words.length / NARRATION_TIMING.maxSilentRevealSteps));
    const revealTimer = window.setInterval(
      () =>
        setVisibleWords((count) => {
          const next = monotonicVisibleWordCount(count, count + wordsPerTick, words.length);
          if (next >= words.length) window.clearInterval(revealTimer);
          return next;
        }),
      localNarrationAvailable
        ? NARRATION_TIMING.spokenWordIntervalMs
        : NARRATION_TIMING.silentWordIntervalMs,
    );

    if (localNarrationAvailable) {
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.rate = 0.96;
      utterance.pitch = 0.92;
      utterance.volume = 0.82;
      utterance.voice = localEnglishVoice;
      utterance.addEventListener("boundary", (event) => {
        if (cancelled || (event.name && event.name !== "word")) return;
        let wordIndex = 0;
        for (let index = 0; index < words.length; index += 1) {
          if ((words[index]?.start ?? Number.POSITIVE_INFINITY) > event.charIndex) break;
          wordIndex = index;
        }
        if (wordIndex >= 0)
          setVisibleWords((count) =>
            monotonicVisibleWordCount(
              count,
              wordIndex + NARRATION_TIMING.boundaryLeadWords,
              words.length,
            ),
          );
      });
      utterance.addEventListener("end", () => {
        if (!cancelled) {
          window.clearInterval(revealTimer);
          setVisibleWords((count) => monotonicVisibleWordCount(count, words.length, words.length));
        }
      });
      window.speechSynthesis.cancel();
      speechTimer = window.setTimeout(() => {
        if (!cancelled) window.speechSynthesis.speak(utterance);
      }, NARRATION_TIMING.speechStartDelayMs);
    }

    return () => {
      cancelled = true;
      window.clearInterval(revealTimer);
      if (speechTimer !== undefined) window.clearTimeout(speechTimer);
      if (localNarrationAvailable) window.speechSynthesis.cancel();
    };
  }, [narrationKey, reducedMotion, soundEnabled, text, words]);

  useEffect(() => {
    if (!complete || announced.current) return;
    announced.current = true;
    onComplete();
  }, [complete, onComplete]);

  return (
    <p className="oracle-entry-text">
      <span aria-hidden="true" className="oracle-word-stream">
        {words.map((word, index) => (
          <span
            className={`oracle-word ${reducedMotion || index < visibleWords ? "is-visible" : ""}`}
            key={`${narrationKey}:${word.start}`}
          >
            {word.text}
            {index < words.length - 1 ? " " : ""}
          </span>
        ))}
      </span>
      <span className="sr-only">{text}</span>
    </p>
  );
}

function ReadingOverview({
  activeCardIndex,
  activeIndex,
  cards,
  entries,
  onNarrationComplete,
  onSelectCard,
  personalization,
  reducedMotion,
  result,
  sigilSeed,
  soundEnabled,
}: {
  activeCardIndex: number | null;
  activeIndex: number;
  cards: readonly DealtCardView[];
  entries: readonly TranscriptEntry[];
  onNarrationComplete: () => void;
  onSelectCard: (index: number) => void;
  personalization?: ReadingPersonalization;
  reducedMotion: boolean;
  result: ReadingResult;
  sigilSeed?: string;
  soundEnabled: boolean;
}) {
  const opening = result.passages.find(({ role }) => role === "opening") ?? result.passages[0];
  const lensSignalLabel = personalization
    ? `${personalization.traits.length} derived lens ${personalization.traits.length === 1 ? "signal" : "signals"}`
    : "";

  return (
    <article
      className={`reading-result-overview ${activeIndex === 0 ? "oracle-entry is-active" : ""}`}
      data-phase={activeIndex === 0 ? "narration" : undefined}
      data-testid="reading-result-overview"
    >
      <header className="reading-result-header">
        <div className="reading-result-title-row">
          <div>
            <p className="reading-section-eyebrow">Personal reading · {cards.length} cards</p>
            <h2>{result.title}</h2>
          </div>
          {sigilSeed && <PrivateSigil seed={sigilSeed} subtle />}
        </div>
        {opening && (
          <NarratedParagraph
            narrationKey={`opening:${opening.id}`}
            onComplete={onNarrationComplete}
            reducedMotion={reducedMotion}
            soundEnabled={soundEnabled}
            text={opening.text}
          />
        )}
        <div className="reading-opening-assurance" role="note">
          <span>Your profile shaped the interpretation.</span>
          <span>The draw stayed entirely random.</span>
        </div>
        {personalization && (
          <details className="reading-lens-disclosure">
            <summary>
              <span aria-hidden="true">◈</span>
              <span>
                <strong>How this was personalized</strong>
                <small>
                  {lensSignalLabel} · snapshot v{personalization.snapshotVersion}
                </small>
              </span>
              <span aria-hidden="true">⌄</span>
            </summary>
            <div>
              <p>
                Only question-relevant, derived profile traits entered the interpretation. Your
                birth name, date, time, and birthplace did not enter the narrator request.
              </p>
              {personalization.traits.length > 0 ? (
                <ul>
                  {personalization.traits.map((trait) => (
                    <li
                      key={[trait.sourceSystem, trait.domain, trait.calculationVersion].join(":")}
                    >
                      <span>{profileSourceLabels[trait.sourceSystem] ?? trait.sourceSystem}</span>
                      <strong>{humanizeDomain(trait.domain)}</strong>
                      <small>
                        {trait.stability} · {trait.confidence} confidence
                      </small>
                    </li>
                  ))}
                  {personalization.tensionCount > 0 && (
                    <li>
                      <span>Preserved tension</span>
                      <strong>Two valid sides held together</strong>
                      <small>Not averaged away</small>
                    </li>
                  )}
                </ul>
              ) : (
                <p>No stable trait met this question’s relevance threshold.</p>
              )}
              <small>
                Lens {personalization.lensVersion} · {personalization.completeness} profile · raw
                birth data shared: no
              </small>
            </div>
          </details>
        )}
      </header>

      <section aria-labelledby="locked-card-overview-heading" className="reading-card-overview">
        <div className="reading-overview-heading-row">
          <h3 id="locked-card-overview-heading">Cards in this thread</h3>
          <span>Select a card to enter its passage.</span>
        </div>
        <div className="reading-card-strip">
          {cards.map((card, cardIndex) => {
            const passageIndex = entries.findIndex(
              (entry, index) => index > 0 && entry.cardPositionIds?.includes(card.positionId),
            );
            return (
              <button
                aria-pressed={activeCardIndex === cardIndex}
                disabled={passageIndex < 0}
                key={card.positionId}
                onClick={() => onSelectCard(passageIndex)}
                type="button"
              >
                <small>{card.positionName}</small>
                <strong>{card.name}</strong>
                <span>{card.orientation}</span>
                <span className="sr-only">. Focus this card in the guided reading.</span>
              </button>
            );
          })}
        </div>
      </section>
      <p className="reading-entry-cue">
        Continue to move through your reading one passage at a time.
      </p>
    </article>
  );
}

function ReadingIntegration({
  cards,
  result,
}: {
  cards: readonly DealtCardView[];
  result: ReadingResult;
}) {
  const likely = result.passages.find(({ id }) => id === result.trajectory.likelyPassageId);
  const alternate = result.passages.find(({ id }) => id === result.trajectory.alternatePassageId);
  return (
    <article
      className="oracle-entry reading-integration is-active"
      data-phase="integration"
      data-testid="reading-integration"
    >
      <header>
        <p className="reading-section-eyebrow">Your reading is complete</p>
        <h2>What to carry forward</h2>
      </header>
      <section aria-label="Conditional trajectories" className="reading-trajectory-compass">
        <article>
          <span>Likely while conditions hold</span>
          <p>{likely?.text}</p>
        </article>
        <i aria-hidden="true">
          <span>or</span>
        </i>
        <article>
          <span>An alternate path</span>
          <p>{alternate?.text}</p>
        </article>
      </section>
      <div className="reading-integration-grid">
        <section>
          <h3>Your agency</h3>
          <ul>
            {result.userAgency.map((action) => (
              <li key={action}>{action}</li>
            ))}
          </ul>
        </section>
        <section>
          <h3>Conditions to notice</h3>
          <ul>
            {result.trajectory.conditions.map((condition) => (
              <li key={condition}>{condition}</li>
            ))}
          </ul>
        </section>
        <section>
          <h3>What could change the pattern</h3>
          <ul>
            {result.disconfirmingEvidence.map((evidence) => (
              <li key={evidence}>{evidence}</li>
            ))}
          </ul>
        </section>
      </div>
      <blockquote className="reading-integration-question">
        <span>A question to carry</span>
        {result.reflectionQuestion}
      </blockquote>
      <p className="reading-uncertainty">{result.uncertainty}</p>
      <footer>
        <strong>{cards.length} cards remain locked to this reading.</strong>
        <span>You can now continue with a follow-up without changing the draw.</span>
      </footer>
    </article>
  );
}

const completeReadingChapters = [
  {
    id: "signal",
    title: "I · The signal",
    description: "What is present and asking to be noticed.",
    roles: ["opening", "situation", "underlyingPattern"] as const,
  },
  {
    id: "pattern",
    title: "II · The pattern",
    description: "How the cards connect, develop, and turn.",
    roles: ["development", "turningPoint"] as const,
  },
  {
    id: "paths",
    title: "III · The paths",
    description: "Conditional trajectories and the choices still yours.",
    roles: ["trajectory", "alternative", "agency", "reflection", "closing", "safety"] as const,
  },
] as const;

function CompleteReading({
  cards,
  onComplete,
  result,
  sigilSeed,
}: {
  cards: readonly DealtCardView[];
  onComplete: () => void;
  result: ReadingResult;
  sigilSeed?: string;
}) {
  const cardByPosition = new Map(cards.map((card) => [card.positionId, card]));
  return (
    <div className="reading-complete-story" data-testid="reading-complete-story">
      <article>
        <header className="reading-complete-story__cover">
          {sigilSeed && <PrivateSigil seed={sigilSeed} />}
          <p className="reading-section-eyebrow">Your reading · one continuous story</p>
          <h2>{result.title}</h2>
          <p>The same locked cards, arranged as three chapters for unhurried reading.</p>
        </header>
        <nav aria-label="Complete reading chapters" className="reading-complete-story__nav">
          {completeReadingChapters.map((chapter) => (
            <a href={`#reading-chapter-${chapter.id}`} key={chapter.id}>
              {chapter.title}
            </a>
          ))}
        </nav>
        {completeReadingChapters.map((chapter) => {
          const passages = result.passages.filter((passage) =>
            chapter.roles.some((role) => role === passage.role),
          );
          if (passages.length === 0) return null;
          return (
            <section
              aria-labelledby={`reading-chapter-${chapter.id}`}
              className="reading-complete-story__chapter"
              key={chapter.id}
            >
              <header>
                <p>{chapter.description}</p>
                <h3 id={`reading-chapter-${chapter.id}`}>{chapter.title}</h3>
              </header>
              {passages.map((passage) => {
                const referencedCards = passage.cardReferences
                  .map((positionId) => cardByPosition.get(positionId))
                  .filter((card): card is DealtCardView => Boolean(card));
                return (
                  <section className="reading-complete-story__passage" key={passage.id}>
                    <div>
                      <span>{passageRoleLabels[passage.role]}</span>
                      {referencedCards.length > 0 && (
                        <small>
                          {referencedCards
                            .map((card) => `${card.positionName} · ${card.name}`)
                            .join(" / ")}
                        </small>
                      )}
                    </div>
                    <p>{passage.text}</p>
                  </section>
                );
              })}
            </section>
          );
        })}
      </article>
      <ReadingIntegration cards={cards} result={result} />
      <button className="reading-complete-story__continue" onClick={onComplete} type="button">
        <span>Reading held</span>
        Continue with these cards <b aria-hidden="true">→</b>
      </button>
    </div>
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
  personalization,
  readingId,
  result,
  sigilSeed,
  target,
  reducedMotion,
  retryToken,
  soundEnabled,
  onActiveCardChange,
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
  soundEnabled: boolean;
  onActiveCardChange?: (index: number | null) => void;
  onJourneyCompleteChange?: (complete: boolean) => void;
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
  const [readingModeSelection, setReadingModeSelection] = useState<{
    target: string;
    mode: "guided" | "complete";
  }>({ target, mode: "guided" });
  const [completeStoryAcknowledgedTarget, setCompleteStoryAcknowledgedTarget] = useState<string>();
  const readingMode = readingModeSelection.target === target ? readingModeSelection.mode : "guided";
  const completeStoryAcknowledged = completeStoryAcknowledgedTarget === target;
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

  const integrationAvailable = streamState === "complete" && entries.length > 0;
  const totalSteps = entries.length + (integrationAvailable ? 1 : 0);
  const maximumIndex = Math.max(0, totalSteps - 1);
  const boundedIndex = Math.min(activeIndex, maximumIndex);
  const showingIntegration = integrationAvailable && boundedIndex === entries.length;
  const activeEntry = showingIntegration ? undefined : entries[boundedIndex];
  const activePassage = activeEntry?.passageId
    ? result.passages.find(({ id }) => id === activeEntry.passageId)
    : undefined;
  const activeCardIndex =
    boundedIndex === 0 ||
    showingIntegration ||
    !activePassage ||
    !isCardFocusedGuidedPassage(activePassage.role)
      ? null
      : cardIndexFor(entries, boundedIndex, cards);
  const activeCard = activeCardIndex === null ? undefined : cards[activeCardIndex];
  const activeChapter = activePassage
    ? completeReadingChapters.find((chapter) =>
        (chapter.roles as readonly string[]).includes(activePassage.role),
      )
    : completeReadingChapters[0];

  useEffect(() => {
    onActiveCardChange?.(readingMode === "guided" ? activeCardIndex : null);
  }, [activeCardIndex, onActiveCardChange, readingMode]);

  useEffect(() => {
    onJourneyCompleteChange?.(showingIntegration || completeStoryAcknowledged);
  }, [completeStoryAcknowledged, onJourneyCompleteChange, showingIntegration]);

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
      const currentMaximum = Math.max(
        0,
        currentEntries.length - 1 + (streamState === "complete" ? 1 : 0),
      );
      const nextIndex = Math.max(0, Math.min(requestedIndex, currentMaximum));
      activeIndexRef.current = nextIndex;
      setActiveIndex(nextIndex);
      window.requestAnimationFrame(() => {
        const viewport = viewportRef.current;
        if (!viewport) return;
        viewport.scrollTo({
          behavior: reducedMotion ? "auto" : "smooth",
          top: 0,
        });
      });
      const next = currentEntries[nextIndex];
      setAnnouncement(
        next
          ? `${next.heading}. ${nextIndex + 1} of ${currentMaximum + 1}.`
          : `Reading complete. ${currentMaximum + 1} of ${currentMaximum + 1}.`,
      );
    },
    [reducedMotion, streamState],
  );
  const goPrevious = () => goTo(activeIndexRef.current - 1);
  const goNext = () => goTo(activeIndexRef.current + 1);
  const changeReadingMode = (mode: "guided" | "complete") => {
    setReadingModeSelection({ target, mode });
    setAnnouncement(
      mode === "complete"
        ? "Complete reading view opened."
        : `Guided reading resumed at passage ${boundedIndex + 1}.`,
    );
    window.requestAnimationFrame(() => {
      viewportRef.current?.scrollTo({ behavior: reducedMotion ? "auto" : "smooth", top: 0 });
    });
  };

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
      goTo(maximumIndex);
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
      data-reading-mode={readingMode}
      data-state={streamState}
      data-testid="reading-journey"
    >
      <div className="reading-mode-bar">
        <div aria-label="Reading format" role="group">
          <button
            aria-pressed={readingMode === "guided"}
            onClick={() => changeReadingMode("guided")}
            type="button"
          >
            <span aria-hidden="true">↝</span>
            Guided
          </button>
          <button
            aria-pressed={readingMode === "complete"}
            disabled={!integrationAvailable}
            onClick={() => changeReadingMode("complete")}
            type="button"
          >
            <span aria-hidden="true">☰</span>
            Read as one story
          </button>
        </div>
        <span>
          {integrationAvailable
            ? readingMode === "guided"
              ? activeChapter?.title
              : "All three chapters"
            : "The reading is still arriving"}
        </span>
      </div>
      <div
        aria-label="Your reading. Scroll, swipe, or use the arrow keys to move through it."
        className="oracle-transcript reading-journey-viewport"
        data-active-card-index={activeCardIndex ?? undefined}
        data-testid="oracle-transcript"
        onKeyDown={(event) => {
          if (readingMode === "guided") handleKeyDown(event);
        }}
        onTouchCancel={() => {
          touchOrigin.current = undefined;
        }}
        onTouchEnd={(event) => {
          if (readingMode === "guided") handleTouchEnd(event);
        }}
        onTouchStart={(event) => {
          if (readingMode === "guided") handleTouchStart(event);
        }}
        onWheel={(event) => {
          if (readingMode === "guided") handleWheel(event);
        }}
        ref={viewportRef}
        role="region"
        tabIndex={0}
      >
        {readingMode === "guided" && boundedIndex === 0 && (
          <ReadingOverview
            activeCardIndex={activeCardIndex}
            activeIndex={boundedIndex}
            cards={cards}
            entries={entries}
            onNarrationComplete={() => setAnnouncement("Opening insight complete.")}
            onSelectCard={goTo}
            {...(personalization ? { personalization } : {})}
            reducedMotion={reducedMotion}
            result={result}
            {...(sigilSeed ? { sigilSeed } : {})}
            soundEnabled={soundEnabled}
          />
        )}
        {readingMode === "guided" && activeEntry && boundedIndex > 0 && (
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
            <NarratedParagraph
              narrationKey={activeEntry.key}
              onComplete={() => setAnnouncement(`${activeEntry.heading} complete.`)}
              reducedMotion={reducedMotion}
              soundEnabled={soundEnabled}
              text={activeEntry.text}
            />
          </article>
        )}
        {readingMode === "guided" && showingIntegration && (
          <ReadingIntegration cards={cards} result={result} />
        )}
        {readingMode === "complete" && integrationAvailable && (
          <CompleteReading
            cards={cards}
            onComplete={() => setCompleteStoryAcknowledgedTarget(target)}
            result={result}
            {...(sigilSeed ? { sigilSeed } : {})}
          />
        )}
        <div aria-atomic="true" aria-live="polite" className="sr-only">
          {announcement}
        </div>
      </div>

      {readingMode === "guided" && (
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
              {totalSteps === 0 ? 0 : boundedIndex + 1} / {totalSteps}
            </span>
            <i aria-hidden="true">
              <b
                style={
                  {
                    "--reading-progress": totalSteps
                      ? `${((boundedIndex + 1) / totalSteps) * 100}%`
                      : "0%",
                  } as CSSProperties
                }
              />
            </i>
          </div>
          <button
            aria-label="Next reading passage"
            disabled={totalSteps === 0 || boundedIndex >= maximumIndex}
            onClick={goNext}
            type="button"
          >
            <span aria-hidden="true">›</span>
          </button>
        </nav>
      )}

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

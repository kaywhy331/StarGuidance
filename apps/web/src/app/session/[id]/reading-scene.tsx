"use client";

import { useCallback, useEffect, useRef, useState, type CSSProperties } from "react";
import Link from "next/link";
import { useMachine } from "@xstate/react";
import { GUARDED_CATEGORIES, type SafetyCategory } from "@starguidance/ai";
import type { FollowUpResult, ReadingResult } from "@starguidance/contracts";
import { readingMachine } from "@starguidance/reading-machine";

import { useReadingPreferences, type ReadingPreferenceSeed } from "@/lib/reading-preferences";
import {
  readRitualProgress,
  writeRitualProgress,
  type RitualProgress,
} from "@/lib/ritual-progress";

import { MysticSanctuaryScene } from "./mystic-sanctuary-scene";
import { OracleTranscript } from "./oracle-transcript";
import { QuestionComposer } from "./question-composer";
import type { ReadingPayload } from "./reading-types";
import { SafetyInterruptContent } from "./safety-interrupt-panel";
import { TarotSpreadStage } from "./tarot-spread-stage";

const SHUFFLE_SHELL_COUNT = 15;

function ShuffleShells({ phase }: { phase: "mixing" | "gathering" }) {
  return (
    <div aria-hidden="true" className={`sanctuary-shuffle-shells is-${phase}`}>
      {Array.from({ length: SHUFFLE_SHELL_COUNT }, (_, index) => {
        const angle = (index / SHUFFLE_SHELL_COUNT) * Math.PI * 2 - Math.PI / 2;
        const mixAngle = angle + Math.PI * (0.58 + (index % 3) * 0.13);
        const counterAngle = angle - Math.PI * (0.34 + (index % 4) * 0.08);
        const horizontalReach = 24 + (index % 4) * 5;
        const verticalReach = 18 + ((index + 2) % 4) * 4;
        return (
          <span
            key={index}
            style={
              {
                "--shell-index": index,
                "--scatter-x": `${Math.cos(angle) * horizontalReach}vw`,
                "--scatter-y": `${Math.sin(angle) * verticalReach}vh`,
                "--mix-x": `${Math.cos(mixAngle) * (horizontalReach * 0.82)}vw`,
                "--mix-y": `${Math.sin(mixAngle) * (verticalReach * 0.9)}vh`,
                "--counter-x": `${Math.cos(counterAngle) * (horizontalReach * 0.68)}vw`,
                "--counter-y": `${Math.sin(counterAngle) * (verticalReach * 0.72)}vh`,
                "--scatter-rotation": `${(index - 7) * 17}deg`,
                "--mix-rotation": `${(7 - index) * 13}deg`,
              } as CSSProperties
            }
          />
        );
      })}
    </div>
  );
}

function playRevealTone() {
  const context = new window.AudioContext();
  const oscillator = context.createOscillator();
  const gain = context.createGain();
  oscillator.frequency.value = 392;
  gain.gain.setValueAtTime(0.035, context.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.001, context.currentTime + 0.18);
  oscillator.connect(gain).connect(context.destination);
  oscillator.start();
  oscillator.stop(context.currentTime + 0.18);
  oscillator.addEventListener("ended", () => void context.close());
}

export function ReadingScene({
  initialPreferences,
  readingId,
}: {
  initialPreferences?: ReadingPreferenceSeed;
  readingId: string;
}) {
  const [state, send] = useMachine(readingMachine);
  const [reading, setReading] = useState<ReadingPayload>();
  const [revealed, setRevealed] = useState<Set<number>>(new Set());
  const revealedRef = useRef<ReadonlySet<number>>(revealed);
  const [dealtCount, setDealtCount] = useState(0);
  const [readyPromptVisible, setReadyPromptVisible] = useState(false);
  const [cutTaken, setCutTaken] = useState<boolean>();
  const [activeReveal, setActiveReveal] = useState<number | null>(null);
  const [activeReadingCard, setActiveReadingCard] = useState<number | null>(null);
  const [error, setError] = useState<string>();
  const [safetyInterrupt, setSafetyInterrupt] = useState<{
    category: SafetyCategory;
    guidance: string;
  }>();
  const [followUp, setFollowUp] = useState("");
  const [followUpLoading, setFollowUpLoading] = useState(false);
  const [streamTarget, setStreamTarget] = useState("primary");
  const [streamRetryToken, setStreamRetryToken] = useState(0);
  const [journeyComplete, setJourneyComplete] = useState(false);
  const bootstrapped = useRef(false);
  const recoveredRitual = useRef(false);
  const revealCompletionTimer = useRef<number | undefined>(undefined);
  const {
    displayName,
    reducedMotion: motionOff,
    sound,
    toggleReducedMotion,
    toggleSound,
  } = useReadingPreferences(initialPreferences);
  const soundEnabled = useRef(sound);

  useEffect(() => {
    soundEnabled.current = sound;
  }, [sound]);

  const persistRitualProgress = useCallback(
    (progress: RitualProgress, phase: "cuttingDeck" | "revealingCards" | "complete") => {
      writeRitualProgress(window.sessionStorage, readingId, progress);
      void fetch(`/api/readings/${readingId}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "progress", phase, ...progress }),
      }).catch(() => {
        // The local receipt remains a recovery fallback; the locked draw is
        // already durable and is never changed by a progress-write failure.
      });
    },
    [readingId],
  );

  const completeShuffle = useCallback(() => {
    if (cutTaken === undefined) {
      setCutTaken(false);
      persistRitualProgress(
        { cutTaken: false, revealedIndexes: [...revealedRef.current] },
        "cuttingDeck",
      );
    }
    send({ type: "SHUFFLE_COMPLETE" });
  }, [cutTaken, persistRitualProgress, send]);

  useEffect(() => {
    void fetch(`/api/readings/${readingId}`, { cache: "no-store" })
      .then(async (response) => {
        if (!response.ok) throw new Error("Unable to recover this reading.");
        const payload = (await response.json()) as { reading: ReadingPayload };
        const progress =
          payload.reading.ritualProgress ??
          readRitualProgress(window.sessionStorage, readingId, payload.reading.cards.length);
        if (progress) {
          recoveredRitual.current = true;
          const recoveredRevealed = new Set(progress.revealedIndexes);
          revealedRef.current = recoveredRevealed;
          setRevealed(recoveredRevealed);
          setCutTaken(progress.cutTaken);
        }
        setReading(payload.reading);
      })
      .catch((cause: unknown) =>
        setError(cause instanceof Error ? cause.message : "Unable to recover this reading."),
      );
  }, [readingId]);

  useEffect(() => {
    if (!reading || bootstrapped.current) return;
    bootstrapped.current = true;
    send({ type: "START" });
    send({ type: "SELECT" });
    if (reading.sessionExpired) {
      send({ type: "EXPIRE" });
      return;
    }
    // Guarded questions are acknowledged on the intake page before this
    // reading, its locked draw, or its generation job exists. Interrupt
    // categories never reach this component at all.
    send({ type: "QUESTION_ACCEPTED" });
    send({ type: "DECK_READY" });
  }, [reading, send]);

  useEffect(() => {
    if (!state.matches("shuffling")) return;
    const timer = window.setTimeout(
      completeShuffle,
      recoveredRitual.current ? 0 : motionOff ? 120 : 5_000,
    );
    return () => window.clearTimeout(timer);
  }, [completeShuffle, motionOff, state]);

  useEffect(() => {
    if (!state.matches("cuttingDeck")) return;
    const timer = window.setTimeout(
      () => send({ type: "SKIP_CUT" }),
      recoveredRitual.current ? 0 : motionOff ? 120 : 2_000,
    );
    return () => window.clearTimeout(timer);
  }, [motionOff, send, state]);

  useEffect(() => {
    if (!state.matches("dealing") || !reading) return;
    const timers: number[] = [];
    if (recoveredRitual.current || motionOff) {
      setDealtCount(reading.cards.length);
      timers.push(window.setTimeout(() => send({ type: "DEALT" }), motionOff ? 80 : 0));
      return () => timers.forEach((timer) => window.clearTimeout(timer));
    }

    setDealtCount(0);
    reading.cards.forEach((_, index) => {
      timers.push(window.setTimeout(() => setDealtCount(index + 1), index * 1_000));
    });
    timers.push(
      window.setTimeout(
        () => send({ type: "DEALT" }),
        Math.max(0, reading.cards.length - 1) * 1_000 + 850,
      ),
    );
    return () => timers.forEach((timer) => window.clearTimeout(timer));
  }, [motionOff, reading, send, state]);

  useEffect(() => {
    if (!state.matches("awaitingReveal")) return;
    setReadyPromptVisible(recoveredRitual.current || motionOff);
    if (recoveredRitual.current || motionOff) return;
    const timer = window.setTimeout(() => setReadyPromptVisible(true), 5_000);
    return () => window.clearTimeout(timer);
  }, [motionOff, state]);

  // PRD UX-006: the reader intentionally begins and advances the reveal. The
  // ref reserves each card synchronously so rapid input cannot lose progress
  // before React commits the corresponding state update.

  const settleDuration = motionOff ? 40 : 650;

  const scheduleRevealCompletion = useCallback(
    (delay = settleDuration) => {
      if (revealCompletionTimer.current !== undefined) return;
      revealCompletionTimer.current = window.setTimeout(() => {
        revealCompletionTimer.current = undefined;
        send({ type: "ALL_REVEALED" });
      }, delay);
    },
    [send, settleDuration],
  );

  useEffect(
    () => () => {
      if (revealCompletionTimer.current !== undefined)
        window.clearTimeout(revealCompletionTimer.current);
    },
    [],
  );

  const revealCard = useCallback(
    (index: number) => {
      if (!reading || !state.matches("revealingCards") || revealedRef.current.has(index)) return;
      setActiveReveal(index);
      const next = new Set(revealedRef.current).add(index);
      revealedRef.current = next;
      setRevealed(next);
      const complete = next.size === reading.draw.assignments.length;
      if (cutTaken !== undefined)
        persistRitualProgress(
          { cutTaken, revealedIndexes: [...next] },
          complete ? "complete" : "revealingCards",
        );
      if (soundEnabled.current) playRevealTone();
    },
    [cutTaken, persistRitualProgress, reading, state],
  );

  useEffect(() => {
    if (!reading || !state.matches("revealingCards") || activeReveal !== null) return;
    const nextIndex = reading.cards.findIndex((_, index) => !revealedRef.current.has(index));
    if (nextIndex >= 0) {
      revealCard(nextIndex);
      return;
    }
    scheduleRevealCompletion();
  }, [activeReveal, reading, revealCard, scheduleRevealCompletion, state]);

  const advanceReveal = useCallback(() => {
    if (!reading || activeReveal === null || !state.matches("revealingCards")) return;
    const nextIndex = reading.cards.findIndex(
      (_, index) => index > activeReveal && !revealedRef.current.has(index),
    );
    if (nextIndex >= 0) {
      revealCard(nextIndex);
      return;
    }
    setActiveReveal(null);
  }, [activeReveal, reading, revealCard, state]);

  // Interpretation generation now happens through a durable job (see
  // docs/KNOWN-GAPS.md): the reading fetched on mount may still say
  // "pending" here even after the ritual's own animation delays. Poll until
  // it settles instead of assuming the one-time fetch above is still
  // current — recovering from a Netlify-scheduled backstop run, not just a
  // synchronous response, is the whole point of the job queue.
  useEffect(() => {
    if (!state.matches("generatingSynthesis") || !reading) return;
    if (reading.generationStatus === "ready") {
      send({ type: "GENERATION_READY" });
      return;
    }
    if (reading.generationStatus === "failed") {
      send({ type: "GENERATION_FAILED" });
      return;
    }
    let cancelled = false;
    let attempts = 0;
    const POLL_INTERVAL_MS = 2_000;
    // ~80s: past AI_PROVIDER_TIMEOUT_MS (20s) plus one exponential-backoff
    // retry. Timing out here doesn't mean the job failed — it may still
    // complete via the scheduled backstop; a fresh page load will show it.
    const MAX_ATTEMPTS = 40;
    const poll = async () => {
      attempts += 1;
      try {
        const response = await fetch(`/api/readings/${readingId}`, { cache: "no-store" });
        if (response.ok) {
          const payload = (await response.json()) as { reading: ReadingPayload };
          if (cancelled) return;
          if (payload.reading.generationStatus !== "pending") {
            setReading(payload.reading);
            return;
          }
        }
      } catch {
        // Transient — retry on the next tick.
      }
      if (cancelled) return;
      if (attempts >= MAX_ATTEMPTS) {
        setReading({ ...reading, generationStatus: "failed" });
        return;
      }
      timer = window.setTimeout(poll, POLL_INTERVAL_MS);
    };
    let timer = window.setTimeout(poll, POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [reading, readingId, send, state]);

  useEffect(() => {
    if (!state.matches("revealingResult")) return;
    const timer = window.setTimeout(() => send({ type: "RESULT_REVEALED" }), motionOff ? 0 : 420);
    return () => window.clearTimeout(timer);
  }, [motionOff, send, state]);

  const handleStreamState = useCallback(
    (streamState: "idle" | "streaming" | "complete" | "failed") => {
      if (streamState === "streaming") setJourneyComplete(false);
      if (streamTarget !== "primary") return;
      if (streamState === "complete" && reading?.followUps.at(-1))
        setStreamTarget(reading.followUps.at(-1)!.id);
    },
    [reading, streamTarget],
  );

  const submitFollowUp = async () => {
    if (!reading || !followUp.trim()) return;
    setFollowUpLoading(true);
    setError(undefined);
    setSafetyInterrupt(undefined);
    try {
      const response = await fetch(`/api/readings/${readingId}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "followUp", question: followUp }),
      });
      const payload = (await response.json()) as {
        followUp?: { id: string; result: FollowUpResult };
        error?: string;
        safety?: { category: SafetyCategory; interrupt: boolean; guidance: string };
      };
      if (payload.safety?.interrupt) {
        setSafetyInterrupt({
          category: payload.safety.category,
          guidance: payload.safety.guidance,
        });
        return;
      }
      if (!response.ok || !payload.followUp)
        throw new Error(payload.safety?.guidance ?? payload.error ?? "Unable to answer follow-up.");
      setReading({
        ...reading,
        followUps: [...reading.followUps, payload.followUp],
        followUpsRemaining: Math.max(0, reading.followUpsRemaining - 1),
      });
      setFollowUp("");
      setJourneyComplete(false);
      setStreamTarget(payload.followUp.id);
      setStreamRetryToken(0);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to answer follow-up.");
    } finally {
      setFollowUpLoading(false);
    }
  };

  if (error && !reading) {
    return (
      <MysticSanctuaryScene reducedMotion={true} testId="mystic-sanctuary-scene">
        <div className="sanctuary-loading" role="alert">
          <span aria-hidden="true">✦</span>
          {error}
          <Link href="/history">Return to reading history</Link>
        </div>
      </MysticSanctuaryScene>
    );
  }

  if (!reading || state.matches("idle") || state.matches("preparingDeck")) {
    return (
      <MysticSanctuaryScene reducedMotion={true} testId="mystic-sanctuary-scene">
        <div className="sanctuary-loading" role="status">
          <span aria-hidden="true">✦</span>
          Recovering your locked draw…
        </div>
      </MysticSanctuaryScene>
    );
  }

  const cardsVisible =
    state.matches("awaitingReveal") ||
    state.matches("revealingCards") ||
    state.matches("generatingSynthesis") ||
    state.matches("generationFailed") ||
    state.matches("revealingResult") ||
    state.matches("complete");
  const focusedCardIndex = activeReveal ?? activeReadingCard;
  const focusMode =
    activeReveal !== null ? "reveal" : activeReadingCard !== null ? "reading" : null;
  const activeRevealCard = activeReveal === null ? undefined : reading.cards[activeReveal];

  return (
    <MysticSanctuaryScene reducedMotion={motionOff} testId="mystic-sanctuary-scene">
      <span
        aria-hidden="true"
        className={`cinematic-card-scrim ${activeReveal === null ? "" : "is-visible"}`}
      />
      {activeRevealCard && (
        <div
          aria-hidden="true"
          className="cinematic-reveal-title"
          data-testid="cinematic-reveal-title"
          key={`${activeRevealCard.positionId}-${activeRevealCard.cardId}`}
        >
          <span>{activeRevealCard.positionName}</span>
          <strong>
            {activeRevealCard.name}
            {activeRevealCard.orientation === "reversed" ? " (R)" : ""}
          </strong>
        </div>
      )}
      <header className="sanctuary-controls" aria-label="Reading controls">
        <Link className="sanctuary-exit" href="/readings">
          ← Exit
        </Link>
        <span className="text-sm text-[#c9bfd4]">For {displayName}</span>
        <div className="sanctuary-control-group">
          <button aria-pressed={motionOff} onClick={toggleReducedMotion} type="button">
            Reduced motion <span>{motionOff ? "on" : "off"}</span>
          </button>
          <button aria-pressed={sound} onClick={toggleSound} type="button">
            Sound <span>{sound ? "on" : "off"}</span>
          </button>
        </div>
      </header>

      <section
        className={`sanctuary-stage ${state.matches("shuffling") ? "is-shuffling" : ""} ${
          state.matches("cuttingDeck") ? "is-gathering" : ""
        } ${state.matches("dealing") ? "is-dealing" : ""} ${
          state.matches("awaitingReveal") ? "is-reflecting" : ""
        } ${state.matches("revealingCards") ? "is-guided-reveal" : ""} ${
          activeReveal === null ? "" : "has-cinematic-review"
        } ${state.matches("complete") ? "has-reading-journey" : ""}`}
        aria-live="polite"
      >
        {state.matches("sessionExpired") && (
          <div className="ritual-moment">
            <p className="ritual-status" role="alert">
              This ritual session has expired. Its locked cards and completed interpretation remain
              unchanged in your private history.
            </p>
            <div className="ritual-action-group">
              {reading?.result && (
                <Link className="ritual-action" href={`/reading/${readingId}`}>
                  Open the preserved reading
                </Link>
              )}
              <Link className="ritual-action" href="/readings">
                Start a new reading
              </Link>
            </div>
          </div>
        )}

        {state.matches("shuffling") && (
          <div className="ritual-moment sanctuary-shuffle-ritual">
            <ShuffleShells phase="mixing" />
            <div className="sanctuary-shuffle-copy">
              <p className="ritual-status" role="status">
                Shuffling your cards
              </p>
              <span>The cards move freely before returning to one center.</span>
            </div>
            <button className="shuffle-skip-action" onClick={completeShuffle} type="button">
              Gather now
            </button>
          </div>
        )}

        {state.matches("cuttingDeck") && (
          <div className="ritual-moment sanctuary-shuffle-ritual sanctuary-gather-ritual">
            <ShuffleShells phase="gathering" />
            <div className="sanctuary-shuffle-copy">
              <p className="ritual-status" role="status">
                Gathering the deck
              </p>
              <span>Every card returns to the center, held in its locked order.</span>
            </div>
          </div>
        )}

        {state.matches("dealing") && (
          <div className="sanctuary-deal-ritual" data-testid="guided-deal">
            <div aria-hidden="true" className="sanctuary-centered-deck">
              <span />
              <span />
              <span />
            </div>
            <TarotSpreadStage
              activeIndex={null}
              cards={reading.cards}
              dealing
              focusMode={null}
              reducedMotion={motionOff}
              revealed={revealed}
              visibleCount={dealtCount}
            />
            <p className="ritual-deal-status" role="status">
              {dealtCount === 0
                ? "The deck is centered."
                : `Dealing card ${dealtCount} of ${reading.cards.length}…`}
            </p>
          </div>
        )}

        {cardsVisible && (
          <div className="ritual-card-layout">
            <TarotSpreadStage
              activeIndex={focusedCardIndex}
              cards={reading.cards}
              focusMode={focusMode}
              reducedMotion={motionOff}
              revealed={revealed}
            />
            {state.matches("awaitingReveal") && (
              <div className="ritual-question-reflection" data-testid="question-reflection">
                <span>Hold your question at the center</span>
                <blockquote>{reading.question}</blockquote>
                <p>Notice what rises before any card is turned.</p>
                {readyPromptVisible && (
                  <button
                    className="ritual-action ritual-ready-action"
                    onClick={() => send({ type: "REVEAL" })}
                    type="button"
                  >
                    {revealed.size > 0 ? "Continue revealing" : "I’m ready"}
                  </button>
                )}
              </div>
            )}
          </div>
        )}

        {state.matches("revealingCards") && activeRevealCard && activeReveal !== null && (
          <div
            className="guided-reveal-panel"
            data-testid="guided-reveal-panel"
            key={`guided-${activeRevealCard.positionId}-${activeReveal}`}
          >
            <p className="guided-reveal-description">{activeRevealCard.positionDescription}</p>
            <p className="guided-reveal-themes">
              {activeRevealCard.orientation === "reversed" ? "Reversed themes" : "Themes"}:{" "}
              {activeRevealCard.themes.slice(0, 3).join(" · ")}
            </p>
            <button
              className="ritual-action guided-next-action"
              onClick={advanceReveal}
              type="button"
            >
              {activeReveal + 1 < reading.cards.length ? "Next card" : "Continue to your reading"}
              <span>
                {activeReveal + 1} of {reading.cards.length}
              </span>
            </button>
          </div>
        )}

        {state.matches("generatingSynthesis") && (
          <p className="stage-whisper" role="status">
            The cards are gathering into a reflection…
          </p>
        )}

        {state.matches("generationFailed") && (
          <div className="generation-recovery" role="alert">
            <p>The cards are safe. Interpretation generation paused.</p>
            <button
              onClick={async () => {
                const response = await fetch(`/api/readings/${readingId}`, {
                  method: "POST",
                  headers: { "content-type": "application/json" },
                  body: JSON.stringify({ action: "retry" }),
                });
                if (!response.ok) return setError("Unable to retry the interpretation.");
                const payload = (await response.json()) as {
                  generationStatus: ReadingPayload["generationStatus"];
                  result?: ReadingResult;
                };
                // A retry now re-enqueues a durable job rather than always
                // generating synchronously (docs/KNOWN-GAPS.md), so this may
                // report "pending" — the generatingSynthesis effect's poll
                // loop picks it up from there, same as initial generation.
                setReading({
                  ...reading,
                  ...(payload.result ? { result: payload.result } : {}),
                  generationStatus: payload.generationStatus,
                });
                send({ type: "RETRY_GENERATION" });
              }}
              type="button"
            >
              Retry the same draw
            </button>
          </div>
        )}
      </section>

      <div className={`oracle-console-stack ${state.matches("complete") ? "" : "is-inactive"}`}>
        {state.matches("complete") && reading.result && (
          <OracleTranscript
            active
            cards={reading.cards}
            onActiveCardChange={setActiveReadingCard}
            onJourneyCompleteChange={setJourneyComplete}
            onRetry={() => setStreamRetryToken((token) => token + 1)}
            onStateChange={handleStreamState}
            readingId={readingId}
            reducedMotion={motionOff}
            result={reading.result}
            retryToken={streamRetryToken}
            soundEnabled={sound}
            target={streamTarget}
          />
        )}
        {state.matches("complete") && safetyInterrupt && (
          <SafetyInterruptContent
            category={safetyInterrupt.category}
            guidance={safetyInterrupt.guidance}
          />
        )}
        {state.matches("complete") && journeyComplete && !safetyInterrupt && (
          <QuestionComposer
            disabled={reading.followUpsRemaining <= 0}
            hint={
              reading.followUpsRemaining <= 0
                ? `This reading’s ${reading.followUpLimit} follow-up${reading.followUpLimit === 1 ? " is" : "s are"} preserved with the same locked cards.`
                : `${reading.followUpsRemaining} follow-up${reading.followUpsRemaining === 1 ? "" : "s"} remaining. Shift+Enter adds a line.`
            }
            label="Keep the same cards and ask what they add"
            loading={followUpLoading}
            onChange={setFollowUp}
            onSubmit={submitFollowUp}
            placeholder={
              reading.followUpsRemaining <= 0
                ? "Follow-up complete"
                : "Ask a follow-up about the same cards…"
            }
            submitLabel="Reflect on the same cards"
            testId="follow-up-composer"
            value={followUp}
          />
        )}
        {state.matches("complete") &&
          reading.safetyClassification &&
          GUARDED_CATEGORIES.has(reading.safetyClassification) && (
            <p className="safety-flags-banner" role="note">
              This reading offers reflection rather than a factual answer, given the kind of
              question it was.
            </p>
          )}
        {error && (
          <p className="sanctuary-error" role="alert">
            {error}
          </p>
        )}
      </div>
    </MysticSanctuaryScene>
  );
}

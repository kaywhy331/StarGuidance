"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useMachine } from "@xstate/react";
import { GUARDED_CATEGORIES, type SafetyCategory } from "@starguidance/ai";
import type { FollowUpResult, ReadingResult } from "@starguidance/contracts";
import { readingMachine } from "@starguidance/reading-machine";

import { useReadingPreferences, type ReadingPreferenceSeed } from "@/lib/reading-preferences";
import { emitBrowserProductEvent } from "@/lib/product-telemetry-client";
import {
  readRitualProgress,
  writeRitualProgress,
  type RitualProgress,
} from "@/lib/ritual-progress";

import { MysticSanctuaryScene } from "./mystic-sanctuary-scene";
import { OracleTranscript } from "./oracle-transcript";
import { QuestionComposer } from "./question-composer";
import { ReadingClosure, ReadingSealed, type ReadingContinuationMode } from "./reading-closure";
import type { ReadingPayload } from "./reading-types";
import { playRitualSound, useRitualAmbience } from "./ritual-audio";
import { RitualControls } from "./ritual-controls";
import { SafetyInterruptContent } from "./safety-interrupt-panel";
import { TarotSpreadStage } from "./tarot-spread-stage";

export function ReadingScene({
  audioAvailable = false,
  animationVariant = "immersive-v1",
  initialPreferences,
  readingId,
}: {
  audioAvailable?: boolean;
  animationVariant?: "immersive-v1" | "quiet-v1" | "disabled";
  initialPreferences?: ReadingPreferenceSeed;
  readingId: string;
}) {
  const [state, send] = useMachine(readingMachine);
  const [reading, setReading] = useState<ReadingPayload>();
  const [revealed, setRevealed] = useState<Set<number>>(new Set());
  const revealedRef = useRef<ReadonlySet<number>>(revealed);
  const [dealtCount, setDealtCount] = useState(0);
  const [readyPromptVisible, setReadyPromptVisible] = useState(false);
  const [activeReveal, setActiveReveal] = useState<number | null>(null);
  const [narratingCardIndexes, setNarratingCardIndexes] = useState<readonly number[]>([]);
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
  const [continuationMode, setContinuationMode] = useState<ReadingContinuationMode>("choice");
  const bootstrapped = useRef(false);
  const recoveredRitual = useRef(false);
  const completionStarted = useRef(false);
  const {
    ambience,
    displayName,
    narration,
    reducedMotion: preferenceMotionOff,
    sound,
    toggleAmbience,
    toggleNarration,
    toggleReducedMotion,
    toggleSound,
  } = useReadingPreferences(initialPreferences);
  const animationManaged = animationVariant !== "immersive-v1";
  const motionOff = preferenceMotionOff || animationManaged;
  const soundEnabled = useRef(sound);
  useRitualAmbience(ambience, String(state.value));

  useEffect(() => {
    soundEnabled.current = sound;
  }, [sound]);

  const cutIndex = reading?.draw.proof?.cutIndex ?? reading?.ritualProgress?.cutIndex ?? 0;

  const persistRitualProgress = useCallback(
    async (
      progress: RitualProgress,
      phase:
        | "drawLocked"
        | "dealing"
        | "awaitingReveal"
        | "revealing"
        | "fullSpreadReady"
        | "interpretationStreaming"
        | "followUpAvailable"
        | "complete",
    ) => {
      writeRitualProgress(window.sessionStorage, readingId, progress);
      try {
        await fetch(`/api/readings/${readingId}`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ action: "progress", phase, ...progress }),
        });
      } catch {
        // The locked draw is already durable; local recovery remains available.
      }
    },
    [readingId],
  );

  useEffect(() => {
    void fetch(`/api/readings/${readingId}`, { cache: "no-store" })
      .then(async (response) => {
        if (!response.ok) throw new Error("Unable to recover this reading.");
        const payload = (await response.json()) as { reading: ReadingPayload };
        const progress =
          payload.reading.ritualProgress ??
          readRitualProgress(window.sessionStorage, readingId, payload.reading.cards.length);
        if (progress) {
          recoveredRitual.current = progress.revealedIndexes.length > 0;
          const restored = new Set(progress.revealedIndexes);
          revealedRef.current = restored;
          setRevealed(restored);
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
    if (reading.sessionExpired) {
      send({ type: "EXPIRE" });
      return;
    }
    send({ type: "RESTORE_LOCKED" });
    if (recoveredRitual.current)
      emitBrowserProductEvent("reading_reopened", {
        routeClass: "ritual",
        cardCount: reading.cards.length,
        statusClass: "started",
      });
  }, [reading, send]);

  useEffect(() => {
    if (!state.matches("drawLocked") || !reading) return;
    void persistRitualProgress(
      { cutIndex, revealedIndexes: [...revealedRef.current] },
      "drawLocked",
    );
    const timer = window.setTimeout(() => send({ type: "BEGIN_DEAL" }), motionOff ? 0 : 180);
    return () => window.clearTimeout(timer);
  }, [cutIndex, motionOff, persistRitualProgress, reading, send, state]);

  useEffect(() => {
    if (!state.matches("dealing") || !reading) return;
    void persistRitualProgress({ cutIndex, revealedIndexes: [...revealedRef.current] }, "dealing");
    const timers: number[] = [];
    if (recoveredRitual.current || motionOff) {
      setDealtCount(reading.cards.length);
      timers.push(window.setTimeout(() => send({ type: "DEALT" }), motionOff ? 40 : 0));
      return () => timers.forEach((timer) => window.clearTimeout(timer));
    }
    const dealNext = (index: number) => {
      setDealtCount(index + 1);
      if (soundEnabled.current) playRitualSound("deal", index);
      if (index + 1 < reading.cards.length)
        timers.push(window.setTimeout(() => dealNext(index + 1), 850));
      else timers.push(window.setTimeout(() => send({ type: "DEALT" }), 650));
    };
    timers.push(window.setTimeout(() => dealNext(0), 0));
    return () => timers.forEach((timer) => window.clearTimeout(timer));
  }, [cutIndex, motionOff, persistRitualProgress, reading, send, state]);

  useEffect(() => {
    if (!state.matches("awaitingReveal") || !reading) return;
    void persistRitualProgress(
      { cutIndex, revealedIndexes: [...revealedRef.current] },
      "awaitingReveal",
    );
    if (revealedRef.current.size > 0) {
      setReadyPromptVisible(true);
      send({ type: "REVEAL" });
      return;
    }
    if (motionOff) {
      const timer = window.setTimeout(() => setReadyPromptVisible(true), 0);
      return () => window.clearTimeout(timer);
    }
    const timer = window.setTimeout(() => setReadyPromptVisible(true), 2_500);
    return () => window.clearTimeout(timer);
  }, [cutIndex, motionOff, persistRitualProgress, reading, send, state]);

  const revealCard = useCallback(
    (index: number) => {
      if (!reading || !state.matches("revealing") || revealedRef.current.has(index)) return;
      setError(undefined);
      const next = new Set(revealedRef.current).add(index);
      revealedRef.current = next;
      setRevealed(next);
      setActiveReveal(index);
      void persistRitualProgress({ cutIndex, revealedIndexes: [...next] }, "revealing");
      if (soundEnabled.current) playRitualSound("reveal", index);
      emitBrowserProductEvent("card_revealed", {
        routeClass: "ritual",
        cardCount: reading.cards.length,
        statusClass: "completed",
      });
    },
    [cutIndex, persistRitualProgress, reading, state],
  );

  const revealAll = useCallback(() => {
    if (!reading || !state.matches("revealing")) return;
    const all = new Set(reading.cards.map((_, index) => index));
    revealedRef.current = all;
    setRevealed(all);
    setActiveReveal(null);
    void persistRitualProgress({ cutIndex, revealedIndexes: [...all] }, "revealing");
    if (soundEnabled.current) playRitualSound("reveal", reading.cards.length - 1);
  }, [cutIndex, persistRitualProgress, reading, state]);

  const enterFullSpread = useCallback(() => {
    if (!reading || completionStarted.current) return;
    completionStarted.current = true;
    void persistRitualProgress(
      { cutIndex, revealedIndexes: [...revealedRef.current] },
      "fullSpreadReady",
    ).finally(() => send({ type: "ALL_REVEALED" }));
  }, [cutIndex, persistRitualProgress, reading, send]);

  useEffect(() => {
    if (
      reading &&
      state.matches("revealing") &&
      activeReveal === null &&
      revealed.size === reading.cards.length
    )
      enterFullSpread();
  }, [activeReveal, enterFullSpread, reading, revealed, state]);

  useEffect(() => {
    if (!state.matches("fullSpreadReady") || !reading) return;
    const timer = window.setTimeout(
      () => send({ type: "BEGIN_INTERPRETATION" }),
      motionOff ? 0 : 350,
    );
    return () => window.clearTimeout(timer);
  }, [motionOff, reading, send, state]);

  useEffect(() => {
    if (!state.matches("interpretationStreaming") || !reading) return;
    void persistRitualProgress(
      { cutIndex, revealedIndexes: [...revealedRef.current] },
      "interpretationStreaming",
    );
    if (reading.generationStatus === "ready" && reading.result) return;
    if (reading.generationStatus === "failed") {
      send({ type: "GENERATION_FAILED" });
      return;
    }
    let cancelled = false;
    let attempts = 0;
    let timer = 0;
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
        // Retry the durable generation status.
      }
      if (!cancelled && attempts < 40) timer = window.setTimeout(poll, 2_000);
      else if (!cancelled) setReading({ ...reading, generationStatus: "failed" });
    };
    timer = window.setTimeout(poll, 250);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [cutIndex, persistRitualProgress, reading, readingId, send, state]);

  const handleStreamState = useCallback(
    (streamState: "idle" | "streaming" | "complete" | "failed") => {
      if (streamState === "streaming") setJourneyComplete(false);
      if (streamTarget !== "primary") return;
      if (streamState === "complete" && state.matches("interpretationStreaming")) {
        void persistRitualProgress(
          { cutIndex, revealedIndexes: [...revealedRef.current] },
          "followUpAvailable",
        );
        send({ type: "INTERPRETATION_COMPLETE" });
      }
    },
    [cutIndex, persistRitualProgress, send, state, streamTarget],
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
        newReadingRequired?: boolean;
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
        throw new Error(
          payload.newReadingRequired
            ? (payload.error ?? "That question needs a new reading and a new spread.")
            : (payload.safety?.guidance ?? payload.error ?? "Unable to answer follow-up."),
        );
      setReading({
        ...reading,
        followUps: [...reading.followUps, payload.followUp],
        followUpsRemaining: Math.max(0, reading.followUpsRemaining - 1),
      });
      setFollowUp("");
      setJourneyComplete(false);
      setContinuationMode("choice");
      setStreamTarget(payload.followUp.id);
      setStreamRetryToken(0);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to answer follow-up.");
    } finally {
      setFollowUpLoading(false);
    }
  };

  if (error && !reading)
    return (
      <MysticSanctuaryScene
        animationVariant={animationVariant}
        backdrop="starry-reading"
        focusStage="ambient"
        phase="generationFailed"
        reducedMotion
        testId="mystic-sanctuary-scene"
      >
        <div className="sanctuary-loading" role="alert">
          <span aria-hidden="true">✦</span>
          {error}
          <Link href="/history">Return to reading history</Link>
        </div>
      </MysticSanctuaryScene>
    );

  if (!reading || state.matches("idle") || state.matches("readingCreated"))
    return (
      <MysticSanctuaryScene
        animationVariant={animationVariant}
        backdrop="starry-reading"
        focusStage="cards"
        phase="drawLocked"
        reducedMotion
        testId="mystic-sanctuary-scene"
      >
        <div className="sanctuary-loading" role="status">
          <span aria-hidden="true">✦</span>Recovering your locked draw…
        </div>
      </MysticSanctuaryScene>
    );

  const activeRevealCard = activeReveal === null ? undefined : reading.cards[activeReveal];
  const transcriptVisible =
    (state.matches("interpretationStreaming") ||
      state.matches("followUpAvailable") ||
      state.matches("complete")) &&
    Boolean(reading.result);
  const cardsVisible =
    !journeyComplete &&
    (state.matches("dealing") ||
      state.matches("awaitingReveal") ||
      state.matches("revealing") ||
      state.matches("fullSpreadReady") ||
      state.matches("interpretationStreaming") ||
      state.matches("followUpAvailable") ||
      state.matches("complete") ||
      state.matches("generationFailed"));
  const readingFocusStage = transcriptVisible
    ? journeyComplete
      ? "actions"
      : "reading"
    : cardsVisible
      ? "cards"
      : "ambient";

  return (
    <MysticSanctuaryScene
      animationVariant={animationVariant}
      backdrop="starry-reading"
      focusStage={readingFocusStage}
      phase={String(state.value)}
      reducedMotion={motionOff}
      testId="mystic-sanctuary-scene"
    >
      <span
        aria-hidden="true"
        className={`cinematic-card-scrim ${activeReveal === null ? "" : "is-visible"}`}
      />
      {activeRevealCard && (
        <div
          aria-hidden="true"
          className="cinematic-reveal-title"
          data-testid="cinematic-reveal-title"
        >
          <span>{activeRevealCard.positionName}</span>
          <strong>
            {activeRevealCard.name}
            {activeRevealCard.orientation === "reversed" ? " (R)" : ""}
          </strong>
        </div>
      )}
      <RitualControls
        ambience={ambience}
        animationManaged={animationManaged}
        displayName={displayName}
        exitHref="/readings"
        narration={audioAvailable && narration}
        reducedMotion={motionOff}
        sigilSeed={reading.profileSnapshotId}
        sound={sound}
        toggleAmbience={toggleAmbience}
        {...(audioAvailable ? { toggleNarration } : {})}
        toggleReducedMotion={toggleReducedMotion}
        toggleSound={toggleSound}
        {...(state.matches("dealing") && !motionOff ? { onSkip: toggleReducedMotion } : {})}
      />

      <section
        aria-live="polite"
        className={`sanctuary-stage ${state.matches("dealing") ? "is-dealing" : ""} ${state.matches("awaitingReveal") ? "is-reflecting" : ""} ${state.matches("revealing") ? "is-guided-reveal" : ""} ${activeReveal === null ? "" : "has-cinematic-review"} ${transcriptVisible && !journeyComplete ? "has-reading-journey" : ""}`}
      >
        {state.matches("sessionExpired") && (
          <div className="ritual-moment">
            <p className="ritual-status" role="alert">
              This ritual session expired. Its locked cards and any completed interpretation remain
              unchanged in your private history.
            </p>
            <div className="ritual-action-group">
              <Link className="ritual-action" href="/history">
                Return to history
              </Link>
              <Link className="ritual-action" href="/readings">
                Start a new reading
              </Link>
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
                ? "The locked deck is centered."
                : `Dealing card ${dealtCount} of ${reading.cards.length} into its fixed position…`}
            </p>
          </div>
        )}

        {cardsVisible && !state.matches("dealing") && (
          <div className="ritual-card-layout">
            <TarotSpreadStage
              activeIndex={activeReveal}
              cards={reading.cards}
              focusMode={activeReveal === null ? null : "reveal"}
              narratingIndexes={narratingCardIndexes}
              reducedMotion={motionOff}
              revealed={revealed}
              onReveal={
                state.matches("revealing") && activeReveal === null ? revealCard : undefined
              }
            />
            {state.matches("awaitingReveal") && (
              <div className="ritual-question-reflection" data-testid="question-reflection">
                <span>Hold your question at the center</span>
                <blockquote>{reading.question}</blockquote>
                <p>
                  Every card is face down in its locked position. Nothing from the whole reading is
                  shown yet.
                </p>
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
            {state.matches("revealing") &&
              activeReveal === null &&
              revealed.size < reading.cards.length && (
                <div className="reveal-choice-prompt" role="status">
                  <span aria-hidden="true">✦</span>
                  <p>
                    <strong>Choose any face-down position</strong>
                    <small>
                      Its assignment is already locked. Tap it, use Tab with Enter or Space, or
                      reveal all.
                    </small>
                  </p>
                  <span>
                    {revealed.size} of {reading.cards.length}
                  </span>
                  <button className="ritual-action" onClick={revealAll} type="button">
                    Reveal All
                  </button>
                </div>
              )}
          </div>
        )}

        {state.matches("revealing") && activeRevealCard && activeReveal !== null && (
          <div className="guided-reveal-panel" data-testid="guided-reveal-panel">
            <p className="guided-reveal-description">{activeRevealCard.positionName}</p>
            <p className="guided-reveal-themes">{activeRevealCard.baselineMeaning}</p>
            <button
              className="ritual-action guided-next-action"
              onClick={() => setActiveReveal(null)}
              type="button"
            >
              {revealed.size < reading.cards.length
                ? "Return to the spread"
                : "Open the complete reading"}
              <span>
                {revealed.size} of {reading.cards.length}
              </span>
            </button>
          </div>
        )}

        {state.matches("fullSpreadReady") && (
          <p className="stage-whisper" role="status">
            The full spread is ready. Now the cards can be read together…
          </p>
        )}
        {state.matches("interpretationStreaming") && !reading.result && (
          <p className="stage-whisper" role="status">
            The complete spread is gathering into one coherent interpretation…
          </p>
        )}

        {state.matches("generationFailed") && (
          <div className="generation-recovery" role="alert">
            <p>The locked cards are safe. Interpretation generation paused.</p>
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

      <div
        className={`oracle-console-stack ${transcriptVisible ? "" : "is-inactive"} ${journeyComplete ? "is-actions" : "is-reading"}`}
        data-focus-stage={readingFocusStage}
      >
        {transcriptVisible && !journeyComplete && reading.result && (
          <OracleTranscript
            active
            cards={reading.cards}
            onJourneyCompleteChange={setJourneyComplete}
            onNarratedCardIndexesChange={(indexes) =>
              setNarratingCardIndexes((current) =>
                current.length === indexes.length &&
                current.every((value, index) => value === indexes[index])
                  ? current
                  : [...indexes],
              )
            }
            onRetry={() => setStreamRetryToken((token) => token + 1)}
            onStateChange={handleStreamState}
            {...(reading.personalization ? { personalization: reading.personalization } : {})}
            readingId={readingId}
            reducedMotion={motionOff}
            result={reading.result}
            retryToken={streamRetryToken}
            sigilSeed={reading.profileSnapshotId}
            audioEnabled={audioAvailable && narration}
            target={streamTarget}
          />
        )}
        {(state.matches("followUpAvailable") || state.matches("complete")) && safetyInterrupt && (
          <SafetyInterruptContent
            category={safetyInterrupt.category}
            guidance={safetyInterrupt.guidance}
          />
        )}
        {state.matches("followUpAvailable") &&
          journeyComplete &&
          !safetyInterrupt &&
          continuationMode === "choice" && (
            <ReadingClosure
              followUpsRemaining={reading.followUpsRemaining}
              onAskFollowUp={() => setContinuationMode("follow-up")}
              onClose={() => {
                setContinuationMode("closed");
                void persistRitualProgress(
                  { cutIndex, revealedIndexes: [...revealedRef.current] },
                  "complete",
                );
                send({ type: "COMPLETE" });
              }}
              reflectionQuestion={
                reading.result?.reflectionPrompt ?? "What will you choose to carry forward?"
              }
            />
          )}
        {state.matches("followUpAvailable") &&
          journeyComplete &&
          !safetyInterrupt &&
          continuationMode === "follow-up" && (
            <div className="reading-follow-up-threshold">
              <button onClick={() => setContinuationMode("choice")} type="button">
                ← Return to closing reflection
              </button>
              <QuestionComposer
                disabled={reading.followUpsRemaining <= 0}
                hint={
                  reading.followUpsRemaining <= 0
                    ? "The included same-draw follow-up is complete."
                    : `${reading.followUpsRemaining} clarification${reading.followUpsRemaining === 1 ? "" : "s"} remaining. A new subject starts a new reading.`
                }
                label="Clarify the original question with these same cards"
                loading={followUpLoading}
                onChange={setFollowUp}
                onSubmit={submitFollowUp}
                placeholder={
                  reading.followUpsRemaining <= 0
                    ? "Follow-up complete"
                    : "Ask about the same subject and horizon…"
                }
                submitLabel="Ask these same cards"
                testId="follow-up-composer"
                value={followUp}
              />
            </div>
          )}
        {state.matches("complete") && <ReadingSealed readingId={readingId} />}
        {(state.matches("followUpAvailable") || state.matches("complete")) &&
          journeyComplete &&
          reading.safetyClassification &&
          GUARDED_CATEGORIES.has(reading.safetyClassification) && (
            <p className="safety-flags-banner" role="note">
              This reading offers user-centered reflection rather than a factual claim.
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

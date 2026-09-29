"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useMachine } from "@xstate/react";
import { GUARDED_CATEGORIES, type SafetyCategory } from "@starguidance/ai";
import type { FollowUpResult, ReadingResult } from "@starguidance/contracts";
import { readingMachine } from "@starguidance/reading-machine";

import { requestJson, sendJson } from "@/lib/client-request";
import { motionTiming } from "@/lib/motion";
import { useReadingPreferences, type ReadingPreferenceSeed } from "@/lib/reading-preferences";
import { emitBrowserProductEvent } from "@/lib/product-telemetry-client";

import { hardNavigate } from "./hard-navigate";
import {
  readRitualProgress,
  ritualPhaseRank,
  writeRitualProgress,
  type RitualPhase,
  type RitualProgress,
} from "@/lib/ritual-progress";

import { SanctuaryFrame, type AnimationVariant } from "./mystic-sanctuary-scene";
import { OracleTranscript } from "./oracle-transcript";
import { QuestionComposer } from "./question-composer";
import { ReadingClosure, ReadingSealed, type ReadingContinuationMode } from "./reading-closure";
import { keepsakeCardsFrom, keepsakeSectionsFrom, ReadingKeepsake } from "./reading-keepsake";
import type { ReadingPayload } from "./reading-types";
import { playRitualSound, useRitualAmbience } from "./ritual-audio";
import { RitualControls } from "./ritual-controls";
import { SafetyInterruptContent } from "./safety-interrupt-panel";
import type { CardHandoffOrigin } from "./stage-flip";
import { TarotSpreadStage } from "./tarot-spread-stage";

/** sessionStorage key a "Start a new reading with this question" action uses
 * to hand the question to /readings without putting it in a URL. */
export const PREFILL_QUESTION_KEY = "starguidance:prefill-question";

/** Interpretation waits longer than this show a gentle "taking longer" note. */
const SLOW_INTERPRETATION_MS = 15_000;
/** After this, the reader is offered a retry while polling continues. */
const STALLED_INTERPRETATION_MS = 80_000;
/** Polling gives up (and shows the recovery panel) only after this long. */
const ABANDON_INTERPRETATION_MS = 5 * 60_000;

function wait(ms: number) {
  return new Promise<void>((resolve) => window.setTimeout(resolve, ms));
}

export function ReadingScene({
  audioAvailable = false,
  animationVariant = "immersive-v1",
  handoff,
  initialPreferences,
  initialReading,
  readingId,
}: {
  audioAvailable?: boolean;
  animationVariant?: AnimationVariant;
  /** Where the reader's picked cards sit on screen when the scene takes over
   * from selection. The dealt cards begin exactly there. */
  handoff?: readonly CardHandoffOrigin[] | undefined;
  initialPreferences?: ReadingPreferenceSeed;
  /** The locked reading when the scene continues a selection in place, so the
   * spread is on screen from the first frame instead of after a fetch. */
  initialReading?: ReadingPayload | undefined;
  readingId: string;
}) {
  const [state, send] = useMachine(readingMachine);
  const [reading, setReading] = useState<ReadingPayload | undefined>(initialReading);
  const [revealed, setRevealed] = useState<Set<number>>(new Set());
  const revealedRef = useRef<ReadonlySet<number>>(revealed);
  const [dealtCount, setDealtCount] = useState(0);
  const [readyPromptVisible, setReadyPromptVisible] = useState(false);
  const [activeReveal, setActiveReveal] = useState<number | null>(null);
  const [narratingCardIndexes, setNarratingCardIndexes] = useState<readonly number[]>([]);
  const [error, setError] = useState<string>();
  const [newReadingQuestion, setNewReadingQuestion] = useState<string>();
  const [safetyInterrupt, setSafetyInterrupt] = useState<{
    category: SafetyCategory;
    userMessage?: string;
  }>();
  const [followUp, setFollowUp] = useState("");
  const [followUpLoading, setFollowUpLoading] = useState(false);
  const [streamTarget, setStreamTarget] = useState("primary");
  const [streamRetryToken, setStreamRetryToken] = useState(0);
  const [journeyComplete, setJourneyComplete] = useState(false);
  const [continuationMode, setContinuationMode] = useState<ReadingContinuationMode>("choice");
  /** Session-only fast-forward from the HUD's skip; never saved as a preference. */
  const [fastForward, setFastForward] = useState(false);
  const [waitingSince, setWaitingSince] = useState<number>();
  const [now, setNow] = useState(() => Date.now());
  const [retrying, setRetrying] = useState(false);
  const [progressBlocked, setProgressBlocked] = useState(false);
  const bootstrapped = useRef(false);
  const recoveredRitual = useRef(false);
  const restoredFinished = useRef<"followUpAvailable" | "complete" | undefined>(undefined);
  const completionStarted = useRef(false);
  /** Highest phase the server has confirmed, so reloads never post backward. */
  const serverPhaseRank = useRef(-1);
  const guidedActionRef = useRef<HTMLButtonElement>(null);
  const revealPromptHeadingRef = useRef<HTMLHeadingElement>(null);
  const closureHeadingRef = useRef<HTMLHeadingElement>(null);
  const keepsakeHeadingRef = useRef<HTMLHeadingElement>(null);
  const pendingFocus = useRef<"closure" | "keepsake" | "reveal-prompt" | "guided" | undefined>(
    undefined,
  );
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
  const preferenceOrManagedMotionOff = preferenceMotionOff || animationManaged;
  const motionOff = preferenceOrManagedMotionOff || fastForward;
  const soundEnabled = useRef(sound);
  useRitualAmbience(ambience, String(state.value));

  useEffect(() => {
    soundEnabled.current = sound;
  }, [sound]);

  const cutIndex = reading?.draw.proof?.cutIndex ?? reading?.ritualProgress?.cutIndex ?? 0;

  /** Saves progress locally and on the server. Resolves true once the server
   * holds at least this phase. Phase-gating writes retry through brief rate
   * limits; an expired session ends the ritual view. */
  const persistRitualProgress = useCallback(
    async (progress: RitualProgress, phase: RitualPhase, attempts = 1): Promise<boolean> => {
      writeRitualProgress(window.sessionStorage, readingId, progress);
      const rank = ritualPhaseRank(phase);
      if (rank < serverPhaseRank.current) return true;
      for (let attempt = 0; attempt < attempts; attempt += 1) {
        const result = await sendJson(`/api/readings/${readingId}`, "POST", {
          action: "progress",
          phase,
          ...progress,
          revealedIndexes: [...progress.revealedIndexes],
        });
        if (result.ok) {
          serverPhaseRank.current = Math.max(serverPhaseRank.current, rank);
          return true;
        }
        if (result.status === 410) {
          send({ type: "EXPIRE" });
          return false;
        }
        // Already further along on the server (another tab, or a reload).
        if (result.status === 409) return true;
        if (attempt < attempts - 1)
          await wait(result.status === 429 ? 2_000 * (attempt + 1) : 800 * (attempt + 1));
      }
      return false;
    },
    [readingId, send],
  );

  useEffect(() => {
    if (initialReading) {
      serverPhaseRank.current = initialReading.ritualProgress
        ? ritualPhaseRank(initialReading.ritualProgress.phase)
        : -1;
      return;
    }
    let active = true;
    void requestJson<{ reading: ReadingPayload }>(`/api/readings/${readingId}`, {
      cache: "no-store",
    }).then((response) => {
      if (!active) return;
      if (!response.ok) {
        if (response.status === 401) {
          hardNavigate("/sign-in");
          return;
        }
        setError(
          response.status === 404
            ? "This reading could not be found. It may have been deleted."
            : response.error,
        );
        return;
      }
      const payload = response.data;
      const progress =
        payload.reading.ritualProgress ??
        readRitualProgress(window.sessionStorage, readingId, payload.reading.cards.length);
      serverPhaseRank.current = payload.reading.ritualProgress
        ? ritualPhaseRank(payload.reading.ritualProgress.phase)
        : -1;
      const phase = payload.reading.ritualProgress?.phase;
      // A reading that already reached its interpretation reopens there: no
      // replayed ceremony, and no progress writes that would move backward.
      if (
        phase !== undefined &&
        ritualPhaseRank(phase) >= ritualPhaseRank("followUpAvailable") &&
        payload.reading.result
      ) {
        const all = new Set(payload.reading.cards.map((_, index) => index));
        restoredFinished.current = phase === "complete" ? "complete" : "followUpAvailable";
        revealedRef.current = all;
        setRevealed(all);
        setDealtCount(payload.reading.cards.length);
        setJourneyComplete(true);
        if (phase === "complete") setContinuationMode("closed");
      } else if (progress) {
        recoveredRitual.current = progress.revealedIndexes.length > 0;
        const restored = new Set(progress.revealedIndexes);
        revealedRef.current = restored;
        setRevealed(restored);
      }
      setReading(payload.reading);
    });
    return () => {
      active = false;
    };
  }, [initialReading, readingId]);

  useEffect(() => {
    if (!reading || bootstrapped.current) return;
    bootstrapped.current = true;
    send({ type: "START" });
    if (restoredFinished.current) {
      send({
        type: restoredFinished.current === "complete" ? "RESTORE_COMPLETE" : "RESTORE_FOLLOW_UP",
      });
      return;
    }
    // Every reading here already has its cards locked, so an unfinished one
    // past its window can still be revealed; nothing about the draw changes.
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
        timers.push(window.setTimeout(() => dealNext(index + 1), motionTiming.dealInterval));
      else timers.push(window.setTimeout(() => send({ type: "DEALT" }), motionTiming.dealSettle));
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
    const timer = window.setTimeout(() => setReadyPromptVisible(true), motionTiming.readyPause);
    return () => window.clearTimeout(timer);
  }, [cutIndex, motionOff, persistRitualProgress, reading, send, state]);

  // A skip fast-forwards only the deal; the reveal keeps the reader's motion.
  useEffect(() => {
    if (!fastForward || state.matches("dealing") || state.matches("drawLocked")) return;
    const timer = window.setTimeout(() => setFastForward(false), 0);
    return () => window.clearTimeout(timer);
  }, [fastForward, state]);

  const revealCard = useCallback(
    (index: number) => {
      if (!reading || !state.matches("revealing") || revealedRef.current.has(index)) return;
      setError(undefined);
      const next = new Set(revealedRef.current).add(index);
      revealedRef.current = next;
      setRevealed(next);
      setActiveReveal(index);
      pendingFocus.current = "guided";
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
    setProgressBlocked(false);
    void persistRitualProgress(
      { cutIndex, revealedIndexes: [...revealedRef.current] },
      "fullSpreadReady",
      4,
    ).then((saved) => {
      if (saved) {
        send({ type: "ALL_REVEALED" });
        return;
      }
      // The whole reading only opens once the server knows every card is
      // turned; keep a way forward instead of streaming into a refusal.
      completionStarted.current = false;
      setProgressBlocked(true);
    });
  }, [cutIndex, persistRitualProgress, reading, send]);

  useEffect(() => {
    if (
      reading &&
      state.matches("revealing") &&
      activeReveal === null &&
      revealed.size === reading.cards.length &&
      !progressBlocked
    )
      enterFullSpread();
  }, [activeReveal, enterFullSpread, progressBlocked, reading, revealed, state]);

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
    let timer = 0;
    const startedAt = Date.now();
    const startTimer = window.setTimeout(() => setWaitingSince(startedAt), 0);
    const poll = async (attempt: number) => {
      const response = await requestJson<{ reading: ReadingPayload }>(
        `/api/readings/${readingId}`,
        { cache: "no-store" },
      );
      if (cancelled) return;
      if (response.ok && response.data.reading.generationStatus !== "pending") {
        setWaitingSince(undefined);
        setReading(response.data.reading);
        return;
      }
      // Only declare failure after the server itself says so, or after a
      // long stretch of checking with no answer.
      if (Date.now() - startedAt >= ABANDON_INTERPRETATION_MS) {
        setWaitingSince(undefined);
        setReading({ ...reading, generationStatus: "failed" });
        return;
      }
      timer = window.setTimeout(
        () => void poll(attempt + 1),
        Math.min(10_000, 2_000 + attempt * 500),
      );
    };
    timer = window.setTimeout(() => void poll(0), 250);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
      window.clearTimeout(startTimer);
    };
  }, [cutIndex, persistRitualProgress, reading, readingId, send, state]);

  // A slow clock for the waiting copy only.
  useEffect(() => {
    if (waitingSince === undefined) return;
    const interval = window.setInterval(() => setNow(Date.now()), 5_000);
    return () => window.clearInterval(interval);
  }, [waitingSince]);

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

  // Before retrying a refused stream, make sure the server knows every card
  // is turned (the stream opens only after fullSpreadReady is saved).
  const retryStream = useCallback(async () => {
    if (reading && revealedRef.current.size === reading.cards.length) {
      serverPhaseRank.current = Math.min(
        serverPhaseRank.current,
        ritualPhaseRank("fullSpreadReady") - 1,
      );
      await persistRitualProgress(
        { cutIndex, revealedIndexes: [...revealedRef.current] },
        "fullSpreadReady",
        3,
      );
    }
    setStreamRetryToken((token) => token + 1);
  }, [cutIndex, persistRitualProgress, reading]);

  const retryGeneration = async () => {
    if (!reading || retrying) return;
    setRetrying(true);
    setError(undefined);
    const response = await sendJson<{
      generationStatus: ReadingPayload["generationStatus"];
      result?: ReadingResult;
    }>(`/api/readings/${readingId}`, "POST", { action: "retry" });
    setRetrying(false);
    if (!response.ok) {
      setError(response.error);
      return;
    }
    setReading({
      ...reading,
      ...(response.data.result ? { result: response.data.result } : {}),
      generationStatus: response.data.generationStatus,
    });
    if (state.matches("generationFailed")) send({ type: "RETRY_GENERATION" });
  };

  const submitFollowUp = async () => {
    const asked = followUp.trim();
    if (!reading || !asked) return;
    setFollowUpLoading(true);
    setError(undefined);
    setNewReadingQuestion(undefined);
    setSafetyInterrupt(undefined);
    const response = await sendJson<{
      followUp?: { id: string; result: FollowUpResult };
    }>(`/api/readings/${readingId}`, "POST", { action: "followUp", question: asked });
    setFollowUpLoading(false);
    const safety = response.ok
      ? undefined
      : (response.data["safety"] as
          { category: SafetyCategory; interrupt: boolean; userMessage?: string } | undefined);
    if (safety?.interrupt) {
      setSafetyInterrupt({
        category: safety.category,
        ...(safety.userMessage ? { userMessage: safety.userMessage } : {}),
      });
      return;
    }
    if (!response.ok || !response.data.followUp) {
      if (response.status === 428) {
        hardNavigate("/consent");
        return;
      }
      if (!response.ok && response.data["newReadingRequired"] === true)
        setNewReadingQuestion(asked);
      setError(
        response.ok ? "That follow-up could not be answered. Please try again." : response.error,
      );
      return;
    }
    const created = { ...response.data.followUp, question: asked };
    setReading({
      ...reading,
      followUps: [...reading.followUps, created],
      followUpsRemaining: Math.max(0, reading.followUpsRemaining - 1),
    });
    setFollowUp("");
    setJourneyComplete(false);
    setContinuationMode("choice");
    setStreamTarget(created.id);
    setStreamRetryToken(0);
  };

  const startNewReadingWith = (question: string) => {
    try {
      window.sessionStorage.setItem(PREFILL_QUESTION_KEY, question);
    } catch {
      // Without storage the new reading simply starts empty.
    }
    hardNavigate("/readings");
  };

  const handleJourneyComplete = useCallback((complete: boolean) => {
    if (complete) pendingFocus.current = "closure";
    setJourneyComplete(complete);
  }, []);

  // Move focus to whatever the last action opened, once it is on screen.
  useEffect(() => {
    const target = pendingFocus.current;
    if (!target) return;
    const element =
      target === "closure"
        ? (closureHeadingRef.current ?? keepsakeHeadingRef.current)
        : target === "keepsake"
          ? keepsakeHeadingRef.current
          : target === "guided"
            ? guidedActionRef.current
            : revealPromptHeadingRef.current;
    if (!element) return;
    pendingFocus.current = undefined;
    element.focus({ preventScroll: target === "guided" });
  });

  if (error && !reading)
    return (
      <SanctuaryFrame
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
          <a href="/history">See all your readings</a>
        </div>
      </SanctuaryFrame>
    );

  if (!reading)
    return (
      <SanctuaryFrame
        animationVariant={animationVariant}
        backdrop="starry-reading"
        focusStage="cards"
        phase="drawLocked"
        reducedMotion
        testId="mystic-sanctuary-scene"
      >
        <div className="sanctuary-loading" role="status">
          <span aria-hidden="true">✦</span>Gathering your cards…
        </div>
      </SanctuaryFrame>
    );

  const activeRevealCard = activeReveal === null ? undefined : reading.cards[activeReveal];
  const finished = state.matches("followUpAvailable") || state.matches("complete");
  const transcriptVisible =
    (state.matches("interpretationStreaming") || finished) && Boolean(reading.result);
  // The locked cards are on stage from the first frame: they hold where the
  // reader placed them until the deal carries each into its slot.
  const dealing =
    state.matches("idle") ||
    state.matches("readingCreated") ||
    state.matches("drawLocked") ||
    state.matches("dealing");
  const cardsVisible =
    !journeyComplete &&
    (dealing ||
      state.matches("awaitingReveal") ||
      state.matches("revealing") ||
      state.matches("fullSpreadReady") ||
      state.matches("interpretationStreaming") ||
      finished ||
      state.matches("generationFailed"));
  const readingFocusStage = transcriptVisible
    ? journeyComplete
      ? "actions"
      : "reading"
    : cardsVisible
      ? "cards"
      : "ambient";
  const stageLayoutKey = [
    dealing ? "dealing" : "",
    state.matches("awaitingReveal") ? "reflecting" : "",
    state.matches("revealing") ? "revealing" : "",
    transcriptVisible && !journeyComplete ? "journey" : "",
    readingFocusStage,
  ].join("|");
  const waitingMs = waitingSince === undefined ? 0 : now - waitingSince;
  const currentFollowUp =
    streamTarget === "primary"
      ? undefined
      : reading.followUps.find(({ id }) => id === streamTarget);
  const keepsake = reading.result ? (
    <ReadingKeepsake
      cards={keepsakeCardsFrom(reading.cards, reading.result)}
      createdAt={reading.createdAt}
      followUps={reading.followUps.map((entry) => ({
        id: entry.id,
        answer: entry.result.response,
        ...(entry.question ? { question: entry.question } : {}),
      }))}
      onReplay={() => {
        setStreamTarget("primary");
        setJourneyComplete(false);
      }}
      question={reading.question}
      ref={keepsakeHeadingRef}
      replayLabel="Revisit the reading"
      sections={keepsakeSectionsFrom(reading.result)}
      {...(reading.spreadName ? { spreadName: reading.spreadName } : {})}
    />
  ) : null;

  return (
    <SanctuaryFrame
      animationVariant={animationVariant}
      backdrop="starry-reading"
      focusStage={readingFocusStage}
      phase={String(state.value)}
      reducedMotion={motionOff}
      testId="mystic-sanctuary-scene"
    >
      <h1 className="sr-only">Your tarot reading</h1>
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
            {activeRevealCard.orientation === "reversed" && (
              <em className="cinematic-reveal-orientation">Reversed</em>
            )}
          </strong>
        </div>
      )}
      <RitualControls
        ambience={ambience}
        animationManaged={animationManaged}
        displayName={displayName}
        exitHard
        exitHref="/readings"
        menu
        narration={audioAvailable && narration}
        reducedMotion={preferenceOrManagedMotionOff}
        sigilSeed={reading.profileSnapshotId}
        sound={sound}
        toggleAmbience={toggleAmbience}
        {...(audioAvailable ? { toggleNarration } : {})}
        toggleReducedMotion={toggleReducedMotion}
        toggleSound={toggleSound}
        {...(state.matches("dealing") && !motionOff
          ? { onSkip: () => setFastForward(true), skipLabel: "Skip the deal" }
          : {})}
      />

      <section
        className={`sanctuary-stage ${dealing ? "is-dealing" : ""} ${state.matches("awaitingReveal") ? "is-reflecting" : ""} ${state.matches("revealing") ? "is-guided-reveal" : ""} ${activeReveal === null ? "" : "has-cinematic-review"} ${transcriptVisible && !journeyComplete ? "has-reading-journey" : ""}`}
      >
        {state.matches("sessionExpired") && (
          <div className="ritual-moment">
            <p className="ritual-status" role="alert">
              This reading sat unfinished for a while, so its session closed. Your cards are kept
              exactly as they were drawn.
            </p>
            <div className="ritual-action-group">
              <a className="ritual-action" href={`/reading/${readingId}`}>
                Open this reading
              </a>
              <a className="ritual-action" href="/history">
                See all your readings
              </a>
              <a className="ritual-action is-quiet" href="/readings">
                Start a new reading
              </a>
            </div>
          </div>
        )}

        {cardsVisible && (
          <div className="ritual-card-layout" data-testid={dealing ? "guided-deal" : undefined}>
            <TarotSpreadStage
              activeIndex={activeReveal}
              cards={reading.cards}
              dealing={dealing}
              focusMode={activeReveal === null ? null : "reveal"}
              handoff={motionOff ? undefined : handoff}
              layoutKey={stageLayoutKey}
              narratingIndexes={narratingCardIndexes}
              reducedMotion={motionOff}
              revealDescribedBy="reveal-instructions"
              revealed={revealed}
              settledCount={dealtCount}
              onReveal={
                state.matches("revealing") && activeReveal === null ? revealCard : undefined
              }
            />
            {dealing && (
              <p className="ritual-deal-status" role="status">
                {dealtCount === 0
                  ? "Your cards are on their way to the table."
                  : "Laying out your cards…"}
              </p>
            )}
            {state.matches("awaitingReveal") && (
              <div className="ritual-question-reflection" data-testid="question-reflection">
                <span>Hold your question in mind</span>
                <blockquote>{reading.question}</blockquote>
                <p>Every card is face down in its place. Turn them over when you’re ready.</p>
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
                <div className="reveal-choice-prompt">
                  <span aria-hidden="true">✦</span>
                  <div className="reveal-choice-copy">
                    <h2 ref={revealPromptHeadingRef} tabIndex={-1}>
                      Choose a card to turn over
                    </h2>
                    <small>Any order you like — or turn them all at once.</small>
                    <span className="sr-only" id="reveal-instructions">
                      Press Enter or Space to turn this card over. Tab moves between cards.
                    </span>
                  </div>
                  <span>
                    {revealed.size} of {reading.cards.length}
                  </span>
                  <button className="ritual-action" onClick={revealAll} type="button">
                    Reveal all
                  </button>
                </div>
              )}
            {progressBlocked && (
              <div className="generation-recovery" role="alert">
                <p>
                  Your cards are kept exactly as drawn, but we couldn’t save that they’re all
                  turned.
                </p>
                <button className="ritual-action" onClick={enterFullSpread} type="button">
                  Try again
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
              onClick={() => {
                pendingFocus.current =
                  revealed.size < reading.cards.length ? "reveal-prompt" : undefined;
                setActiveReveal(null);
              }}
              ref={guidedActionRef}
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
            All your cards are turned. Now they can be read together…
          </p>
        )}
        {state.matches("interpretationStreaming") && !reading.result && (
          <div className="stage-whisper interpretation-waiting" role="status">
            <p>
              {waitingMs < SLOW_INTERPRETATION_MS
                ? "Your cards are being read together…"
                : "This is taking longer than usual. Your cards are kept exactly as drawn. The reading is still being written…"}
            </p>
            {waitingMs >= STALLED_INTERPRETATION_MS && (
              <button
                className="ritual-action"
                disabled={retrying}
                onClick={() => void retryGeneration()}
                type="button"
              >
                {retrying ? "Asking again…" : "Try writing it again"}
              </button>
            )}
          </div>
        )}

        {state.matches("generationFailed") && (
          <div className="generation-recovery" role="alert">
            <p>
              Your cards are kept exactly as drawn. The reading paused while it was being written.
            </p>
            <button
              aria-busy={retrying}
              className="ritual-action"
              disabled={retrying}
              onClick={() => void retryGeneration()}
              type="button"
            >
              {retrying ? "Writing your reading…" : "Try writing it again"}
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
            displayName={displayName}
            onJourneyCompleteChange={handleJourneyComplete}
            onNarratedCardIndexesChange={(indexes) =>
              setNarratingCardIndexes((current) =>
                current.length === indexes.length &&
                current.every((value, index) => value === indexes[index])
                  ? current
                  : [...indexes],
              )
            }
            onRetry={() => void retryStream()}
            onStateChange={handleStreamState}
            {...(reading.personalization ? { personalization: reading.personalization } : {})}
            {...(currentFollowUp?.question ? { question: currentFollowUp.question } : {})}
            readingId={readingId}
            reducedMotion={motionOff}
            result={reading.result}
            retryToken={streamRetryToken}
            sigilSeed={reading.profileSnapshotId}
            audioEnabled={audioAvailable && narration}
            target={streamTarget}
          />
        )}
        {finished && safetyInterrupt && (
          <SafetyInterruptContent
            category={safetyInterrupt.category}
            dismissLabel="Return to my reading"
            exitHref="/history"
            exitLabel="See all your readings"
            onDismiss={() => {
              setSafetyInterrupt(undefined);
              setContinuationMode("choice");
            }}
            {...(safetyInterrupt.userMessage ? { userMessage: safetyInterrupt.userMessage } : {})}
          />
        )}
        {state.matches("followUpAvailable") &&
          journeyComplete &&
          !safetyInterrupt &&
          continuationMode === "choice" && (
            <ReadingClosure
              feedbackSubmitted={reading.feedbackSubmitted}
              followUpsRemaining={reading.followUpsRemaining}
              onAskFollowUp={() => setContinuationMode("follow-up")}
              onClose={() => {
                setContinuationMode("closed");
                pendingFocus.current = "keepsake";
                void persistRitualProgress(
                  { cutIndex, revealedIndexes: [...revealedRef.current] },
                  "complete",
                );
                send({ type: "COMPLETE" });
              }}
              readingId={readingId}
              ref={closureHeadingRef}
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
                <span aria-hidden="true">←</span> Back to the closing reflection
              </button>
              <QuestionComposer
                disabled={reading.followUpsRemaining <= 0}
                disabledReason="You’ve used the follow-ups included with this reading."
                hint={`${reading.followUpsRemaining === 1 ? "1 follow-up" : `${reading.followUpsRemaining} follow-ups`} left with these cards. A different subject deserves a new reading.`}
                label="Ask these same cards about your question"
                loading={followUpLoading}
                onChange={setFollowUp}
                onSubmit={submitFollowUp}
                placeholder={
                  reading.followUpsRemaining <= 0
                    ? "No follow-ups left"
                    : "Ask more about the same question…"
                }
                submitLabel="Ask these same cards"
                testId="follow-up-composer"
                value={followUp}
              />
            </div>
          )}
        {state.matches("complete") && journeyComplete && <ReadingSealed readingId={readingId} />}
        {finished && journeyComplete && keepsake}
        {finished &&
          journeyComplete &&
          reading.safetyClassification &&
          GUARDED_CATEGORIES.has(reading.safetyClassification) && (
            <p className="safety-flags-banner" role="note">
              This reading is a reflection to think with, not a statement of fact.
            </p>
          )}
        {error && (
          <div className="sanctuary-error" role="alert">
            <p>{error}</p>
            {newReadingQuestion && (
              <button
                className="ritual-action"
                onClick={() => startNewReadingWith(newReadingQuestion)}
                type="button"
              >
                Start a new reading with this question
              </button>
            )}
          </div>
        )}
      </div>
    </SanctuaryFrame>
  );
}

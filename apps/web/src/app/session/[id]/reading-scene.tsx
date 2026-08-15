"use client";

import { useCallback, useEffect, useRef, useState } from "react";
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
  const [primaryJourneyReady, setPrimaryJourneyReady] = useState(false);
  const bootstrapped = useRef(false);
  const revealRun = useRef(0);
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

  useEffect(() => {
    void fetch(`/api/readings/${readingId}`, { cache: "no-store" })
      .then(async (response) => {
        if (!response.ok) throw new Error("Unable to recover this reading.");
        const payload = (await response.json()) as { reading: ReadingPayload };
        const progress =
          payload.reading.ritualProgress ??
          readRitualProgress(window.sessionStorage, readingId, payload.reading.cards.length);
        if (progress) {
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
      () => send({ type: "SHUFFLE_COMPLETE" }),
      cutTaken !== undefined ? 0 : motionOff ? 120 : 1_900,
    );
    return () => window.clearTimeout(timer);
  }, [cutTaken, motionOff, send, state]);

  useEffect(() => {
    if (!state.matches("cuttingDeck") || cutTaken === undefined) return;
    send({ type: cutTaken ? "CUT" : "SKIP_CUT" });
  }, [cutTaken, send, state]);

  useEffect(() => {
    if (!state.matches("dealing")) return;
    const timer = window.setTimeout(() => send({ type: "DEALT" }), motionOff ? 0 : 850);
    return () => window.clearTimeout(timer);
  }, [motionOff, send, state]);

  useEffect(() => {
    if (!state.matches("awaitingReveal")) return;
    const timer = window.setTimeout(() => send({ type: "REVEAL" }), motionOff ? 0 : 280);
    return () => window.clearTimeout(timer);
  }, [motionOff, send, state]);

  // PRD UX-006: cards are revealed by intentional click/tap/keyboard, not a
  // timer. Every write updates `revealedRef` and React state together so the
  // async callbacks below always guard against the latest set, not a stale
  // closure. A passive mirroring effect is deliberately avoided: under a
  // throttled render it could commit an older set after a reveal callback had
  // already reserved another card.

  const focusDuration = motionOff ? 90 : 2_200;
  const settleDuration = motionOff ? 40 : 650;

  const scheduleRevealCompletion = useCallback(
    (delay = focusDuration + settleDuration) => {
      if (revealCompletionTimer.current !== undefined) return;
      revealCompletionTimer.current = window.setTimeout(() => {
        revealCompletionTimer.current = undefined;
        send({ type: "ALL_REVEALED" });
      }, delay);
    },
    [focusDuration, send, settleDuration],
  );

  useEffect(
    () => () => {
      if (revealCompletionTimer.current !== undefined)
        window.clearTimeout(revealCompletionTimer.current);
    },
    [],
  );

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

  const revealCard = useCallback(
    (index: number) => {
      if (!reading || !state.matches("revealingCards") || revealedRef.current.has(index)) return;
      const run = ++revealRun.current;
      setActiveReveal(index);
      const next = new Set(revealedRef.current).add(index);
      // Reserve the card synchronously as well as updating React state. A
      // Rapid multi-card interactions can land before React commits the first
      // update (notably in throttled WebKit contexts). If every callback sees
      // the same stale ref, later cards are dropped and the ritual can never
      // advance past revealingCards.
      revealedRef.current = next;
      setRevealed(next);
      const complete = next.size === reading.draw.assignments.length;
      if (cutTaken !== undefined)
        persistRitualProgress(
          { cutTaken, revealedIndexes: [...next] },
          complete ? "complete" : "revealingCards",
        );
      // Schedule the state-machine transition from the same callback that
      // reserves the final card. A passive effect alone can have its cleanup
      // race a throttled WebKit render and cancel the only completion timer.
      if (complete) scheduleRevealCompletion();
      if (soundEnabled.current) playRevealTone();
      window.setTimeout(() => {
        if (revealRun.current !== run) return;
        setActiveReveal(null);
      }, focusDuration);
    },
    [cutTaken, focusDuration, persistRitualProgress, reading, scheduleRevealCompletion, state],
  );

  const revealAll = useCallback(() => {
    if (!reading || !state.matches("revealingCards")) return;
    const allIndexes = reading.draw.assignments.map((_, index) => index);
    const next = new Set(allIndexes);
    if (next.size === revealedRef.current.size) {
      scheduleRevealCompletion(motionOff ? 0 : settleDuration);
      return;
    }

    // "Reveal all" is an explicit shortcut, so reserve and persist the full
    // set in one callback instead of chaining one wall-clock timer per card.
    // The collective flip still gets a brief visual settle, while throttled
    // browsers cannot strand the ritual between scheduled card callbacks.
    ++revealRun.current;
    revealedRef.current = next;
    setRevealed(next);
    setActiveReveal(null);
    if (cutTaken !== undefined)
      persistRitualProgress({ cutTaken, revealedIndexes: allIndexes }, "complete");
    if (soundEnabled.current) playRevealTone();
    scheduleRevealCompletion(motionOff ? 0 : settleDuration);
  }, [
    cutTaken,
    motionOff,
    persistRitualProgress,
    reading,
    scheduleRevealCompletion,
    settleDuration,
    state,
  ]);

  // Recovery may hydrate a session whose final card was already persisted,
  // so retain an idempotent effect as a backstop. It does not own cleanup;
  // incidental rerenders must not cancel an already scheduled transition.
  useEffect(() => {
    if (!reading || !state.matches("revealingCards")) return;
    if (revealed.size < reading.draw.assignments.length) return;
    scheduleRevealCompletion();
  }, [reading, revealed, scheduleRevealCompletion, state]);

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
      if (streamTarget !== "primary") return;
      setPrimaryJourneyReady(streamState === "complete");
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
        className={`sanctuary-stage ${activeReveal === null ? "" : "has-cinematic-review"} ${
          state.matches("complete") ? "has-reading-journey" : ""
        }`}
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
          <div className="ritual-moment">
            <div aria-hidden="true" className="sanctuary-shuffle-shells">
              {Array.from({ length: 9 }, (_, index) => (
                <span key={index} style={{ "--shell-index": index } as React.CSSProperties} />
              ))}
            </div>
            <p className="ritual-status" role="status">
              Shuffling your cards…
            </p>
            <button
              className="ritual-action"
              onClick={() => send({ type: "SHUFFLE_COMPLETE" })}
              type="button"
            >
              Finish shuffling
            </button>
          </div>
        )}

        {state.matches("cuttingDeck") && (
          <div className="ritual-moment">
            <p className="ritual-status" role="status">
              Cut the deck, or continue.
            </p>
            <div className="ritual-action-group">
              <button
                className="ritual-action"
                onClick={() => {
                  setCutTaken(true);
                  persistRitualProgress(
                    { cutTaken: true, revealedIndexes: [...revealed] },
                    "cuttingDeck",
                  );
                }}
                type="button"
              >
                Cut
              </button>
              <button
                className="ritual-action"
                onClick={() => {
                  setCutTaken(false);
                  persistRitualProgress(
                    { cutTaken: false, revealedIndexes: [...revealed] },
                    "cuttingDeck",
                  );
                }}
                type="button"
              >
                Skip cut
              </button>
            </div>
          </div>
        )}

        {state.matches("dealing") && (
          <div className="ritual-moment">
            <div aria-hidden="true" className="sanctuary-deal-shells">
              {reading.cards.map((card, index) => (
                <span
                  key={card.positionId}
                  style={{ "--deal-index": index } as React.CSSProperties}
                />
              ))}
            </div>
            <p>Dealing your locked cards…</p>
          </div>
        )}

        {cardsVisible && (
          <TarotSpreadStage
            activeIndex={focusedCardIndex}
            cards={reading.cards}
            focusMode={focusMode}
            onReveal={state.matches("revealingCards") ? revealCard : undefined}
            reducedMotion={motionOff}
            revealed={revealed}
          />
        )}

        {state.matches("revealingCards") && revealed.size < reading.cards.length && (
          <button className="ritual-action reveal-all-action" onClick={revealAll} type="button">
            Reveal all
          </button>
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
            onRetry={() => setStreamRetryToken((token) => token + 1)}
            onStateChange={handleStreamState}
            readingId={readingId}
            reducedMotion={motionOff}
            result={reading.result}
            retryToken={streamRetryToken}
            target={streamTarget}
          />
        )}
        {state.matches("complete") && safetyInterrupt && (
          <SafetyInterruptContent
            category={safetyInterrupt.category}
            guidance={safetyInterrupt.guidance}
          />
        )}
        {state.matches("complete") && !safetyInterrupt && (
          <QuestionComposer
            disabled={reading.followUpsRemaining <= 0 || !primaryJourneyReady}
            hint={
              reading.followUpsRemaining <= 0
                ? `This reading’s ${reading.followUpLimit} follow-up${reading.followUpLimit === 1 ? " is" : "s are"} preserved with the same locked cards.`
                : !primaryJourneyReady
                  ? "Let the complete reading arrive before continuing the same thread."
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

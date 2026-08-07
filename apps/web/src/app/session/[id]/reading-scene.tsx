"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useMachine } from "@xstate/react";
import type { FollowUpResult, ReadingResult } from "@starguidance/contracts";
import { readingMachine } from "@starguidance/reading-machine";

import { MysticSanctuaryScene } from "./mystic-sanctuary-scene";
import { OracleTranscript } from "./oracle-transcript";
import { QuestionComposer } from "./question-composer";
import type { ReadingPayload } from "./reading-types";
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

export function ReadingScene({ readingId }: { readingId: string }) {
  const [state, send] = useMachine(readingMachine);
  const [reading, setReading] = useState<ReadingPayload>();
  const [revealed, setRevealed] = useState<Set<number>>(new Set());
  const [reducedMotion, setReducedMotion] = useState(
    () =>
      typeof window !== "undefined" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches,
  );
  const [sound, setSound] = useState(false);
  // Distinct from the OS-detected `reducedMotion` above: this is the explicit,
  // in-app "Reduced motion" control (PRD UX-009 / KNOWN-GAPS "skip-animation
  // mode"). It drives the exact same `motionOff` flag as the OS preference, so
  // it shortens/removes decorative transitions without changing whether the
  // user still intentionally reveals each card (UX-006 is unconditional).
  const [manualReducedMotion, setManualReducedMotion] = useState(false);
  const [activeReveal, setActiveReveal] = useState<number | null>(null);
  const [activeReadingCard, setActiveReadingCard] = useState<number | null>(null);
  const [error, setError] = useState<string>();
  const [followUp, setFollowUp] = useState("");
  const [followUpLoading, setFollowUpLoading] = useState(false);
  const [streamTarget, setStreamTarget] = useState("primary");
  const [streamRetryToken, setStreamRetryToken] = useState(0);
  const [primaryJourneyReady, setPrimaryJourneyReady] = useState(false);
  const bootstrapped = useRef(false);
  const revealRun = useRef(0);
  const soundEnabled = useRef(sound);
  const motionOff = reducedMotion || manualReducedMotion;

  useEffect(() => {
    soundEnabled.current = sound;
  }, [sound]);

  useEffect(() => {
    const query = window.matchMedia("(prefers-reduced-motion: reduce)");
    const handleChange = (event: MediaQueryListEvent) => setReducedMotion(event.matches);
    query.addEventListener("change", handleChange);
    return () => query.removeEventListener("change", handleChange);
  }, []);

  useEffect(() => {
    void fetch(`/api/readings/${readingId}`, { cache: "no-store" })
      .then(async (response) => {
        if (!response.ok) throw new Error("Unable to recover this reading.");
        const payload = (await response.json()) as { reading: ReadingPayload };
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
    send({ type: "QUESTION_ACCEPTED" });
    send({ type: "DECK_READY" });
  }, [reading, send]);

  useEffect(() => {
    if (!state.matches("shuffling")) return;
    const timer = window.setTimeout(
      () => send({ type: "SHUFFLE_COMPLETE" }),
      motionOff ? 120 : 1_900,
    );
    return () => window.clearTimeout(timer);
  }, [motionOff, send, state]);

  // Cutting the deck is a deliberate PRD UX-004 choice (Cut vs Skip cut), not
  // a timed transition — both buttons are rendered directly from `cuttingDeck`
  // state below and send their event on click; there is no auto-advance here.

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
  // timer. `revealedRef` mirrors `revealed` synchronously so the async
  // callbacks below always guard against the latest set, not a stale closure
  // — matters because "Reveal all" schedules several reveals ahead of time,
  // and the user can still click an individual not-yet-revealed card while
  // that schedule is in flight.
  const revealedRef = useRef<ReadonlySet<number>>(revealed);
  useEffect(() => {
    revealedRef.current = revealed;
  }, [revealed]);

  const focusDuration = motionOff ? 90 : 1_250;
  const settleDuration = motionOff ? 40 : 400;

  const revealCard = useCallback(
    (index: number) => {
      if (!reading || !state.matches("revealingCards") || revealedRef.current.has(index)) return;
      const run = ++revealRun.current;
      setActiveReveal(index);
      setRevealed((current) => new Set(current).add(index));
      if (soundEnabled.current) playRevealTone();
      window.setTimeout(() => {
        if (revealRun.current !== run) return;
        setActiveReveal(null);
      }, focusDuration);
    },
    [focusDuration, reading, state],
  );

  const revealAll = useCallback(() => {
    if (!reading) return;
    const remaining = reading.draw.assignments
      .map((_, index) => index)
      .filter((index) => !revealedRef.current.has(index));
    remaining.forEach((index, position) =>
      window.setTimeout(() => revealCard(index), position * (focusDuration + settleDuration)),
    );
  }, [focusDuration, reading, revealCard, settleDuration]);

  // Once every card has been individually revealed — however the user got
  // there, one at a time or via "Reveal all" — advance the ritual onward.
  useEffect(() => {
    if (!reading || !state.matches("revealingCards")) return;
    if (revealed.size < reading.draw.assignments.length) return;
    const timer = window.setTimeout(() => send({ type: "ALL_REVEALED" }), settleDuration);
    return () => window.clearTimeout(timer);
  }, [reading, revealed, send, settleDuration, state]);

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
    try {
      const response = await fetch(`/api/readings/${readingId}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "followUp", question: followUp }),
      });
      const payload = (await response.json()) as {
        followUp?: { id: string; result: FollowUpResult };
        error?: string;
        safety?: { guidance: string };
      };
      if (!response.ok || !payload.followUp)
        throw new Error(payload.safety?.guidance ?? payload.error ?? "Unable to answer follow-up.");
      setReading({ ...reading, followUps: [...reading.followUps, payload.followUp] });
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

  return (
    <MysticSanctuaryScene reducedMotion={motionOff} testId="mystic-sanctuary-scene">
      <span
        aria-hidden="true"
        className={`cinematic-card-scrim ${activeReveal === null ? "" : "is-visible"}`}
      />
      <header className="sanctuary-controls" aria-label="Reading controls">
        <Link className="sanctuary-exit" href="/readings">
          ← Exit
        </Link>
        <div className="sanctuary-control-group">
          {!reducedMotion && (
            <button
              aria-pressed={manualReducedMotion}
              onClick={() => setManualReducedMotion((value) => !value)}
              type="button"
            >
              Reduced motion <span>{manualReducedMotion ? "on" : "off"}</span>
            </button>
          )}
          <button aria-pressed={sound} onClick={() => setSound((value) => !value)} type="button">
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
              <button className="ritual-action" onClick={() => send({ type: "CUT" })} type="button">
                Cut
              </button>
              <button
                className="ritual-action"
                onClick={() => send({ type: "SKIP_CUT" })}
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
        {state.matches("complete") && (
          <QuestionComposer
            disabled={reading.followUps.length >= 1 || !primaryJourneyReady}
            hint={
              reading.followUps.length >= 1
                ? "This reading’s follow-up is preserved with the same locked cards."
                : !primaryJourneyReady
                  ? "Let the complete reading arrive before continuing the same thread."
                  : "Shift+Enter adds a line. Enter sends privately."
            }
            label="Keep the same cards and ask what they add"
            loading={followUpLoading}
            onChange={setFollowUp}
            onSubmit={submitFollowUp}
            placeholder={
              reading.followUps.length >= 1
                ? "Follow-up complete"
                : "Ask one follow-up about the same cards…"
            }
            submitLabel="Reflect on the same cards"
            testId="follow-up-composer"
            value={followUp}
          />
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

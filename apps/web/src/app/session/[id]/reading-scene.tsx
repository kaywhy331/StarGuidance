"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useMachine } from "@xstate/react";
import type { ReadingResult } from "@starguidance/contracts";
import { readingMachine } from "@starguidance/reading-machine";

import { MysticSanctuaryScene } from "./mystic-sanctuary-scene";
import { OracleTranscript } from "./oracle-transcript";
import { QuestionComposer } from "./question-composer";
import { ReadingDetailsDrawer } from "./reading-details-drawer";
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
  const [skipAnimation, setSkipAnimation] = useState(false);
  const [sound, setSound] = useState(false);
  const [error, setError] = useState<string>();
  const [followUp, setFollowUp] = useState("");
  const [followUpLoading, setFollowUpLoading] = useState(false);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [streamTarget, setStreamTarget] = useState("primary");
  const [streamRetryToken, setStreamRetryToken] = useState(0);
  const bootstrapped = useRef(false);
  const motionOff = reducedMotion || skipAnimation;

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
    if (!state.matches("dealing")) return;
    const timer = window.setTimeout(() => send({ type: "DEALT" }), motionOff ? 0 : 850);
    return () => window.clearTimeout(timer);
  }, [motionOff, send, state]);

  useEffect(() => {
    if (!state.matches("generatingSynthesis") || !reading) return;
    if (reading.generationStatus === "ready") send({ type: "GENERATION_READY" });
    if (reading.generationStatus === "failed") send({ type: "GENERATION_FAILED" });
  }, [reading, send, state]);

  useEffect(() => {
    if (!state.matches("revealingResult")) return;
    const timer = window.setTimeout(() => send({ type: "RESULT_REVEALED" }), motionOff ? 0 : 420);
    return () => window.clearTimeout(timer);
  }, [motionOff, send, state]);

  const allRevealed = Boolean(reading && revealed.size === reading.draw.assignments.length);
  const reveal = (index: number) => {
    if (!reading) return;
    if (revealed.has(index)) return;
    if (state.matches("awaitingReveal")) send({ type: "REVEAL" });
    if (!state.matches("awaitingReveal") && !state.matches("revealingCards")) return;
    const next = new Set(revealed).add(index);
    setRevealed(next);
    if (sound) playRevealTone();
    if (next.size === reading.draw.assignments.length)
      window.setTimeout(() => send({ type: "ALL_REVEALED" }), motionOff ? 0 : 420);
  };
  const revealAll = () => {
    if (!reading) return;
    if (state.matches("awaitingReveal")) send({ type: "REVEAL" });
    setRevealed(new Set(reading.draw.assignments.map((_, index) => index)));
    window.setTimeout(() => send({ type: "ALL_REVEALED" }), motionOff ? 0 : 420);
  };

  const handleStreamState = useCallback(
    (streamState: "idle" | "streaming" | "complete" | "failed") => {
      if (streamState === "complete" && streamTarget === "primary" && reading?.followUps.at(-1)) {
        setStreamTarget(reading.followUps.at(-1)!.id);
      }
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
        followUp?: { id: string; result: ReadingResult };
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

  return (
    <MysticSanctuaryScene reducedMotion={motionOff} testId="mystic-sanctuary-scene">
      <header className="sanctuary-controls" aria-label="Reading controls">
        <Link className="sanctuary-exit" href="/readings">
          ← Exit
        </Link>
        <div className="sanctuary-control-group">
          <button aria-pressed={sound} onClick={() => setSound((value) => !value)} type="button">
            Sound <span>{sound ? "on" : "off"}</span>
          </button>
          <button
            aria-pressed={reducedMotion}
            onClick={() => setReducedMotion((value) => !value)}
            type="button"
          >
            Reduced motion
          </button>
          <button
            aria-pressed={skipAnimation}
            onClick={() => setSkipAnimation((value) => !value)}
            type="button"
          >
            Skip animation
          </button>
          <button onClick={() => setDetailsOpen(true)} type="button">
            Reading details
          </button>
        </div>
      </header>

      <p className="locked-reading-note" data-testid="locked-reading-id">
        Locked draw · profile and question never select cards
      </p>

      <section className="sanctuary-stage" aria-live="polite">
        {state.matches("shuffling") && (
          <div className="ritual-moment">
            <div aria-hidden="true" className="sanctuary-shuffle-shells">
              {Array.from({ length: 9 }, (_, index) => (
                <span key={index} style={{ "--shell-index": index } as React.CSSProperties} />
              ))}
            </div>
            <h1>The draw is secured</h1>
            <p>The ritual cannot alter your already locked cards.</p>
            <button onClick={() => send({ type: "SHUFFLE_COMPLETE" })} type="button">
              Finish shuffling
            </button>
          </div>
        )}

        {state.matches("cuttingDeck") && (
          <div className="ritual-moment">
            <div aria-hidden="true" className="sanctuary-cut-deck" />
            <h1>Cut the deck?</h1>
            <p>This physical gesture does not change the locked draw.</p>
            <div className="ritual-actions">
              <button onClick={() => send({ type: "CUT" })} type="button">
                Cut
              </button>
              <button onClick={() => send({ type: "SKIP_CUT" })} type="button">
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
            cards={reading.cards}
            onReveal={reveal}
            reducedMotion={motionOff}
            revealed={revealed}
          />
        )}

        {(state.matches("awaitingReveal") || state.matches("revealingCards")) && !allRevealed && (
          <button className="reveal-all-control" onClick={revealAll} type="button">
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
                const payload = (await response.json()) as { result: ReadingResult };
                setReading({ ...reading, result: payload.result, generationStatus: "ready" });
                send({ type: "RETRY_GENERATION" });
              }}
              type="button"
            >
              Retry the same draw
            </button>
          </div>
        )}
      </section>

      <div className="oracle-console-stack">
        {state.matches("complete") && reading.result ? (
          <OracleTranscript
            active
            onRetry={() => setStreamRetryToken((token) => token + 1)}
            onStateChange={handleStreamState}
            readingId={readingId}
            reducedMotion={motionOff}
            retryToken={streamRetryToken}
            target={streamTarget}
          />
        ) : (
          <p className="oracle-console-placeholder">
            Reveal the locked spread to begin the oracle transcript.
          </p>
        )}
        {state.matches("complete") && (
          <QuestionComposer
            disabled={reading.followUps.length >= 1}
            hint={
              reading.followUps.length >= 1
                ? "This reading’s follow-up is preserved with the same locked cards."
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

      <ReadingDetailsDrawer
        onClose={() => setDetailsOpen(false)}
        open={detailsOpen}
        result={reading.result}
      />
    </MysticSanctuaryScene>
  );
}

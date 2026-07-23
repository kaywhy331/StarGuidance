"use client";

import { useEffect, useRef, useState } from "react";
import { useMachine } from "@xstate/react";
import type { ReadingResult } from "@starguidance/contracts";
import { readingMachine } from "@starguidance/reading-machine";
import type { LockedDraw } from "@starguidance/tarot-domain";
import { Button, LoadingState, Panel } from "@starguidance/design-system";

interface ReadingPayload {
  id: string;
  draw: LockedDraw;
  result?: ReadingResult;
  generationStatus: "pending" | "ready" | "failed";
  followUps: { id: string; result: ReadingResult }[];
}

function playRevealTone() {
  const AudioContextClass = window.AudioContext;
  const context = new AudioContextClass();
  const oscillator = context.createOscillator();
  const gain = context.createGain();
  oscillator.frequency.value = 392;
  gain.gain.setValueAtTime(0.04, context.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.001, context.currentTime + 0.16);
  oscillator.connect(gain).connect(context.destination);
  oscillator.start();
  oscillator.stop(context.currentTime + 0.16);
}

export function ReadingScene({ readingId }: { readingId: string }) {
  const [state, send] = useMachine(readingMachine);
  const [reading, setReading] = useState<ReadingPayload>();
  const [revealed, setRevealed] = useState<Set<number>>(new Set());
  const [skipMotion, setSkipMotion] = useState(
    () =>
      typeof window !== "undefined" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches,
  );
  const [sound, setSound] = useState(false);
  const [error, setError] = useState<string>();
  const [followUp, setFollowUp] = useState("");
  const bootstrapped = useRef(false);

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
    const timer = window.setTimeout(() => send({ type: "DEALT" }), skipMotion ? 0 : 900);
    return () => window.clearTimeout(timer);
  }, [send, skipMotion, state]);

  useEffect(() => {
    if (!state.matches("generatingSynthesis") || !reading) return;
    send({
      type: reading.generationStatus === "ready" ? "GENERATION_READY" : "GENERATION_FAILED",
    });
  }, [reading, send, state]);

  if (error)
    return (
      <main className="mx-auto max-w-3xl px-6 py-20">
        <Panel>
          <h1 className="text-3xl">Reading unavailable</h1>
          <p className="mt-3">{error}</p>
        </Panel>
      </main>
    );
  if (!reading || state.matches("idle") || state.matches("preparingDeck"))
    return (
      <main className="grid min-h-screen place-items-center">
        <LoadingState label="Recovering your locked draw…" />
      </main>
    );

  const allRevealed = revealed.size === reading.draw.assignments.length;
  const reveal = (index: number) => {
    if (state.matches("awaitingReveal")) send({ type: "REVEAL" });
    if (!state.matches("awaitingReveal") && !state.matches("revealingCards")) return;
    const next = new Set(revealed).add(index);
    setRevealed(next);
    if (sound) playRevealTone();
    if (next.size === reading.draw.assignments.length)
      window.setTimeout(() => send({ type: "ALL_REVEALED" }), skipMotion ? 0 : 500);
  };
  const revealAll = () => {
    if (state.matches("awaitingReveal")) send({ type: "REVEAL" });
    setRevealed(new Set(reading.draw.assignments.map((_, index) => index)));
    window.setTimeout(() => send({ type: "ALL_REVEALED" }), skipMotion ? 0 : 500);
  };

  return (
    <main className="mx-auto min-h-screen max-w-6xl px-5 py-8">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-sm tracking-[0.2em] text-[#d8b56d] uppercase">Locked reading</p>
          <h1 className="text-3xl font-semibold">Reveal at your pace</h1>
        </div>
        <div className="flex gap-2">
          <button
            aria-pressed={skipMotion}
            className="rounded-full border border-white/15 px-3 py-2"
            onClick={() => setSkipMotion((value) => !value)}
          >
            Skip motion
          </button>
          <button
            aria-pressed={sound}
            className="rounded-full border border-white/15 px-3 py-2"
            onClick={() => setSound((value) => !value)}
          >
            Sound {sound ? "on" : "off"}
          </button>
        </div>
      </header>
      <p className="mt-4 text-[#b8adc8]">
        Your profile shaped the interpretation, never this card selection. Reloading restores the
        same locked cards.
      </p>

      {state.matches("shuffling") && (
        <section className={`ritual-stage ${skipMotion ? "skip-motion" : ""}`}>
          <div aria-hidden="true" className="shuffle-shells">
            {Array.from({ length: 9 }, (_, index) => (
              <span key={index} style={{ "--shell-index": index } as React.CSSProperties} />
            ))}
          </div>
          <h2 className="text-2xl">The draw is secured</h2>
          <p className="mt-2 text-[#b8adc8]">
            The animation cannot alter the already locked cards.
          </p>
          <Button className="mt-5" onClick={() => send({ type: "SHUFFLE_COMPLETE" })}>
            Finish shuffling
          </Button>
        </section>
      )}

      {state.matches("cuttingDeck") && (
        <section className="ritual-stage">
          <div aria-hidden="true" className="cut-deck-shell">
            ✦
          </div>
          <h2 className="mt-6 text-2xl">Cut the deck?</h2>
          <p className="mt-2 text-[#b8adc8]">This ritual choice does not change the locked draw.</p>
          <div className="mt-5 flex justify-center gap-3">
            <Button onClick={() => send({ type: "CUT" })}>Cut</Button>
            <Button onClick={() => send({ type: "SKIP_CUT" })}>Skip cut</Button>
          </div>
        </section>
      )}

      {state.matches("dealing") && (
        <section aria-live="polite" className="ritual-stage">
          <div className={`deal-shells ${skipMotion ? "skip-motion" : ""}`} aria-hidden="true">
            {reading.draw.assignments.map((assignment, index) => (
              <span
                key={assignment.positionId}
                style={{ "--deal-index": index } as React.CSSProperties}
              />
            ))}
          </div>
          <LoadingState label="Dealing your locked cards…" />
        </section>
      )}

      {(state.matches("awaitingReveal") || state.matches("revealingCards")) && (
        <>
          <section
            aria-label="Your dealt cards"
            className={`reading-table mt-10 grid gap-5 sm:grid-cols-2 lg:grid-cols-4 ${skipMotion ? "skip-motion" : ""}`}
          >
            {reading.draw.assignments.map((assignment, index) => {
              const card = reading.result?.cards[index];
              const isRevealed = revealed.has(index);
              return (
                <button
                  aria-label={
                    isRevealed
                      ? `${card?.traditionalMeaning ?? "Revealed card"}, ${assignment.orientation}`
                      : `Reveal card ${index + 1}`
                  }
                  className={`tarot-card ${isRevealed ? "is-revealed" : ""}`}
                  key={assignment.positionId}
                  onClick={() => reveal(index)}
                >
                  <span className="tarot-card-inner">
                    <span className="tarot-card-back" aria-hidden="true">
                      ✦
                    </span>
                    <span className="tarot-card-front">
                      <small>{assignment.positionId.replaceAll("-", " ")}</small>
                      <strong>
                        {card?.traditionalMeaning.split(" highlights ")[0] ?? assignment.cardId}
                      </strong>
                      <span>{assignment.orientation}</span>
                    </span>
                  </span>
                </button>
              );
            })}
          </section>
          {!allRevealed && (
            <Button className="mt-8" onClick={revealAll}>
              Reveal all
            </Button>
          )}
        </>
      )}

      {state.matches("generatingSynthesis") && (
        <div className="mt-16 flex justify-center">
          <LoadingState label="Connecting the cards into a grounded reflection…" />
        </div>
      )}

      {state.matches("generationFailed") && (
        <Panel className="mt-12">
          <h2 className="text-2xl">The cards are safe</h2>
          <p className="mt-3">Interpretation generation failed. Retry without drawing again.</p>
          <Button
            className="mt-5"
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
          >
            Retry the same draw
          </Button>
        </Panel>
      )}

      {state.matches("revealingResult") && (
        <section className="ritual-stage">
          <h2 className="text-3xl">Your reflection is ready</h2>
          <Button className="mt-6" onClick={() => send({ type: "RESULT_REVEALED" })}>
            Open the reading
          </Button>
        </section>
      )}

      {state.matches("complete") && reading.result && (
        <ResultView
          followUp={followUp}
          reading={reading}
          result={reading.result}
          readingId={readingId}
          setError={setError}
          setFollowUp={setFollowUp}
          setReading={setReading}
        />
      )}
    </main>
  );
}

function ResultView({
  followUp,
  reading,
  readingId,
  result,
  setError,
  setFollowUp,
  setReading,
}: {
  followUp: string;
  reading: ReadingPayload;
  readingId: string;
  result: ReadingResult;
  setError: (message: string) => void;
  setFollowUp: (question: string) => void;
  setReading: (reading: ReadingPayload) => void;
}) {
  return (
    <section className="mt-12 grid gap-6">
      <Panel>
        <p className="text-sm text-[#d8b56d]">Central theme</p>
        <h2 className="mt-2 text-3xl">{result.title}</h2>
        <p className="mt-4 text-lg leading-8">{result.directAnswer}</p>
        <p className="mt-5 leading-7 text-[#c9bfd4]">{result.synthesis}</p>
      </Panel>
      <div className="grid gap-5 md:grid-cols-2">
        {result.cards.map((card, index) => (
          <Panel key={`${card.positionId}-${card.cardId}`}>
            <p className="text-sm text-[#d8b56d]">Card {index + 1}</p>
            <h3 className="mt-2 text-xl capitalize">
              {card.cardId.replaceAll("-", " ")} · {card.orientation}
            </h3>
            <p className="mt-3">{card.traditionalMeaning}</p>
            <p className="mt-3 text-[#c9bfd4]">{card.personalizedMeaning}</p>
            <p className="mt-3 text-sm text-[#a99db5]">{card.questionConnection}</p>
          </Panel>
        ))}
      </div>
      <Panel>
        <h2 className="text-2xl">Likely trajectory</h2>
        <p className="mt-3">{result.likelyTrajectory.summary}</p>
        <h3 className="mt-5 font-semibold">Conditions</h3>
        <ul className="mt-2 list-disc space-y-1 pl-5">
          {result.likelyTrajectory.conditions.map((condition) => (
            <li key={condition}>{condition}</li>
          ))}
        </ul>
        <h3 className="mt-5 font-semibold">Alternate trajectory</h3>
        <p>{result.likelyTrajectory.alternateTrajectory}</p>
      </Panel>
      <Panel>
        <h2 className="text-2xl">Your agency</h2>
        <ul className="mt-3 list-disc space-y-2 pl-5">
          {result.userAgency.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
        <p className="mt-5 text-lg italic">{result.reflectionQuestion}</p>
        <h3 className="mt-5 font-semibold">What could disconfirm this?</h3>
        <ul className="mt-2 list-disc space-y-1 pl-5">
          {result.disconfirmingEvidence.map((evidence) => (
            <li key={evidence}>{evidence}</li>
          ))}
        </ul>
        <p className="mt-5 text-sm text-[#a99db5]">{result.uncertainty}</p>
      </Panel>
      <Panel>
        <h2 className="text-2xl">Ask one follow-up</h2>
        {reading.followUps.length === 0 && (
          <form
            className="mt-4 grid gap-3"
            onSubmit={async (event) => {
              event.preventDefault();
              const response = await fetch(`/api/readings/${readingId}`, {
                method: "POST",
                headers: { "content-type": "application/json" },
                body: JSON.stringify({ action: "followUp", question: followUp }),
              });
              const payload = (await response.json()) as {
                followUp?: { id: string; result: ReadingResult };
                safety?: { guidance: string };
              };
              if (!response.ok)
                return setError(payload.safety?.guidance ?? "Unable to answer the follow-up.");
              if (payload.followUp)
                setReading({ ...reading, followUps: [...reading.followUps, payload.followUp] });
              setFollowUp("");
            }}
          >
            <label htmlFor="follow-up">Keep the same cards and ask what they add</label>
            <textarea
              className="rounded-2xl border border-white/15 bg-[#120e20] p-4"
              id="follow-up"
              maxLength={500}
              onChange={(event) => setFollowUp(event.target.value)}
              required
              value={followUp}
            />
            <Button type="submit">Reflect on the same cards</Button>
          </form>
        )}
        {reading.followUps.map(({ id, result: followUpResult }) => (
          <div className="mt-5 border-t border-white/10 pt-5" key={id}>
            <p>{followUpResult.directAnswer}</p>
            <p className="mt-2 text-sm text-[#a99db5]">{followUpResult.uncertainty}</p>
          </div>
        ))}
      </Panel>
    </section>
  );
}

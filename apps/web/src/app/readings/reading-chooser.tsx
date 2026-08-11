"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMachine } from "@xstate/react";
import type { SafetyCategory } from "@starguidance/ai";
import {
  GENERAL_READING_QUESTION,
  type ReadingEntitlementDecision,
  type ReadingHorizon,
  type ReadingTopic,
} from "@starguidance/contracts";
import { readingMachine } from "@starguidance/reading-machine";

import { useReadingPreferences, type ReadingPreferenceSeed } from "@/lib/reading-preferences";

import { MysticSanctuaryScene } from "../session/[id]/mystic-sanctuary-scene";
import { QuestionComposer } from "../session/[id]/question-composer";
import { SafetyInterruptPanel } from "../session/[id]/safety-interrupt-panel";

export function ReadingChooser({
  access,
  initialPreferences,
  spreads,
}: {
  access: ReadingEntitlementDecision;
  initialPreferences?: ReadingPreferenceSeed;
  spreads: readonly {
    id: string;
    name: string;
    purpose: string;
    estimatedMinutes: number;
    entitlementClass: "standard";
    count: number;
  }[];
}) {
  const [intakeState, sendIntake] = useMachine(readingMachine);
  const [selected, setSelected] = useState(spreads[1]?.id ?? spreads[0]?.id ?? "");
  const [question, setQuestion] = useState("");
  const [topic, setTopic] = useState<ReadingTopic>("general");
  const [horizon, setHorizon] = useState<ReadingHorizon>("open");
  const [generalReading, setGeneralReading] = useState(false);
  const [message, setMessage] = useState<string>();
  const [retained, setRetained] = useState<{ readingId: string; availableAt: string }>();
  const [safetyInterrupt, setSafetyInterrupt] = useState<{
    category: SafetyCategory;
    guidance: string;
  }>();
  const [guardedPrompt, setGuardedPrompt] = useState<{ category: SafetyCategory }>();
  const [loading, setLoading] = useState(false);
  const [idempotencyKey] = useState(() => crypto.randomUUID());
  const { displayName, reducedMotion, sound, toggleReducedMotion, toggleSound } =
    useReadingPreferences(initialPreferences);
  const router = useRouter();

  useEffect(() => {
    sendIntake({ type: "START" });
    sendIntake({ type: "SELECT" });
  }, [sendIntake]);

  const beginReading = async (continueAsReflection = false) => {
    setMessage(undefined);
    setRetained(undefined);
    setSafetyInterrupt(undefined);
    if (!continueAsReflection) setGuardedPrompt(undefined);
    setLoading(true);
    try {
      const response = await fetch("/api/readings", {
        method: "POST",
        headers: { "content-type": "application/json", "idempotency-key": idempotencyKey },
        body: JSON.stringify({
          spreadId: selected,
          question,
          topic,
          horizon,
          generalReading,
          continueAsReflection,
        }),
      });
      const payload = (await response.json()) as {
        readingId?: string;
        error?: string;
        cooldownActive?: boolean;
        retainedReadingId?: string;
        availableAt?: string;
        safety?: { category: SafetyCategory; interrupt: boolean; guidance: string };
        reflectionAcknowledgementRequired?: boolean;
      };
      if (response.status === 401) return router.push("/sign-in");
      if (response.status === 428) return router.push("/consent");
      if (payload.safety?.interrupt)
        return setSafetyInterrupt({
          category: payload.safety.category,
          guidance: payload.safety.guidance,
        });
      if (payload.reflectionAcknowledgementRequired && payload.safety) {
        sendIntake({ type: "HIGH_STAKES" });
        setGuardedPrompt({ category: payload.safety.category });
        return;
      }
      if (payload.cooldownActive && payload.retainedReadingId && payload.availableAt) {
        setRetained({ readingId: payload.retainedReadingId, availableAt: payload.availableAt });
        return setMessage(payload.error ?? "This question already has a recent reading.");
      }
      if (!response.ok || !payload.readingId)
        return setMessage(
          payload.safety?.guidance ?? payload.error ?? "Unable to begin the reading.",
        );
      if (continueAsReflection) sendIntake({ type: "CONTINUE_AS_REFLECTION" });
      else sendIntake({ type: "QUESTION_ACCEPTED" });
      sendIntake({ type: "DECK_READY" });
      router.push(`/session/${payload.readingId}`);
    } finally {
      setLoading(false);
    }
  };

  if (safetyInterrupt)
    return (
      <SafetyInterruptPanel
        category={safetyInterrupt.category}
        guidance={safetyInterrupt.guidance}
      />
    );

  return (
    <MysticSanctuaryScene reducedMotion={reducedMotion} testId="mystic-sanctuary-scene">
      <header className="sanctuary-controls" aria-label="Reading setup controls">
        <Link href="/profile">← Exit</Link>
        <span className="text-sm text-[#c9bfd4]">For {displayName}</span>
        <div className="sanctuary-control-group">
          <button aria-pressed={reducedMotion} onClick={toggleReducedMotion} type="button">
            Reduced motion <span>{reducedMotion ? "on" : "off"}</span>
          </button>
          <button aria-pressed={sound} onClick={toggleSound} type="button">
            Sound <span>{sound ? "on" : "off"}</span>
          </button>
        </div>
      </header>
      <section className="reading-entry-stage" data-intake-state={String(intakeState.value)}>
        <p>Choose a ritual</p>
        <h1>What kind of space do you need?</h1>
        <div aria-label="Reading type" className="ritual-spread-options" role="radiogroup">
          {spreads.map((spread) => (
            <label key={spread.id}>
              <input
                checked={selected === spread.id}
                className="sr-only"
                name="spread"
                onChange={() => setSelected(spread.id)}
                type="radio"
                value={spread.id}
              />
              <span>
                <small>
                  {spread.count} {spread.count === 1 ? "card" : "cards"} · about{" "}
                  {spread.estimatedMinutes} min
                </small>
                <strong>{spread.name}</strong>
                <span>{spread.purpose}</span>
                <small>
                  {access.outcome === "granted"
                    ? access.mode === "unlimited"
                      ? "Included"
                      : `${access.remaining ?? 0} included this window`
                    : "Allowance used"}
                </small>
              </span>
            </label>
          ))}
        </div>
      </section>
      <div className="oracle-console-stack reading-entry-console">
        <p className="entry-privacy-note">
          Your question stays private and can shape interpretation—never the card selection.
        </p>
        {!guardedPrompt && (
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="grid gap-1 text-sm">
              <span>Topic</span>
              <select
                onChange={(event) => setTopic(event.target.value as ReadingTopic)}
                value={topic}
              >
                <option value="general">General</option>
                <option value="career">Career and work</option>
                <option value="relationships">Relationships</option>
                <option value="change">Change and decisions</option>
                <option value="wellbeing">Balance and wellbeing</option>
              </select>
            </label>
            <label className="grid gap-1 text-sm">
              <span>Time horizon</span>
              <select
                onChange={(event) => setHorizon(event.target.value as ReadingHorizon)}
                value={horizon}
              >
                <option value="open">Open-ended</option>
                <option value="immediate">Right now</option>
                <option value="weeks">Next few weeks</option>
                <option value="months">Next few months</option>
              </select>
            </label>
            <label className="flex items-start gap-2 text-sm sm:col-span-2">
              <input
                checked={generalReading}
                onChange={(event) => {
                  const checked = event.target.checked;
                  setGeneralReading(checked);
                  if (checked) {
                    setQuestion(GENERAL_READING_QUESTION);
                    setTopic("general");
                    setHorizon("open");
                  } else setQuestion("");
                }}
                type="checkbox"
              />
              Use a general reading when you do not want to ask a specific question.
            </label>
          </div>
        )}
        {guardedPrompt ? (
          <div className="ritual-moment" data-safety-category={guardedPrompt.category}>
            <p className="ritual-status" role="status">
              This question touches something the cards can’t establish as fact. A reading can still
              reflect on evidence, preparation, boundaries, and choices; it cannot replace qualified
              professional support.
            </p>
            <div className="ritual-action-group">
              <button
                className="ritual-action"
                disabled={loading}
                onClick={() => void beginReading(true)}
                type="button"
              >
                {loading ? "Preparing reflection…" : "Continue as reflection"}
              </button>
              <button
                className="ritual-action"
                disabled={loading}
                onClick={() => {
                  setGuardedPrompt(undefined);
                  sendIntake({ type: "RESTART" });
                }}
                type="button"
              >
                Revise the question
              </button>
            </div>
          </div>
        ) : (
          <QuestionComposer
            disabled={access.outcome !== "granted"}
            hint="Shift+Enter adds a line. Enter begins the locked draw."
            label="Your private question"
            loading={loading}
            onChange={(value) => {
              setGeneralReading(false);
              setQuestion(value);
            }}
            onSubmit={() => void beginReading()}
            placeholder="What can I understand or do about…"
            submitLabel="Begin the shuffle"
            testId="initial-question-composer"
            value={question}
          />
        )}
        {access.outcome === "limitReached" && access.windowEndsAt && (
          <p className="sanctuary-error" role="status">
            Your included reading allowance renews{" "}
            <time dateTime={access.windowEndsAt}>
              {new Date(access.windowEndsAt).toLocaleString()}
            </time>
            . Your history and locked cards remain available.
          </p>
        )}
        {message && (
          <div className="sanctuary-error" role="alert">
            <p>{message}</p>
            {retained && (
              <p>
                <Link href={`/reading/${retained.readingId}`}>Open the retained reading</Link>
                {" · another draw becomes available "}
                <time dateTime={retained.availableAt}>
                  {new Date(retained.availableAt).toLocaleString()}
                </time>
              </p>
            )}
          </div>
        )}
      </div>
    </MysticSanctuaryScene>
  );
}

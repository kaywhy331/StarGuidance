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

const readingNeeds = [
  {
    id: "direction",
    label: "A clear next step",
    hint: "See the situation, tension, and direction",
    glyph: "↗",
    spreadId: "three-card",
  },
  {
    id: "focus",
    label: "One thing to notice",
    hint: "A concise signal for right now",
    glyph: "✦",
    spreadId: "one-card",
  },
  {
    id: "decision",
    label: "A complex decision",
    hint: "Trace influences, obstacles, and agency",
    glyph: "⋔",
    spreadId: "horseshoe",
  },
  {
    id: "relationship",
    label: "A relationship dynamic",
    hint: "Reflect on signals, needs, and boundaries",
    glyph: "∞",
    spreadId: "relationship",
  },
  {
    id: "depth",
    label: "A deeper pattern",
    hint: "Hold a layered situation from many angles",
    glyph: "◇",
    spreadId: "celtic-cross",
  },
  {
    id: "chapter",
    label: "A bigger life chapter",
    hint: "Map past, present, future, and integration",
    glyph: "⌗",
    spreadId: "nine-card-matrix",
  },
] as const;

type ReadingNeed = (typeof readingNeeds)[number]["id"];

const spreadPresentationOrder = [
  "three-card",
  "one-card",
  "horseshoe",
  "relationship",
  "celtic-cross",
  "nine-card-matrix",
] as const;

export function ReadingChooser({
  access,
  animationVariant = "immersive-v1",
  initialPreferences,
  spreads,
}: {
  access: ReadingEntitlementDecision;
  animationVariant?: "immersive-v1" | "quiet-v1" | "disabled";
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
  const initialSelected = spreads[1]?.id ?? spreads[0]?.id ?? "";
  const availableNeeds = readingNeeds.filter((option) =>
    spreads.some(({ id }) => id === option.spreadId),
  );
  const [intakeState, sendIntake] = useMachine(readingMachine);
  const [selected, setSelected] = useState(initialSelected);
  const [need, setNeed] = useState<ReadingNeed>(
    readingNeeds.find(({ spreadId }) => spreadId === initialSelected)?.id ??
      availableNeeds[0]?.id ??
      "direction",
  );
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
  const {
    displayName,
    reducedMotion: preferenceReducedMotion,
    sound,
    toggleReducedMotion,
    toggleSound,
  } = useReadingPreferences(initialPreferences);
  const animationManaged = animationVariant !== "immersive-v1";
  const reducedMotion = preferenceReducedMotion || animationManaged;
  const router = useRouter();

  useEffect(() => {
    sendIntake({ type: "START" });
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

  if (spreads.length === 0)
    return (
      <MysticSanctuaryScene
        animationVariant={animationVariant}
        phase="selectingReading"
        reducedMotion={true}
        testId="mystic-sanctuary-scene"
      >
        <div className="sanctuary-loading" role="status">
          <span aria-hidden="true">✦</span>
          New readings are paused while the available spreads are reviewed.
          <Link href="/history">Return to your saved readings</Link>
        </div>
      </MysticSanctuaryScene>
    );

  const selectingReading = intakeState.matches("selectingReading");
  const selectedSpread = spreads.find(({ id }) => id === selected) ?? spreads[0];
  const orderedSpreads = [...spreads].sort(
    (left, right) =>
      spreadPresentationOrder.indexOf(left.id as (typeof spreadPresentationOrder)[number]) -
      spreadPresentationOrder.indexOf(right.id as (typeof spreadPresentationOrder)[number]),
  );

  return (
    <MysticSanctuaryScene
      animationVariant={animationVariant}
      phase={selectingReading ? "selectingReading" : "enteringQuestion"}
      reducedMotion={reducedMotion}
      testId="mystic-sanctuary-scene"
    >
      <header className="sanctuary-controls" aria-label="Reading setup controls">
        <Link href="/profile">← Exit</Link>
        <span className="text-sm text-[#c9bfd4]">For {displayName}</span>
        <div className="sanctuary-control-group">
          <button
            aria-pressed={reducedMotion}
            disabled={animationManaged}
            onClick={toggleReducedMotion}
            type="button"
          >
            Reduced motion{" "}
            <span>{animationManaged ? "managed" : reducedMotion ? "on" : "off"}</span>
          </button>
          <button aria-pressed={sound} onClick={toggleSound} type="button">
            Sound <span>{sound ? "on" : "off"}</span>
          </button>
        </div>
      </header>
      {selectingReading ? (
        <section
          className="reading-entry-stage reading-selection-stage"
          data-intake-state={String(intakeState.value)}
        >
          <p>Choose a ritual</p>
          <h1>What kind of space do you need?</h1>
          <div className="ritual-need-picker">
            <p>Start with the feeling, not the spread name.</p>
            <div aria-label="What you need" className="ritual-need-options" role="radiogroup">
              {availableNeeds.map((option) => (
                <button
                  aria-checked={need === option.id}
                  data-need={option.id}
                  key={option.id}
                  onClick={() => {
                    setNeed(option.id);
                    setSelected(option.spreadId);
                  }}
                  role="radio"
                  type="button"
                >
                  <span aria-hidden="true">{option.glyph}</span>
                  <span>
                    <strong>{option.label}</strong>
                    <small>{option.hint}</small>
                  </span>
                </button>
              ))}
            </div>
          </div>
          <div className="ritual-spread-heading">
            <p>Recommended ritual</p>
            <span aria-hidden="true" />
            <small>Choose another if it feels more fitting</small>
          </div>
          <div aria-label="Reading type" className="ritual-spread-options" role="radiogroup">
            {orderedSpreads.map((spread) => {
              const matchingNeed = readingNeeds.find((option) => option.spreadId === spread.id);
              return (
                <label data-recommended={matchingNeed?.id === need} key={spread.id}>
                  <input
                    checked={selected === spread.id}
                    className="sr-only"
                    name="spread"
                    onChange={() => setSelected(spread.id)}
                    type="radio"
                    value={spread.id}
                  />
                  <span>
                    {matchingNeed?.id === need ? (
                      <em className="ritual-spread-recommendation">Best fit</em>
                    ) : null}
                    <small>
                      {spread.count} {spread.count === 1 ? "card" : "cards"} · about{" "}
                      {spread.estimatedMinutes} min
                    </small>
                    <strong>{spread.name}</strong>
                    <span className="ritual-spread-purpose">{spread.purpose}</span>
                    <small>
                      {access.outcome === "granted"
                        ? access.mode === "unlimited"
                          ? "Included"
                          : `${access.remaining ?? 0} included this window`
                        : "Allowance used"}
                    </small>
                  </span>
                </label>
              );
            })}
          </div>
          <button
            className="reading-entry-continue"
            disabled={!selectedSpread}
            onClick={() => sendIntake({ type: "SELECT" })}
            type="button"
          >
            Continue with {selectedSpread?.name ?? "this reading"}
          </button>
        </section>
      ) : (
        <section
          className="reading-entry-stage reading-question-stage"
          data-intake-state={String(intakeState.value)}
        >
          <div>
            <p>Set your intention</p>
            <h1>What would you like the cards to illuminate?</h1>
            {selectedSpread && (
              <button
                className="selected-ritual-summary"
                onClick={() => {
                  setGuardedPrompt(undefined);
                  sendIntake({ type: "CHANGE_READING" });
                }}
                type="button"
              >
                <span>{selectedSpread.name}</span>
                <small>
                  {selectedSpread.count} {selectedSpread.count === 1 ? "card" : "cards"} · about{" "}
                  {selectedSpread.estimatedMinutes} min · change
                </small>
              </button>
            )}
          </div>
        </section>
      )}
      {!selectingReading && (
        <div className="oracle-console-stack reading-entry-console reading-question-console">
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
                This question touches something the cards can’t establish as fact. A reading can
                still reflect on evidence, preparation, boundaries, and choices; it cannot replace
                qualified professional support.
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
      )}
    </MysticSanctuaryScene>
  );
}

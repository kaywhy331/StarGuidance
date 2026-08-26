"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMachine } from "@xstate/react";
import type { SafetyCategory } from "@starguidance/ai";
import {
  GENERAL_READING_QUESTION,
  type DrawCeremony,
  type PersonalizationMode,
  type ReadingEntitlementDecision,
  type ReversalMode,
} from "@starguidance/contracts";
import { readingMachine } from "@starguidance/reading-machine";

import {
  createClientDrawNonce,
  isClientDrawNonce,
  stirClientDrawNonce,
} from "@/lib/client-draw-entropy";
import { useReadingPreferences, type ReadingPreferenceSeed } from "@/lib/reading-preferences";

import { MysticSanctuaryScene } from "../session/[id]/mystic-sanctuary-scene";
import { QuestionComposer } from "../session/[id]/question-composer";
import { playRitualSound, useRitualAmbience } from "../session/[id]/ritual-audio";
import { RitualControls } from "../session/[id]/ritual-controls";
import { SafetyInterruptPanel } from "../session/[id]/safety-interrupt-panel";
import { ImmersiveCutDeck, ImmersiveShuffleDeck } from "../session/[id]/shuffle-shells";

const CEREMONY_STORAGE_KEY = "starguidance:pending-draw-ceremony:v1";

type CeremonyStage = "focusing" | "shuffling" | "optionalCut";

interface PendingCeremonyReceipt {
  token: string;
  stage: CeremonyStage;
  clientNonce?: string;
  stirCount?: number;
}

interface QuestionReview {
  encouragedForm: boolean;
  reformulationReason?: "binary" | "deterministic" | "third_party_private";
  suggestedQuestion?: string;
}

interface SpreadChoice {
  id: string;
  version: string;
  name: string;
  purpose: string;
  estimatedMinutes: number;
  entitlementClass: "standard";
  count: number;
  positions: readonly {
    id: string;
    displayName: string;
    interpretiveFunction: string;
    description: string;
    order: number;
  }[];
}

function savePendingCeremony(
  token: string,
  stage: CeremonyStage,
  clientNonce: string,
  stirCount: number,
) {
  const receipt: PendingCeremonyReceipt = { token, stage, clientNonce, stirCount };
  window.sessionStorage.setItem(CEREMONY_STORAGE_KEY, JSON.stringify(receipt));
}

function clearPendingCeremony() {
  window.sessionStorage.removeItem(CEREMONY_STORAGE_KEY);
}

export function ReadingChooser({
  access,
  animationVariant = "immersive-v1",
  initialPreferences,
  sigilSeed,
  spreads,
}: {
  access: ReadingEntitlementDecision;
  animationVariant?: "immersive-v1" | "quiet-v1" | "disabled";
  initialPreferences?: ReadingPreferenceSeed;
  sigilSeed: string;
  spreads: readonly SpreadChoice[];
}) {
  const router = useRouter();
  const [state, send] = useMachine(readingMachine);
  const defaultSpread = spreads.find(({ id }) => id === "three-card") ?? spreads[0];
  const [selected, setSelected] = useState(defaultSpread?.id ?? "");
  const [question, setQuestion] = useState("");
  const [confirmedQuestion, setConfirmedQuestion] = useState("");
  const [questionReview, setQuestionReview] = useState<QuestionReview>();
  const [ceremony, setCeremony] = useState<DrawCeremony>();
  const [reversalMode, setReversalMode] = useState<ReversalMode>("reversals_enabled");
  const [personalizationMode, setPersonalizationMode] =
    useState<PersonalizationMode>("personalized_tarot");
  const [message, setMessage] = useState<string>();
  const [retained, setRetained] = useState<{ readingId: string; availableAt: string }>();
  const [loading, setLoading] = useState(false);
  const [safetyInterrupt, setSafetyInterrupt] = useState<{
    category: SafetyCategory;
    guidance: string;
  }>();
  const [guardedPrompt, setGuardedPrompt] = useState<{ category: SafetyCategory }>();
  const [idempotencyKey] = useState(() => crypto.randomUUID());
  const clientNonce = useRef<string | undefined>(undefined);
  const stirCount = useRef(0);
  const {
    ambience,
    displayName,
    narration,
    reducedMotion: preferenceReducedMotion,
    sound,
    toggleAmbience,
    toggleNarration,
    toggleReducedMotion,
    toggleSound,
  } = useReadingPreferences(initialPreferences);
  const animationManaged = animationVariant !== "immersive-v1";
  const reducedMotion = preferenceReducedMotion || animationManaged;
  useRitualAmbience(ambience, String(state.value));

  const selectedSpread = useMemo(
    () => spreads.find(({ id }) => id === selected) ?? spreads[0],
    [selected, spreads],
  );

  useEffect(() => {
    send({ type: "START" });
    send({ type: "DRAFT_QUESTION" });
    const raw = window.sessionStorage.getItem(CEREMONY_STORAGE_KEY);
    if (!raw) return;
    let receipt: PendingCeremonyReceipt;
    try {
      receipt = JSON.parse(raw) as PendingCeremonyReceipt;
    } catch {
      clearPendingCeremony();
      return;
    }
    void fetch("/api/readings", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "restore", ceremonyToken: receipt.token }),
    })
      .then(async (response) => {
        if (!response.ok) throw new Error("The pending ritual could not be restored.");
        return response.json() as Promise<{
          ceremony?: DrawCeremony;
          readingId?: string;
        }>;
      })
      .then((payload) => {
        if (payload.readingId) {
          clearPendingCeremony();
          router.replace(`/session/${payload.readingId}`);
          return;
        }
        if (!payload.ceremony) throw new Error("The pending ritual could not be restored.");
        setCeremony(payload.ceremony);
        setQuestion(payload.ceremony.question);
        setConfirmedQuestion(payload.ceremony.question);
        setSelected(payload.ceremony.spread.id);
        setReversalMode(payload.ceremony.configuration.reversalMode);
        setPersonalizationMode(payload.ceremony.configuration.personalizationMode);
        clientNonce.current = isClientDrawNonce(receipt.clientNonce)
          ? receipt.clientNonce
          : createClientDrawNonce();
        stirCount.current =
          Number.isSafeInteger(receipt.stirCount) && (receipt.stirCount ?? -1) >= 0
            ? (receipt.stirCount ?? 0)
            : 0;
        send({ type: "CONFIRM_QUESTION" });
        send({ type: "CONFIRM_SPREAD" });
        send({ type: "SAFETY_APPROVED" });
        if (receipt.stage === "shuffling" || receipt.stage === "optionalCut")
          send({ type: "FOCUS_COMPLETE" });
        if (receipt.stage === "optionalCut") send({ type: "SHUFFLE_COMPLETE" });
      })
      .catch((cause: unknown) => {
        clearPendingCeremony();
        setMessage(cause instanceof Error ? cause.message : "The pending ritual expired.");
      });
  }, [router, send]);

  const reviewQuestion = async () => {
    const finalQuestion = question.trim();
    if (!finalQuestion) return;
    setLoading(true);
    setMessage(undefined);
    try {
      const response = await fetch("/api/readings", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "review", question: finalQuestion }),
      });
      const payload = (await response.json()) as {
        error?: string;
        review?: QuestionReview;
        safety?: { category: SafetyCategory; interrupt: boolean; guidance: string };
      };
      if (response.status === 401) return router.push("/sign-in");
      if (response.status === 428) return router.push("/consent");
      if (payload.safety?.interrupt) {
        setSafetyInterrupt({
          category: payload.safety.category,
          guidance: payload.safety.guidance,
        });
        return;
      }
      if (!response.ok || !payload.review)
        throw new Error(payload.error ?? "The question could not be reviewed.");
      setQuestionReview(payload.review);
    } catch (cause) {
      setMessage(cause instanceof Error ? cause.message : "The question could not be reviewed.");
    } finally {
      setLoading(false);
    }
  };

  const confirmQuestion = () => {
    const finalQuestion = question.trim();
    if (!finalQuestion || !questionReview) return;
    setConfirmedQuestion(finalQuestion);
    setQuestionReview(undefined);
    send({ type: "CONFIRM_QUESTION" });
  };

  const prepareRitual = async (continueAsReflection = false) => {
    if (!selectedSpread || !confirmedQuestion) return;
    setLoading(true);
    setMessage(undefined);
    setRetained(undefined);
    if (!continueAsReflection) {
      setGuardedPrompt(undefined);
      send({ type: "CONFIRM_SPREAD" });
    }
    try {
      const response = await fetch("/api/readings", {
        method: "POST",
        headers: { "content-type": "application/json", "idempotency-key": idempotencyKey },
        body: JSON.stringify({
          action: "prepare",
          spreadId: selectedSpread.id,
          question: confirmedQuestion,
          questionConfirmed: true,
          reversalMode,
          personalizationMode,
          continueAsReflection,
        }),
      });
      const payload = (await response.json()) as {
        ceremony?: DrawCeremony;
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
      if (payload.readingId) return router.push(`/session/${payload.readingId}`);
      if (payload.safety?.interrupt) {
        setSafetyInterrupt({
          category: payload.safety.category,
          guidance: payload.safety.guidance,
        });
        return;
      }
      if (payload.reflectionAcknowledgementRequired && payload.safety) {
        send({ type: "HIGH_STAKES" });
        setGuardedPrompt({ category: payload.safety.category });
        return;
      }
      if (payload.cooldownActive && payload.retainedReadingId && payload.availableAt) {
        send({ type: "CHANGE_SPREAD" });
        setRetained({ readingId: payload.retainedReadingId, availableAt: payload.availableAt });
        setMessage(payload.error ?? "This question already has a recent reading.");
        return;
      }
      if (!response.ok || !payload.ceremony) {
        send({ type: "CHANGE_SPREAD" });
        throw new Error(
          payload.safety?.guidance ?? payload.error ?? "Unable to prepare the ritual.",
        );
      }
      setCeremony(payload.ceremony);
      clientNonce.current = createClientDrawNonce();
      stirCount.current = 0;
      savePendingCeremony(payload.ceremony.token, "focusing", clientNonce.current, 0);
      if (continueAsReflection) send({ type: "CONTINUE_AS_REFLECTION" });
      else send({ type: "SAFETY_APPROVED" });
    } catch (cause) {
      setMessage(cause instanceof Error ? cause.message : "Unable to prepare the ritual.");
    } finally {
      setLoading(false);
    }
  };

  const finalizeDraw = useCallback(
    async (cutIndex: number) => {
      if (!ceremony || loading) return;
      const pendingNonce = clientNonce.current ?? createClientDrawNonce();
      clientNonce.current = pendingNonce;
      setLoading(true);
      setMessage(undefined);
      send({ type: cutIndex === 0 ? "SKIP_CUT" : "CUT" });
      try {
        const response = await fetch("/api/readings", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            action: "finalize",
            ceremonyToken: ceremony.token,
            clientNonce: pendingNonce,
            cutIndex,
          }),
        });
        const payload = (await response.json()) as { readingId?: string; error?: string };
        if (!response.ok || !payload.readingId)
          throw new Error(payload.error ?? "The draw could not be finalized.");
        clearPendingCeremony();
        if (sound) playRitualSound("gather");
        send({ type: "DRAW_LOCKED" });
        router.push(`/session/${payload.readingId}`);
      } catch (cause) {
        send({ type: "FINALIZATION_FAILED" });
        setMessage(cause instanceof Error ? cause.message : "The draw could not be finalized.");
      } finally {
        setLoading(false);
      }
    },
    [ceremony, loading, router, send, sound],
  );

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
        phase="readingCreated"
        reducedMotion
        testId="mystic-sanctuary-scene"
      >
        <div className="sanctuary-loading" role="status">
          <span aria-hidden="true">✦</span>
          New readings are paused while the available spreads are reviewed.
          <Link href="/history">Return to your saved readings</Link>
        </div>
      </MysticSanctuaryScene>
    );

  const showQuestion = state.matches("questionDrafting");
  const showSpread = state.matches("questionConfirmed") || state.matches("spreadConfirmed");
  const readingSetupFocus =
    state.matches("focusing") ||
    state.matches("shuffling") ||
    state.matches("optionalCut") ||
    state.matches("drawFinalizing")
      ? "cards"
      : "ambient";

  const saveCurrentCeremony = (stage: CeremonyStage) => {
    if (!ceremony) return;
    const pendingNonce = clientNonce.current ?? createClientDrawNonce();
    clientNonce.current = pendingNonce;
    savePendingCeremony(ceremony.token, stage, pendingNonce, stirCount.current);
  };

  const stirPendingDeck = () => {
    const pendingNonce = clientNonce.current ?? createClientDrawNonce();
    clientNonce.current = stirClientDrawNonce(pendingNonce);
    stirCount.current += 1;
    saveCurrentCeremony("shuffling");
    if (sound) playRitualSound("shuffle");
  };

  return (
    <MysticSanctuaryScene
      animationVariant={animationVariant}
      backdrop={readingSetupFocus === "cards" ? "starry-reading" : "sanctuary"}
      focusStage={readingSetupFocus}
      phase={String(state.value)}
      reducedMotion={reducedMotion}
      testId="mystic-sanctuary-scene"
    >
      <RitualControls
        ambience={ambience}
        animationManaged={animationManaged}
        controlsLabel="Reading setup controls"
        displayName={displayName}
        exitHref="/profile"
        narration={narration}
        reducedMotion={reducedMotion}
        sigilSeed={sigilSeed}
        sound={sound}
        toggleAmbience={toggleAmbience}
        toggleNarration={toggleNarration}
        toggleReducedMotion={toggleReducedMotion}
        toggleSound={toggleSound}
        {...(state.matches("shuffling") || state.matches("optionalCut")
          ? {
              onSkip: () => {
                if (state.matches("shuffling")) send({ type: "SHUFFLE_COMPLETE" });
                else void finalizeDraw(0);
              },
            }
          : {})}
      />

      {showQuestion && (
        <section className="reading-entry-stage reading-question-stage">
          <div>
            <p>Set your intention</p>
            <h1>What would you like the cards to illuminate?</h1>
            <p>
              Questions beginning with What, How, or “What should I understand” leave room for
              insight and choice.
            </p>
          </div>
        </section>
      )}
      {showQuestion && (
        <div className="oracle-console-stack reading-entry-console reading-question-console">
          <p className="entry-privacy-note">
            Your confirmed question shapes interpretation—never the card selection.
          </p>
          {questionReview ? (
            <div className="ritual-moment" data-testid="question-confirmation">
              <p className="ritual-status">Confirm the exact question the reading will use</p>
              <blockquote>{question}</blockquote>
              {questionReview.suggestedQuestion && (
                <div>
                  <p>A more open, user-centered form may give the spread more room:</p>
                  <blockquote>{questionReview.suggestedQuestion}</blockquote>
                  <button
                    className="ritual-action"
                    onClick={() => {
                      setQuestion(questionReview.suggestedQuestion ?? question);
                      setQuestionReview({ encouragedForm: true });
                    }}
                    type="button"
                  >
                    Use this reformulation
                  </button>
                </div>
              )}
              <div className="ritual-action-group">
                <button
                  className="ritual-action is-primary"
                  onClick={confirmQuestion}
                  type="button"
                >
                  Confirm this question
                </button>
                <button
                  className="ritual-action"
                  onClick={() => setQuestionReview(undefined)}
                  type="button"
                >
                  Revise it
                </button>
              </div>
            </div>
          ) : (
            <>
              <QuestionComposer
                disabled={access.outcome !== "granted"}
                hint="Shift+Enter adds a line. You will confirm the exact wording before any draw."
                label="Your private question"
                loading={loading}
                onChange={setQuestion}
                onSubmit={() => void reviewQuestion()}
                placeholder="What should I understand about…"
                submitLabel="Review my question"
                testId="initial-question-composer"
                value={question}
              />
              <button
                className="reading-entry-continue"
                onClick={() => {
                  setQuestion(GENERAL_READING_QUESTION);
                  setQuestionReview({ encouragedForm: true });
                }}
                type="button"
              >
                Use a general intention
              </button>
            </>
          )}
        </div>
      )}

      {showSpread && selectedSpread && (
        <section className="reading-entry-stage reading-selection-stage">
          <p>Choose the structure</p>
          <h1>Select a spread for your confirmed question</h1>
          <blockquote>{confirmedQuestion}</blockquote>
          <div aria-label="Reading type" className="ritual-spread-options" role="radiogroup">
            {spreads.map((spread) => (
              <label
                data-featured="true"
                data-recommended={spread.id === "three-card"}
                key={spread.id}
              >
                <input
                  checked={selected === spread.id}
                  className="sr-only"
                  name="spread"
                  onChange={() => setSelected(spread.id)}
                  type="radio"
                  value={spread.id}
                />
                <span>
                  {spread.id === "three-card" && (
                    <em className="ritual-spread-recommendation">Recommended</em>
                  )}
                  <small>
                    {spread.count} {spread.count === 1 ? "card" : "cards"} · about{" "}
                    {spread.estimatedMinutes} min
                  </small>
                  <strong>{spread.name}</strong>
                  <span className="ritual-spread-purpose">{spread.purpose}</span>
                </span>
              </label>
            ))}
          </div>
          <div className="ritual-moment" data-testid="spread-position-preview">
            <p className="ritual-status">The positions are fixed before any card is known</p>
            <ol>
              {[...selectedSpread.positions]
                .sort((left, right) => left.order - right.order)
                .map((position) => (
                  <li key={position.id}>
                    <strong>
                      {position.order + 1}. {position.displayName}
                    </strong>
                    <span>{position.interpretiveFunction}</span>
                    <small>{position.description}</small>
                  </li>
                ))}
            </ol>
          </div>
          <div className="ritual-moment">
            <p className="ritual-status">Reading method</p>
            <div className="ritual-action-group" role="group" aria-label="Reversal preference">
              <button
                aria-pressed={reversalMode === "reversals_enabled"}
                onClick={() => setReversalMode("reversals_enabled")}
                type="button"
              >
                Use reversals
              </button>
              <button
                aria-pressed={reversalMode === "upright_only"}
                onClick={() => setReversalMode("upright_only")}
                type="button"
              >
                Upright only
              </button>
            </div>
            <div
              className="ritual-action-group"
              role="group"
              aria-label="Personalization preference"
            >
              <button
                aria-pressed={personalizationMode === "personalized_tarot"}
                onClick={() => setPersonalizationMode("personalized_tarot")}
                type="button"
              >
                Personalized Tarot
              </button>
              <button
                aria-pressed={personalizationMode === "pure_tarot"}
                onClick={() => setPersonalizationMode("pure_tarot")}
                type="button"
              >
                Pure Tarot
              </button>
            </div>
            <p className="entry-privacy-note">
              Pure Tarot sends no profile traits. Personalized Tarot weaves only relevant, available
              profile traits into the interpretation and never changes the draw. Unavailable or
              unvalidated systems are not invented.
            </p>
          </div>
          <div className="ritual-action-group">
            <button
              className="reading-entry-continue"
              disabled={loading}
              onClick={() => void prepareRitual()}
              type="button"
            >
              {loading ? "Preparing…" : `Confirm ${selectedSpread.name}`}
            </button>
            <button
              className="ritual-action"
              onClick={() => send({ type: "REVISE_QUESTION" })}
              type="button"
            >
              Revise question
            </button>
          </div>
        </section>
      )}

      {state.matches("highStakesQuestion") && guardedPrompt && (
        <section className="reading-entry-stage reading-question-stage">
          <div className="ritual-moment" data-safety-category={guardedPrompt.category}>
            <p className="ritual-status" role="status">
              The cards cannot establish this as fact. They can still reflect on evidence,
              preparation, boundaries, and your choices.
            </p>
            <div className="ritual-action-group">
              <button
                className="ritual-action"
                disabled={loading}
                onClick={() => void prepareRitual(true)}
                type="button"
              >
                {loading ? "Preparing reflection…" : "Continue as reflection"}
              </button>
              <button
                className="ritual-action"
                onClick={() => {
                  setGuardedPrompt(undefined);
                  send({ type: "REVISE_QUESTION" });
                }}
                type="button"
              >
                Revise the question
              </button>
            </div>
          </div>
        </section>
      )}

      {state.matches("focusing") && ceremony && (
        <section className="reading-entry-stage reading-question-stage">
          <div className="ritual-moment">
            <p>Focus</p>
            <h1>Hold the confirmed question</h1>
            <blockquote>{ceremony.question}</blockquote>
            <ol>
              {ceremony.spread.positions.map((position) => (
                <li key={position.id}>
                  <strong>
                    {position.order + 1}. {position.displayName}
                  </strong>{" "}
                  — {position.interpretiveFunction}
                </li>
              ))}
            </ol>
            <small>Fair-draw commitment: {ceremony.serverSeedCommitment.slice(0, 12)}…</small>
            <button
              className="reading-entry-continue"
              onClick={() => {
                saveCurrentCeremony("shuffling");
                send({ type: "FOCUS_COMPLETE" });
              }}
              type="button"
            >
              Begin the shuffle
            </button>
          </div>
        </section>
      )}

      {state.matches("shuffling") && ceremony && (
        <section className="reading-entry-stage reading-question-stage sanctuary-shuffle-ritual is-shuffling">
          <ImmersiveShuffleDeck onStir={stirPendingDeck} />
          <div className="sanctuary-shuffle-copy">
            <p className="ritual-status">All 78 possibilities are in motion</p>
            <span>
              Swipe, tap, click, or press Space to stir in fresh secure entropy. The draw remains
              cryptographically strong if you finish immediately.
            </span>
          </div>
          <button
            className="shuffle-skip-action"
            onClick={() => {
              saveCurrentCeremony("optionalCut");
              send({ type: "SHUFFLE_COMPLETE" });
            }}
            type="button"
          >
            Finish shuffling
          </button>
        </section>
      )}

      {state.matches("optionalCut") && ceremony && (
        <section className="reading-entry-stage reading-question-stage sanctuary-gather-ritual">
          <div className="sanctuary-shuffle-copy">
            <p className="ritual-status">Cut the deck, if you wish</p>
            <span>
              Choose where the deck separates. That exact cut becomes part of this locked draw.
            </span>
          </div>
          <ImmersiveCutDeck
            onCut={(cutIndex) => void finalizeDraw(cutIndex)}
            onNoCut={() => void finalizeDraw(0)}
            reducedMotion={reducedMotion}
          />
        </section>
      )}

      {state.matches("drawFinalizing") && (
        <div className="sanctuary-loading" role="status">
          <span aria-hidden="true">✦</span>
          Finalizing and atomically locking every card, position, and orientation…
        </div>
      )}

      {access.outcome === "limitReached" && access.windowEndsAt && (
        <p className="sanctuary-error" role="status">
          Your included reading allowance renews{" "}
          <time dateTime={access.windowEndsAt}>
            {new Date(access.windowEndsAt).toLocaleString()}
          </time>
          .
        </p>
      )}
      {message && (
        <div className="sanctuary-error" role="alert">
          <p>{message}</p>
          {retained && (
            <p>
              <Link href={`/reading/${retained.readingId}`}>Open the retained reading</Link> ·
              another draw becomes available{" "}
              <time dateTime={retained.availableAt}>
                {new Date(retained.availableAt).toLocaleString()}
              </time>
            </p>
          )}
        </div>
      )}
    </MysticSanctuaryScene>
  );
}

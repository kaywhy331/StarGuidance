"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { useMachine } from "@xstate/react";
import type { SafetyCategory } from "@starguidance/ai";
import type {
  DrawCeremony,
  PersonalizationMode,
  ReadingEntitlementDecision,
  ReversalMode,
} from "@starguidance/contracts";
import { readingMachine } from "@starguidance/reading-machine";

import {
  createClientDrawNonce,
  isClientDrawNonce,
  stirClientDrawNonce,
} from "@/lib/client-draw-entropy";
import { useReadingPreferences, type ReadingPreferenceSeed } from "@/lib/reading-preferences";

import { MysticSanctuaryScene } from "../session/[id]/mystic-sanctuary-scene";
import { playRitualSound, useRitualAmbience } from "../session/[id]/ritual-audio";
import { RitualControls } from "../session/[id]/ritual-controls";
import { SafetyInterruptPanel } from "../session/[id]/safety-interrupt-panel";
import { CasinoWashDeck } from "../session/[id]/shuffle-shells";

const CEREMONY_STORAGE_KEY = "starguidance:pending-draw-ceremony:v2";
const LEGACY_CEREMONY_STORAGE_KEY = "starguidance:pending-draw-ceremony:v1";

type CeremonyStage = "focusing" | "shuffling" | "selectingCards" | "optionalCut";

interface PendingCeremonyReceipt {
  token: string;
  stage: CeremonyStage;
  clientNonce?: string;
  stirCount?: number;
  selectedIndexes?: number[];
}

function savePendingCeremony(receipt: PendingCeremonyReceipt) {
  window.sessionStorage.setItem(CEREMONY_STORAGE_KEY, JSON.stringify(receipt));
}

function clearPendingCeremony() {
  window.sessionStorage.removeItem(CEREMONY_STORAGE_KEY);
  window.sessionStorage.removeItem(LEGACY_CEREMONY_STORAGE_KEY);
}

export function ReadingChooser({
  access,
  animationVariant = "immersive-v1",
  initialPreferences,
  sigilSeed,
}: {
  access: ReadingEntitlementDecision;
  animationVariant?: "immersive-v1" | "quiet-v1" | "disabled";
  initialPreferences?: ReadingPreferenceSeed;
  sigilSeed: string;
}) {
  const router = useRouter();
  const [state, send] = useMachine(readingMachine);
  const [question, setQuestion] = useState("");
  const [confirmedQuestion, setConfirmedQuestion] = useState("");
  const [ceremony, setCeremony] = useState<DrawCeremony>();
  const [selectedIndexes, setSelectedIndexes] = useState<number[]>([]);
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
  const reversalMode: ReversalMode = "reversals_enabled";
  const personalizationMode: PersonalizationMode = "personalized_tarot";
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

  useEffect(() => {
    send({ type: "START" });
    send({ type: "DRAFT_QUESTION" });
    const raw =
      window.sessionStorage.getItem(CEREMONY_STORAGE_KEY) ??
      window.sessionStorage.getItem(LEGACY_CEREMONY_STORAGE_KEY);
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
        return response.json() as Promise<{ ceremony?: DrawCeremony; readingId?: string }>;
      })
      .then((payload) => {
        if (payload.readingId) {
          clearPendingCeremony();
          router.replace(`/session/${payload.readingId}`);
          return;
        }
        if (!payload.ceremony) throw new Error("The pending ritual could not be restored.");
        const restoredPicks = (receipt.selectedIndexes ?? []).filter(
          (index, position, indexes) =>
            Number.isInteger(index) &&
            index >= 0 &&
            index < 78 &&
            indexes.indexOf(index) === position &&
            position < payload.ceremony!.spread.positions.length,
        );
        setCeremony(payload.ceremony);
        setQuestion(payload.ceremony.question);
        setConfirmedQuestion(payload.ceremony.question);
        setSelectedIndexes(restoredPicks);
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
        send({ type: "FOCUS_COMPLETE" });
        if (receipt.stage === "selectingCards" || receipt.stage === "optionalCut")
          send({ type: "SHUFFLE_COMPLETE" });
      })
      .catch((cause: unknown) => {
        clearPendingCeremony();
        setMessage(cause instanceof Error ? cause.message : "The pending ritual expired.");
      });
  }, [router, send]);

  const prepareRitual = async (continueAsReflection = false) => {
    const finalQuestion = (continueAsReflection ? confirmedQuestion : question).trim();
    if (!finalQuestion || loading) return;
    setLoading(true);
    setMessage(undefined);
    setRetained(undefined);
    if (!continueAsReflection) {
      setConfirmedQuestion(finalQuestion);
      setGuardedPrompt(undefined);
      send({ type: "CONFIRM_QUESTION" });
      send({ type: "CONFIRM_SPREAD" });
    }
    try {
      const response = await fetch("/api/readings", {
        method: "POST",
        headers: { "content-type": "application/json", "idempotency-key": idempotencyKey },
        body: JSON.stringify({
          action: "prepare",
          question: finalQuestion,
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
        send({ type: "REVISE_QUESTION" });
        setRetained({ readingId: payload.retainedReadingId, availableAt: payload.availableAt });
        setMessage(payload.error ?? "This question already has a recent reading.");
        return;
      }
      if (!response.ok || !payload.ceremony) {
        send({ type: "CHANGE_SPREAD" });
        send({ type: "REVISE_QUESTION" });
        throw new Error(
          payload.safety?.guidance ?? payload.error ?? "Unable to prepare the reading.",
        );
      }
      const nonce = createClientDrawNonce();
      setCeremony(payload.ceremony);
      setSelectedIndexes([]);
      clientNonce.current = nonce;
      stirCount.current = 0;
      savePendingCeremony({
        token: payload.ceremony.token,
        stage: "shuffling",
        clientNonce: nonce,
        stirCount: 0,
        selectedIndexes: [],
      });
      if (continueAsReflection) send({ type: "CONTINUE_AS_REFLECTION" });
      else send({ type: "SAFETY_APPROVED" });
      send({ type: "FOCUS_COMPLETE" });
    } catch (cause) {
      setMessage(cause instanceof Error ? cause.message : "Unable to prepare the reading.");
    } finally {
      setLoading(false);
    }
  };

  const finalizeDraw = useCallback(
    async (picks: readonly number[]) => {
      if (!ceremony || loading || picks.length !== ceremony.spread.positions.length) return;
      const pendingNonce = clientNonce.current ?? createClientDrawNonce();
      clientNonce.current = pendingNonce;
      setLoading(true);
      setMessage(undefined);
      send({ type: "SELECTION_COMPLETE" });
      try {
        const response = await fetch("/api/readings", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            action: "finalize",
            ceremonyToken: ceremony.token,
            clientNonce: pendingNonce,
            cutIndex: 0,
            selectedIndexes: picks,
          }),
        });
        const payload = (await response.json()) as { readingId?: string; error?: string };
        if (!response.ok || !payload.readingId)
          throw new Error(payload.error ?? "The selected cards could not be locked.");
        clearPendingCeremony();
        if (sound) playRitualSound("deal");
        send({ type: "DRAW_LOCKED" });
        router.push(`/session/${payload.readingId}`);
      } catch (cause) {
        send({ type: "FINALIZATION_FAILED" });
        setMessage(
          cause instanceof Error ? cause.message : "The selected cards could not be locked.",
        );
      } finally {
        setLoading(false);
      }
    },
    [ceremony, loading, router, send, sound],
  );

  useEffect(() => {
    if (
      !state.matches("selectingCards") ||
      !ceremony ||
      selectedIndexes.length !== ceremony.spread.positions.length ||
      loading
    )
      return;
    const timer = window.setTimeout(
      () => void finalizeDraw(selectedIndexes),
      reducedMotion ? 0 : 850,
    );
    return () => window.clearTimeout(timer);
  }, [ceremony, finalizeDraw, loading, reducedMotion, selectedIndexes, state]);

  if (safetyInterrupt)
    return (
      <SafetyInterruptPanel
        category={safetyInterrupt.category}
        guidance={safetyInterrupt.guidance}
      />
    );

  const readingSetupFocus =
    state.matches("shuffling") || state.matches("selectingCards") || state.matches("drawFinalizing")
      ? "cards"
      : "ambient";

  const saveCurrentCeremony = (stage: CeremonyStage, picks = selectedIndexes) => {
    if (!ceremony) return;
    const nonce = clientNonce.current ?? createClientDrawNonce();
    clientNonce.current = nonce;
    savePendingCeremony({
      token: ceremony.token,
      stage,
      clientNonce: nonce,
      stirCount: stirCount.current,
      selectedIndexes: [...picks],
    });
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
      />

      {state.matches("questionDrafting") && (
        <section className="minimal-question-stage">
          <h1>What question did you have for the stars today?</h1>
          <form
            className="minimal-question-form"
            onSubmit={(event) => {
              event.preventDefault();
              void prepareRitual();
            }}
          >
            <textarea
              aria-label="Your question for the stars"
              autoFocus
              disabled={access.outcome !== "granted" || loading}
              maxLength={500}
              onChange={(event) => setQuestion(event.target.value)}
              value={question}
            />
            <button disabled={!question.trim() || loading} type="submit">
              <span className="sr-only">Send question</span>
              <span aria-hidden="true">➤</span>
            </button>
          </form>
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

      {(state.matches("shuffling") || state.matches("selectingCards")) && ceremony && (
        <section className="reading-entry-stage casino-wash-stage">
          <CasinoWashDeck
            onFinishWash={() => {
              saveCurrentCeremony("selectingCards");
              if (sound) playRitualSound("gather");
              send({ type: "SHUFFLE_COMPLETE" });
            }}
            onSelect={(index) => {
              const next = [...selectedIndexes, index];
              setSelectedIndexes(next);
              saveCurrentCeremony("selectingCards", next);
              if (sound) playRitualSound("reveal", next.length - 1);
            }}
            onStir={stirPendingDeck}
            phase={state.matches("shuffling") ? "washing" : "selecting"}
            positions={ceremony.spread.positions}
            reducedMotion={reducedMotion}
            selectedIndexes={selectedIndexes}
          />
        </section>
      )}

      {state.matches("drawFinalizing") && (
        <div className="sanctuary-loading" role="status">
          <span aria-hidden="true">✦</span>
          Locking your selected cards…
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

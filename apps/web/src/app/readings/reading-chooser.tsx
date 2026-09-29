"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { useMachine } from "@xstate/react";
import { SAFETY_USER_MESSAGES, type SafetyCategory } from "@starguidance/ai";
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
import { requestJson, sendJson } from "@/lib/client-request";
import { motionTiming } from "@/lib/motion";
import { useReadingPreferences, type ReadingPreferenceSeed } from "@/lib/reading-preferences";

import { hardNavigate } from "../session/[id]/hard-navigate";
import {
  personalizationEnabledOnDevice,
  reversalsEnabledOnDevice,
} from "../settings/account/reading-experience";

import {
  SanctuaryFrame,
  SanctuaryFrameHost,
  type AnimationVariant,
} from "../session/[id]/mystic-sanctuary-scene";
import { QuestionComposer } from "../session/[id]/question-composer";
import { PREFILL_QUESTION_KEY, ReadingScene } from "../session/[id]/reading-scene";
import type { ReadingPayload } from "../session/[id]/reading-types";
import { playRitualSound, useRitualAmbience } from "../session/[id]/ritual-audio";
import { RitualControls } from "../session/[id]/ritual-controls";
import { SafetyInterruptPanel } from "../session/[id]/safety-interrupt-panel";
import {
  awaitCasinoPickFlights,
  CasinoWashDeck,
  measureCasinoPickHandoff,
  spreadLayoutFor,
} from "../session/[id]/shuffle-shells";
import type { CardHandoffOrigin } from "../session/[id]/stage-flip";
import { SpreadSlotGhost, type SpreadSlot } from "../session/[id]/tarot-spread-stage";

const CEREMONY_STORAGE_KEY = "starguidance:pending-draw-ceremony:v2";
const LEGACY_CEREMONY_STORAGE_KEY = "starguidance:pending-draw-ceremony:v1";

type CeremonyStage = "focusing" | "shuffling" | "selectingCards" | "optionalCut";

interface PendingCeremonyReceipt {
  token: string;
  stage: CeremonyStage;
  clientNonce?: string;
  stirCount?: number;
  selectedIndexes?: number[];
  /** Whether the reader chose to continue a guarded question as reflection. */
  reflection?: boolean;
}

const EXAMPLE_QUESTIONS = [
  "What should I understand about where my work is heading?",
  "What would help me through this change in my relationship?",
  "What am I not seeing about the choice in front of me?",
] as const;

/** Plain words for each guarded topic, used in "This is a question about …". */
const GUARDED_TOPIC: Partial<Record<SafetyCategory, string>> = {
  medical: "your health",
  legal: "a legal matter",
  financial: "money and investments",
  pregnancy: "a pregnancy",
  physicalDeath: "life and death",
  criminalGuilt: "guilt or a crime",
  infidelity: "faithfulness in a relationship",
  mentalHealthDiagnosis: "a mental health diagnosis",
  thirdPartyPrivateClaim: "someone else’s private life",
};

type FinalizeFailure =
  | { kind: "retry"; message: string }
  | { kind: "reshuffle"; message: string }
  | { kind: "restart"; message: string }
  | { kind: "allowance"; message: string; windowEndsAt?: string }
  | { kind: "retained"; message: string; readingId: string; availableAt: string };

function savePendingCeremony(receipt: PendingCeremonyReceipt) {
  try {
    window.sessionStorage.setItem(CEREMONY_STORAGE_KEY, JSON.stringify(receipt));
  } catch {
    // Without storage the ritual still works; it just can't resume a reload.
  }
}

function clearPendingCeremony() {
  try {
    window.sessionStorage.removeItem(CEREMONY_STORAGE_KEY);
    window.sessionStorage.removeItem(LEGACY_CEREMONY_STORAGE_KEY);
  } catch {
    // Nothing to clear.
  }
}

function subscribeToMinutes(onChange: () => void) {
  const interval = window.setInterval(onChange, 30_000);
  return () => window.clearInterval(interval);
}

/** "in 3 hours" / "tomorrow", updated each minute; an absolute date on the
 * server render. */
function RelativeTime({ iso }: { iso: string }) {
  const minute = useSyncExternalStore(
    subscribeToMinutes,
    () => Math.floor(Date.now() / 60_000),
    () => 0,
  );
  const target = Date.parse(iso);
  let label = new Date(iso).toLocaleDateString(undefined, { month: "long", day: "numeric" });
  if (minute > 0 && Number.isFinite(target)) {
    const minutes = Math.round((target - minute * 60_000) / 60_000);
    const format = new Intl.RelativeTimeFormat(undefined, { numeric: "auto" });
    label =
      Math.abs(minutes) < 60
        ? format.format(Math.max(1, minutes), "minute")
        : Math.abs(minutes) < 60 * 36
          ? format.format(Math.round(minutes / 60), "hour")
          : format.format(Math.round(minutes / (60 * 24)), "day");
  }
  return <time dateTime={iso}>{label}</time>;
}

function AllowanceNotice({ windowEndsAt }: { windowEndsAt?: string | null | undefined }) {
  return (
    <div className="reading-allowance-notice" role="status">
      <p>
        You’ve used the readings included for now.
        {windowEndsAt ? (
          <>
            {" "}
            Your next one opens <RelativeTime iso={windowEndsAt} />.
          </>
        ) : null}
      </p>
      <p>
        In the meantime, <Link href="/history">revisit your past readings</Link> — they’re kept just
        as they were drawn.
      </p>
    </div>
  );
}

export function ReadingChooser({
  access,
  animationVariant = "immersive-v1",
  audioAvailable = false,
  initialPreferences,
  sigilSeed,
}: {
  access: ReadingEntitlementDecision;
  animationVariant?: AnimationVariant;
  audioAvailable?: boolean;
  initialPreferences?: ReadingPreferenceSeed;
  sigilSeed: string;
}) {
  const router = useRouter();
  const [state, send] = useMachine(readingMachine);
  /** Once the draw is locked the reading continues in this same scene: the
   * picked cards stay where they are and become the dealt spread. A route
   * change would unmount them and deal a second, unrelated-looking set. */
  const [locked, setLocked] = useState<{
    readingId: string;
    reading: ReadingPayload;
    handoff: readonly CardHandoffOrigin[] | undefined;
  }>();
  const [question, setQuestion] = useState("");
  const [confirmedQuestion, setConfirmedQuestion] = useState("");
  const [reflection, setReflection] = useState(false);
  const [ceremony, setCeremony] = useState<DrawCeremony>();
  const [selectedIndexes, setSelectedIndexes] = useState<number[]>([]);
  const [slots, setSlots] = useState<readonly SpreadSlot[]>();
  const [message, setMessage] = useState<string>();
  const [retained, setRetained] = useState<{ readingId: string; availableAt: string }>();
  const [allowance, setAllowance] = useState<{ windowEndsAt?: string }>();
  const [loading, setLoading] = useState(false);
  const [finalizeFailure, setFinalizeFailure] = useState<FinalizeFailure>();
  const [safetyInterrupt, setSafetyInterrupt] = useState<{
    category: SafetyCategory;
    userMessage?: string;
    recentReadingId?: string;
  }>();
  const [guardedPrompt, setGuardedPrompt] = useState<{ category: SafetyCategory }>();
  /** Session-only fast-forward from the HUD's skip; never saved as a preference. */
  const [fastForward, setFastForward] = useState(false);
  /** The fan's entrance has finished; "Skip ahead" is no longer offered. */
  const [fanSettled, setFanSettled] = useState(false);
  const idempotencyKey = useRef<string>("");
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
  const preferenceOrManagedReducedMotion = preferenceReducedMotion || animationManaged;
  const reducedMotion = preferenceOrManagedReducedMotion || fastForward;
  useRitualAmbience(ambience, String(state.value));

  useEffect(() => {
    idempotencyKey.current = crypto.randomUUID();
    send({ type: "START" });
    send({ type: "DRAFT_QUESTION" });
    // A question handed over from elsewhere: "?q=" or, without putting the
    // words in a URL, sessionStorage (a follow-up that needs a new reading).
    let prefill: string | undefined;
    try {
      const url = new URL(window.location.href);
      const fromQuery = url.searchParams.get("q");
      if (fromQuery) {
        prefill = fromQuery;
        url.searchParams.delete("q");
        window.history.replaceState(window.history.state, "", url.pathname + url.search);
      }
      const fromStorage = window.sessionStorage.getItem(PREFILL_QUESTION_KEY);
      if (fromStorage) {
        prefill ??= fromStorage;
        window.sessionStorage.removeItem(PREFILL_QUESTION_KEY);
      }
    } catch {
      // No prefill available.
    }
    let raw: string | null = null;
    try {
      raw =
        window.sessionStorage.getItem(CEREMONY_STORAGE_KEY) ??
        window.sessionStorage.getItem(LEGACY_CEREMONY_STORAGE_KEY);
    } catch {
      raw = null;
    }
    if (!raw) {
      if (prefill) {
        const text = prefill.slice(0, 500);
        const timer = window.setTimeout(() => setQuestion(text), 0);
        return () => window.clearTimeout(timer);
      }
      return;
    }
    let receipt: PendingCeremonyReceipt;
    try {
      receipt = JSON.parse(raw) as PendingCeremonyReceipt;
    } catch {
      clearPendingCeremony();
      return;
    }
    let active = true;
    void sendJson<{ ceremony?: DrawCeremony; readingId?: string }>("/api/readings", "POST", {
      action: "restore",
      ceremonyToken: receipt.token,
    }).then((result) => {
      if (!active) return;
      if (result.ok && result.data.readingId) {
        clearPendingCeremony();
        router.replace(`/session/${result.data.readingId}`);
        return;
      }
      const restored = result.ok ? result.data.ceremony : undefined;
      if (!restored) {
        clearPendingCeremony();
        setMessage("Your earlier draw couldn’t be picked up again, so let’s begin fresh.");
        return;
      }
      const restoredPicks = (receipt.selectedIndexes ?? []).filter(
        (index, position, indexes) =>
          Number.isInteger(index) &&
          index >= 0 &&
          index < 78 &&
          indexes.indexOf(index) === position &&
          position < restored.spread.positions.length,
      );
      setCeremony(restored);
      setQuestion(restored.question);
      setConfirmedQuestion(restored.question);
      setReflection(receipt.reflection === true);
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
    });
    return () => {
      active = false;
    };
  }, [router, send]);

  useEffect(() => {
    if (!state.matches("selectingCards")) return;
    const timer = window.setTimeout(
      () => setFanSettled(true),
      motionTiming.gather + motionTiming.fan + 77 * motionTiming.fanStagger,
    );
    return () => window.clearTimeout(timer);
  }, [state]);

  /** POSTs `prepare`. Never throws. */
  const requestPrepare = (finalQuestion: string, continueAsReflection: boolean) => {
    // Device-only choices from Settings; both default to the full reading.
    const reversalMode: ReversalMode = reversalsEnabledOnDevice()
      ? "reversals_enabled"
      : "upright_only";
    const personalizationMode: PersonalizationMode = personalizationEnabledOnDevice()
      ? "personalized_tarot"
      : "pure_tarot";
    return sendJson<{
      ceremony?: DrawCeremony;
      readingId?: string;
      cooldownActive?: boolean;
      retainedReadingId?: string;
      availableAt?: string;
      entitlementDecision?: ReadingEntitlementDecision;
      safety?: {
        category: SafetyCategory;
        interrupt: boolean;
        userMessage?: string;
      };
      reflectionAcknowledgementRequired?: boolean;
    }>(
      "/api/readings",
      "POST",
      {
        action: "prepare",
        question: finalQuestion,
        questionConfirmed: true,
        reversalMode,
        personalizationMode,
        continueAsReflection,
      },
      { headers: { "idempotency-key": idempotencyKey.current }, timeoutMs: 30_000 },
    );
  };

  const beginCeremony = (prepared: DrawCeremony, continueAsReflection: boolean) => {
    const nonce = createClientDrawNonce();
    setCeremony(prepared);
    setSelectedIndexes([]);
    setFinalizeFailure(undefined);
    clientNonce.current = nonce;
    stirCount.current = 0;
    savePendingCeremony({
      token: prepared.token,
      stage: "shuffling",
      clientNonce: nonce,
      stirCount: 0,
      selectedIndexes: [],
      reflection: continueAsReflection,
    });
  };

  const findRecentReadingId = async () => {
    const result = await requestJson<{ readings?: { id: string; createdAt: string }[] }>(
      "/api/readings",
      { cache: "no-store" },
    );
    if (!result.ok) return undefined;
    return [...(result.data.readings ?? [])].sort(
      (left, right) => Date.parse(right.createdAt) - Date.parse(left.createdAt),
    )[0]?.id;
  };

  const prepareRitual = async (continueAsReflection = false) => {
    const finalQuestion = (continueAsReflection ? confirmedQuestion : question).trim();
    if (!finalQuestion || loading) return;
    setLoading(true);
    setMessage(undefined);
    setRetained(undefined);
    setAllowance(undefined);
    // The question stays on screen, busy, until the server answers; the
    // ritual only moves on once there is a deck to shuffle.
    const result = await requestPrepare(finalQuestion, continueAsReflection);
    if (result.status === 401) return hardNavigate("/sign-in");
    if (result.status === 428) return hardNavigate("/consent");
    const data = result.data as {
      ceremony?: DrawCeremony;
      readingId?: string;
      cooldownActive?: boolean;
      retainedReadingId?: string;
      availableAt?: string;
      entitlementDecision?: ReadingEntitlementDecision;
      safety?: { category: SafetyCategory; interrupt: boolean; userMessage?: string };
      reflectionAcknowledgementRequired?: boolean;
    };
    if (data.readingId) {
      clearPendingCeremony();
      hardNavigate(`/session/${data.readingId}`);
      return;
    }
    if (data.safety?.interrupt) {
      const recentReadingId =
        data.safety.category === "compulsiveReading" ? await findRecentReadingId() : undefined;
      setLoading(false);
      setSafetyInterrupt({
        category: data.safety.category,
        ...(data.safety.userMessage ? { userMessage: data.safety.userMessage } : {}),
        ...(recentReadingId ? { recentReadingId } : {}),
      });
      return;
    }
    setLoading(false);
    if (data.reflectionAcknowledgementRequired && data.safety) {
      setConfirmedQuestion(finalQuestion);
      send({ type: "CONFIRM_QUESTION" });
      send({ type: "CONFIRM_SPREAD" });
      send({ type: "HIGH_STAKES" });
      setGuardedPrompt({ category: data.safety.category });
      return;
    }
    if (data.cooldownActive && data.retainedReadingId && data.availableAt) {
      if (continueAsReflection) send({ type: "REVISE_QUESTION" });
      setGuardedPrompt(undefined);
      setRetained({ readingId: data.retainedReadingId, availableAt: data.availableAt });
      return;
    }
    if (!result.ok && data.entitlementDecision?.outcome === "limitReached") {
      if (continueAsReflection) send({ type: "REVISE_QUESTION" });
      setGuardedPrompt(undefined);
      setAllowance(
        data.entitlementDecision.windowEndsAt
          ? { windowEndsAt: data.entitlementDecision.windowEndsAt }
          : {},
      );
      return;
    }
    if (!result.ok || !data.ceremony) {
      // Back to the question, words intact, with a way to try again.
      if (continueAsReflection) send({ type: "REVISE_QUESTION" });
      setGuardedPrompt(undefined);
      setMessage(result.ok ? "The deck could not be prepared. Please try again." : result.error);
      return;
    }
    setConfirmedQuestion(finalQuestion);
    setReflection(continueAsReflection);
    setGuardedPrompt(undefined);
    beginCeremony(data.ceremony, continueAsReflection);
    if (continueAsReflection) send({ type: "CONTINUE_AS_REFLECTION" });
    else {
      send({ type: "CONFIRM_QUESTION" });
      send({ type: "CONFIRM_SPREAD" });
      send({ type: "SAFETY_APPROVED" });
    }
    send({ type: "FOCUS_COMPLETE" });
  };

  /** A fresh ceremony for the same question after a draw could not be kept.
   * No card identity existed yet, so nothing drawn is discarded. */
  const reshuffleFreshDeck = async () => {
    if (loading) return;
    setLoading(true);
    setFinalizeFailure(undefined);
    idempotencyKey.current = crypto.randomUUID();
    const result = await requestPrepare(confirmedQuestion, reflection);
    setLoading(false);
    const prepared = result.ok ? result.data.ceremony : undefined;
    if (!prepared) {
      setFinalizeFailure({
        kind: result.status === 0 || result.status >= 500 ? "reshuffle" : "restart",
        message: result.ok ? "The deck could not be prepared. Please try again." : result.error,
      });
      return;
    }
    setSlots(undefined);
    beginCeremony(prepared, reflection);
    send({ type: "RESHUFFLE" });
  };

  const startOver = () => {
    clearPendingCeremony();
    hardNavigate("/readings");
  };

  const finalizeDraw = useCallback(
    async (picks: readonly number[]) => {
      if (!ceremony || loading || picks.length !== ceremony.spread.positions.length) return;
      const pendingNonce = clientNonce.current ?? createClientDrawNonce();
      clientNonce.current = pendingNonce;
      setLoading(true);
      setMessage(undefined);
      setFinalizeFailure(undefined);
      send({ type: "SELECTION_COMPLETE" });
      const result = await sendJson<{ readingId?: string }>(
        "/api/readings",
        "POST",
        {
          action: "finalize",
          ceremonyToken: ceremony.token,
          clientNonce: pendingNonce,
          cutIndex: 0,
          selectedIndexes: picks,
        },
        { timeoutMs: 45_000 },
      );
      if (!result.ok || !result.data.readingId) {
        // Back to the picked cards, without trying again on its own.
        send({ type: "FINALIZATION_FAILED" });
        setLoading(false);
        const data = result.ok ? {} : result.data;
        const entitlement = data["entitlementDecision"] as ReadingEntitlementDecision | undefined;
        const message = result.ok
          ? "Your cards could not be kept. Please try again."
          : result.error;
        if (result.status === 401) return hardNavigate("/sign-in");
        if (result.status === 428) return hardNavigate("/consent");
        if (entitlement?.outcome === "limitReached")
          setFinalizeFailure({
            kind: "allowance",
            message,
            ...(entitlement.windowEndsAt ? { windowEndsAt: entitlement.windowEndsAt } : {}),
          });
        else if (
          data["cooldownActive"] === true &&
          typeof data["retainedReadingId"] === "string" &&
          typeof data["availableAt"] === "string"
        )
          setFinalizeFailure({
            kind: "retained",
            message,
            readingId: data["retainedReadingId"],
            availableAt: data["availableAt"],
          });
        else if (result.status === 409 || result.status === 410)
          setFinalizeFailure({ kind: "restart", message });
        else if (result.status === 400)
          setFinalizeFailure({
            kind: "reshuffle",
            message: "This deck can no longer be drawn from. Shuffle a fresh one to continue.",
          });
        else setFinalizeFailure({ kind: "retry", message });
        return;
      }
      clearPendingCeremony();
      if (sound) playRitualSound("deal");
      send({ type: "DRAW_LOCKED" });
      const readingId = result.data.readingId;
      const recovered = await requestJson<{ reading: ReadingPayload }>(
        `/api/readings/${readingId}`,
        { cache: "no-store" },
      );
      setLoading(false);
      if (!recovered.ok) {
        // The session route recovers the kept draw on its own.
        hardNavigate(`/session/${readingId}`);
        return;
      }
      await awaitCasinoPickFlights();
      const handoff = measureCasinoPickHandoff(ceremony.spread.positions);
      window.history.replaceState(null, "", `/session/${readingId}`);
      setLocked({ readingId, reading: recovered.data.reading, handoff });
    },
    [ceremony, loading, send, sound],
  );

  if (safetyInterrupt)
    return (
      <SafetyInterruptPanel
        category={safetyInterrupt.category}
        exitHref="/history"
        exitLabel="See your past readings"
        onRevise={() => {
          setSafetyInterrupt(undefined);
          setGuardedPrompt(undefined);
        }}
        {...(safetyInterrupt.recentReadingId
          ? { recentReadingHref: `/reading/${safetyInterrupt.recentReadingId}` }
          : {})}
        {...(safetyInterrupt.userMessage ? { userMessage: safetyInterrupt.userMessage } : {})}
      />
    );

  const deckVisible =
    state.matches("shuffling") ||
    state.matches("selectingCards") ||
    state.matches("drawFinalizing") ||
    state.matches("drawLocked");
  const readingSetupFocus = deckVisible ? "cards" : "ambient";
  const fanOpening = state.matches("selectingCards") && !reducedMotion && !fanSettled;

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
      reflection,
    });
  };

  const stirPendingDeck = () => {
    const pendingNonce = clientNonce.current ?? createClientDrawNonce();
    clientNonce.current = stirClientDrawNonce(pendingNonce);
    stirCount.current += 1;
    saveCurrentCeremony("shuffling");
    if (sound) playRitualSound("shuffle");
  };

  const finishWash = () => {
    saveCurrentCeremony("selectingCards");
    if (sound) playRitualSound("gather");
    send({ type: "SHUFFLE_COMPLETE" });
  };

  const skipAvailable = state.matches("shuffling") || (fanOpening && !fastForward);
  const handleSkip = () => {
    setFastForward(true);
    if (state.matches("shuffling")) finishWash();
  };
  const allowanceWindow = allowance?.windowEndsAt ?? access.windowEndsAt ?? undefined;
  const limitReached = access.outcome === "limitReached" || Boolean(allowance);

  return (
    <SanctuaryFrameHost
      animationVariant={animationVariant}
      initialFrame={{
        backdrop: "sanctuary",
        focusStage: "ambient",
        phase: String(state.value),
        reducedMotion,
      }}
      testId="mystic-sanctuary-scene"
    >
      {locked ? (
        <ReadingScene
          animationVariant={animationVariant}
          audioAvailable={audioAvailable}
          handoff={locked.handoff}
          initialReading={locked.reading}
          {...(initialPreferences ? { initialPreferences } : {})}
          readingId={locked.readingId}
        />
      ) : (
        <SanctuaryFrame
          backdrop={readingSetupFocus === "cards" ? "starry-reading" : "sanctuary"}
          focusStage={readingSetupFocus}
          phase={String(state.value)}
          reducedMotion={reducedMotion}
        >
          <RitualControls
            ambience={ambience}
            animationManaged={animationManaged}
            controlsLabel="Reading setup controls"
            displayName={displayName}
            exitHard
            exitHref="/history"
            menu
            narration={narration}
            reducedMotion={preferenceOrManagedReducedMotion}
            sigilSeed={sigilSeed}
            sound={sound}
            toggleAmbience={toggleAmbience}
            toggleNarration={toggleNarration}
            toggleReducedMotion={toggleReducedMotion}
            toggleSound={toggleSound}
            {...(skipAvailable
              ? {
                  onSkip: handleSkip,
                  skipLabel: state.matches("shuffling") ? "Skip the shuffle" : "Skip ahead",
                }
              : {})}
          />

          {state.matches("questionDrafting") && (
            <section className="minimal-question-stage" aria-busy={loading}>
              <h1>What would you like to ask the cards?</h1>
              <p className="question-stage-hint">
                Open questions work best: “What should I understand about…”
              </p>
              <QuestionComposer
                autoFocus
                disabled={access.outcome !== "granted" || limitReached}
                disabledReason="You’ve used the readings included for now — see below for when the next one opens."
                label="Your question for the stars"
                loading={loading}
                mentions
                onChange={setQuestion}
                onSubmit={() => prepareRitual()}
                placeholder="What should I understand about…"
                showSubmitLabel
                submitLabel="Draw my cards"
                testId="reading-question-composer"
                value={question}
                variant="primary"
              />
              {!limitReached && !loading && !question.trim() && (
                <div aria-label="Example questions" className="question-examples" role="group">
                  {EXAMPLE_QUESTIONS.map((example) => (
                    <button key={example} onClick={() => setQuestion(example)} type="button">
                      {example}
                    </button>
                  ))}
                </div>
              )}
              {loading && (
                <p className="question-stage-status" role="status">
                  <span aria-hidden="true">✦</span> Consulting the deck…
                </p>
              )}
              {message && (
                <div className="sanctuary-error" role="alert">
                  <p>{message}</p>
                  {!retained && question.trim() && (
                    <button
                      className="ritual-action"
                      onClick={() => void prepareRitual()}
                      type="button"
                    >
                      Try again
                    </button>
                  )}
                </div>
              )}
              {retained && (
                <div className="reading-allowance-notice" role="status">
                  <p>
                    You asked this recently. Sit with the cards you already drew before asking again
                    — a new draw opens <RelativeTime iso={retained.availableAt} />.
                  </p>
                  <p>
                    <Link href={`/reading/${retained.readingId}`}>Open that reading</Link>
                  </p>
                </div>
              )}
              {limitReached && <AllowanceNotice windowEndsAt={allowanceWindow} />}
            </section>
          )}

          {state.matches("highStakesQuestion") && guardedPrompt && (
            <section className="reading-entry-stage reading-question-stage">
              <div className="ritual-moment" data-safety-category={guardedPrompt.category}>
                <h2 className="guarded-question-heading">
                  This is a question about{" "}
                  {GUARDED_TOPIC[guardedPrompt.category] ?? "something the cards can’t decide"}
                </h2>
                <blockquote className="guarded-question-echo">{confirmedQuestion}</blockquote>
                <p className="ritual-status" role="status">
                  {SAFETY_USER_MESSAGES[guardedPrompt.category]}
                </p>
                <p className="guarded-question-offer">
                  The cards can still reflect on your choices and feelings with you. Continue as a
                  reflection, or ask it a different way.
                </p>
                <div className="ritual-action-group">
                  <button
                    className="ritual-action"
                    disabled={loading}
                    onClick={() => void prepareRitual(true)}
                    type="button"
                  >
                    {loading ? "Preparing your reflection…" : "Continue as reflection"}
                  </button>
                  <button
                    className="ritual-action is-quiet"
                    disabled={loading}
                    onClick={() => {
                      setGuardedPrompt(undefined);
                      send({ type: "REVISE_QUESTION" });
                    }}
                    type="button"
                  >
                    Revise the question
                  </button>
                </div>
                {message && (
                  <p className="sanctuary-error" role="alert">
                    {message}
                  </p>
                )}
              </div>
            </section>
          )}

          {deckVisible && ceremony && (
            <SpreadSlotGhost
              layout={spreadLayoutFor(ceremony.spread)}
              onMeasure={setSlots}
              positions={ceremony.spread.positions}
            />
          )}
          {deckVisible && ceremony && (
            <section className="reading-entry-stage casino-wash-stage">
              <CasinoWashDeck
                confirming={state.matches("drawFinalizing") || state.matches("drawLocked")}
                key={ceremony.token}
                onConfirm={() => void finalizeDraw(selectedIndexes)}
                onDeselect={(index) => {
                  const next = selectedIndexes.filter((picked) => picked !== index);
                  setSelectedIndexes(next);
                  setFinalizeFailure(undefined);
                  saveCurrentCeremony("selectingCards", next);
                }}
                onFinishWash={finishWash}
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
                slots={slots}
              />
              {finalizeFailure && (
                <div className="finalize-failure" role="alert">
                  <p>{finalizeFailure.message}</p>
                  {finalizeFailure.kind === "allowance" && (
                    <AllowanceNotice windowEndsAt={finalizeFailure.windowEndsAt} />
                  )}
                  {finalizeFailure.kind === "retained" && (
                    <p>
                      <Link href={`/reading/${finalizeFailure.readingId}`}>
                        Open your recent reading
                      </Link>
                    </p>
                  )}
                  <div className="ritual-action-group">
                    {finalizeFailure.kind === "retry" && (
                      <button
                        className="ritual-action"
                        disabled={loading}
                        onClick={() => void finalizeDraw(selectedIndexes)}
                        type="button"
                      >
                        Try again
                      </button>
                    )}
                    {(finalizeFailure.kind === "retry" || finalizeFailure.kind === "reshuffle") && (
                      <button
                        className="ritual-action is-quiet"
                        disabled={loading}
                        onClick={() => void reshuffleFreshDeck()}
                        type="button"
                      >
                        {loading ? "Shuffling…" : "Shuffle a fresh deck"}
                      </button>
                    )}
                    {finalizeFailure.kind === "restart" && (
                      <button className="ritual-action" onClick={startOver} type="button">
                        Start over
                      </button>
                    )}
                  </div>
                </div>
              )}
            </section>
          )}

          {!state.matches("questionDrafting") &&
            message &&
            !state.matches("highStakesQuestion") && (
              <div className="sanctuary-error" role="alert">
                <p>{message}</p>
              </div>
            )}
        </SanctuaryFrame>
      )}
    </SanctuaryFrameHost>
  );
}

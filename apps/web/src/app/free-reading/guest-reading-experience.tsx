"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useMachine } from "@xstate/react";
import type { SafetyCategory } from "@starguidance/ai";
import {
  GENERAL_READING_QUESTION,
  drawCeremonySchema,
  type DrawCeremony,
  type OracleStreamEvent,
  type PersonalizationMode,
  type ReversalMode,
} from "@starguidance/contracts";
import { readingMachine } from "@starguidance/reading-machine";

import {
  createClientDrawNonce,
  isClientDrawNonce,
  stirClientDrawNonce,
} from "@/lib/client-draw-entropy";
import {
  GUEST_DEVICE_HEADER,
  GUEST_DEVICE_STORAGE_KEY,
  GUEST_READING_RECEIPT_KEY,
  GUEST_READING_SESSION_KEY,
  GUEST_TRIAL_LOCAL_MARKER_KEY,
  guestDeviceIdSchema,
  guestFollowUpResponseSchema,
  guestReadingDisplaySchema,
  guestReadingResponseSchema,
  type GuestFollowUpResponse,
  type GuestReadingDisplay,
} from "@/lib/guest-reading-contract";

import { MysticSanctuaryScene } from "../session/[id]/mystic-sanctuary-scene";
import { OracleTranscript } from "../session/[id]/oracle-transcript";
import { QuestionComposer } from "../session/[id]/question-composer";
import { SafetyInterruptPanel } from "../session/[id]/safety-interrupt-panel";
import { ImmersiveCutDeck, ImmersiveShuffleDeck } from "../session/[id]/shuffle-shells";
import { TarotSpreadStage } from "../session/[id]/tarot-spread-stage";

type PhaseEvent = Extract<OracleStreamEvent, { type: "phase" }>;
type CeremonyStage = "focusing" | "shuffling" | "optionalCut";

type PendingGuestSession =
  | {
      kind: "ceremony";
      token: string;
      stage: CeremonyStage;
      clientNonce?: string;
      stirCount?: number;
    }
  | {
      kind: "receipt";
      receipt: string;
      revealedIndexes: number[];
      resultUnlocked: boolean;
    };

interface QuestionReview {
  encouragedForm: boolean;
  reformulationReason?: "binary" | "deterministic" | "third_party_private";
  suggestedQuestion?: string;
}

interface FreeSpread {
  id: "three-card" | "one-card";
  version: string;
  name: string;
  purpose: string;
  estimatedMinutes: number;
  count: number;
  positions: readonly {
    id: string;
    displayName: string;
    interpretiveFunction: string;
    description: string;
    order: number;
  }[];
}

const continuationPath = "/free-reading?continue=1";
const signupHref = `/sign-up?next=${encodeURIComponent(continuationPath)}`;
const signInHref = `/sign-in?next=${encodeURIComponent(continuationPath)}`;

function storedDeviceId(): string {
  try {
    const existing = guestDeviceIdSchema.safeParse(localStorage.getItem(GUEST_DEVICE_STORAGE_KEY));
    if (existing.success) return existing.data;
    const created = crypto.randomUUID();
    localStorage.setItem(GUEST_DEVICE_STORAGE_KEY, created);
    return created;
  } catch {
    return crypto.randomUUID();
  }
}

function readPendingSession(): PendingGuestSession | undefined {
  try {
    const raw = sessionStorage.getItem(GUEST_READING_SESSION_KEY);
    if (!raw) return undefined;
    const value = JSON.parse(raw) as Partial<PendingGuestSession>;
    if (
      value.kind === "ceremony" &&
      typeof value.token === "string" &&
      ["focusing", "shuffling", "optionalCut"].includes(String(value.stage))
    )
      return value as PendingGuestSession;
    if (
      value.kind === "receipt" &&
      typeof value.receipt === "string" &&
      Array.isArray(value.revealedIndexes) &&
      typeof value.resultUnlocked === "boolean"
    )
      return value as PendingGuestSession;
  } catch {
    // Invalid local recovery state is ignored; the signed cookie still protects trial use.
  }
  return undefined;
}

function savePendingSession(value: PendingGuestSession) {
  try {
    sessionStorage.setItem(GUEST_READING_SESSION_KEY, JSON.stringify(value));
  } catch {
    // The in-memory ritual remains usable when session storage is unavailable.
  }
}

function phaseEvents(reading: GuestReadingDisplay): readonly PhaseEvent[] {
  return (reading.previewEvents ?? []).filter(
    (event): event is PhaseEvent => event.type === "phase",
  );
}

export function GuestReadingExperience({
  authenticated,
  continueRequested,
  hasProfile,
  requiresPolicyReconsent,
  spreads,
}: {
  authenticated: boolean;
  continueRequested: boolean;
  hasProfile: boolean;
  requiresPolicyReconsent: boolean;
  spreads: readonly FreeSpread[];
}) {
  const [state, send] = useMachine(readingMachine);
  const defaultSpread = spreads.find(({ id }) => id === "three-card") ?? spreads[0];
  const [selected, setSelected] = useState<FreeSpread["id"]>(defaultSpread?.id ?? "three-card");
  const [birthDate, setBirthDate] = useState("");
  const [question, setQuestion] = useState("");
  const [confirmedQuestion, setConfirmedQuestion] = useState("");
  const [questionReview, setQuestionReview] = useState<QuestionReview>();
  const [termsAccepted, setTermsAccepted] = useState(false);
  const [privacyAccepted, setPrivacyAccepted] = useState(false);
  const [ageConfirmed, setAgeConfirmed] = useState(false);
  const [reversalMode, setReversalMode] = useState<ReversalMode>("reversals_enabled");
  const [personalizationMode, setPersonalizationMode] =
    useState<PersonalizationMode>("personalized_tarot");
  const [deviceId, setDeviceId] = useState<string>();
  const [ceremony, setCeremony] = useState<DrawCeremony>();
  const [reading, setReading] = useState<GuestReadingDisplay>();
  const [receipt, setReceipt] = useState<string>();
  const [trialUsed, setTrialUsed] = useState(false);
  const [bootstrapLoading, setBootstrapLoading] = useState(!continueRequested);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string>();
  const [safetyInterrupt, setSafetyInterrupt] = useState<{
    category: SafetyCategory;
    guidance: string;
  }>();
  const [guardedPrompt, setGuardedPrompt] = useState<{ category: SafetyCategory }>();
  const [reducedMotion, setReducedMotion] = useState(false);
  const [dealtCount, setDealtCount] = useState(0);
  const [revealed, setRevealed] = useState<Set<number>>(new Set());
  const revealedRef = useRef<ReadonlySet<number>>(revealed);
  const [activeReveal, setActiveReveal] = useState<number | null>(null);
  const [activeReadingCard, setActiveReadingCard] = useState<number | null>(null);
  const [journeyComplete, setJourneyComplete] = useState(false);
  const [continuationReading, setContinuationReading] = useState<GuestReadingDisplay>();
  const [continuationLoading, setContinuationLoading] = useState(continueRequested);
  const [followUp, setFollowUp] = useState("");
  const [followUpResult, setFollowUpResult] = useState<GuestFollowUpResponse>();
  const [followUpLoading, setFollowUpLoading] = useState(false);
  const bootstrapped = useRef(false);
  const resultUnlockStarted = useRef(false);
  const clientNonce = useRef<string | undefined>(undefined);
  const stirCount = useRef(0);

  const selectedSpread = useMemo(
    () => spreads.find(({ id }) => id === selected) ?? spreads[0],
    [selected, spreads],
  );
  const consentsReady = termsAccepted && privacyAccepted && ageConfirmed;
  const intakeReady = consentsReady && Boolean(birthDate) && Boolean(question.trim());
  const continuationReadingRevealed = useMemo(
    () => new Set(continuationReading?.cards.map((_, index) => index) ?? []),
    [continuationReading],
  );
  const readingPreviewEvents = useMemo(() => (reading ? phaseEvents(reading) : []), [reading]);

  useEffect(() => {
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setReducedMotion(media.matches);
    update();
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);

  useEffect(() => {
    if (bootstrapped.current) return;
    bootstrapped.current = true;
    const device = storedDeviceId();
    setDeviceId(device);
    if (continueRequested) return;
    const controller = new AbortController();
    void (async () => {
      const pending = readPendingSession();
      let localReceipt: string | undefined;
      try {
        localReceipt = localStorage.getItem(GUEST_READING_RECEIPT_KEY) ?? undefined;
      } catch {
        // The server marker remains authoritative when local storage is unavailable.
      }
      try {
        if (pending?.kind === "ceremony") {
          const response = await fetch("/api/guest-readings", {
            method: "POST",
            headers: { "content-type": "application/json", [GUEST_DEVICE_HEADER]: device },
            body: JSON.stringify({ action: "restore", ceremonyToken: pending.token }),
            signal: controller.signal,
          });
          const payload = (await response.json()) as { ceremony?: unknown; error?: string };
          if (!response.ok || !payload.ceremony)
            throw new Error(payload.error ?? "The pending guest ritual expired.");
          const restored = drawCeremonySchema.parse(payload.ceremony);
          setCeremony(restored);
          setQuestion(restored.question);
          setConfirmedQuestion(restored.question);
          setSelected(restored.spread.id as FreeSpread["id"]);
          setReversalMode(restored.configuration.reversalMode);
          setPersonalizationMode(restored.configuration.personalizationMode);
          clientNonce.current = isClientDrawNonce(pending.clientNonce)
            ? pending.clientNonce
            : createClientDrawNonce();
          stirCount.current =
            Number.isSafeInteger(pending.stirCount) && (pending.stirCount ?? -1) >= 0
              ? (pending.stirCount ?? 0)
              : 0;
          send({ type: "START" });
          send({ type: "DRAFT_QUESTION" });
          send({ type: "CONFIRM_QUESTION" });
          send({ type: "CONFIRM_SPREAD" });
          send({ type: "SAFETY_APPROVED" });
          if (pending.stage === "shuffling" || pending.stage === "optionalCut")
            send({ type: "FOCUS_COMPLETE" });
          if (pending.stage === "optionalCut") send({ type: "SHUFFLE_COMPLETE" });
          return;
        }

        const recoveryReceipt = pending?.kind === "receipt" ? pending.receipt : localReceipt;
        if (recoveryReceipt) {
          const resultUnlocked = pending?.kind === "receipt" && pending.resultUnlocked;
          const response = await fetch("/api/guest-readings", {
            method: "POST",
            headers: { "content-type": "application/json", [GUEST_DEVICE_HEADER]: device },
            body: JSON.stringify({
              action: resultUnlocked ? "reveal" : "recover",
              receipt: recoveryReceipt,
            }),
            signal: controller.signal,
          });
          const payload = guestReadingResponseSchema.safeParse(await response.json());
          if (response.ok && payload.success) {
            const restoredIndexes =
              pending?.kind === "receipt"
                ? pending.revealedIndexes.filter(
                    (index) => index >= 0 && index < payload.data.reading.cards.length,
                  )
                : [];
            const restoredSet = new Set(restoredIndexes);
            revealedRef.current = restoredSet;
            setRevealed(restoredSet);
            setReceipt(recoveryReceipt);
            setReading(payload.data.reading);
            setTrialUsed(true);
            send({ type: "START" });
            send({ type: "RESTORE_LOCKED" });
            return;
          }
        }

        send({ type: "START" });
        send({ type: "DRAFT_QUESTION" });
        const response = await fetch("/api/guest-readings", {
          cache: "no-store",
          headers: { [GUEST_DEVICE_HEADER]: device },
          signal: controller.signal,
        });
        const payload = (await response.json()) as {
          eligible?: boolean;
          signupRequired?: boolean;
          error?: string;
        };
        if (!response.ok) throw new Error(payload.error ?? "Free-reading access is unavailable.");
        setTrialUsed(payload.signupRequired === true || payload.eligible === false);
      } catch (cause) {
        if (!controller.signal.aborted) {
          send({ type: "START" });
          send({ type: "DRAFT_QUESTION" });
          setError(
            cause instanceof Error ? cause.message : "The guest ritual could not be restored.",
          );
        }
      } finally {
        if (!controller.signal.aborted) setBootstrapLoading(false);
      }
    })();
    return () => controller.abort();
  }, [continueRequested, send]);

  useEffect(() => {
    if (!continueRequested || !authenticated || !deviceId) return;
    const controller = new AbortController();
    void (async () => {
      try {
        const storedReceipt = localStorage.getItem(GUEST_READING_RECEIPT_KEY);
        if (!storedReceipt)
          throw new Error("This browser no longer has the encrypted guest-reading handoff.");
        setReceipt(storedReceipt);
        const response = await fetch("/api/guest-readings/continue", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ action: "recover", receipt: storedReceipt }),
          signal: controller.signal,
        });
        const payload = (await response.json()) as { reading?: unknown; error?: string };
        if (!response.ok || !payload.reading)
          throw new Error(payload.error ?? "The same draw could not be recovered.");
        setContinuationReading(guestReadingDisplaySchema.parse(payload.reading));
      } catch (cause) {
        if (!controller.signal.aborted)
          setError(
            cause instanceof Error ? cause.message : "The same draw could not be recovered.",
          );
      } finally {
        if (!controller.signal.aborted) setContinuationLoading(false);
      }
    })();
    return () => controller.abort();
  }, [authenticated, continueRequested, deviceId]);

  useEffect(() => {
    if (!state.matches("drawLocked") || !reading) return;
    const timer = window.setTimeout(() => send({ type: "BEGIN_DEAL" }), reducedMotion ? 0 : 180);
    return () => window.clearTimeout(timer);
  }, [reading, reducedMotion, send, state]);

  useEffect(() => {
    if (!state.matches("dealing") || !reading) return;
    const timers: number[] = [];
    if (reducedMotion) {
      timers.push(window.setTimeout(() => setDealtCount(reading.cards.length), 0));
      timers.push(window.setTimeout(() => send({ type: "DEALT" }), 40));
      return () => timers.forEach((timer) => window.clearTimeout(timer));
    }
    const dealNext = (index: number) => {
      setDealtCount(index + 1);
      if (index + 1 < reading.cards.length)
        timers.push(window.setTimeout(() => dealNext(index + 1), 650));
      else timers.push(window.setTimeout(() => send({ type: "DEALT" }), 450));
    };
    timers.push(window.setTimeout(() => dealNext(0), 100));
    return () => timers.forEach((timer) => window.clearTimeout(timer));
  }, [reading, reducedMotion, send, state]);

  useEffect(() => {
    if (!state.matches("awaitingReveal") || revealedRef.current.size === 0) return;
    send({ type: "REVEAL" });
  }, [send, state]);

  const reviewQuestion = async () => {
    if (!deviceId || !intakeReady) return;
    setLoading(true);
    setError(undefined);
    try {
      const response = await fetch("/api/guest-readings", {
        method: "POST",
        headers: { "content-type": "application/json", [GUEST_DEVICE_HEADER]: deviceId },
        body: JSON.stringify({ action: "review", question: question.trim() }),
      });
      const payload = (await response.json()) as {
        review?: QuestionReview;
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
      if (!response.ok || !payload.review)
        throw new Error(payload.error ?? "The question could not be reviewed.");
      setQuestionReview(payload.review);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The question could not be reviewed.");
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
    if (!deviceId || !selectedSpread || !confirmedQuestion) return;
    setLoading(true);
    setError(undefined);
    if (!continueAsReflection) {
      setGuardedPrompt(undefined);
      send({ type: "CONFIRM_SPREAD" });
    }
    try {
      const response = await fetch("/api/guest-readings", {
        method: "POST",
        headers: { "content-type": "application/json", [GUEST_DEVICE_HEADER]: deviceId },
        body: JSON.stringify({
          action: "prepare",
          spreadId: selectedSpread.id,
          birthDate,
          question: confirmedQuestion,
          questionConfirmed: true,
          reversalMode,
          personalizationMode,
          continueAsReflection,
          termsAccepted,
          privacyAccepted,
          ageConfirmed,
        }),
      });
      const payload = (await response.json()) as {
        ceremony?: unknown;
        error?: string;
        signupRequired?: boolean;
        reflectionAcknowledgementRequired?: boolean;
        safety?: { category: SafetyCategory; interrupt: boolean; guidance: string };
      };
      if (payload.safety?.interrupt) {
        setSafetyInterrupt({
          category: payload.safety.category,
          guidance: payload.safety.guidance,
        });
        return;
      }
      if (payload.reflectionAcknowledgementRequired && payload.safety) {
        setGuardedPrompt({ category: payload.safety.category });
        send({ type: "HIGH_STAKES" });
        return;
      }
      if (payload.signupRequired) setTrialUsed(true);
      if (!response.ok || !payload.ceremony)
        throw new Error(payload.error ?? "The free reading could not be prepared.");
      const prepared = drawCeremonySchema.parse(payload.ceremony);
      setCeremony(prepared);
      clientNonce.current = createClientDrawNonce();
      stirCount.current = 0;
      savePendingSession({
        kind: "ceremony",
        token: prepared.token,
        stage: "focusing",
        clientNonce: clientNonce.current,
        stirCount: 0,
      });
      if (continueAsReflection) send({ type: "CONTINUE_AS_REFLECTION" });
      else send({ type: "SAFETY_APPROVED" });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The free reading could not be prepared.");
    } finally {
      setLoading(false);
    }
  };

  const finalizeDraw = useCallback(
    async (cutIndex: number) => {
      if (!deviceId || !ceremony || loading) return;
      const pendingNonce = clientNonce.current ?? createClientDrawNonce();
      clientNonce.current = pendingNonce;
      setLoading(true);
      setError(undefined);
      send({ type: cutIndex === 0 ? "SKIP_CUT" : "CUT" });
      try {
        const response = await fetch("/api/guest-readings", {
          method: "POST",
          headers: { "content-type": "application/json", [GUEST_DEVICE_HEADER]: deviceId },
          body: JSON.stringify({
            action: "finalize",
            ceremonyToken: ceremony.token,
            clientNonce: pendingNonce,
            cutIndex,
          }),
        });
        const payload = guestReadingResponseSchema.safeParse(await response.json());
        if (!response.ok || !payload.success)
          throw new Error("The committed draw could not be finalized.");
        setReading(payload.data.reading);
        setReceipt(payload.data.receipt);
        setTrialUsed(true);
        savePendingSession({
          kind: "receipt",
          receipt: payload.data.receipt,
          revealedIndexes: [],
          resultUnlocked: false,
        });
        try {
          localStorage.setItem(GUEST_READING_RECEIPT_KEY, payload.data.receipt);
          localStorage.setItem(GUEST_TRIAL_LOCAL_MARKER_KEY, new Date().toISOString());
        } catch {
          // The signed cookie still enforces trial use.
        }
        send({ type: "DRAW_LOCKED" });
      } catch (cause) {
        send({ type: "FINALIZATION_FAILED" });
        setError(cause instanceof Error ? cause.message : "The draw could not be finalized.");
      } finally {
        setLoading(false);
      }
    },
    [ceremony, deviceId, loading, send],
  );

  const saveCurrentCeremony = (stage: CeremonyStage) => {
    if (!ceremony) return;
    const pendingNonce = clientNonce.current ?? createClientDrawNonce();
    clientNonce.current = pendingNonce;
    savePendingSession({
      kind: "ceremony",
      token: ceremony.token,
      stage,
      clientNonce: pendingNonce,
      stirCount: stirCount.current,
    });
  };

  const stirPendingDeck = () => {
    const pendingNonce = clientNonce.current ?? createClientDrawNonce();
    clientNonce.current = stirClientDrawNonce(pendingNonce);
    stirCount.current += 1;
    saveCurrentCeremony("shuffling");
  };

  const revealCard = useCallback(
    (index: number) => {
      if (!reading || !state.matches("revealing") || revealedRef.current.has(index)) return;
      const next = new Set(revealedRef.current).add(index);
      revealedRef.current = next;
      setRevealed(next);
      setActiveReveal(index);
      setError(undefined);
      if (receipt)
        savePendingSession({
          kind: "receipt",
          receipt,
          revealedIndexes: [...next],
          resultUnlocked: false,
        });
    },
    [reading, receipt, state],
  );

  const revealAll = useCallback(() => {
    if (!reading || !state.matches("revealing")) return;
    const all = new Set(reading.cards.map((_, index) => index));
    revealedRef.current = all;
    setRevealed(all);
    setActiveReveal(null);
    if (receipt)
      savePendingSession({
        kind: "receipt",
        receipt,
        revealedIndexes: [...all],
        resultUnlocked: false,
      });
  }, [reading, receipt, state]);

  const unlockCompleteReading = useCallback(async () => {
    if (!deviceId || !reading || !receipt || resultUnlockStarted.current) return;
    resultUnlockStarted.current = true;
    setLoading(true);
    setError(undefined);
    try {
      if (reading.result) {
        send({ type: "ALL_REVEALED" });
        return;
      }
      const response = await fetch("/api/guest-readings", {
        method: "POST",
        headers: { "content-type": "application/json", [GUEST_DEVICE_HEADER]: deviceId },
        body: JSON.stringify({ action: "reveal", receipt }),
      });
      const payload = guestReadingResponseSchema.safeParse(await response.json());
      if (!response.ok || !payload.success || !payload.data.reading.result)
        throw new Error("The complete interpretation could not be opened.");
      setReading(payload.data.reading);
      savePendingSession({
        kind: "receipt",
        receipt,
        revealedIndexes: payload.data.reading.cards.map((_, index) => index),
        resultUnlocked: true,
      });
      send({ type: "ALL_REVEALED" });
    } catch (cause) {
      resultUnlockStarted.current = false;
      setError(cause instanceof Error ? cause.message : "The interpretation could not be opened.");
    } finally {
      setLoading(false);
    }
  }, [deviceId, reading, receipt, send]);

  useEffect(() => {
    if (
      !state.matches("revealing") ||
      activeReveal !== null ||
      !reading ||
      revealed.size !== reading.cards.length
    )
      return;
    const timer = window.setTimeout(() => void unlockCompleteReading(), 0);
    return () => window.clearTimeout(timer);
  }, [activeReveal, reading, revealed, state, unlockCompleteReading]);

  useEffect(() => {
    if (!state.matches("fullSpreadReady") || !reading?.result) return;
    const timer = window.setTimeout(
      () => send({ type: "BEGIN_INTERPRETATION" }),
      reducedMotion ? 0 : 300,
    );
    return () => window.clearTimeout(timer);
  }, [reading, reducedMotion, send, state]);

  useEffect(() => {
    if (!state.matches("interpretationStreaming") || !journeyComplete) return;
    send({ type: "INTERPRETATION_COMPLETE" });
  }, [journeyComplete, send, state]);

  const submitFollowUp = async () => {
    if (!receipt || !followUp.trim()) return;
    setFollowUpLoading(true);
    setError(undefined);
    try {
      const response = await fetch("/api/guest-readings/continue", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "followUp", receipt, question: followUp }),
      });
      const raw = (await response.json()) as {
        error?: string;
        newReadingRequired?: boolean;
        safety?: { category: SafetyCategory; interrupt: boolean; guidance: string };
      };
      if (raw.safety?.interrupt) {
        setSafetyInterrupt({ category: raw.safety.category, guidance: raw.safety.guidance });
        return;
      }
      if (!response.ok)
        throw new Error(
          raw.newReadingRequired
            ? (raw.error ?? "That subject needs a new reading and a newly confirmed spread.")
            : (raw.error ?? "The same-draw follow-up could not be prepared."),
        );
      setFollowUpResult(guestFollowUpResponseSchema.parse(raw));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The same-draw follow-up failed.");
    } finally {
      setFollowUpLoading(false);
    }
  };

  if (safetyInterrupt)
    return (
      <SafetyInterruptPanel
        category={safetyInterrupt.category}
        guidance={safetyInterrupt.guidance}
      />
    );

  if (continueRequested)
    return (
      <MysticSanctuaryScene
        phase="complete"
        reducedMotion={reducedMotion}
        testId="guest-continuation"
      >
        <section className="guest-continuation-shell">
          <Link className="guest-reading-brand" href="/">
            <span aria-hidden="true">✦</span> StarGuidance
          </Link>
          {!authenticated ? (
            <div className="guest-conversion-card">
              <p className="page-eyebrow">Your cards are waiting</p>
              <h1>Create your private account to continue the same draw.</h1>
              <p>
                The encrypted handoff stays in this browser. Signing up does not redraw or alter a
                card.
              </p>
              <div className="guest-conversion-actions">
                <Link className="sg-button sg-button--primary" href={signupHref}>
                  Sign up to ask a follow-up
                </Link>
                <Link className="sg-button sg-button--secondary" href={signInHref}>
                  I already have an account
                </Link>
              </div>
            </div>
          ) : requiresPolicyReconsent ? (
            <div className="guest-conversion-card">
              <p className="page-eyebrow">One current permission</p>
              <h1>Review the current policies before continuing.</h1>
              <Link
                className="sg-button sg-button--primary"
                href={`/consent?next=${encodeURIComponent(continuationPath)}`}
              >
                Review policies
              </Link>
            </div>
          ) : continuationLoading ? (
            <div className="sanctuary-loading" role="status">
              <span aria-hidden="true">✦</span> Recovering the exact locked draw…
            </div>
          ) : continuationReading?.result ? (
            <div className="guest-continuation-reading">
              <header>
                <p className="page-eyebrow">Same cards · account unlocked</p>
                <h1>Your saved guest reading</h1>
                <p>{continuationReading.result.directAnswer}</p>
              </header>
              <TarotSpreadStage
                activeIndex={null}
                cards={continuationReading.cards}
                focusMode={null}
                reducedMotion={reducedMotion}
                revealed={continuationReadingRevealed}
              />
              {followUpResult ? (
                <section
                  className="guest-follow-up-answer"
                  aria-labelledby="guest-follow-up-heading"
                >
                  <p className="reading-section-eyebrow">The same cards answer</p>
                  <h2 id="guest-follow-up-heading">A clarification from the original spread</h2>
                  <p>{followUpResult.followUp.response}</p>
                  <small>
                    {followUpResult.personalizedByPrivateProfile
                      ? "The original minimized lens shaped this clarification; it did not alter the cards."
                      : "This clarification used pure tarot and did not alter the cards."}
                  </small>
                  <div className="guest-conversion-actions">
                    <Link
                      className="sg-button sg-button--primary"
                      href={hasProfile ? "/readings" : "/onboarding"}
                    >
                      {hasProfile ? "Begin a saved reading" : "Create my private profile"}
                    </Link>
                  </div>
                </section>
              ) : (
                <div className="guest-follow-up-composer">
                  <QuestionComposer
                    hint="Clarify the original subject and horizon; a different question starts a new reading."
                    label="Ask these same cards one follow-up"
                    loading={followUpLoading}
                    onChange={setFollowUp}
                    onSubmit={submitFollowUp}
                    placeholder="What do these same cards add about…"
                    submitLabel="Ask the same cards"
                    testId="guest-follow-up-composer"
                    value={followUp}
                  />
                </div>
              )}
            </div>
          ) : (
            <div className="guest-conversion-card">
              <p className="page-eyebrow">Handoff unavailable</p>
              <h1>The encrypted guest receipt could not be recovered.</h1>
              <p>{error ?? "It may have expired or been cleared from this browser."}</p>
              <Link
                className="sg-button sg-button--primary"
                href={hasProfile ? "/readings" : "/onboarding"}
              >
                {hasProfile ? "Begin a saved reading" : "Create my private profile"}
              </Link>
            </div>
          )}
          {error && continuationReading ? (
            <p className="sanctuary-error" role="alert">
              {error}
            </p>
          ) : null}
        </section>
      </MysticSanctuaryScene>
    );

  if (authenticated && !reading)
    return (
      <MysticSanctuaryScene phase="readingCreated" reducedMotion={reducedMotion}>
        <section className="guest-conversion-card guest-account-return">
          <p className="page-eyebrow">Your private space is open</p>
          <h1>Your account reading offers the fuller experience.</h1>
          <p>
            Use your saved profile, durable history, every available spread, and same-draw
            follow-ups.
          </p>
          <div className="guest-conversion-actions">
            <Link
              className="sg-button sg-button--primary"
              href={hasProfile ? "/readings" : "/onboarding"}
            >
              {hasProfile ? "Choose a reading" : "Create my private profile"}
            </Link>
            <Link className="sg-button sg-button--secondary" href="/">
              Return home
            </Link>
          </div>
        </section>
      </MysticSanctuaryScene>
    );

  if (bootstrapLoading)
    return (
      <MysticSanctuaryScene phase="idle" reducedMotion={reducedMotion}>
        <div className="sanctuary-loading" role="status">
          <span aria-hidden="true">✦</span> Preparing the guest threshold…
        </div>
      </MysticSanctuaryScene>
    );

  if (trialUsed && !reading && !ceremony)
    return (
      <MysticSanctuaryScene phase="complete" reducedMotion={reducedMotion}>
        <section className="guest-conversion-card guest-account-return">
          <p className="page-eyebrow">Your free reading has been experienced</p>
          <h1>Keep going inside a private account.</h1>
          <p>
            This browser has used its free draw. Sign up for saved readings and same-draw
            follow-ups.
          </p>
          <div className="guest-conversion-actions">
            <Link className="sg-button sg-button--primary" href={signupHref}>
              Sign up
            </Link>
            <Link className="sg-button sg-button--secondary" href={signInHref}>
              Sign in
            </Link>
          </div>
          {error ? <p className="sanctuary-error">{error}</p> : null}
        </section>
      </MysticSanctuaryScene>
    );

  const showQuestion = state.matches("questionDrafting");
  const showSpread = state.matches("questionConfirmed") || state.matches("spreadConfirmed");
  const cardsVisible =
    state.matches("awaitingReveal") ||
    state.matches("revealing") ||
    state.matches("fullSpreadReady") ||
    state.matches("interpretationStreaming") ||
    state.matches("followUpAvailable") ||
    state.matches("complete");
  const transcriptVisible =
    state.matches("interpretationStreaming") ||
    state.matches("followUpAvailable") ||
    state.matches("complete");
  const activeRevealCard = activeReveal === null ? undefined : reading?.cards[activeReveal];
  const focusedCard = activeReveal ?? activeReadingCard;

  return (
    <MysticSanctuaryScene
      phase={String(state.value)}
      reducedMotion={reducedMotion}
      testId="guest-reading-experience"
    >
      <header className="guest-reading-toolbar">
        <Link className="guest-reading-brand" href="/">
          <span aria-hidden="true">✦</span> StarGuidance
        </Link>
        <button onClick={() => setReducedMotion((current) => !current)} type="button">
          {reducedMotion ? "Use gentle motion" : "Reduce motion"}
        </button>
      </header>

      {showQuestion && (
        <>
          <section className="reading-entry-stage reading-question-stage guest-reading-entry">
            <div>
              <p>Set your intention</p>
              <h1>What would you like the cards to illuminate?</h1>
              <p>
                What, How, and “What should I understand” questions leave room for insight and
                choice.
              </p>
            </div>
          </section>
          <div className="oracle-console-stack reading-entry-console reading-question-console guest-question-console">
            <p className="entry-privacy-note">
              Your birthday can shape a minimized reflection lens. Neither it nor your question
              selects cards.
            </p>
            {questionReview ? (
              <div className="ritual-moment" data-testid="guest-question-confirmation">
                <p className="ritual-status">Confirm the exact question this reading will use</p>
                <blockquote>{question}</blockquote>
                {questionReview.suggestedQuestion && (
                  <div>
                    <p>A more open, user-centered question may serve the spread better:</p>
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
                <label className="guest-birth-date-field">
                  <span>
                    Your birthday <strong aria-hidden="true">*</strong>
                  </span>
                  <input
                    autoComplete="bday"
                    onChange={(event) => setBirthDate(event.target.value)}
                    required
                    type="date"
                    value={birthDate}
                  />
                  <small>
                    Used to personalize interpretation only. It does not choose or orient cards.
                  </small>
                </label>
                <QuestionComposer
                  disabled={!consentsReady || !birthDate}
                  hint="You will confirm the exact wording before choosing a spread."
                  label="Your private guest question"
                  loading={loading}
                  onChange={setQuestion}
                  onSubmit={reviewQuestion}
                  placeholder="What should I understand about…"
                  submitLabel="Review my question"
                  testId="guest-question-composer"
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
                <fieldset className="guest-policy-consents">
                  <legend>Before the cards are prepared</legend>
                  <label>
                    <input
                      checked={termsAccepted}
                      onChange={(event) => setTermsAccepted(event.target.checked)}
                      type="checkbox"
                    />
                    <span>
                      I agree to the <Link href="/terms">Terms</Link>.
                    </span>
                  </label>
                  <label>
                    <input
                      checked={privacyAccepted}
                      onChange={(event) => setPrivacyAccepted(event.target.checked)}
                      type="checkbox"
                    />
                    <span>
                      I have read the <Link href="/privacy">Privacy Notice</Link>.
                    </span>
                  </label>
                  <label>
                    <input
                      checked={ageConfirmed}
                      onChange={(event) => setAgeConfirmed(event.target.checked)}
                      type="checkbox"
                    />
                    <span>I confirm that I am at least 18 years old.</span>
                  </label>
                </fieldset>
                {!intakeReady ? (
                  <p className="guest-consent-hint">
                    Enter your birthday and question, then accept all three commitments.
                  </p>
                ) : null}
              </>
            )}
          </div>
        </>
      )}

      {showSpread && selectedSpread && (
        <section className="reading-entry-stage reading-selection-stage guest-reading-entry">
          <p>Choose the structure</p>
          <h1>Select a spread for your confirmed question</h1>
          <blockquote>{confirmedQuestion}</blockquote>
          <div aria-label="Free reading type" className="ritual-spread-options" role="radiogroup">
            {spreads.map((spread) => (
              <label
                data-recommended={spread.id === "three-card"}
                key={`${spread.id}:${spread.version}`}
              >
                <input
                  checked={selected === spread.id}
                  className="sr-only"
                  name="guest-spread"
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
                  <span className="ritual-spread-purpose">{spread.purpose}</span>
                </span>
              </label>
            ))}
          </div>
          <div className="ritual-moment" data-testid="guest-spread-position-preview">
            <p className="ritual-status">These positions are fixed before any card is known</p>
            <ol>
              {[...selectedSpread.positions]
                .sort((a, b) => a.order - b.order)
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
              Pure Tarot uses no profile lens. Personalized Tarot uses a minimized birthday lens
              that cannot change card meanings.
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
            <p className="ritual-status">
              The cards cannot establish this as fact. They can reflect on evidence, preparation,
              boundaries, and your choices.
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
          <span aria-hidden="true">✦</span> Finalizing and locking every card, position, and
          orientation…
        </div>
      )}

      {(state.matches("dealing") || cardsVisible) && (
        <section
          className={`sanctuary-stage ${state.matches("dealing") ? "is-dealing" : ""} ${state.matches("awaitingReveal") ? "is-reflecting" : ""} ${state.matches("revealing") ? "is-guided-reveal" : ""}`}
        >
          {state.matches("dealing") && reading && (
            <div className="sanctuary-deal-ritual" data-testid="guest-deal">
              <TarotSpreadStage
                activeIndex={null}
                cards={reading.cards}
                dealing
                focusMode={null}
                reducedMotion={reducedMotion}
                revealed={revealed}
                visibleCount={dealtCount}
              />
              <p className="ritual-deal-status" role="status">
                {dealtCount === 0
                  ? "The locked deck is centered."
                  : `Dealing card ${dealtCount} of ${reading.cards.length} into its fixed position…`}
              </p>
            </div>
          )}
          {cardsVisible && reading && (
            <div className="ritual-card-layout">
              <TarotSpreadStage
                activeIndex={focusedCard}
                cards={reading.cards}
                focusMode={
                  activeReveal !== null ? "reveal" : activeReadingCard !== null ? "reading" : null
                }
                reducedMotion={reducedMotion}
                revealed={revealed}
                onReveal={
                  state.matches("revealing") && activeReveal === null ? revealCard : undefined
                }
              />
              {state.matches("awaitingReveal") && (
                <div className="ritual-question-reflection" data-testid="guest-question-reflection">
                  <span>Hold your question at the center</span>
                  <blockquote>{reading.question}</blockquote>
                  <p>
                    Every card is face down. The whole-reading answer remains private until all are
                    revealed.
                  </p>
                  <button
                    className="ritual-action ritual-ready-action"
                    onClick={() => send({ type: "REVEAL" })}
                    type="button"
                  >
                    I’m ready
                  </button>
                </div>
              )}
              {state.matches("revealing") &&
                activeReveal === null &&
                revealed.size < reading.cards.length && (
                  <div className="reveal-choice-prompt" role="status">
                    <span aria-hidden="true">✦</span>
                    <p>
                      <strong>Choose any face-down position</strong>
                      <small>
                        Its assignment is already locked. Tap, click, use Enter or Space, or reveal
                        all.
                      </small>
                    </p>
                    <span>
                      {revealed.size} of {reading.cards.length}
                    </span>
                    <button className="ritual-action" onClick={revealAll} type="button">
                      Reveal All
                    </button>
                  </div>
                )}
            </div>
          )}
          {state.matches("revealing") && activeRevealCard && activeReveal !== null && (
            <div className="guided-reveal-panel" data-testid="guest-guided-reveal-panel">
              <p className="guided-reveal-description">{activeRevealCard.positionName}</p>
              <h2>
                {activeRevealCard.name}
                {activeRevealCard.orientation === "reversed" ? " · Reversed" : ""}
              </h2>
              <p className="guided-reveal-themes">{activeRevealCard.baselineMeaning}</p>
              <button
                className="ritual-action guided-next-action"
                onClick={() => setActiveReveal(null)}
                type="button"
              >
                {revealed.size < (reading?.cards.length ?? revealed.size)
                  ? "Return to the spread"
                  : "Open the complete reading"}
                <span>
                  {revealed.size} of {reading?.cards.length ?? revealed.size}
                </span>
              </button>
            </div>
          )}
          {state.matches("fullSpreadReady") && (
            <p className="stage-whisper" role="status">
              The full spread is ready. Now the cards can be read together…
            </p>
          )}
        </section>
      )}

      <div className={`oracle-console-stack ${transcriptVisible ? "" : "is-inactive"}`}>
        {transcriptVisible && reading?.result ? (
          <OracleTranscript
            active
            cards={reading.cards}
            onActiveCardChange={setActiveReadingCard}
            onJourneyCompleteChange={setJourneyComplete}
            onRetry={() => undefined}
            previewEvents={readingPreviewEvents}
            readingId={reading.id}
            reducedMotion={reducedMotion}
            result={reading.result}
            retryToken={0}
            soundEnabled={false}
            target="guest-primary"
          />
        ) : null}
        {(state.matches("followUpAvailable") || state.matches("complete")) &&
        journeyComplete &&
        reading ? (
          <section
            className="guest-conversion-card guest-reading-result-gate"
            data-testid="guest-signup-gate"
          >
            <p className="page-eyebrow">Your reading is complete</p>
            <h2>Want to ask these same cards one follow-up?</h2>
            <p>
              Create a private account to continue. The encrypted handoff keeps this exact draw for
              seven days; signup never redraws it.
            </p>
            <div className="guest-conversion-actions">
              <Link className="sg-button sg-button--primary" href={signupHref}>
                Sign up to continue
              </Link>
              <Link className="sg-button sg-button--secondary" href={signInHref}>
                Sign in
              </Link>
              <Link className="guest-settle-link" href="/">
                Let the reading settle
              </Link>
            </div>
          </section>
        ) : null}
      </div>

      {error ? (
        <p className="sanctuary-error" role="alert">
          {error}
        </p>
      ) : null}
    </MysticSanctuaryScene>
  );
}

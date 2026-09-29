"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { useMachine } from "@xstate/react";
import type { SafetyCategory } from "@starguidance/ai";
import {
  drawCeremonySchema,
  type DrawCeremony,
  type OracleStreamEvent,
} from "@starguidance/contracts";
import { readingMachine } from "@starguidance/reading-machine";

import {
  createClientDrawNonce,
  isClientDrawNonce,
  stirClientDrawNonce,
} from "@/lib/client-draw-entropy";
import { requestJson, sendJson } from "@/lib/client-request";
import {
  GUEST_DEVICE_HEADER,
  GUEST_DEVICE_STORAGE_KEY,
  GUEST_HANDOFF_PATTERN,
  GUEST_INTAKE_DRAFT_KEY,
  GUEST_READING_HANDOFF_KEY,
  GUEST_READING_RECEIPT_KEY,
  GUEST_READING_SESSION_KEY,
  GUEST_TRIAL_LOCAL_MARKER_KEY,
  guestDeviceIdSchema,
  guestFollowUpResponseSchema,
  guestReadingDisplaySchema,
  guestReadingResponseSchema,
  type GuestFollowUpResponse,
  type GuestReadingDisplay,
  type GuestReadingResponse,
} from "@/lib/guest-reading-contract";

import { MysticSanctuaryScene } from "../session/[id]/mystic-sanctuary-scene";
import { OracleTranscript } from "../session/[id]/oracle-transcript";
import { QuestionComposer } from "../session/[id]/question-composer";
import {
  keepsakeCardsFrom,
  keepsakeSectionsFrom,
  ReadingKeepsake,
} from "../session/[id]/reading-keepsake";
import {
  SafetyInterruptContent,
  SafetyInterruptPanel,
} from "../session/[id]/safety-interrupt-panel";
import {
  awaitCasinoPickFlights,
  CasinoWashDeck,
  measureCasinoPickHandoff,
  spreadLayoutFor,
} from "../session/[id]/shuffle-shells";
import type { CardHandoffOrigin } from "../session/[id]/stage-flip";
import {
  SpreadSlotGhost,
  TarotSpreadStage,
  type SpreadSlot,
} from "../session/[id]/tarot-spread-stage";

import { useMotionPreference } from "@/lib/motion-preference";
import { motionTiming } from "@/lib/motion";

type PhaseEvent = Extract<OracleStreamEvent, { type: "phase" }>;

type CeremonyStage = "focusing" | "shuffling" | "selectingCards" | "optionalCut";

type PendingGuestSession =
  | {
      kind: "ceremony";
      token: string;
      stage: CeremonyStage;
      clientNonce?: string;
      stirCount?: number;
      selectedIndexes?: number[];
    }
  | {
      kind: "receipt";
      receipt: string;
      revealedIndexes: number[];
      resultUnlocked: boolean;
    };

interface IntakeDraft {
  question: string;
  consented: boolean;
  personalize: boolean;
}

interface ProblemAction {
  label: string;
  onClick: () => void;
}

interface Problem {
  message: string;
  actions?: readonly ProblemAction[];
}

interface SafetyInterruptState {
  category: SafetyCategory;
  userMessage?: string | undefined;
  origin: "question" | "followUp";
}

const continuationPath = "/free-reading?continue=1";
/**
 * Carry the compact handoff in account links so a confirmation email opened
 * in another browser can still reopen the same cards. Enable only once
 * `safeAccountReturnPath` accepts `/free-reading?continue=1#handoff=…`;
 * until then the sign-up page would drop the return path entirely.
 */
const HANDOFF_IN_ACCOUNT_LINKS = true;
const EXAMPLE_QUESTIONS = [
  "What do I need to understand about my work right now?",
  "How can I move forward in this relationship with care?",
  "What is asking for my attention this month?",
] as const;
const QUESTION_LIMIT = 500;
const OLDEST_BIRTH_DATE = "1900-01-01";
const FRESH_DECK_NOTICE =
  "That shuffle rested too long, so we’ve set out a fresh deck. Your question is still here.";
const PURE_TAROT_NOTICE =
  "Your birthday lens is resting just now, so these cards are read as pure tarot. They are exactly the cards you chose.";

function accountLinks(handoff: string | undefined) {
  const path =
    HANDOFF_IN_ACCOUNT_LINKS && handoff
      ? `${continuationPath}#handoff=${handoff}`
      : continuationPath;
  return {
    signup: `/sign-up?next=${encodeURIComponent(path)}`,
    signin: `/sign-in?next=${encodeURIComponent(path)}`,
  };
}

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

function readLocal(key: string): string | undefined {
  try {
    return localStorage.getItem(key) ?? undefined;
  } catch {
    return undefined;
  }
}

function writeLocal(key: string, value: string | undefined) {
  try {
    if (value === undefined) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch {
    // The signed cookie still protects the trial; local recovery is a convenience.
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
      ["focusing", "shuffling", "selectingCards", "optionalCut"].includes(String(value.stage))
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

function savePendingSession(value: PendingGuestSession | undefined) {
  try {
    if (value) sessionStorage.setItem(GUEST_READING_SESSION_KEY, JSON.stringify(value));
    else sessionStorage.removeItem(GUEST_READING_SESSION_KEY);
  } catch {
    // The in-memory ritual remains usable when session storage is unavailable.
  }
}

function readIntakeDraft(): IntakeDraft | undefined {
  try {
    const raw = sessionStorage.getItem(GUEST_INTAKE_DRAFT_KEY);
    if (!raw) return undefined;
    const value = JSON.parse(raw) as Partial<IntakeDraft>;
    return {
      question: typeof value.question === "string" ? value.question.slice(0, QUESTION_LIMIT) : "",
      consented: value.consented === true,
      personalize: value.personalize !== false,
    };
  } catch {
    return undefined;
  }
}

function saveIntakeDraft(draft: IntakeDraft | undefined) {
  try {
    if (draft) sessionStorage.setItem(GUEST_INTAKE_DRAFT_KEY, JSON.stringify(draft));
    else sessionStorage.removeItem(GUEST_INTAKE_DRAFT_KEY);
  } catch {
    // Drafts are a convenience; the form still works in memory.
  }
}

function subscribeToNothing() {
  return () => {};
}

function storedHandoffSnapshot(): string | undefined {
  const value = readLocal(GUEST_READING_HANDOFF_KEY);
  return value && GUEST_HANDOFF_PATTERN.test(value) ? value : undefined;
}

function isoDate(date: Date): string {
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${date.getFullYear()}-${month}-${day}`;
}

/** The latest birthday that makes someone 18 today. */
function adultBirthDateCutoff(now = new Date()): string {
  const cutoff = new Date(now);
  cutoff.setFullYear(now.getFullYear() - 18);
  return isoDate(cutoff);
}

function formatBirthDate(value: string): string {
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isNaN(date.getTime())
    ? value
    : date.toLocaleDateString(undefined, {
        day: "numeric",
        month: "long",
        year: "numeric",
        timeZone: "UTC",
      });
}

function formatDay(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime())
    ? iso
    : date.toLocaleDateString(undefined, { day: "numeric", month: "long" });
}

const countWords = ["", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine"];

function spreadNameFor(reading: GuestReadingDisplay): string {
  const count = countWords[reading.cards.length] ?? String(reading.cards.length);
  return `${count.charAt(0).toUpperCase()}${count.slice(1)}-card spread`;
}

function phaseEvents(reading: GuestReadingDisplay): readonly PhaseEvent[] {
  return (reading.previewEvents ?? []).filter(
    (event): event is PhaseEvent => event.type === "phase",
  );
}

/** A fixed, visible banner under the toolbar that is announced and focused. */
function GuestProblemBanner({ problem, onDismiss }: { problem: Problem; onDismiss: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    ref.current?.focus({ preventScroll: true });
  }, [problem]);
  return (
    <div
      className="guest-banner guest-banner--problem"
      data-testid="guest-problem"
      ref={ref}
      role="alert"
      tabIndex={-1}
    >
      <p>{problem.message}</p>
      <div className="guest-banner-actions">
        {problem.actions?.map((action) => (
          <button
            className="guest-banner-action"
            key={action.label}
            onClick={action.onClick}
            type="button"
          >
            {action.label}
          </button>
        ))}
        <button
          aria-label="Dismiss this message"
          className="guest-banner-close"
          onClick={onDismiss}
          type="button"
        >
          <span aria-hidden="true">×</span>
        </button>
      </div>
    </div>
  );
}

function GuestNoticeBanner({ notice, onDismiss }: { notice: string; onDismiss: () => void }) {
  return (
    <div className="guest-banner guest-banner--notice" data-testid="guest-notice" role="status">
      <p>{notice}</p>
      <div className="guest-banner-actions">
        <button
          aria-label="Dismiss this note"
          className="guest-banner-close"
          onClick={onDismiss}
          type="button"
        >
          <span aria-hidden="true">×</span>
        </button>
      </div>
    </div>
  );
}

interface ExperienceProps {
  authenticated: boolean;
  continueRequested: boolean;
  hasProfile: boolean;
  requiresPolicyReconsent: boolean;
}

/**
 * Remounts the ritual with a fresh state machine when a ceremony has to be
 * started again (for example, the pending shuffle expired). The birthday is
 * carried only in memory; the question and consents come from the session
 * draft.
 */
export function GuestReadingExperience(props: ExperienceProps) {
  const [restart, setRestart] = useState<{
    epoch: number;
    birthDate?: string;
    notice?: string;
  }>({ epoch: 0 });
  return (
    <GuestReadingRitual
      {...props}
      initialBirthDate={restart.birthDate}
      initialNotice={restart.notice}
      key={`${restart.epoch}:${props.continueRequested ? "continue" : "ritual"}`}
      onRestart={(birthDate, notice) =>
        setRestart((current) => ({
          epoch: current.epoch + 1,
          ...(birthDate ? { birthDate } : {}),
          ...(notice ? { notice } : {}),
        }))
      }
    />
  );
}

function GuestReadingRitual({
  authenticated,
  continueRequested,
  hasProfile,
  requiresPolicyReconsent,
  initialBirthDate,
  initialNotice,
  onRestart,
}: ExperienceProps & {
  initialBirthDate?: string | undefined;
  initialNotice?: string | undefined;
  onRestart: (birthDate?: string, notice?: string) => void;
}) {
  const router = useRouter();
  const [state, send] = useMachine(readingMachine);
  const [intakeStep, setIntakeStep] = useState<"about" | "question">(
    initialBirthDate ? "question" : "about",
  );
  const [birthDate, setBirthDate] = useState(initialBirthDate ?? "");
  // The intake is never server-rendered (a loading state always comes
  // first), so browser-only drafts can seed these without a hydration gap.
  const [latestAdultBirthDate] = useState(adultBirthDateCutoff);
  const [personalize, setPersonalize] = useState(() => readIntakeDraft()?.personalize ?? true);
  const [consented, setConsented] = useState(() => readIntakeDraft()?.consented ?? false);
  const [question, setQuestion] = useState(() => readIntakeDraft()?.question ?? "");
  const [confirmedQuestion, setConfirmedQuestion] = useState("");
  const [deviceId, setDeviceId] = useState<string>();
  const [ceremony, setCeremony] = useState<DrawCeremony>();
  const [selectedIndexes, setSelectedIndexes] = useState<number[]>([]);
  const [reading, setReading] = useState<GuestReadingDisplay>();
  const [receipt, setReceipt] = useState<string>();
  const [issuedHandoff, setHandoffToken] = useState<string>();
  const storedHandoff = useSyncExternalStore(
    subscribeToNothing,
    storedHandoffSnapshot,
    () => undefined,
  );
  const handoff = issuedHandoff ?? storedHandoff;
  const [trialUsed, setTrialUsed] = useState(false);
  const [receiptExpired, setReceiptExpired] = useState(false);
  const [storedReceiptAvailable, setStoredReceiptAvailable] = useState(false);
  const [bootstrapLoading, setBootstrapLoading] = useState(!continueRequested);
  const [loading, setLoading] = useState(false);
  /** Session-only fast-forward for the deal; never saved as a preference. */
  const [fastForward, setFastForward] = useState(false);
  const [unlocking, setUnlocking] = useState(false);
  const [unlockHalted, setUnlockHalted] = useState(false);
  const [problem, setProblem] = useState<Problem>();
  const [notice, setNotice] = useState<string | undefined>(initialNotice);
  const [safetyInterrupt, setSafetyInterrupt] = useState<SafetyInterruptState>();
  const [guardedPrompt, setGuardedPrompt] = useState<{ category: SafetyCategory }>();
  const { reducedMotion, systemReducedMotion, setReducedMotion } = useMotionPreference();
  const [dealtCount, setDealtCount] = useState(0);
  /** Where the picked shells sat when the draw locked; the dealt cards begin
   * there so the chosen cards and the spread read as the same cards. */
  const [cardHandoff, setCardHandoff] = useState<readonly CardHandoffOrigin[]>();
  const [slots, setSlots] = useState<readonly SpreadSlot[]>();
  const [revealed, setRevealed] = useState<Set<number>>(new Set());
  const revealedRef = useRef<ReadonlySet<number>>(revealed);
  const [activeReveal, setActiveReveal] = useState<number | null>(null);
  const [journeyComplete, setJourneyComplete] = useState(false);
  const [transcriptEpoch, setTranscriptEpoch] = useState(0);
  const [continuationReading, setContinuationReading] = useState<GuestReadingDisplay>();
  const [continuationLoading, setContinuationLoading] = useState(
    continueRequested && authenticated && !requiresPolicyReconsent,
  );
  const [continuationExpired, setContinuationExpired] = useState(false);
  const [followUp, setFollowUp] = useState("");
  const [followUpResult, setFollowUpResult] = useState<GuestFollowUpResponse>();
  const [askedFollowUp, setAskedFollowUp] = useState<string>();
  const [followUpLoading, setFollowUpLoading] = useState(false);
  const bootstrapped = useRef(false);
  const resultUnlockStarted = useRef(false);
  const clientNonce = useRef<string | undefined>(undefined);
  const stirCount = useRef(0);
  const questionHeadingRef = useRef<HTMLHeadingElement>(null);
  const aboutHeadingRef = useRef<HTMLHeadingElement>(null);
  const focusQuestionHeading = useRef(false);
  /** Re-sends the confirmed picks after a failed lock (set below). */
  const retryFinalize = useRef<() => void>(() => undefined);

  const personalizationMode = personalize ? "personalized_tarot" : "pure_tarot";
  const dealMotionOff = reducedMotion || fastForward;
  const birthDateValid =
    Boolean(birthDate) &&
    birthDate >= OLDEST_BIRTH_DATE &&
    (!latestAdultBirthDate || birthDate <= latestAdultBirthDate);
  const aboutReady = consented && (!personalize || birthDateValid);
  const readingPreviewEvents = useMemo(() => (reading ? phaseEvents(reading) : []), [reading]);
  const links = accountLinks(handoff);

  const showError = useCallback((message: string, actions?: readonly ProblemAction[]) => {
    setProblem(actions ? { message, actions } : { message });
  }, []);
  const clearProblem = useCallback(() => setProblem(undefined), []);

  /** Stores everything needed to reopen this reading later. */
  const rememberReading = useCallback((payload: GuestReadingResponse) => {
    setReading(payload.reading);
    setReceipt(payload.receipt);
    setTrialUsed(true);
    writeLocal(GUEST_READING_RECEIPT_KEY, payload.receipt);
    writeLocal(GUEST_TRIAL_LOCAL_MARKER_KEY, new Date().toISOString());
    if (payload.handoff) {
      setHandoffToken(payload.handoff);
      writeLocal(GUEST_READING_HANDOFF_KEY, payload.handoff);
    }
  }, []);

  useEffect(() => {
    if (bootstrapped.current) return;
    bootstrapped.current = true;
    const device = storedDeviceId();
    setDeviceId(device);
    if (continueRequested) return;
    const controller = new AbortController();
    const headers = { [GUEST_DEVICE_HEADER]: device };
    let redirecting = false;
    void (async () => {
      const pending = readPendingSession();
      const localReceipt = readLocal(GUEST_READING_RECEIPT_KEY);
      try {
        if (authenticated) {
          // Signed-in visitors never see the guest threshold: a kept guest
          // reading opens in the account continuation, otherwise they are
          // pointed to their own readings.
          if (localReceipt) {
            redirecting = true;
            router.replace(continuationPath);
          }
          return;
        }
        if (pending?.kind === "ceremony") {
          const response = await sendJson<Record<string, unknown>>(
            "/api/guest-readings",
            "POST",
            { action: "restore", ceremonyToken: pending.token },
            { headers, signal: controller.signal },
          );
          if (controller.signal.aborted) return;
          const locked = response.ok
            ? guestReadingResponseSchema.safeParse(response.data)
            : undefined;
          if (locked?.success) {
            // This ceremony was already finalized (its response never
            // arrived); the server hands back that same draw.
            rememberReading(locked.data);
            savePendingSession({
              kind: "receipt",
              receipt: locked.data.receipt,
              revealedIndexes: [],
              resultUnlocked: false,
            });
            saveIntakeDraft(undefined);
            send({ type: "START" });
            send({ type: "RESTORE_LOCKED" });
            return;
          }
          const restored = response.ok
            ? drawCeremonySchema.safeParse(response.data.ceremony)
            : undefined;
          if (restored?.success) {
            setCeremony(restored.data);
            setQuestion(restored.data.question);
            setConfirmedQuestion(restored.data.question);
            setPersonalize(
              restored.data.configuration.personalizationMode === "personalized_tarot",
            );
            clientNonce.current = isClientDrawNonce(pending.clientNonce)
              ? pending.clientNonce
              : createClientDrawNonce();
            stirCount.current =
              Number.isSafeInteger(pending.stirCount) && (pending.stirCount ?? -1) >= 0
                ? (pending.stirCount ?? 0)
                : 0;
            setSelectedIndexes(
              (pending.selectedIndexes ?? []).filter(
                (index, position, indexes) =>
                  Number.isInteger(index) &&
                  index >= 0 &&
                  index < 78 &&
                  indexes.indexOf(index) === position &&
                  position < restored.data.spread.positions.length,
              ),
            );
            send({ type: "START" });
            send({ type: "DRAFT_QUESTION" });
            send({ type: "CONFIRM_QUESTION" });
            send({ type: "CONFIRM_SPREAD" });
            send({ type: "SAFETY_APPROVED" });
            send({ type: "FOCUS_COMPLETE" });
            if (pending.stage === "selectingCards" || pending.stage === "optionalCut")
              send({ type: "SHUFFLE_COMPLETE" });
            return;
          }
          if (response.status === 0 || response.status >= 500) {
            // Keep the pending shuffle; nothing is lost by trying again.
            send({ type: "START" });
            send({ type: "DRAFT_QUESTION" });
            showError(response.ok ? "Your shuffle couldn’t be reopened." : response.error, [
              { label: "Try again", onClick: () => window.location.reload() },
            ]);
            return;
          }
          // The shuffle expired: begin again, keeping the drafted question.
          savePendingSession(undefined);
          if (response.status === 410) setNotice(FRESH_DECK_NOTICE);
        }

        const recoveryReceipt = pending?.kind === "receipt" ? pending.receipt : localReceipt;
        if (recoveryReceipt) {
          const resultUnlocked = pending?.kind === "receipt" && pending.resultUnlocked;
          const response = await sendJson<unknown>(
            "/api/guest-readings",
            "POST",
            { action: resultUnlocked ? "reveal" : "recover", receipt: recoveryReceipt },
            { headers, signal: controller.signal },
          );
          if (controller.signal.aborted) return;
          const payload = response.ok
            ? guestReadingResponseSchema.safeParse(response.data)
            : undefined;
          if (payload?.success) {
            const restoredIndexes =
              pending?.kind === "receipt"
                ? pending.revealedIndexes.filter(
                    (index) => index >= 0 && index < payload.data.reading.cards.length,
                  )
                : [];
            const restoredSet = new Set(restoredIndexes);
            revealedRef.current = restoredSet;
            setRevealed(restoredSet);
            rememberReading(payload.data);
            setNotice(
              `Welcome back — here are the cards you drew on ${formatDay(payload.data.reading.createdAt)}.`,
            );
            send({ type: "START" });
            send({ type: "RESTORE_LOCKED" });
            return;
          }
          if (!response.ok && response.status === 410 && /expired/i.test(response.error)) {
            setReceiptExpired(true);
            writeLocal(GUEST_READING_RECEIPT_KEY, undefined);
            writeLocal(GUEST_READING_HANDOFF_KEY, undefined);
            savePendingSession(undefined);
          }
        }

        send({ type: "START" });
        send({ type: "DRAFT_QUESTION" });
        const response = await requestJson<{ eligible?: boolean; signupRequired?: boolean }>(
          "/api/guest-readings",
          { cache: "no-store", headers, signal: controller.signal },
        );
        if (controller.signal.aborted) return;
        if (!response.ok) {
          showError(response.error, [
            { label: "Try again", onClick: () => window.location.reload() },
          ]);
          return;
        }
        const used = response.data.signupRequired === true || response.data.eligible === false;
        setTrialUsed(used);
        setStoredReceiptAvailable(used && Boolean(readLocal(GUEST_READING_RECEIPT_KEY)));
      } finally {
        if (!controller.signal.aborted && !redirecting) setBootstrapLoading(false);
      }
    })();
    return () => controller.abort();
  }, [authenticated, continueRequested, rememberReading, router, send, showError]);

  // Keep the drafted question and consent across reloads (never the birthday).
  useEffect(() => {
    if (reading) return;
    saveIntakeDraft({ question, consented, personalize });
  }, [consented, personalize, question, reading]);

  useEffect(() => {
    if (intakeStep !== "question" || !focusQuestionHeading.current) return;
    focusQuestionHeading.current = false;
    questionHeadingRef.current?.focus();
  }, [intakeStep]);

  const loadContinuation = useCallback(
    async (signal: AbortSignal | undefined, preferHandoff: boolean) => {
      try {
        // A handoff that just arrived from an email link names the reading
        // the visitor meant; an older receipt in this browser must not win.
        const storedReceipt = preferHandoff ? undefined : readLocal(GUEST_READING_RECEIPT_KEY);
        const storedHandoff = readLocal(GUEST_READING_HANDOFF_KEY);
        const init = signal ? { signal } : {};
        let expired = false;
        if (storedReceipt) {
          const response = await sendJson<{ reading?: unknown; handoff?: string }>(
            "/api/guest-readings/continue",
            "POST",
            { action: "recover", receipt: storedReceipt },
            init,
          );
          if (signal?.aborted) return;
          const parsed = response.ok
            ? guestReadingDisplaySchema.safeParse(response.data.reading)
            : undefined;
          if (parsed?.success) {
            setReceipt(storedReceipt);
            setContinuationReading(parsed.data);
            if (typeof response.data.handoff === "string") {
              setHandoffToken(response.data.handoff);
              writeLocal(GUEST_READING_HANDOFF_KEY, response.data.handoff);
            }
            return;
          }
          expired = response.status === 410;
          if (!storedHandoff) {
            if (expired) setContinuationExpired(true);
            else if (response.status !== 401)
              showError(response.ok ? "Your reading couldn’t be opened." : response.error, [
                { label: "Try again", onClick: () => window.location.reload() },
              ]);
            return;
          }
        }
        if (storedHandoff && GUEST_HANDOFF_PATTERN.test(storedHandoff)) {
          const response = await sendJson<{ reading?: unknown; receipt?: string }>(
            "/api/guest-readings/continue",
            "POST",
            { action: "redeem", handoff: storedHandoff },
            init,
          );
          if (signal?.aborted) return;
          const parsed = response.ok
            ? guestReadingDisplaySchema.safeParse(response.data.reading)
            : undefined;
          if (parsed?.success && typeof response.data.receipt === "string") {
            setReceipt(response.data.receipt);
            writeLocal(GUEST_READING_RECEIPT_KEY, response.data.receipt);
            setContinuationReading(parsed.data);
            return;
          }
          if (response.status === 410) setContinuationExpired(true);
          else
            showError(response.ok ? "Your reading couldn’t be opened." : response.error, [
              { label: "Try again", onClick: () => window.location.reload() },
            ]);
          return;
        }
        if (expired) setContinuationExpired(true);
      } finally {
        if (!signal?.aborted) setContinuationLoading(false);
      }
    },
    [showError],
  );

  useEffect(() => {
    if (!continueRequested) return;
    // A confirmation email may carry the handoff in the URL fragment. Keep it
    // locally and remove it from the address bar straight away.
    const fragment = new URLSearchParams(window.location.hash.slice(1)).get("handoff");
    const freshHandoff = Boolean(fragment && GUEST_HANDOFF_PATTERN.test(fragment));
    if (fragment && freshHandoff) writeLocal(GUEST_READING_HANDOFF_KEY, fragment);
    if (window.location.hash)
      window.history.replaceState(null, "", `${window.location.pathname}${window.location.search}`);
    if (!authenticated || requiresPolicyReconsent) return;
    const controller = new AbortController();
    void loadContinuation(controller.signal, freshHandoff);
    return () => controller.abort();
  }, [authenticated, continueRequested, loadContinuation, requiresPolicyReconsent]);

  useEffect(() => {
    if (!state.matches("drawLocked") || !reading) return;
    const timer = window.setTimeout(() => send({ type: "BEGIN_DEAL" }), dealMotionOff ? 0 : 180);
    return () => window.clearTimeout(timer);
  }, [dealMotionOff, reading, send, state]);

  // A skip fast-forwards only the deal; the reveal keeps the reader's motion.
  useEffect(() => {
    if (!fastForward || state.matches("dealing") || state.matches("drawLocked")) return;
    const timer = window.setTimeout(() => setFastForward(false), 0);
    return () => window.clearTimeout(timer);
  }, [fastForward, state]);

  useEffect(() => {
    if (!state.matches("dealing") || !reading) return;
    const timers: number[] = [];
    if (dealMotionOff) {
      timers.push(window.setTimeout(() => setDealtCount(reading.cards.length), 0));
      timers.push(window.setTimeout(() => send({ type: "DEALT" }), 40));
      return () => timers.forEach((timer) => window.clearTimeout(timer));
    }
    const dealNext = (index: number) => {
      setDealtCount(index + 1);
      if (index + 1 < reading.cards.length)
        timers.push(window.setTimeout(() => dealNext(index + 1), motionTiming.dealInterval));
      else timers.push(window.setTimeout(() => send({ type: "DEALT" }), motionTiming.dealSettle));
    };
    timers.push(window.setTimeout(() => dealNext(0), 100));
    return () => timers.forEach((timer) => window.clearTimeout(timer));
  }, [dealMotionOff, reading, send, state]);

  useEffect(() => {
    if (!state.matches("awaitingReveal") || revealedRef.current.size === 0) return;
    send({ type: "REVEAL" });
  }, [send, state]);

  const advanceToQuestion = () => {
    if (!aboutReady) return;
    focusQuestionHeading.current = true;
    setIntakeStep("question");
  };

  const returnToAbout = () => {
    setIntakeStep("about");
    window.setTimeout(() => aboutHeadingRef.current?.focus(), 0);
  };

  const prepareRitual = async (continueAsReflection = false) => {
    const finalQuestion = (continueAsReflection ? confirmedQuestion : question).trim();
    if (!deviceId || !aboutReady || !finalQuestion || loading) return;
    setLoading(true);
    clearProblem();
    const response = await sendJson<{
      ceremony?: unknown;
      signupRequired?: boolean;
      reflectionAcknowledgementRequired?: boolean;
      safety?: { category: SafetyCategory; interrupt: boolean; userMessage?: string };
    }>(
      "/api/guest-readings",
      "POST",
      {
        action: "prepare",
        ...(personalize ? { birthDate } : {}),
        question: finalQuestion,
        questionConfirmed: true,
        reversalMode: "reversals_enabled",
        personalizationMode,
        continueAsReflection,
        termsAccepted: consented,
        privacyAccepted: consented,
        ageConfirmed: consented,
      },
      { headers: { [GUEST_DEVICE_HEADER]: deviceId } },
    );
    setLoading(false);
    const safety = response.data.safety as
      { category: SafetyCategory; interrupt: boolean; userMessage?: string } | undefined;
    if (safety?.interrupt) {
      setSafetyInterrupt({
        category: safety.category,
        userMessage: safety.userMessage,
        origin: "question",
      });
      return;
    }
    if (!response.ok && response.data.reflectionAcknowledgementRequired === true && safety) {
      setConfirmedQuestion(finalQuestion);
      setGuardedPrompt({ category: safety.category });
      send({ type: "CONFIRM_QUESTION" });
      send({ type: "CONFIRM_SPREAD" });
      send({ type: "HIGH_STAKES" });
      return;
    }
    if (!response.ok && response.data.signupRequired === true) {
      setStoredReceiptAvailable(Boolean(readLocal(GUEST_READING_RECEIPT_KEY)));
      setTrialUsed(true);
      return;
    }
    const prepared = response.ok ? drawCeremonySchema.safeParse(response.data.ceremony) : undefined;
    if (!prepared?.success) {
      showError(
        response.ok ? "The deck couldn’t be prepared just now. Please try again." : response.error,
        [{ label: "Try again", onClick: () => void prepareRitual(continueAsReflection) }],
      );
      return;
    }
    // Only now, with the ceremony in hand, does the ritual move on; a failure
    // above leaves the question on screen exactly as it was typed.
    setConfirmedQuestion(finalQuestion);
    setGuardedPrompt(undefined);
    setCeremony(prepared.data);
    setSelectedIndexes([]);
    clientNonce.current = createClientDrawNonce();
    stirCount.current = 0;
    savePendingSession({
      kind: "ceremony",
      token: prepared.data.token,
      stage: "shuffling",
      clientNonce: clientNonce.current,
      stirCount: 0,
      selectedIndexes: [],
    });
    if (continueAsReflection) send({ type: "CONTINUE_AS_REFLECTION" });
    else {
      send({ type: "CONFIRM_QUESTION" });
      send({ type: "CONFIRM_SPREAD" });
      send({ type: "SAFETY_APPROVED" });
    }
    // The deck itself announces the spread the question calls for.
    send({ type: "FOCUS_COMPLETE" });
  };

  const restartCeremony = useCallback(
    (message: string) => {
      savePendingSession(undefined);
      saveIntakeDraft({ question: confirmedQuestion || question, consented, personalize });
      onRestart(birthDate || undefined, message);
    },
    [birthDate, confirmedQuestion, consented, onRestart, personalize, question],
  );

  const chooseDifferentCards = useCallback(() => {
    clearProblem();
    setSelectedIndexes([]);
    if (!ceremony) return;
    savePendingSession({
      kind: "ceremony",
      token: ceremony.token,
      stage: "selectingCards",
      clientNonce: clientNonce.current ?? createClientDrawNonce(),
      stirCount: stirCount.current,
      selectedIndexes: [],
    });
  }, [ceremony, clearProblem]);

  const finalizeDraw = useCallback(
    async (picks: readonly number[]) => {
      if (!deviceId || !ceremony || loading || picks.length !== ceremony.spread.positions.length)
        return;
      const pendingNonce = clientNonce.current ?? createClientDrawNonce();
      clientNonce.current = pendingNonce;
      setLoading(true);
      clearProblem();
      if (state.matches("selectingCards")) send({ type: "SELECTION_COMPLETE" });
      const lock = (pureTarotFallback: boolean) =>
        sendJson<unknown>(
          "/api/guest-readings",
          "POST",
          {
            action: "finalize",
            ceremonyToken: ceremony.token,
            clientNonce: pendingNonce,
            cutIndex: 0,
            selectedIndexes: picks,
            ...(pureTarotFallback ? { pureTarotFallback: true } : {}),
          },
          { headers: { [GUEST_DEVICE_HEADER]: deviceId } },
        );
      let response = await lock(false);
      if (
        !response.ok &&
        (response.data as Record<string, unknown>).birthdayLensUnavailable === true
      )
        // Same cards, read without the birthday lens.
        response = await lock(true);
      const payload = response.ok ? guestReadingResponseSchema.safeParse(response.data) : undefined;
      if (!payload?.success) {
        setLoading(false);
        const data = response.data as Record<string, unknown>;
        send({ type: "FINALIZATION_FAILED" });
        if (response.status === 410) {
          restartCeremony(FRESH_DECK_NOTICE);
          return;
        }
        if (response.status === 409 && data.signupRequired === true) {
          savePendingSession(undefined);
          setCeremony(undefined);
          setStoredReceiptAvailable(Boolean(readLocal(GUEST_READING_RECEIPT_KEY)));
          setTrialUsed(true);
          return;
        }
        showError(
          response.ok
            ? "Your cards couldn’t be laid out just now. Please try again."
            : response.error,
          [
            {
              label: "Try again",
              onClick: () => {
                clearProblem();
                retryFinalize.current();
              },
            },
            { label: "Choose different cards", onClick: chooseDifferentCards },
          ],
        );
        return;
      }
      // Measure while the picked shells are still on screen, once at rest.
      if (!reducedMotion) await awaitCasinoPickFlights();
      setCardHandoff(
        reducedMotion ? undefined : measureCasinoPickHandoff(ceremony.spread.positions),
      );
      rememberReading(payload.data);
      savePendingSession({
        kind: "receipt",
        receipt: payload.data.receipt,
        revealedIndexes: [],
        resultUnlocked: false,
      });
      saveIntakeDraft(undefined);
      setNotice(payload.data.personalizationFallback ? PURE_TAROT_NOTICE : undefined);
      setLoading(false);
      send({ type: "DRAW_LOCKED" });
    },
    [
      ceremony,
      chooseDifferentCards,
      clearProblem,
      deviceId,
      loading,
      reducedMotion,
      rememberReading,
      restartCeremony,
      send,
      showError,
      state,
    ],
  );

  // Draws lock only when the reader confirms "These are my cards".
  const confirmSelection = useCallback(() => {
    if (!ceremony || selectedIndexes.length !== ceremony.spread.positions.length) return;
    void finalizeDraw(selectedIndexes);
  }, [ceremony, finalizeDraw, selectedIndexes]);
  useEffect(() => {
    retryFinalize.current = confirmSelection;
  }, [confirmSelection]);

  const saveCurrentCeremony = (stage: CeremonyStage, picks = selectedIndexes) => {
    if (!ceremony) return;
    const pendingNonce = clientNonce.current ?? createClientDrawNonce();
    clientNonce.current = pendingNonce;
    savePendingSession({
      kind: "ceremony",
      token: ceremony.token,
      stage,
      clientNonce: pendingNonce,
      stirCount: stirCount.current,
      selectedIndexes: [...picks],
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
      clearProblem();
      if (receipt)
        savePendingSession({
          kind: "receipt",
          receipt,
          revealedIndexes: [...next],
          resultUnlocked: false,
        });
    },
    [clearProblem, reading, receipt, state],
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
    if (reading.result) {
      send({ type: "ALL_REVEALED" });
      return;
    }
    resultUnlockStarted.current = true;
    setUnlocking(true);
    clearProblem();
    const response = await sendJson<unknown>(
      "/api/guest-readings",
      "POST",
      { action: "reveal", receipt },
      { headers: { [GUEST_DEVICE_HEADER]: deviceId } },
    );
    setUnlocking(false);
    const payload = response.ok ? guestReadingResponseSchema.safeParse(response.data) : undefined;
    if (!payload?.success || !payload.data.reading.result) {
      resultUnlockStarted.current = false;
      setUnlockHalted(true);
      showError(
        response.ok
          ? "Your reading couldn’t be opened just now. Please try again."
          : response.error,
        [
          {
            label: "Try again",
            onClick: () => {
              clearProblem();
              setUnlockHalted(false);
            },
          },
        ],
      );
      return;
    }
    setReading(payload.data.reading);
    savePendingSession({
      kind: "receipt",
      receipt,
      revealedIndexes: payload.data.reading.cards.map((_, index) => index),
      resultUnlocked: true,
    });
    send({ type: "ALL_REVEALED" });
  }, [clearProblem, deviceId, reading, receipt, send, showError]);

  useEffect(() => {
    if (
      !state.matches("revealing") ||
      activeReveal !== null ||
      !reading ||
      revealed.size !== reading.cards.length ||
      unlockHalted
    )
      return;
    const timer = window.setTimeout(() => void unlockCompleteReading(), 0);
    return () => window.clearTimeout(timer);
  }, [activeReveal, reading, revealed, state, unlockCompleteReading, unlockHalted]);

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
    clearProblem();
    const response = await sendJson<Record<string, unknown>>(
      "/api/guest-readings/continue",
      "POST",
      { action: "followUp", receipt, question: followUp },
    );
    setFollowUpLoading(false);
    const safety = response.data.safety as
      { category: SafetyCategory; interrupt: boolean; userMessage?: string } | undefined;
    if (safety?.interrupt) {
      setSafetyInterrupt({
        category: safety.category,
        userMessage: safety.userMessage,
        origin: "followUp",
      });
      return;
    }
    if (!response.ok) {
      showError(
        response.error,
        response.data.newReadingRequired === true
          ? [
              {
                label: "Begin a new reading",
                onClick: () => router.push(hasProfile ? "/readings" : "/onboarding"),
              },
            ]
          : [{ label: "Try again", onClick: () => void submitFollowUp() }],
      );
      return;
    }
    const parsed = guestFollowUpResponseSchema.safeParse(response.data);
    if (!parsed.success) {
      showError("These cards couldn’t answer just now. Please try again.", [
        { label: "Try again", onClick: () => void submitFollowUp() },
      ]);
      return;
    }
    setAskedFollowUp(followUp.trim());
    setFollowUpResult(parsed.data);
  };

  const banners = (
    <>
      {problem ? <GuestProblemBanner onDismiss={clearProblem} problem={problem} /> : null}
      {!problem && notice ? (
        <GuestNoticeBanner notice={notice} onDismiss={() => setNotice(undefined)} />
      ) : null}
    </>
  );

  if (safetyInterrupt?.origin === "question")
    return (
      <SafetyInterruptPanel
        category={safetyInterrupt.category}
        exitHref="/"
        exitLabel="Return home"
        onRevise={() => {
          setSafetyInterrupt(undefined);
          window.setTimeout(() => questionHeadingRef.current?.focus(), 0);
        }}
        {...(safetyInterrupt.userMessage ? { userMessage: safetyInterrupt.userMessage } : {})}
      />
    );

  if (continueRequested) {
    const continuationResult = continuationReading?.result;
    return (
      <MysticSanctuaryScene
        backdrop="starry-reading"
        focusStage="actions"
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
              <h1>Create your free account to keep going with these same cards.</h1>
              <p>
                We’ll keep these exact cards for you for 7 days — signing up never reshuffles them.
              </p>
              <div className="guest-conversion-actions">
                <Link className="sg-button sg-button--primary" href={links.signup}>
                  Sign up to ask a follow-up
                </Link>
                <Link className="sg-button sg-button--secondary" href={links.signin}>
                  I already have an account
                </Link>
              </div>
            </div>
          ) : requiresPolicyReconsent ? (
            <div className="guest-conversion-card">
              <p className="page-eyebrow">One quick update</p>
              <h1>Please review our updated policies before continuing.</h1>
              <Link
                className="sg-button sg-button--primary"
                href={`/consent?next=${encodeURIComponent(continuationPath)}`}
              >
                Review policies
              </Link>
            </div>
          ) : continuationLoading ? (
            <div className="sanctuary-loading" role="status">
              <span aria-hidden="true">✦</span> Opening your reading…
            </div>
          ) : continuationReading && continuationResult ? (
            <div className="guest-continuation-reading">
              <header>
                <p className="page-eyebrow">Same cards, now in your account</p>
                <h1>Your free reading</h1>
                <p>Kept here until {formatDay(continuationReading.receiptExpiresAt)}</p>
              </header>
              <div
                className="guest-continuation-keepsake"
                data-card-ids={continuationReading.cards.map(({ cardId }) => cardId).join(" ")}
                data-testid="guest-continuation-keepsake"
              >
                <ReadingKeepsake
                  cards={keepsakeCardsFrom(continuationReading.cards, continuationResult)}
                  createdAt={continuationReading.createdAt}
                  followUps={
                    followUpResult
                      ? [
                          {
                            id: "guest-follow-up",
                            ...(askedFollowUp ? { question: askedFollowUp } : {}),
                            answer: followUpResult.followUp.response,
                          },
                        ]
                      : []
                  }
                  question={continuationReading.question}
                  sections={keepsakeSectionsFrom(continuationResult)}
                  spreadName={spreadNameFor(continuationReading)}
                />
              </div>
              {safetyInterrupt?.origin === "followUp" ? (
                <section className="guest-follow-up-answer">
                  <SafetyInterruptContent
                    category={safetyInterrupt.category}
                    dismissLabel="Return to my reading"
                    onDismiss={() => setSafetyInterrupt(undefined)}
                    {...(safetyInterrupt.userMessage
                      ? { userMessage: safetyInterrupt.userMessage }
                      : {})}
                  />
                </section>
              ) : followUpResult ? (
                <p className="guest-follow-up-note" role="status">
                  {followUpResult.personalizedByPrivateProfile
                    ? "Your birthday lens gently shaped this answer; the cards stayed exactly as drawn."
                    : "This answer is pure tarot; the cards stayed exactly as drawn."}
                </p>
              ) : (
                <div className="guest-follow-up-composer">
                  <QuestionComposer
                    hint="Stay with the same question and ask what these cards add. A new question deserves fresh cards."
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
              <nav aria-label="Where to next" className="guest-continuation-next">
                <p>
                  Guest readings stay here rather than in your history. Begin a new reading to keep
                  one in your account.
                </p>
                <div className="guest-conversion-actions">
                  <Link
                    className="sg-button sg-button--primary"
                    href={hasProfile ? "/readings" : "/onboarding"}
                  >
                    {hasProfile ? "Begin a new reading" : "Create my private profile"}
                  </Link>
                  <Link className="sg-button sg-button--secondary" href="/history">
                    History
                  </Link>
                </div>
              </nav>
            </div>
          ) : (
            <div className="guest-conversion-card">
              <p className="page-eyebrow">
                {continuationExpired
                  ? "This reading has closed"
                  : "We couldn’t find your reading here"}
              </p>
              {continuationExpired ? (
                <>
                  <h1>Your saved guest reading expired after 7 days.</h1>
                  <p>Your account is ready for a fresh reading whenever you are.</p>
                </>
              ) : (
                <>
                  <h1>Your reading is waiting in the browser where you drew it.</h1>
                  <p>Open this link there, or begin a new reading.</p>
                </>
              )}
              <div className="guest-conversion-actions">
                <Link
                  className="sg-button sg-button--primary"
                  href={hasProfile ? "/readings" : "/onboarding"}
                >
                  {hasProfile ? "Begin a new reading" : "Create my private profile"}
                </Link>
              </div>
            </div>
          )}
          {banners}
        </section>
      </MysticSanctuaryScene>
    );
  }

  if (bootstrapLoading)
    return (
      <MysticSanctuaryScene phase="idle" reducedMotion={reducedMotion}>
        <div className="sanctuary-loading" role="status">
          <span aria-hidden="true">✦</span> Setting out the deck…
        </div>
      </MysticSanctuaryScene>
    );

  if (authenticated && !reading)
    return (
      <MysticSanctuaryScene phase="readingCreated" reducedMotion={reducedMotion}>
        <section className="guest-conversion-card guest-account-return">
          <p className="page-eyebrow">You’re signed in</p>
          <h1>Your readings live in your account now.</h1>
          <p>
            The free reading is for visitors. In your account you can choose any spread, keep every
            reading in your history, and ask the same cards a follow-up.
          </p>
          <div className="guest-conversion-actions">
            <Link
              className="sg-button sg-button--primary"
              href={hasProfile ? "/readings" : "/onboarding"}
            >
              {hasProfile ? "Go to my readings" : "Create my private profile"}
            </Link>
            <Link className="sg-button sg-button--secondary" href="/">
              Return home
            </Link>
          </div>
        </section>
      </MysticSanctuaryScene>
    );

  if (trialUsed && !reading && !ceremony)
    return (
      <MysticSanctuaryScene phase="complete" reducedMotion={reducedMotion}>
        <section
          className="guest-conversion-card guest-account-return"
          data-testid="guest-trial-used"
        >
          <p className="page-eyebrow">You’ve had your free reading</p>
          <h1>Keep going with a free account.</h1>
          {receiptExpired ? <p>Your saved guest reading expired after 7 days.</p> : null}
          <ul className="guest-account-benefits">
            <li>Keep every reading in your private history.</li>
            <li>Ask the same cards a follow-up question.</li>
            <li>Choose from every spread, shaped by your own profile.</li>
          </ul>
          <div className="guest-conversion-actions">
            {storedReceiptAvailable && !receiptExpired ? (
              <button
                className="sg-button sg-button--secondary"
                onClick={() => {
                  savePendingSession(undefined);
                  onRestart();
                }}
                type="button"
              >
                Reopen my free reading
              </button>
            ) : null}
            <Link className="sg-button sg-button--primary" href={links.signup}>
              Sign up
            </Link>
            <Link className="sg-button sg-button--secondary" href={links.signin}>
              Sign in
            </Link>
          </div>
          {banners}
        </section>
      </MysticSanctuaryScene>
    );

  const showQuestion = state.matches("questionDrafting");
  const transcriptVisible =
    (state.matches("interpretationStreaming") ||
      state.matches("followUpAvailable") ||
      state.matches("complete")) &&
    Boolean(reading?.result);
  // The locked cards take the stage the moment the fan lets go of them and
  // hold where the reader placed them until each is dealt into its slot.
  const dealing = Boolean(reading) && (state.matches("drawLocked") || state.matches("dealing"));
  const deckVisible =
    state.matches("shuffling") ||
    state.matches("selectingCards") ||
    state.matches("drawFinalizing") ||
    (state.matches("drawLocked") && !reading);
  const gateVisible =
    (state.matches("followUpAvailable") || state.matches("complete")) &&
    journeyComplete &&
    Boolean(reading);
  // Once the reading is finished the keepsake under the gate shows every
  // card, so the stage steps aside rather than competing with it.
  const cardsVisible =
    !gateVisible &&
    (dealing ||
      state.matches("awaitingReveal") ||
      state.matches("revealing") ||
      state.matches("fullSpreadReady") ||
      state.matches("interpretationStreaming") ||
      state.matches("followUpAvailable") ||
      state.matches("complete"));
  const activeRevealCard = activeReveal === null ? undefined : reading?.cards[activeReveal];
  const readingFocusStage = transcriptVisible
    ? journeyComplete
      ? "actions"
      : "reading"
    : state.matches("focusing") ||
        state.matches("shuffling") ||
        state.matches("selectingCards") ||
        state.matches("drawFinalizing") ||
        state.matches("drawLocked") ||
        state.matches("dealing") ||
        cardsVisible
      ? "cards"
      : "ambient";
  const questionLength = question.length;

  return (
    <MysticSanctuaryScene
      backdrop={readingFocusStage === "ambient" ? "sanctuary" : "starry-reading"}
      focusStage={readingFocusStage}
      phase={String(state.value)}
      reducedMotion={reducedMotion}
      testId="guest-reading-experience"
    >
      <header className="guest-reading-toolbar">
        <Link className="guest-reading-brand" href="/">
          <span aria-hidden="true">✦</span> StarGuidance
        </Link>
        {state.matches("dealing") && !dealMotionOff ? (
          // Fast-forwards this deal only; the saved motion preference is untouched.
          <button className="guest-skip-action" onClick={() => setFastForward(true)} type="button">
            <span aria-hidden="true">⇥</span> Skip the deal
          </button>
        ) : null}
        <button
          aria-pressed={reducedMotion}
          className="guest-motion-toggle"
          disabled={systemReducedMotion}
          onClick={() => setReducedMotion(!reducedMotion)}
          type="button"
        >
          {systemReducedMotion
            ? "Motion: Reduced (device setting)"
            : reducedMotion
              ? "Motion: Reduced"
              : "Motion: Full"}
        </button>
      </header>

      {banners}

      {showQuestion && intakeStep === "about" && (
        <section
          aria-labelledby="guest-intake-heading"
          className="guest-prerequisite-stage guest-intake"
        >
          <form
            className="guest-intake-form"
            onSubmit={(event) => {
              event.preventDefault();
              advanceToQuestion();
            }}
          >
            <h1 id="guest-intake-heading" ref={aboutHeadingRef} tabIndex={-1}>
              Your free tarot reading
            </h1>
            <p className="guest-intake-lede">
              Your birthday gently colours the reading; it never chooses the cards.
            </p>
            <label className="guest-personalize-toggle">
              <input
                checked={personalize}
                onChange={(event) => setPersonalize(event.target.checked)}
                role="switch"
                type="checkbox"
              />
              <span>Personalize with my birthday</span>
            </label>
            {personalize ? (
              <label className="guest-birth-date-field">
                <span>Your birthday</span>
                <input
                  aria-describedby="guest-birth-date-hint"
                  autoComplete="bday"
                  max={latestAdultBirthDate}
                  min={OLDEST_BIRTH_DATE}
                  onChange={(event) => setBirthDate(event.target.value)}
                  required
                  type="date"
                  value={birthDate}
                />
                <small id="guest-birth-date-hint">
                  {birthDate && !birthDateValid
                    ? "Please enter a birthday from 1900 onward; free readings are for adults 18 and over."
                    : "Used only for this reading’s lens, never stored with your cards."}
                </small>
              </label>
            ) : (
              <p className="guest-intake-note">
                Pure tarot: the cards speak on their own, with no birthday needed.
              </p>
            )}
            <fieldset className="guest-policy-consents">
              <legend className="sr-only">Agreement</legend>
              <label>
                <input
                  checked={consented}
                  onChange={(event) => setConsented(event.target.checked)}
                  type="checkbox"
                />
                <span>
                  I’m 18 or older, I agree to the <Link href="/terms">Terms</Link>, and I’ve read
                  the <Link href="/privacy">Privacy Notice</Link>.
                </span>
              </label>
            </fieldset>
            <button className="guest-intake-continue" disabled={!aboutReady} type="submit">
              Continue
            </button>
          </form>
        </section>
      )}

      {showQuestion && intakeStep === "question" && (
        <section aria-labelledby="guest-question-heading" className="minimal-question-stage">
          <h1 id="guest-question-heading" ref={questionHeadingRef} tabIndex={-1}>
            What would you like to ask the cards?
          </h1>
          <p className="guest-question-context">
            {personalize && birthDate ? `Born ${formatBirthDate(birthDate)}` : "Pure tarot"} ·{" "}
            <button className="guest-inline-link" onClick={returnToAbout} type="button">
              change
            </button>
          </p>
          <form
            aria-busy={loading}
            className="minimal-question-form guest-question-form"
            onSubmit={(event) => {
              event.preventDefault();
              void prepareRitual();
            }}
          >
            <textarea
              aria-describedby="guest-question-hint"
              aria-labelledby="guest-question-heading"
              maxLength={QUESTION_LIMIT}
              onChange={(event) => setQuestion(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
                  event.preventDefault();
                  event.currentTarget.form?.requestSubmit();
                }
              }}
              placeholder="What do I need to understand about…"
              readOnly={loading}
              value={question}
            />
            <button disabled={!question.trim() || loading} type="submit">
              {loading ? "Consulting the deck…" : "Draw my cards"}
            </button>
          </form>
          <p className="guest-question-hint" id="guest-question-hint">
            Open questions work best — “what” or “how” rather than yes or no.
            {questionLength >= 400 ? (
              <span className="guest-question-counter">
                {" "}
                {questionLength} / {QUESTION_LIMIT}
              </span>
            ) : null}
          </p>
          <div aria-label="Example questions" className="guest-question-examples" role="group">
            {EXAMPLE_QUESTIONS.map((example) => (
              <button
                disabled={loading}
                key={example}
                onClick={() => setQuestion(example)}
                type="button"
              >
                {example}
              </button>
            ))}
          </div>
          {loading ? (
            <p className="sr-only" role="status">
              Consulting the deck…
            </p>
          ) : null}
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
                {loading ? "Consulting the deck…" : "Continue as reflection"}
              </button>
              <button
                className="ritual-action"
                onClick={() => {
                  setGuardedPrompt(undefined);
                  send({ type: "REVISE_QUESTION" });
                  window.setTimeout(() => questionHeadingRef.current?.focus(), 0);
                }}
                type="button"
              >
                Revise the question
              </button>
            </div>
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
            onFinishWash={() => {
              saveCurrentCeremony("selectingCards");
              send({ type: "SHUFFLE_COMPLETE" });
            }}
            onSelect={(index) => {
              const next = [...selectedIndexes, index];
              setSelectedIndexes(next);
              saveCurrentCeremony("selectingCards", next);
            }}
            onDeselect={(index) => {
              const next = selectedIndexes.filter((picked) => picked !== index);
              setSelectedIndexes(next);
              saveCurrentCeremony("selectingCards", next);
            }}
            onConfirm={confirmSelection}
            confirming={loading || state.matches("drawFinalizing")}
            onStir={stirPendingDeck}
            phase={state.matches("shuffling") ? "washing" : "selecting"}
            positions={ceremony.spread.positions}
            reducedMotion={reducedMotion}
            selectedIndexes={selectedIndexes}
            slots={slots}
          />
        </section>
      )}

      {cardsVisible && reading && (
        <section
          className={`sanctuary-stage ${dealing ? "is-dealing" : ""} ${state.matches("awaitingReveal") ? "is-reflecting" : ""} ${state.matches("revealing") ? "is-guided-reveal" : ""} ${transcriptVisible && !journeyComplete ? "has-reading-journey" : ""}`}
        >
          <div className="ritual-card-layout" data-testid={dealing ? "guest-deal" : undefined}>
            <TarotSpreadStage
              activeIndex={activeReveal}
              cards={reading.cards}
              dealing={dealing}
              focusMode={activeReveal === null ? null : "reveal"}
              handoff={dealMotionOff ? undefined : cardHandoff}
              layoutKey={[
                dealing ? "dealing" : "",
                state.matches("awaitingReveal") ? "reflecting" : "",
                state.matches("revealing") ? "revealing" : "",
                transcriptVisible && !journeyComplete ? "journey" : "",
                readingFocusStage,
              ].join("|")}
              reducedMotion={dealMotionOff}
              revealDescribedBy="guest-reveal-instructions"
              revealed={revealed}
              settledCount={dealtCount}
              onReveal={
                state.matches("revealing") && activeReveal === null ? revealCard : undefined
              }
            />
            {dealing && (
              <p className="ritual-deal-status" role="status">
                {dealtCount === 0
                  ? "Your chosen cards are coming to the table."
                  : `Laying card ${dealtCount} of ${reading.cards.length} in its place…`}
              </p>
            )}
            {state.matches("awaitingReveal") && (
              <div className="ritual-question-reflection" data-testid="guest-question-reflection">
                <span>Hold your question in mind</span>
                <blockquote>{reading.question}</blockquote>
                <p>
                  Every card is still face down. When you’re ready, turn the cards over one at a
                  time.
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
                    <strong>Choose any face-down card</strong>
                    <small>Turn them over one at a time, in any order.</small>
                  </p>
                  <span>
                    {revealed.size} of {reading.cards.length}
                  </span>
                  <button className="ritual-action" onClick={revealAll} type="button">
                    Turn over all cards
                  </button>
                </div>
              )}
            {state.matches("revealing") &&
              activeReveal === null &&
              revealed.size === reading.cards.length &&
              unlocking && (
                <p className="stage-whisper" role="status">
                  Gathering the whole reading…
                </p>
              )}
            <p className="sr-only" id="guest-reveal-instructions">
              Press Enter or Space to turn this card over.
            </p>
          </div>
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
              All your cards are showing. Now they can be read together…
            </p>
          )}
        </section>
      )}

      <div
        className={`oracle-console-stack ${transcriptVisible ? "" : "is-inactive"} ${journeyComplete ? "is-actions" : "is-reading"}`}
        data-focus-stage={readingFocusStage}
      >
        {transcriptVisible && !journeyComplete && reading?.result ? (
          <OracleTranscript
            active
            cards={reading.cards}
            key={transcriptEpoch}
            onJourneyCompleteChange={setJourneyComplete}
            onRetry={() => undefined}
            previewEvents={readingPreviewEvents}
            readingId={reading.id}
            reducedMotion={reducedMotion}
            result={reading.result}
            retryToken={0}
            audioEnabled={false}
            target="guest-primary"
          />
        ) : null}
        {gateVisible && reading ? (
          <div className="guest-settled-reading">
            <section
              aria-labelledby="guest-signup-gate-heading"
              className="guest-conversion-card guest-reading-result-gate"
              data-testid="guest-signup-gate"
            >
              <p className="page-eyebrow">Your reading is complete</p>
              <h2 id="guest-signup-gate-heading">Want to ask these same cards a follow-up?</h2>
              <p>
                We’ll keep these exact cards for you for 7 days — signing up never reshuffles them.
              </p>
              <div className="guest-conversion-actions">
                <Link className="sg-button sg-button--primary" href={links.signup}>
                  Sign up to continue
                </Link>
                <Link className="sg-button sg-button--secondary" href={links.signin}>
                  Sign in
                </Link>
              </div>
              <Link className="guest-settle-link" href="/">
                Close — you can return to this reading until {formatDay(reading.receiptExpiresAt)}
              </Link>
            </section>
            {reading.result ? (
              <ReadingKeepsake
                cards={keepsakeCardsFrom(reading.cards, reading.result)}
                createdAt={reading.createdAt}
                onReplay={() => {
                  setTranscriptEpoch((epoch) => epoch + 1);
                  setJourneyComplete(false);
                }}
                question={reading.question}
                replayLabel="Read it again"
                sections={keepsakeSectionsFrom(reading.result)}
                spreadName={spreadNameFor(reading)}
              />
            ) : null}
          </div>
        ) : null}
      </div>
    </MysticSanctuaryScene>
  );
}

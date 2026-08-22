"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useMachine } from "@xstate/react";
import type { SafetyCategory } from "@starguidance/ai";
import type { OracleStreamEvent } from "@starguidance/contracts";
import { readingMachine } from "@starguidance/reading-machine";

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
import { ShuffleShells } from "../session/[id]/shuffle-shells";
import { SafetyInterruptPanel } from "../session/[id]/safety-interrupt-panel";
import { TarotSpreadStage } from "../session/[id]/tarot-spread-stage";

type PhaseEvent = Extract<OracleStreamEvent, { type: "phase" }>;
type FreeSpread = {
  id: "three-card" | "one-card";
  name: string;
  purpose: string;
  estimatedMinutes: number;
  count: number;
};

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

function phaseEvents(reading: GuestReadingDisplay): readonly PhaseEvent[] {
  return reading.previewEvents.filter((event): event is PhaseEvent => event.type === "phase");
}

function restoreSessionReading(): GuestReadingDisplay | undefined {
  try {
    const stored = sessionStorage.getItem(GUEST_READING_SESSION_KEY);
    if (!stored) return undefined;
    const parsed = guestReadingDisplaySchema.safeParse(JSON.parse(stored));
    return parsed.success ? parsed.data : undefined;
  } catch {
    return undefined;
  }
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
  const [selected, setSelected] = useState<FreeSpread["id"]>("three-card");
  const [birthDate, setBirthDate] = useState("");
  const [question, setQuestion] = useState("");
  const [termsAccepted, setTermsAccepted] = useState(false);
  const [privacyAccepted, setPrivacyAccepted] = useState(false);
  const [ageConfirmed, setAgeConfirmed] = useState(false);
  const [deviceId, setDeviceId] = useState<string>();
  const [reading, setReading] = useState<GuestReadingDisplay>();
  const [receipt, setReceipt] = useState<string>();
  const [trialUsed, setTrialUsed] = useState(false);
  const [eligibilityLoading, setEligibilityLoading] = useState(true);
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
  const [journeyComplete, setJourneyComplete] = useState(false);
  const [activeReadingCard, setActiveReadingCard] = useState<number | null>(null);
  const [continuationReading, setContinuationReading] = useState<GuestReadingDisplay>();
  const [continuationLoading, setContinuationLoading] = useState(continueRequested);
  const [followUp, setFollowUp] = useState("");
  const [followUpResult, setFollowUpResult] = useState<GuestFollowUpResponse>();
  const [followUpLoading, setFollowUpLoading] = useState(false);

  const selectedSpread = spreads.find(({ id }) => id === selected) ?? spreads[0];
  const consentsReady = termsAccepted && privacyAccepted && ageConfirmed;
  const intakeReady = consentsReady && Boolean(birthDate);
  const restoredQuestion = question || "The intention you brought to this private moment";
  const continuationReadingRevealed = useMemo(
    () => new Set(continuationReading?.cards.map((_, index) => index) ?? []),
    [continuationReading],
  );

  useEffect(() => {
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setReducedMotion(media.matches);
    const timer = window.setTimeout(update, 0);
    media.addEventListener("change", update);
    return () => {
      window.clearTimeout(timer);
      media.removeEventListener("change", update);
    };
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      send({ type: "START" });
      const device = storedDeviceId();
      setDeviceId(device);
      try {
        setReceipt(localStorage.getItem(GUEST_READING_RECEIPT_KEY) ?? undefined);
        const localTrialUsed = Boolean(localStorage.getItem(GUEST_TRIAL_LOCAL_MARKER_KEY));
        setTrialUsed(localTrialUsed);
        if (localTrialUsed) setEligibilityLoading(false);
      } catch {
        // Cookie enforcement remains available when browser storage is blocked.
      }
      if (continueRequested) return;
      const restored = restoreSessionReading();
      if (!restored) return;
      setReading(restored);
      setRevealed(new Set(restored.cards.map((_, index) => index)));
      setDealtCount(restored.cards.length);
      for (const event of [
        { type: "SELECT" },
        { type: "QUESTION_ACCEPTED" },
        { type: "DECK_READY" },
        { type: "SHUFFLE_COMPLETE" },
        { type: "SKIP_CUT" },
        { type: "DEALT" },
        { type: "REVEAL" },
        { type: "ALL_REVEALED" },
        { type: "GENERATION_READY" },
        { type: "RESULT_REVEALED" },
      ] as const)
        send(event);
      setEligibilityLoading(false);
    }, 0);
    return () => window.clearTimeout(timer);
  }, [continueRequested, send]);

  useEffect(() => {
    if (!deviceId || continueRequested || reading) return;
    if (trialUsed) return;
    const controller = new AbortController();
    void fetch("/api/guest-readings", {
      cache: "no-store",
      headers: { [GUEST_DEVICE_HEADER]: deviceId },
      signal: controller.signal,
    })
      .then(async (response) => {
        const body = (await response.json()) as {
          eligible?: boolean;
          error?: string;
          signupRequired?: boolean;
        };
        if (!response.ok) setError(body.error ?? "Free-reading access could not be checked.");
        if (body.signupRequired || body.eligible === false) setTrialUsed(true);
      })
      .catch((cause: unknown) => {
        if (!controller.signal.aborted)
          setError(cause instanceof Error ? cause.message : "Free-reading access is unavailable.");
      })
      .finally(() => setEligibilityLoading(false));
    return () => controller.abort();
  }, [continueRequested, deviceId, reading, trialUsed]);

  useEffect(() => {
    if (!state.matches("shuffling")) return;
    const timer = window.setTimeout(
      () => send({ type: "SHUFFLE_COMPLETE" }),
      reducedMotion ? 80 : 6_000,
    );
    return () => window.clearTimeout(timer);
  }, [reducedMotion, send, state]);

  useEffect(() => {
    if (!state.matches("cuttingDeck")) return;
    const timer = window.setTimeout(() => send({ type: "SKIP_CUT" }), reducedMotion ? 0 : 900);
    return () => window.clearTimeout(timer);
  }, [reducedMotion, send, state]);

  useEffect(() => {
    if (!state.matches("dealing") || !reading) return;
    if (reducedMotion) {
      const showTimer = window.setTimeout(() => setDealtCount(reading.cards.length), 0);
      const completeTimer = window.setTimeout(() => send({ type: "DEALT" }), 60);
      return () => {
        window.clearTimeout(showTimer);
        window.clearTimeout(completeTimer);
      };
    }
    const timers: number[] = [];
    const deal = (index: number) => {
      setDealtCount(index + 1);
      if (index + 1 < reading.cards.length)
        timers.push(window.setTimeout(() => deal(index + 1), 650));
      else timers.push(window.setTimeout(() => send({ type: "DEALT" }), 500));
    };
    timers.push(window.setTimeout(() => deal(0), 120));
    return () => timers.forEach((timer) => window.clearTimeout(timer));
  }, [reading, reducedMotion, send, state]);

  useEffect(() => {
    if (!continueRequested || !authenticated || !deviceId) return;
    let controller: AbortController | undefined;
    const timer = window.setTimeout(() => {
      let storedReceipt: string | undefined;
      try {
        storedReceipt = localStorage.getItem(GUEST_READING_RECEIPT_KEY) ?? undefined;
      } catch {
        // The error below explains that this browser cannot recover the handoff.
      }
      if (!storedReceipt) {
        setContinuationLoading(false);
        setError("This browser no longer has the encrypted guest-reading handoff.");
        return;
      }
      setReceipt(storedReceipt);
      controller = new AbortController();
      void fetch("/api/guest-readings/continue", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "recover", receipt: storedReceipt }),
        signal: controller.signal,
      })
        .then(async (response) => {
          const body = (await response.json()) as { reading?: unknown; error?: string };
          if (!response.ok || !body.reading)
            throw new Error(body.error ?? "The same draw could not be recovered.");
          setContinuationReading(guestReadingDisplaySchema.parse(body.reading));
        })
        .catch((cause: unknown) => {
          if (!controller?.signal.aborted)
            setError(
              cause instanceof Error ? cause.message : "The same draw could not be recovered.",
            );
        })
        .finally(() => setContinuationLoading(false));
    }, 0);
    return () => {
      window.clearTimeout(timer);
      controller?.abort();
    };
  }, [authenticated, continueRequested, deviceId]);

  const beginReading = async (continueAsReflection = false) => {
    if (!deviceId || !selectedSpread) return;
    setLoading(true);
    setError(undefined);
    setSafetyInterrupt(undefined);
    if (!continueAsReflection) setGuardedPrompt(undefined);
    try {
      const response = await fetch("/api/guest-readings", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          [GUEST_DEVICE_HEADER]: deviceId,
        },
        body: JSON.stringify({
          spreadId: selectedSpread.id,
          birthDate,
          question,
          continueAsReflection,
          termsAccepted,
          privacyAccepted,
          ageConfirmed,
        }),
      });
      const raw = (await response.json()) as {
        error?: string;
        reflectionAcknowledgementRequired?: boolean;
        safety?: { category: SafetyCategory; interrupt: boolean; guidance: string };
        signupRequired?: boolean;
      };
      if (raw.safety?.interrupt) {
        setSafetyInterrupt({ category: raw.safety.category, guidance: raw.safety.guidance });
        return;
      }
      if (raw.reflectionAcknowledgementRequired && raw.safety) {
        send({ type: "HIGH_STAKES" });
        setGuardedPrompt({ category: raw.safety.category });
        return;
      }
      if (raw.signupRequired) {
        setTrialUsed(true);
        setError(raw.error ?? "Create an account to continue.");
        return;
      }
      if (!response.ok) {
        setError(raw.error ?? "The free reading could not begin.");
        return;
      }
      const payload = guestReadingResponseSchema.parse(raw);
      setReading(payload.reading);
      setReceipt(payload.receipt);
      try {
        sessionStorage.setItem(GUEST_READING_SESSION_KEY, JSON.stringify(payload.reading));
        localStorage.setItem(GUEST_READING_RECEIPT_KEY, payload.receipt);
        localStorage.setItem(GUEST_TRIAL_LOCAL_MARKER_KEY, new Date().toISOString());
      } catch {
        // The current in-memory ritual still works when browser storage is disabled.
      }
      if (continueAsReflection) send({ type: "CONTINUE_AS_REFLECTION" });
      else send({ type: "QUESTION_ACCEPTED" });
      send({ type: "DECK_READY" });
    } finally {
      setLoading(false);
    }
  };

  const revealCard = useCallback(
    (index: number) => {
      if (!reading) return;
      setRevealed((current) => {
        if (current.has(index)) return current;
        const next = new Set(current).add(index);
        if (next.size === reading.cards.length)
          window.setTimeout(
            () => {
              send({ type: "ALL_REVEALED" });
              send({ type: "GENERATION_READY" });
              send({ type: "RESULT_REVEALED" });
            },
            reducedMotion ? 30 : 500,
          );
        return next;
      });
    },
    [reading, reducedMotion, send],
  );

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
        safety?: { category: SafetyCategory; interrupt: boolean; guidance: string };
      };
      if (raw.safety?.interrupt) {
        setSafetyInterrupt({ category: raw.safety.category, guidance: raw.safety.guidance });
        return;
      }
      if (!response.ok) {
        setError(raw.error ?? "The same-draw follow-up could not be prepared.");
        return;
      }
      setFollowUpResult(guestFollowUpResponseSchema.parse(raw));
      try {
        localStorage.removeItem(GUEST_READING_RECEIPT_KEY);
      } catch {
        // The current response remains available in memory.
      }
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
                single card.
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
              <p>Your encrypted guest draw will remain in this browser while you do.</p>
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
          ) : continuationReading ? (
            <div className="guest-continuation-reading">
              <header>
                <p className="page-eyebrow">Same cards · account unlocked</p>
                <h1>{continuationReading.result.title}</h1>
                <p>
                  No card was redrawn. Ask one clarification and the original result stays fixed.
                </p>
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
                  <h2 id="guest-follow-up-heading">One more edge comes into view.</h2>
                  <p>{followUpResult.followUp.response}</p>
                  <small>
                    {followUpResult.personalizedByPrivateProfile
                      ? "Your private profile shaped this follow-up; it did not alter the cards."
                      : "This follow-up used no account profile and did not alter the cards."}
                  </small>
                  <div className="guest-conversion-actions">
                    <Link
                      className="sg-button sg-button--primary"
                      href={hasProfile ? "/readings" : "/onboarding"}
                    >
                      {hasProfile ? "Begin a saved reading" : "Create my private profile"}
                    </Link>
                    <Link className="sg-button sg-button--secondary" href="/">
                      Return home
                    </Link>
                  </div>
                </section>
              ) : (
                <div className="guest-follow-up-composer">
                  <QuestionComposer
                    hint="One follow-up · the draw remains exactly the same"
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
      <MysticSanctuaryScene phase="selectingReading" reducedMotion={reducedMotion}>
        <section className="guest-conversion-card guest-account-return">
          <p className="page-eyebrow">Your private space is open</p>
          <h1>Your account reading offers the fuller experience.</h1>
          <p>
            Use your saved profile, durable history, all spreads, and same-draw follow-ups instead
            of consuming the browser guest trial.
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

  if (eligibilityLoading)
    return (
      <MysticSanctuaryScene phase="idle" reducedMotion={reducedMotion}>
        <div className="sanctuary-loading" role="status">
          <span aria-hidden="true">✦</span> Preparing the guest threshold…
        </div>
      </MysticSanctuaryScene>
    );

  if (trialUsed && !reading)
    return (
      <MysticSanctuaryScene phase="complete" reducedMotion={reducedMotion}>
        <section className="guest-conversion-card guest-account-return">
          <p className="page-eyebrow">Your free reading has been experienced</p>
          <h1>Keep going inside a private account.</h1>
          <p>
            This browser has used its free draw. Sign up for saved readings, a private profile, and
            follow-ups that keep the same cards.
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

  const selecting = state.matches("selectingReading");
  const enteringQuestion = state.matches("enteringQuestion") || state.matches("highStakesQuestion");
  const cardsVisible =
    state.matches("dealing") ||
    state.matches("awaitingReveal") ||
    state.matches("revealingCards") ||
    state.matches("complete");

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

      {selecting ? (
        <section className="reading-entry-stage reading-selection-stage guest-reading-entry">
          <p>One reading · no account</p>
          <h1>Meet the cards before you decide to stay.</h1>
          <p className="guest-reading-intro">
            Choose a birthday-personalized ritual. Your date shapes the interpretation only; the
            draw stays genuinely random and no AI-provider request is made.
          </p>
          <div aria-label="Free reading type" className="ritual-spread-options" role="radiogroup">
            {spreads.map((spread) => (
              <label key={spread.id}>
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
                  <small>Included in your free guest reading</small>
                </span>
              </label>
            ))}
          </div>
          <button
            className="reading-entry-continue"
            onClick={() => send({ type: "SELECT" })}
            type="button"
          >
            Continue with {selectedSpread?.name ?? "this reading"}
          </button>
        </section>
      ) : null}

      {enteringQuestion ? (
        <>
          <section className="reading-entry-stage reading-question-stage guest-reading-entry">
            <div>
              <p>Set your intention</p>
              <h1>What would you like the cards to illuminate?</h1>
              <button
                className="selected-ritual-summary"
                onClick={() => {
                  setGuardedPrompt(undefined);
                  send({ type: "CHANGE_READING" });
                }}
                type="button"
              >
                <span>{selectedSpread?.name}</span>
                <small>Birthday-personalized · change reading</small>
              </button>
            </div>
          </section>
          <div className="oracle-console-stack reading-entry-console reading-question-console guest-question-console">
            <p className="entry-privacy-note">
              Your birthday is used by our private calculation service, then discarded from the
              guest handoff. Your raw date and question never enter a URL, analytics, or an AI
              provider.
            </p>
            {!guardedPrompt ? (
              <>
                <label className="guest-birth-date-field">
                  <span>Your birthday</span>
                  <input
                    aria-describedby="guest-birth-date-help"
                    autoComplete="bday"
                    onChange={(event) => setBirthDate(event.target.value)}
                    required
                    type="date"
                    value={birthDate}
                  />
                  <small id="guest-birth-date-help">
                    Used once to derive a stable date-based lens. It does not choose your cards or
                    become part of the saved guest receipt.
                  </small>
                </label>
                <QuestionComposer
                  disabled={!intakeReady}
                  hint="Write the question in your own words. Shift+Enter adds a line."
                  label="Your private guest question"
                  loading={loading}
                  onChange={setQuestion}
                  onSubmit={() => beginReading()}
                  placeholder="What can I understand or do about…"
                  submitLabel="Begin my free reading"
                  testId="guest-question-composer"
                  value={question}
                />
                <fieldset className="guest-policy-consents">
                  <legend>Before the cards are drawn</legend>
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
              </>
            ) : (
              <div className="ritual-moment" data-safety-category={guardedPrompt.category}>
                <p className="ritual-status" role="status">
                  The cards cannot establish this as fact. They can reflect on evidence,
                  preparation, boundaries, and choices without replacing professional advice.
                </p>
                <div className="ritual-action-group">
                  <button
                    className="ritual-action"
                    disabled={loading}
                    onClick={() => beginReading(true)}
                    type="button"
                  >
                    {loading ? "Preparing reflection…" : "Continue as reflection"}
                  </button>
                  <button
                    className="ritual-action"
                    onClick={() => {
                      setGuardedPrompt(undefined);
                      send({ type: "RESTART" });
                    }}
                    type="button"
                  >
                    Revise the question
                  </button>
                </div>
              </div>
            )}
            {!intakeReady && !guardedPrompt ? (
              <p className="guest-consent-hint">
                {!birthDate
                  ? "Enter your birthday, then accept all three guest commitments to begin."
                  : "Accept all three guest commitments to begin."}
              </p>
            ) : null}
            {error ? (
              <p className="sanctuary-error" role="alert">
                {error}
              </p>
            ) : null}
          </div>
        </>
      ) : null}

      <section
        className={`sanctuary-stage ${state.matches("shuffling") ? "is-shuffling" : ""} ${
          state.matches("cuttingDeck") ? "is-gathering" : ""
        } ${state.matches("dealing") ? "is-dealing" : ""}`}
      >
        {state.matches("shuffling") ? (
          <div className="ritual-moment sanctuary-shuffle-ritual">
            <ShuffleShells phase="mixing" />
            <div className="sanctuary-shuffle-copy">
              <p className="ritual-status" role="status">
                Your free draw is locked
              </p>
              <span>
                Move through the visual shuffle. Your question did not choose these cards.
              </span>
            </div>
            <button
              className="shuffle-skip-action"
              onClick={() => send({ type: "SHUFFLE_COMPLETE" })}
              type="button"
            >
              Gather now
            </button>
          </div>
        ) : null}
        {state.matches("cuttingDeck") ? (
          <div className="ritual-moment sanctuary-shuffle-ritual sanctuary-gather-ritual">
            <ShuffleShells phase="gathering" />
            <div className="sanctuary-shuffle-copy">
              <p className="ritual-status" role="status">
                Gathering the locked deck
              </p>
              <span>The cards move directly into the spread without changing order.</span>
            </div>
          </div>
        ) : null}
        {state.matches("dealing") && reading ? (
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
              Dealing {dealtCount} of {reading.cards.length}…
            </p>
          </div>
        ) : null}
        {cardsVisible && reading ? (
          <div className="ritual-card-layout">
            <TarotSpreadStage
              activeIndex={activeReadingCard}
              cards={reading.cards}
              focusMode={activeReadingCard === null ? null : "reading"}
              reducedMotion={reducedMotion}
              revealed={revealed}
              onReveal={state.matches("revealingCards") ? revealCard : undefined}
            />
            {state.matches("awaitingReveal") ? (
              <div className="ritual-question-reflection" data-testid="guest-question-reflection">
                <span>Hold your intention at the center</span>
                <blockquote>{restoredQuestion}</blockquote>
                <p>Notice what rises before any card is turned.</p>
                <button
                  className="ritual-action ritual-ready-action"
                  onClick={() => send({ type: "REVEAL" })}
                  type="button"
                >
                  I’m ready
                </button>
              </div>
            ) : null}
            {state.matches("revealingCards") && revealed.size < reading.cards.length ? (
              <div className="reveal-choice-prompt" role="status">
                <span aria-hidden="true">✦</span>
                <p>
                  <strong>Choose a face-down card to turn</strong>
                  <small>Tap, or use Tab and Enter.</small>
                </p>
                <span>
                  {revealed.size} of {reading.cards.length}
                </span>
              </div>
            ) : null}
          </div>
        ) : null}
      </section>

      <div className={`oracle-console-stack ${state.matches("complete") ? "" : "is-inactive"}`}>
        {state.matches("complete") && reading ? (
          <OracleTranscript
            active
            cards={reading.cards}
            onActiveCardChange={setActiveReadingCard}
            onJourneyCompleteChange={setJourneyComplete}
            onRetry={() => undefined}
            previewEvents={phaseEvents(reading)}
            readingId={reading.id}
            reducedMotion={reducedMotion}
            result={reading.result}
            retryToken={0}
            sigilSeed={reading.id}
            soundEnabled={false}
            target="guest-primary"
          />
        ) : null}
        {state.matches("complete") && journeyComplete && reading ? (
          <section className="guest-conversion-card" data-testid="guest-signup-gate">
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
            <small>
              No account was required for this reading. Account history begins only after you choose
              to sign up.
            </small>
          </section>
        ) : null}
      </div>
    </MysticSanctuaryScene>
  );
}

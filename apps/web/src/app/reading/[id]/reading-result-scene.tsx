"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createOracleStreamEvents } from "@starguidance/ai";
import type { FollowUpResult, OracleStreamEvent } from "@starguidance/contracts";

import { signInPathFor } from "@/lib/account-return";
import { requestJson, sendJson } from "@/lib/client-request";
import { emitBrowserProductEventOnce } from "@/lib/product-telemetry-client";
import { useReadingPreferences, type ReadingPreferenceSeed } from "@/lib/reading-preferences";

import { MysticSanctuaryScene } from "../../session/[id]/mystic-sanctuary-scene";
import { OracleTranscript } from "../../session/[id]/oracle-transcript";
import { QuestionComposer } from "../../session/[id]/question-composer";
import { ReadingClosure, type ReadingContinuationMode } from "../../session/[id]/reading-closure";
import {
  keepsakeCardsFrom,
  keepsakeSectionsFrom,
  ReadingKeepsake,
} from "../../session/[id]/reading-keepsake";
import type { ReadingPayload } from "../../session/[id]/reading-types";
import { useRitualAmbience } from "../../session/[id]/ritual-audio";
import { RitualControls } from "../../session/[id]/ritual-controls";
import { TarotSpreadStage } from "../../session/[id]/tarot-spread-stage";
import { ReadingJournal } from "./reading-journal";

type PhaseEvent = Extract<OracleStreamEvent, { type: "phase" }>;
type FocusTarget = "closure" | "keepsake" | "transcript" | "kept";

export function ReadingResultScene({
  audioAvailable = false,
  animationVariant = "immersive-v1",
  initialPreferences,
  readingId,
}: {
  audioAvailable?: boolean;
  animationVariant?: "immersive-v1" | "quiet-v1" | "disabled";
  initialPreferences?: ReadingPreferenceSeed;
  readingId: string;
}) {
  const router = useRouter();
  const [reading, setReading] = useState<ReadingPayload>();
  const [error, setError] = useState<string>();
  const [followUp, setFollowUp] = useState("");
  const [followUpLoading, setFollowUpLoading] = useState(false);
  /** A saved reading opens on its keepsake; the passage walk is a replay. */
  const [view, setView] = useState<"keepsake" | "walk">("keepsake");
  const [narratingCardIndexes, setNarratingCardIndexes] = useState<readonly number[]>([]);
  const [continuationMode, setContinuationMode] = useState<ReadingContinuationMode>("choice");
  const [now, setNow] = useState(0);
  const closureHeadingRef = useRef<HTMLHeadingElement>(null);
  const keepsakeHeadingRef = useRef<HTMLHeadingElement>(null);
  const keptHeadingRef = useRef<HTMLHeadingElement>(null);
  const consoleRef = useRef<HTMLDivElement>(null);
  const pendingFocus = useRef<FocusTarget | undefined>(undefined);
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
  useRitualAmbience(ambience, "complete");

  useEffect(() => {
    let active = true;
    void requestJson<{ reading: ReadingPayload }>(`/api/readings/${readingId}`, {
      cache: "no-store",
    }).then((result) => {
      if (!active) return;
      if (!result.ok) {
        if (result.status === 401) {
          router.replace(signInPathFor(`/reading/${readingId}`));
          return;
        }
        setError(
          result.status === 404 ? "We couldn’t find this reading in your history." : result.error,
        );
        return;
      }
      setNow(Date.now());
      setReading(result.data.reading);
    });
    return () => {
      active = false;
    };
  }, [readingId, router]);

  useEffect(() => {
    if (reading?.generationStatus !== "ready" || !reading.result) return;
    emitBrowserProductEventOnce("result_viewed", `reading:${readingId}`, {
      routeClass: "result",
      cardCount: reading.cards.length,
      statusClass: "ready",
    });
  }, [reading, readingId]);

  useEffect(() => {
    if (view !== "keepsake" || !reading?.result || reading.outcomeFeedbackSubmitted) return;
    emitBrowserProductEventOnce("outcome_invited", `reading:${readingId}`, {
      routeClass: "result",
      statusClass: "ready",
    });
  }, [view, reading, readingId]);

  // Move focus to whatever the last action opened, once it is on screen.
  useEffect(() => {
    const target = pendingFocus.current;
    if (!target) return;
    const element =
      target === "closure"
        ? (closureHeadingRef.current ?? keepsakeHeadingRef.current)
        : target === "keepsake"
          ? keepsakeHeadingRef.current
          : target === "kept"
            ? keptHeadingRef.current
            : consoleRef.current?.querySelector<HTMLElement>('[data-testid="oracle-transcript"]');
    if (!element) return;
    pendingFocus.current = undefined;
    element.focus();
  });

  const handleJourneyComplete = useCallback((complete: boolean) => {
    if (!complete) return;
    pendingFocus.current = "closure";
    setContinuationMode("choice");
    setView("keepsake");
  }, []);

  const previewEvents = useMemo(
    () =>
      reading?.result
        ? createOracleStreamEvents(reading.result).filter(
            (event): event is PhaseEvent => event.type === "phase",
          )
        : [],
    [reading],
  );
  const revealedCardIndexes = new Set(reading?.cards.map((_, index) => index) ?? []);

  const submitFollowUp = async () => {
    if (!reading || !followUp.trim()) return;
    const asked = followUp.trim();
    setFollowUpLoading(true);
    setError(undefined);
    try {
      const result = await sendJson<{
        followUp?: { id: string; result: FollowUpResult; question?: string };
      }>(`/api/readings/${readingId}`, "POST", { action: "followUp", question: followUp });
      if (result.status === 428) {
        router.push("/consent");
        return;
      }
      if (!result.ok || !result.data.followUp) {
        const safety = result.data as { safety?: { guidance?: string } };
        setError(
          safety.safety?.guidance ??
            (result.ok ? "That follow-up couldn’t be answered. Please try again." : result.error),
        );
        return;
      }
      const answered = { question: asked, ...result.data.followUp };
      setReading({
        ...reading,
        followUps: [...reading.followUps, answered],
        followUpsRemaining: Math.max(0, reading.followUpsRemaining - 1),
      });
      setFollowUp("");
      setContinuationMode("choice");
      pendingFocus.current = "keepsake";
    } finally {
      setFollowUpLoading(false);
    }
  };

  if (!reading) {
    return (
      <MysticSanctuaryScene
        animationVariant={animationVariant}
        backdrop="starry-reading"
        focusStage="reading"
        reducedMotion={true}
        testId="reading-result-scene"
      >
        <div className="sanctuary-loading" role={error ? "alert" : "status"}>
          <span aria-hidden="true">✦</span>
          {error ?? "Opening your finished reading…"}
          {error && <Link href="/history">See all your readings</Link>}
        </div>
      </MysticSanctuaryScene>
    );
  }

  if (reading.generationStatus !== "ready" || !reading.result) {
    return (
      <MysticSanctuaryScene
        animationVariant={animationVariant}
        backdrop="starry-reading"
        focusStage="reading"
        reducedMotion={true}
        testId="reading-result-scene"
      >
        <div className="sanctuary-loading" role="status">
          <span aria-hidden="true">✦</span>
          {reading.sessionExpired
            ? "This reading was left unfinished, so it has no interpretation — but your cards are kept."
            : "This interpretation is not finished yet."}
          {reading.sessionExpired ? (
            <Link href="/history">See all your readings</Link>
          ) : (
            <Link href={`/session/${readingId}`}>Return to the reading</Link>
          )}
        </div>
      </MysticSanctuaryScene>
    );
  }

  const walking = view === "walk";

  return (
    <MysticSanctuaryScene
      animationVariant={animationVariant}
      backdrop="starry-reading"
      focusStage={walking ? "reading" : "actions"}
      phase="complete"
      reducedMotion={reducedMotion}
      testId="reading-result-scene"
    >
      <h1 className="sr-only">Your saved tarot reading</h1>
      <RitualControls
        ambience={ambience}
        animationManaged={animationManaged}
        displayName={displayName}
        exitHref="/history"
        exitLabel="History"
        narration={audioAvailable && narration}
        reducedMotion={reducedMotion}
        {...(reading.profileSnapshotId ? { sigilSeed: reading.profileSnapshotId } : {})}
        sound={sound}
        toggleAmbience={toggleAmbience}
        {...(audioAvailable ? { toggleNarration } : {})}
        toggleReducedMotion={toggleReducedMotion}
        toggleSound={toggleSound}
      />

      {walking && (
        <section
          aria-label="Your locked tarot spread remains present during the reading"
          className="sanctuary-stage has-reading-journey"
        >
          <TarotSpreadStage
            activeIndex={null}
            cards={reading.cards}
            focusMode={null}
            narratingIndexes={narratingCardIndexes}
            reducedMotion={reducedMotion}
            revealed={revealedCardIndexes}
          />
        </section>
      )}

      <div
        className={`oracle-console-stack ${walking ? "is-reading" : "is-actions"}`}
        data-focus-stage={walking ? "reading" : "actions"}
        ref={consoleRef}
      >
        {walking ? (
          <OracleTranscript
            active
            cards={reading.cards}
            displayName={displayName}
            onJourneyCompleteChange={handleJourneyComplete}
            onNarratedCardIndexesChange={(indexes) =>
              setNarratingCardIndexes((current) =>
                current.length === indexes.length &&
                current.every((value, index) => value === indexes[index])
                  ? current
                  : [...indexes],
              )
            }
            onRetry={() => undefined}
            {...(reading.personalization ? { personalization: reading.personalization } : {})}
            previewEvents={previewEvents}
            readingId={readingId}
            reducedMotion={reducedMotion}
            result={reading.result}
            retryToken={0}
            {...(reading.profileSnapshotId ? { sigilSeed: reading.profileSnapshotId } : {})}
            audioEnabled={audioAvailable && narration}
            target="primary"
          />
        ) : (
          <>
            <ReadingKeepsake
              cards={keepsakeCardsFrom(reading.cards, reading.result)}
              createdAt={reading.createdAt}
              followUps={reading.followUps.map((entry) => ({
                id: entry.id,
                answer: entry.result.response,
                ...(entry.question ? { question: entry.question } : {}),
              }))}
              onReplay={() => {
                pendingFocus.current = "transcript";
                setView("walk");
              }}
              question={reading.question}
              ref={keepsakeHeadingRef}
              replayLabel="Replay the reading"
              sections={keepsakeSectionsFrom(reading.result)}
              {...(reading.spreadName
                ? {
                    spreadName:
                      reading.source === "guest_trial"
                        ? `${reading.spreadName} · Your free reading`
                        : reading.spreadName,
                  }
                : {})}
            />

            {continuationMode === "choice" && (
              <ReadingClosure
                closeLabel="Keep this reading"
                feedbackSubmitted={reading.feedbackSubmitted}
                followUpsRemaining={reading.followUpsRemaining}
                onAskFollowUp={() => setContinuationMode("follow-up")}
                onClose={() => {
                  pendingFocus.current = "kept";
                  setContinuationMode("closed");
                }}
                readingId={readingId}
                ref={closureHeadingRef}
                reflectionQuestion={reading.result.reflectionPrompt}
              />
            )}

            {continuationMode === "follow-up" && reading.followUpsRemaining > 0 && (
              <div className="reading-follow-up-threshold">
                <button onClick={() => setContinuationMode("choice")} type="button">
                  ← Back
                </button>
                <QuestionComposer
                  hint={`${reading.followUpsRemaining} of ${reading.followUpLimit} follow-up${reading.followUpLimit === 1 ? "" : "s"} remaining on these cards.`}
                  label="Ask a follow-up using the same cards"
                  loading={followUpLoading}
                  onChange={setFollowUp}
                  onSubmit={submitFollowUp}
                  placeholder="Ask what these same cards add…"
                  submitLabel="Reflect on the same cards"
                  testId="follow-up-composer"
                  value={followUp}
                />
              </div>
            )}

            {continuationMode === "closed" && (
              <section aria-labelledby="reading-kept-heading" className="reading-kept-note">
                <h2 id="reading-kept-heading" ref={keptHeadingRef} tabIndex={-1}>
                  Kept in your history
                </h2>
                <p>This reading stays just as it was drawn. Coming back never changes its cards.</p>
                <div>
                  <Link href="/history">See all your readings</Link>
                  {/* A full page load, so no half-finished ritual state carries over. */}
                  <a href="/readings">Begin a new reading</a>
                </div>
              </section>
            )}

            <ReadingJournal
              createdAt={reading.createdAt}
              now={now}
              onSaved={() => setReading({ ...reading, outcomeFeedbackSubmitted: true })}
              readingId={readingId}
              submitted={reading.outcomeFeedbackSubmitted}
            />

            {error && (
              <p className="sanctuary-error" role="alert">
                {error}
              </p>
            )}
          </>
        )}
      </div>
    </MysticSanctuaryScene>
  );
}

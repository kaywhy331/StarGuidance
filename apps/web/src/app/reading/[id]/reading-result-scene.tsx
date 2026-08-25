"use client";

import { useEffect, useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createOracleStreamEvents } from "@starguidance/ai";
import type { FollowUpResult, OracleStreamEvent } from "@starguidance/contracts";

import { emitBrowserProductEventOnce } from "@/lib/product-telemetry-client";
import { useReadingPreferences, type ReadingPreferenceSeed } from "@/lib/reading-preferences";

import { MysticSanctuaryScene } from "../../session/[id]/mystic-sanctuary-scene";
import { OracleTranscript } from "../../session/[id]/oracle-transcript";
import { QuestionComposer } from "../../session/[id]/question-composer";
import {
  ReadingClosure,
  ReadingSealed,
  type ReadingContinuationMode,
} from "../../session/[id]/reading-closure";
import type { ReadingPayload } from "../../session/[id]/reading-types";
import { useRitualAmbience } from "../../session/[id]/ritual-audio";
import { RitualControls } from "../../session/[id]/ritual-controls";

type PhaseEvent = Extract<OracleStreamEvent, { type: "phase" }>;

export function ReadingResultScene({
  animationVariant = "immersive-v1",
  initialPreferences,
  readingId,
}: {
  animationVariant?: "immersive-v1" | "quiet-v1" | "disabled";
  initialPreferences?: ReadingPreferenceSeed;
  readingId: string;
}) {
  const router = useRouter();
  const [reading, setReading] = useState<ReadingPayload>();
  const [error, setError] = useState<string>();
  const [followUp, setFollowUp] = useState("");
  const [followUpLoading, setFollowUpLoading] = useState(false);
  const [feedbackOpen, setFeedbackOpen] = useState(false);
  const [helpfulness, setHelpfulness] = useState(0);
  const [resonance, setResonance] = useState(0);
  const [comment, setComment] = useState("");
  const [outcomeStatus, setOutcomeStatus] = useState("");
  const [behaviorChanged, setBehaviorChanged] = useState("");
  const [outcomeComment, setOutcomeComment] = useState("");
  const [feedbackLoading, setFeedbackLoading] = useState(false);
  const [journeyComplete, setJourneyComplete] = useState(false);
  const [continuationMode, setContinuationMode] = useState<ReadingContinuationMode>("choice");
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
    void fetch(`/api/readings/${readingId}`, { cache: "no-store" })
      .then(async (response) => {
        if (response.status === 401) {
          router.replace("/sign-in");
          return;
        }
        if (!response.ok) throw new Error("This reading could not be loaded.");
        const payload = (await response.json()) as { reading: ReadingPayload };
        setReading(payload.reading);
      })
      .catch((cause: unknown) =>
        setError(cause instanceof Error ? cause.message : "This reading could not be loaded."),
      );
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
    if (!journeyComplete || !reading?.result || reading.outcomeFeedbackSubmitted) return;
    emitBrowserProductEventOnce("outcome_invited", `reading:${readingId}`, {
      routeClass: "result",
      statusClass: "ready",
    });
  }, [journeyComplete, reading, readingId]);

  const previewEvents = reading?.result
    ? createOracleStreamEvents(reading.result).filter(
        (event): event is PhaseEvent => event.type === "phase",
      )
    : [];

  const submitFollowUp = async () => {
    if (!reading || !followUp.trim()) return;
    setFollowUpLoading(true);
    setError(undefined);
    try {
      const response = await fetch(`/api/readings/${readingId}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "followUp", question: followUp }),
      });
      const payload = (await response.json()) as {
        followUp?: { id: string; result: FollowUpResult };
        error?: string;
        safety?: { guidance: string };
      };
      if (response.status === 428) {
        router.push("/consent");
        return;
      }
      if (!response.ok || !payload.followUp)
        throw new Error(payload.safety?.guidance ?? payload.error ?? "Unable to answer follow-up.");
      setReading({
        ...reading,
        followUps: [...reading.followUps, payload.followUp],
        followUpsRemaining: Math.max(0, reading.followUpsRemaining - 1),
      });
      setFollowUp("");
      setContinuationMode("choice");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to answer follow-up.");
    } finally {
      setFollowUpLoading(false);
    }
  };

  const submitFeedback = async (event: FormEvent) => {
    event.preventDefault();
    if (!reading || (!helpfulness && !resonance && !comment.trim())) return;
    setFeedbackLoading(true);
    setError(undefined);
    try {
      const response = await fetch(`/api/readings/${readingId}/feedback`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          kind: "experience",
          ...(helpfulness ? { helpfulness } : {}),
          ...(resonance ? { resonance } : {}),
          ...(comment.trim() ? { comment: comment.trim() } : {}),
        }),
      });
      const payload = (await response.json()) as { error?: string };
      if (!response.ok) throw new Error(payload.error ?? "Feedback could not be saved.");
      setReading({ ...reading, feedbackSubmitted: true });
      setFeedbackOpen(false);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Feedback could not be saved.");
    } finally {
      setFeedbackLoading(false);
    }
  };

  const submitOutcomeFeedback = async (event: FormEvent) => {
    event.preventDefault();
    if (!reading || !outcomeStatus || !behaviorChanged) return;
    setFeedbackLoading(true);
    setError(undefined);
    try {
      const response = await fetch(`/api/readings/${readingId}/feedback`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          kind: "outcome",
          outcomeStatus,
          behaviorChanged: behaviorChanged === "yes",
          ...(outcomeComment.trim() ? { comment: outcomeComment.trim() } : {}),
        }),
      });
      const payload = (await response.json()) as { error?: string };
      if (!response.ok) throw new Error(payload.error ?? "Outcome reflection could not be saved.");
      setReading({ ...reading, outcomeFeedbackSubmitted: true });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Outcome reflection could not be saved.");
    } finally {
      setFeedbackLoading(false);
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
          {error && <Link href="/history">Return to reading history</Link>}
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
          This interpretation is not finished yet.
          <Link href={`/session/${readingId}`}>Return to the reading scene</Link>
        </div>
      </MysticSanctuaryScene>
    );
  }

  return (
    <MysticSanctuaryScene
      animationVariant={animationVariant}
      backdrop="starry-reading"
      focusStage={journeyComplete ? "actions" : "reading"}
      phase="complete"
      reducedMotion={reducedMotion}
      testId="reading-result-scene"
    >
      <RitualControls
        ambience={ambience}
        animationManaged={animationManaged}
        displayName={displayName}
        exitHref="/history"
        exitLabel="History"
        narration={narration}
        reducedMotion={reducedMotion}
        sigilSeed={reading.profileSnapshotId}
        sound={sound}
        toggleAmbience={toggleAmbience}
        toggleNarration={toggleNarration}
        toggleReducedMotion={toggleReducedMotion}
        toggleSound={toggleSound}
      />

      <div
        className={`oracle-console-stack ${journeyComplete ? "is-actions" : "is-reading"}`}
        data-focus-stage={journeyComplete ? "actions" : "reading"}
      >
        {!journeyComplete && (
          <OracleTranscript
            active
            cards={reading.cards}
            onJourneyCompleteChange={setJourneyComplete}
            onRetry={() => undefined}
            {...(reading.personalization ? { personalization: reading.personalization } : {})}
            previewEvents={previewEvents}
            readingId={readingId}
            reducedMotion={reducedMotion}
            result={reading.result}
            retryToken={0}
            sigilSeed={reading.profileSnapshotId}
            soundEnabled={narration}
            target="primary"
          />
        )}

        {journeyComplete && (
          <div className="result-support-stack">
            {reading.followUps.length > 0 && (
              <details className="result-followups">
                <summary>
                  Saved follow-up{reading.followUps.length === 1 ? "" : "s"} ·{" "}
                  {reading.followUps.length}
                </summary>
                {reading.followUps.map((entry) => (
                  <p key={entry.id}>{entry.result.response}</p>
                ))}
              </details>
            )}

            {continuationMode === "choice" && (
              <ReadingClosure
                followUpsRemaining={reading.followUpsRemaining}
                onAskFollowUp={() => setContinuationMode("follow-up")}
                onClose={() => setContinuationMode("closed")}
                reflectionQuestion={reading.result.reflectionPrompt}
              />
            )}

            {continuationMode === "follow-up" && reading.followUpsRemaining > 0 && (
              <div className="reading-follow-up-threshold">
                <button onClick={() => setContinuationMode("choice")} type="button">
                  ← Return to closing reflection
                </button>
                <QuestionComposer
                  hint={`${reading.followUpsRemaining} of ${reading.followUpLimit} follow-up${reading.followUpLimit === 1 ? "" : "s"} remaining on these locked cards.`}
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

            {continuationMode === "closed" && <ReadingSealed readingId={readingId} />}

            {reading.feedbackSubmitted ? (
              <p className="feedback-thanks">Thank you — your feedback is saved separately.</p>
            ) : (
              <details
                className="reading-feedback-panel"
                onToggle={(event) => setFeedbackOpen(event.currentTarget.open)}
                open={feedbackOpen}
              >
                <summary>Share private feedback</summary>
                <form onSubmit={submitFeedback}>
                  <label>
                    Helpful
                    <select
                      onChange={(event) => setHelpfulness(Number(event.target.value))}
                      value={helpfulness}
                    >
                      <option value={0}>Not rated</option>
                      {[1, 2, 3, 4, 5].map((value) => (
                        <option key={value} value={value}>
                          {value} / 5
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    Resonance
                    <select
                      onChange={(event) => setResonance(Number(event.target.value))}
                      value={resonance}
                    >
                      <option value={0}>Not rated</option>
                      {[1, 2, 3, 4, 5].map((value) => (
                        <option key={value} value={value}>
                          {value} / 5
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="feedback-comment-field">
                    Optional note
                    <textarea
                      maxLength={1_000}
                      onChange={(event) => setComment(event.target.value)}
                      rows={2}
                      value={comment}
                    />
                  </label>
                  <button
                    disabled={feedbackLoading || (!helpfulness && !resonance && !comment.trim())}
                    type="submit"
                  >
                    {feedbackLoading ? "Saving…" : "Save feedback"}
                  </button>
                </form>
              </details>
            )}
            {reading.outcomeFeedbackSubmitted ? (
              <p className="feedback-thanks">
                What unfolded is saved as a separate annotation; the original reading is unchanged.
              </p>
            ) : (
              <details className="reading-feedback-panel">
                <summary>Record what unfolded later</summary>
                <form onSubmit={submitOutcomeFeedback}>
                  <p>
                    This is a reflection record, not proof of prediction. It never edits the cards
                    or the original interpretation.
                  </p>
                  <label>
                    What happened?
                    <select
                      onChange={(event) => setOutcomeStatus(event.target.value)}
                      required
                      value={outcomeStatus}
                    >
                      <option value="">Choose one</option>
                      <option value="occurred">Occurred</option>
                      <option value="partial">Partly occurred</option>
                      <option value="did_not_occur">Did not occur</option>
                      <option value="unclear">Still unclear</option>
                    </select>
                  </label>
                  <label>
                    Did the reading influence what you did?
                    <select
                      onChange={(event) => setBehaviorChanged(event.target.value)}
                      required
                      value={behaviorChanged}
                    >
                      <option value="">Choose one</option>
                      <option value="yes">Yes</option>
                      <option value="no">No</option>
                    </select>
                  </label>
                  <label className="feedback-comment-field">
                    Optional private context
                    <textarea
                      maxLength={1_000}
                      onChange={(event) => setOutcomeComment(event.target.value)}
                      rows={2}
                      value={outcomeComment}
                    />
                  </label>
                  <button
                    disabled={feedbackLoading || !outcomeStatus || !behaviorChanged}
                    type="submit"
                  >
                    {feedbackLoading ? "Saving…" : "Save outcome reflection"}
                  </button>
                </form>
              </details>
            )}
            {error && (
              <p className="sanctuary-error" role="alert">
                {error}
              </p>
            )}
          </div>
        )}
      </div>
    </MysticSanctuaryScene>
  );
}

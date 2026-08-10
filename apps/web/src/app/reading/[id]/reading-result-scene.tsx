"use client";

import { useEffect, useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createOracleStreamEvents } from "@starguidance/ai";
import type { FollowUpResult, OracleStreamEvent } from "@starguidance/contracts";

import { useReadingPreferences } from "@/lib/reading-preferences";

import { MysticSanctuaryScene } from "../../session/[id]/mystic-sanctuary-scene";
import { OracleTranscript } from "../../session/[id]/oracle-transcript";
import { QuestionComposer } from "../../session/[id]/question-composer";
import type { ReadingPayload } from "../../session/[id]/reading-types";
import { TarotSpreadStage } from "../../session/[id]/tarot-spread-stage";

type PhaseEvent = Extract<OracleStreamEvent, { type: "phase" }>;

export function ReadingResultScene({ readingId }: { readingId: string }) {
  const router = useRouter();
  const [reading, setReading] = useState<ReadingPayload>();
  const [error, setError] = useState<string>();
  const [activeCard, setActiveCard] = useState<number | null>(null);
  const [followUp, setFollowUp] = useState("");
  const [followUpLoading, setFollowUpLoading] = useState(false);
  const [feedbackOpen, setFeedbackOpen] = useState(false);
  const [helpfulness, setHelpfulness] = useState(0);
  const [resonance, setResonance] = useState(0);
  const [comment, setComment] = useState("");
  const [feedbackLoading, setFeedbackLoading] = useState(false);
  const { reducedMotion, sound, toggleReducedMotion, toggleSound } = useReadingPreferences();

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

  const previewEvents = reading?.result
    ? createOracleStreamEvents(reading.result).filter(
        (event): event is PhaseEvent => event.type === "phase",
      )
    : [];
  const revealed = new Set(reading?.cards.map((_, index) => index) ?? []);

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
      if (!response.ok || !payload.followUp)
        throw new Error(payload.safety?.guidance ?? payload.error ?? "Unable to answer follow-up.");
      setReading({
        ...reading,
        followUps: [...reading.followUps, payload.followUp],
        followUpsRemaining: Math.max(0, reading.followUpsRemaining - 1),
      });
      setFollowUp("");
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

  if (!reading) {
    return (
      <MysticSanctuaryScene reducedMotion={true} testId="reading-result-scene">
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
      <MysticSanctuaryScene reducedMotion={true} testId="reading-result-scene">
        <div className="sanctuary-loading" role="status">
          <span aria-hidden="true">✦</span>
          This interpretation is not finished yet.
          <Link href={`/session/${readingId}`}>Return to the reading scene</Link>
        </div>
      </MysticSanctuaryScene>
    );
  }

  return (
    <MysticSanctuaryScene reducedMotion={reducedMotion} testId="reading-result-scene">
      <header className="sanctuary-controls" aria-label="Reading controls">
        <Link className="sanctuary-exit" href="/history">
          ← History
        </Link>
        <div className="sanctuary-control-group">
          <button aria-pressed={reducedMotion} onClick={toggleReducedMotion} type="button">
            Reduced motion <span>{reducedMotion ? "on" : "off"}</span>
          </button>
          <button aria-pressed={sound} onClick={toggleSound} type="button">
            Sound <span>{sound ? "on" : "off"}</span>
          </button>
        </div>
      </header>

      <section className="sanctuary-stage has-reading-journey" aria-label="Finished reading">
        <TarotSpreadStage
          activeIndex={activeCard}
          cards={reading.cards}
          focusMode={activeCard === null ? null : "reading"}
          reducedMotion={reducedMotion}
          revealed={revealed}
        />
      </section>

      <div className="oracle-console-stack">
        <OracleTranscript
          active
          cards={reading.cards}
          onActiveCardChange={setActiveCard}
          onRetry={() => undefined}
          previewEvents={previewEvents}
          readingId={readingId}
          reducedMotion={true}
          result={reading.result}
          retryToken={0}
          target="primary"
        />

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

          {reading.followUpsRemaining > 0 && (
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
          )}

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
          {error && (
            <p className="sanctuary-error" role="alert">
              {error}
            </p>
          )}
        </div>
      </div>
    </MysticSanctuaryScene>
  );
}

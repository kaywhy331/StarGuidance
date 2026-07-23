"use client";

import { useState } from "react";
import Link from "next/link";
import type { OracleStreamEvent, ReadingResult } from "@starguidance/contracts";

import { MysticSanctuaryScene } from "../session/[id]/mystic-sanctuary-scene";
import { OracleTranscript } from "../session/[id]/oracle-transcript";
import { QuestionComposer } from "../session/[id]/question-composer";
import { ReadingDetailsDrawer } from "../session/[id]/reading-details-drawer";
import type { DealtCardView } from "../session/[id]/reading-types";
import { TarotSpreadStage } from "../session/[id]/tarot-spread-stage";

type PhaseEvent = Extract<OracleStreamEvent, { type: "phase" }>;

export function SanctuaryVisualPreview({
  cards,
  events,
  result,
}: {
  cards: DealtCardView[];
  events: PhaseEvent[];
  result: ReadingResult;
}) {
  const [reducedMotion, setReducedMotion] = useState(false);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [question, setQuestion] = useState("");
  return (
    <MysticSanctuaryScene reducedMotion={reducedMotion} testId="mystic-sanctuary-scene">
      <header className="sanctuary-controls" aria-label="Visual preview controls">
        <Link href="/">← Exit</Link>
        <div className="sanctuary-control-group">
          <button aria-pressed="false" type="button">
            Sound off
          </button>
          <button
            aria-pressed={reducedMotion}
            onClick={() => setReducedMotion((value) => !value)}
            type="button"
          >
            Reduced motion
          </button>
          <button aria-pressed={reducedMotion} onClick={() => setReducedMotion(true)} type="button">
            Skip animation
          </button>
          <button onClick={() => setDetailsOpen(true)} type="button">
            Reading details
          </button>
        </div>
      </header>
      <p className="locked-reading-note">Synthetic preview · no personal data</p>
      <section className="sanctuary-stage">
        <TarotSpreadStage
          cards={cards}
          onReveal={() => undefined}
          reducedMotion={reducedMotion}
          revealed={new Set(cards.map((_, index) => index))}
        />
      </section>
      <div className="oracle-console-stack">
        <OracleTranscript
          active={false}
          onRetry={() => undefined}
          previewEvents={events}
          readingId="synthetic-preview"
          reducedMotion={reducedMotion}
          retryToken={0}
          target="preview"
        />
        <QuestionComposer
          hint="Preview only. The authenticated reading composer submits privately."
          label="Preview follow-up composer"
          onChange={setQuestion}
          onSubmit={() => setQuestion("")}
          placeholder="Ask one follow-up about the same cards…"
          submitLabel="Preview send control"
          value={question}
        />
      </div>
      <ReadingDetailsDrawer
        onClose={() => setDetailsOpen(false)}
        open={detailsOpen}
        result={result}
      />
    </MysticSanctuaryScene>
  );
}

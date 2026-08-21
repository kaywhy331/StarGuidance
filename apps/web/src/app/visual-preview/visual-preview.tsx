"use client";

import { useState } from "react";
import type { OracleStreamEvent, ReadingResult } from "@starguidance/contracts";

import { MysticSanctuaryScene } from "../session/[id]/mystic-sanctuary-scene";
import { OracleTranscript } from "../session/[id]/oracle-transcript";
import { QuestionComposer } from "../session/[id]/question-composer";
import type { DealtCardView } from "../session/[id]/reading-types";
import { useRitualAmbience } from "../session/[id]/ritual-audio";
import { RitualControls } from "../session/[id]/ritual-controls";
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
  const [activeCard, setActiveCard] = useState<number | null>(null);
  const [question, setQuestion] = useState("");
  const [sound, setSound] = useState(false);
  const [ambience, setAmbience] = useState(false);
  const [narration, setNarration] = useState(false);
  useRitualAmbience(ambience, "complete");
  return (
    <MysticSanctuaryScene phase="complete" reducedMotion={false} testId="mystic-sanctuary-scene">
      <RitualControls
        ambience={ambience}
        controlsLabel="Visual preview controls"
        exitHref="/"
        narration={narration}
        reducedMotion={false}
        showMotion={false}
        sound={sound}
        toggleAmbience={() => setAmbience((enabled) => !enabled)}
        toggleNarration={() => setNarration((enabled) => !enabled)}
        toggleSound={() => setSound((enabled) => !enabled)}
      />
      <section className="sanctuary-stage has-reading-journey">
        <TarotSpreadStage
          activeIndex={activeCard}
          cards={cards}
          focusMode={activeCard === null ? null : "reading"}
          reducedMotion={false}
          revealed={new Set(cards.map((_, index) => index))}
        />
      </section>
      <div className="oracle-console-stack">
        <OracleTranscript
          active={false}
          cards={cards}
          onActiveCardChange={setActiveCard}
          onRetry={() => undefined}
          previewEvents={events}
          readingId="synthetic-preview"
          reducedMotion={false}
          result={result}
          retryToken={0}
          sigilSeed="synthetic-preview-profile"
          soundEnabled={narration}
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
    </MysticSanctuaryScene>
  );
}

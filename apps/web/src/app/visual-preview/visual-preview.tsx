"use client";

import { useState } from "react";
import type { OracleStreamEvent, ReadingResult } from "@starguidance/contracts";

import { MysticSanctuaryScene } from "../session/[id]/mystic-sanctuary-scene";
import { OracleTranscript } from "../session/[id]/oracle-transcript";
import { QuestionComposer } from "../session/[id]/question-composer";
import type { DealtCardView } from "../session/[id]/reading-types";
import { useRitualAmbience } from "../session/[id]/ritual-audio";
import { RitualControls } from "../session/[id]/ritual-controls";

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
  const [journeyComplete, setJourneyComplete] = useState(false);
  const [question, setQuestion] = useState("");
  const [sound, setSound] = useState(false);
  const [ambience, setAmbience] = useState(false);
  useRitualAmbience(ambience, "complete");
  return (
    <MysticSanctuaryScene
      backdrop="starry-reading"
      focusStage={journeyComplete ? "actions" : "reading"}
      phase="complete"
      reducedMotion={false}
      testId="mystic-sanctuary-scene"
    >
      <RitualControls
        ambience={ambience}
        controlsLabel="Visual preview controls"
        exitHref="/"
        reducedMotion={false}
        showMotion={false}
        sound={sound}
        toggleAmbience={() => setAmbience((enabled) => !enabled)}
        toggleSound={() => setSound((enabled) => !enabled)}
      />
      <div
        className={`oracle-console-stack ${journeyComplete ? "is-actions" : "is-reading"}`}
        data-focus-stage={journeyComplete ? "actions" : "reading"}
      >
        {!journeyComplete ? (
          <OracleTranscript
            active={false}
            cards={cards}
            onJourneyCompleteChange={setJourneyComplete}
            onRetry={() => undefined}
            previewEvents={events}
            readingId="synthetic-preview"
            reducedMotion={false}
            result={result}
            retryToken={0}
            sigilSeed="synthetic-preview-profile"
            audioEnabled={false}
            target="preview"
          />
        ) : (
          <QuestionComposer
            hint="Preview only. The authenticated reading composer submits privately."
            label="Preview follow-up composer"
            onChange={setQuestion}
            onSubmit={() => setQuestion("")}
            placeholder="Ask one follow-up about the same cards…"
            submitLabel="Preview send control"
            value={question}
          />
        )}
      </div>
    </MysticSanctuaryScene>
  );
}

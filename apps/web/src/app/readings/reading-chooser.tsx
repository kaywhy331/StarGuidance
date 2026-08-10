"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { SafetyCategory } from "@starguidance/ai";

import { useReadingPreferences } from "@/lib/reading-preferences";

import { MysticSanctuaryScene } from "../session/[id]/mystic-sanctuary-scene";
import { QuestionComposer } from "../session/[id]/question-composer";
import { SafetyInterruptPanel } from "../session/[id]/safety-interrupt-panel";

export function ReadingChooser({
  spreads,
}: {
  spreads: readonly { id: string; name: string; count: number }[];
}) {
  const [selected, setSelected] = useState(spreads[1]?.id ?? spreads[0]?.id ?? "");
  const [question, setQuestion] = useState("");
  const [message, setMessage] = useState<string>();
  const [retained, setRetained] = useState<{ readingId: string; availableAt: string }>();
  const [safetyInterrupt, setSafetyInterrupt] = useState<{
    category: SafetyCategory;
    guidance: string;
  }>();
  const [loading, setLoading] = useState(false);
  const [idempotencyKey] = useState(() => crypto.randomUUID());
  const { reducedMotion, sound, toggleReducedMotion, toggleSound } = useReadingPreferences();
  const router = useRouter();

  const beginReading = async () => {
    setMessage(undefined);
    setRetained(undefined);
    setSafetyInterrupt(undefined);
    setLoading(true);
    try {
      const response = await fetch("/api/readings", {
        method: "POST",
        headers: { "content-type": "application/json", "idempotency-key": idempotencyKey },
        body: JSON.stringify({ spreadId: selected, question }),
      });
      const payload = (await response.json()) as {
        readingId?: string;
        error?: string;
        cooldownActive?: boolean;
        retainedReadingId?: string;
        availableAt?: string;
        safety?: { category: SafetyCategory; interrupt: boolean; guidance: string };
      };
      if (response.status === 401) return router.push("/sign-in");
      if (payload.safety?.interrupt)
        return setSafetyInterrupt({
          category: payload.safety.category,
          guidance: payload.safety.guidance,
        });
      if (payload.cooldownActive && payload.retainedReadingId && payload.availableAt) {
        setRetained({ readingId: payload.retainedReadingId, availableAt: payload.availableAt });
        return setMessage(payload.error ?? "This question already has a recent reading.");
      }
      if (!response.ok || !payload.readingId)
        return setMessage(
          payload.safety?.guidance ?? payload.error ?? "Unable to begin the reading.",
        );
      router.push(`/session/${payload.readingId}`);
    } finally {
      setLoading(false);
    }
  };

  if (safetyInterrupt)
    return (
      <SafetyInterruptPanel
        category={safetyInterrupt.category}
        guidance={safetyInterrupt.guidance}
      />
    );

  return (
    <MysticSanctuaryScene reducedMotion={reducedMotion} testId="mystic-sanctuary-scene">
      <header className="sanctuary-controls" aria-label="Reading setup controls">
        <Link href="/profile">← Exit</Link>
        <div className="sanctuary-control-group">
          <button aria-pressed={reducedMotion} onClick={toggleReducedMotion} type="button">
            Reduced motion <span>{reducedMotion ? "on" : "off"}</span>
          </button>
          <button aria-pressed={sound} onClick={toggleSound} type="button">
            Sound <span>{sound ? "on" : "off"}</span>
          </button>
        </div>
      </header>
      <section className="reading-entry-stage">
        <p>Choose a ritual</p>
        <h1>What kind of space do you need?</h1>
        <div aria-label="Reading type" className="ritual-spread-options" role="radiogroup">
          {spreads.map((spread) => (
            <label key={spread.id}>
              <input
                checked={selected === spread.id}
                className="sr-only"
                name="spread"
                onChange={() => setSelected(spread.id)}
                type="radio"
                value={spread.id}
              />
              <span>
                <small>
                  {spread.count} {spread.count === 1 ? "card" : "cards"}
                </small>
                <strong>{spread.name}</strong>
              </span>
            </label>
          ))}
        </div>
      </section>
      <div className="oracle-console-stack reading-entry-console">
        <p className="entry-privacy-note">
          Your question stays private and can shape interpretation—never the card selection.
        </p>
        <QuestionComposer
          hint="Shift+Enter adds a line. Enter begins the locked draw."
          label="Your private question"
          loading={loading}
          onChange={setQuestion}
          onSubmit={beginReading}
          placeholder="What can I understand or do about…"
          submitLabel="Begin the shuffle"
          testId="initial-question-composer"
          value={question}
        />
        {message && (
          <div className="sanctuary-error" role="alert">
            <p>{message}</p>
            {retained && (
              <p>
                <Link href={`/reading/${retained.readingId}`}>Open the retained reading</Link>
                {" · another draw becomes available "}
                <time dateTime={retained.availableAt}>
                  {new Date(retained.availableAt).toLocaleString()}
                </time>
              </p>
            )}
          </div>
        )}
      </div>
    </MysticSanctuaryScene>
  );
}

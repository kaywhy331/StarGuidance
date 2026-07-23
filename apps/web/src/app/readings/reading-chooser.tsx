"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

import { MysticSanctuaryScene } from "../session/[id]/mystic-sanctuary-scene";
import { QuestionComposer } from "../session/[id]/question-composer";

export function ReadingChooser({
  spreads,
}: {
  spreads: readonly { id: string; name: string; count: number }[];
}) {
  const [selected, setSelected] = useState(spreads[1]?.id ?? spreads[0]?.id ?? "");
  const [question, setQuestion] = useState("");
  const [message, setMessage] = useState<string>();
  const [loading, setLoading] = useState(false);
  const [reducedMotion, setReducedMotion] = useState(
    () =>
      typeof window !== "undefined" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches,
  );
  const router = useRouter();

  useEffect(() => {
    const query = window.matchMedia("(prefers-reduced-motion: reduce)");
    const handleChange = (event: MediaQueryListEvent) => setReducedMotion(event.matches);
    query.addEventListener("change", handleChange);
    return () => query.removeEventListener("change", handleChange);
  }, []);

  const beginReading = async () => {
    setMessage(undefined);
    setLoading(true);
    try {
      const response = await fetch("/api/readings", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ spreadId: selected, question }),
      });
      const payload = (await response.json()) as {
        readingId?: string;
        error?: string;
        safety?: { guidance: string };
      };
      if (response.status === 401) return router.push("/sign-in");
      if (!response.ok || !payload.readingId)
        return setMessage(
          payload.safety?.guidance ?? payload.error ?? "Unable to begin the reading.",
        );
      router.push(`/session/${payload.readingId}`);
    } finally {
      setLoading(false);
    }
  };

  return (
    <MysticSanctuaryScene reducedMotion={reducedMotion} testId="mystic-sanctuary-scene">
      <header className="sanctuary-controls" aria-label="Reading setup controls">
        <Link href="/profile">← Exit</Link>
        <div className="sanctuary-control-group">
          <button
            aria-pressed={reducedMotion}
            onClick={() => setReducedMotion((value) => !value)}
            type="button"
          >
            Reduced motion
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
          <p className="sanctuary-error" role="alert">
            {message}
          </p>
        )}
      </div>
    </MysticSanctuaryScene>
  );
}

"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button, Panel } from "@starguidance/design-system";

export function ReadingChooser({
  spreads,
}: {
  spreads: readonly { id: string; name: string; count: number }[];
}) {
  const [selected, setSelected] = useState(spreads[1]?.id ?? spreads[0]?.id ?? "");
  const [question, setQuestion] = useState("");
  const [message, setMessage] = useState<string>();
  const router = useRouter();
  return (
    <form
      className="mt-10 grid gap-6"
      onSubmit={async (event) => {
        event.preventDefault();
        setMessage(undefined);
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
        if (!response.ok)
          return setMessage(
            payload.safety?.guidance ?? payload.error ?? "Unable to begin the reading.",
          );
        router.push(`/session/${payload.readingId}`);
      }}
    >
      <div className="grid gap-5 md:grid-cols-2">
        {spreads.map((spread) => (
          <label key={spread.id}>
            <input
              checked={selected === spread.id}
              className="peer sr-only"
              name="spread"
              onChange={() => setSelected(spread.id)}
              type="radio"
            />
            <Panel className="cursor-pointer peer-checked:border-[#d8b56d] peer-checked:bg-[#2a1d3d]">
              <p className="text-sm text-[#d8b56d]">
                {spread.count} {spread.count === 1 ? "card" : "cards"}
              </p>
              <h2 className="mt-2 text-2xl font-semibold">{spread.name}</h2>
            </Panel>
          </label>
        ))}
      </div>
      <label className="grid gap-2">
        <span className="font-medium">Your private question</span>
        <textarea
          className="min-h-32 rounded-3xl border border-white/15 bg-[#120e20] p-4"
          maxLength={500}
          onChange={(event) => setQuestion(event.target.value)}
          placeholder="What can I understand or do about…"
          required
          value={question}
        />
        <span className="text-sm text-[#a99db5]">
          Ask about your choices and observable conditions. The question never affects which cards
          are drawn.
        </span>
      </label>
      <Button type="submit">Begin the shuffle</Button>
      {message && (
        <p className="rounded-2xl bg-[#3a1f35] p-4" role="alert">
          {message}
        </p>
      )}
    </form>
  );
}

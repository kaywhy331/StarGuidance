import { Panel } from "@starguidance/design-system";

const readings = [
  ["Single Card — Focus", "One clear point of reflection", 1],
  ["Three Cards — Direction", "Situation, challenge, direction", 3],
  ["Five Cards — Crossroads", "Compare paths and find leverage", 5],
  ["Seven Cards — Deeper Outlook", "A layered, bounded outlook", 7],
] as const;

export default function ReadingsPage() {
  return (
    <main className="mx-auto min-h-screen max-w-6xl px-6 py-12 sm:px-10">
      <p className="text-sm tracking-[0.22em] text-[#d8b56d] uppercase">Choose a ritual</p>
      <h1 className="mt-3 text-5xl font-semibold">What kind of space do you need?</h1>
      <div className="mt-10 grid gap-5 md:grid-cols-2">
        {readings.map(([title, description, count]) => (
          <Panel key={title}>
            <p className="text-sm text-[#d8b56d]">
              {count} {count === 1 ? "card" : "cards"}
            </p>
            <h2 className="mt-2 text-2xl font-semibold">{title}</h2>
            <p className="mt-3 text-[#b8adc8]">{description}</p>
          </Panel>
        ))}
      </div>
    </main>
  );
}

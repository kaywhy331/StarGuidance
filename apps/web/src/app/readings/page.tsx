import { spreads } from "@starguidance/tarot-content";
import { ReadingChooser } from "./reading-chooser";

export default function ReadingsPage() {
  return (
    <main className="mx-auto min-h-screen max-w-6xl px-6 py-12 sm:px-10">
      <p className="text-sm tracking-[0.22em] text-[#d8b56d] uppercase">Choose a ritual</p>
      <h1 className="mt-3 text-5xl font-semibold">What kind of space do you need?</h1>
      <ReadingChooser
        spreads={spreads.map(({ id, name, positions }) => ({ id, name, count: positions.length }))}
      />
    </main>
  );
}

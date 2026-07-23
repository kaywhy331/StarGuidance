import { spreads } from "@starguidance/tarot-content";
import { ReadingChooser } from "./reading-chooser";

export default function ReadingsPage() {
  return (
    <ReadingChooser
      spreads={spreads.map(({ id, name, positions }) => ({ id, name, count: positions.length }))}
    />
  );
}

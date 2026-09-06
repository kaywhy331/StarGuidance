import type { ReactNode } from "react";

import { SanctuaryBackground } from "./sanctuary-backdrop";
import { AtmosphericLayers } from "./atmospheric-layers";

export type ReadingFocusStage = "ambient" | "cards" | "reading" | "actions";
export type SanctuaryBackdrop = "sanctuary" | "starry-reading";

export function MysticSanctuaryScene({
  children,
  phase,
  reducedMotion,
  animationVariant,
  backdrop = "sanctuary",
  focusStage = "ambient",
  testId,
}: {
  children: ReactNode;
  phase?: string;
  reducedMotion: boolean;
  animationVariant?: "immersive-v1" | "quiet-v1" | "disabled";
  backdrop?: SanctuaryBackdrop;
  focusStage?: ReadingFocusStage;
  testId?: string;
}) {
  return (
    <main
      className="mystic-sanctuary"
      data-reduced-motion={reducedMotion ? "true" : "false"}
      data-animation-variant={animationVariant ?? "immersive-v1"}
      data-backdrop={backdrop}
      data-reading-focus={focusStage}
      data-ritual-phase={phase}
      data-testid={testId}
    >
      <SanctuaryBackground backdrop={backdrop} />
      <AtmosphericLayers reducedMotion={reducedMotion} />
      <div className="sanctuary-content">{children}</div>
    </main>
  );
}

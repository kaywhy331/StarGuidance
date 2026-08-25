import type { ReactNode } from "react";

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
  const readingBackdrop = backdrop === "starry-reading";

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
      <picture className="sanctuary-background">
        <source
          media="(max-width: 767px)"
          srcSet={
            readingBackdrop
              ? "/art/reading/starry-night-mobile-v1.avif"
              : "/art/sanctuary/cosmic-gothic-mobile-v1.avif"
          }
          type="image/avif"
        />
        <source
          media="(max-width: 767px)"
          srcSet={
            readingBackdrop
              ? "/art/reading/starry-night-mobile-v1.webp"
              : "/art/sanctuary/cosmic-gothic-mobile-v1.webp"
          }
          type="image/webp"
        />
        <source
          srcSet={
            readingBackdrop
              ? "/art/reading/starry-night-desktop-v1.avif"
              : "/art/sanctuary/cosmic-gothic-desktop-v1.avif"
          }
          type="image/avif"
        />
        <source
          srcSet={
            readingBackdrop
              ? "/art/reading/starry-night-desktop-v1.webp"
              : "/art/sanctuary/cosmic-gothic-desktop-v1.webp"
          }
          type="image/webp"
        />
        <img
          alt=""
          decoding="async"
          fetchPriority="high"
          src={
            readingBackdrop
              ? "/art/reading/starry-night-desktop-v1.webp"
              : "/art/sanctuary/cosmic-gothic-desktop-v1.webp"
          }
        />
      </picture>
      <AtmosphericLayers reducedMotion={reducedMotion} />
      <div className="sanctuary-content">{children}</div>
    </main>
  );
}

import type { ReactNode } from "react";

import { AtmosphericLayers } from "./atmospheric-layers";

export function MysticSanctuaryScene({
  children,
  phase,
  reducedMotion,
  animationVariant,
  testId,
}: {
  children: ReactNode;
  phase?: string;
  reducedMotion: boolean;
  animationVariant?: "immersive-v1" | "quiet-v1" | "disabled";
  testId?: string;
}) {
  return (
    <main
      className="mystic-sanctuary"
      data-reduced-motion={reducedMotion ? "true" : "false"}
      data-animation-variant={animationVariant ?? "immersive-v1"}
      data-ritual-phase={phase}
      data-testid={testId}
    >
      <picture className="sanctuary-background">
        <source
          media="(max-width: 767px)"
          srcSet="/art/sanctuary/cosmic-gothic-mobile-v1.avif"
          type="image/avif"
        />
        <source
          media="(max-width: 767px)"
          srcSet="/art/sanctuary/cosmic-gothic-mobile-v1.webp"
          type="image/webp"
        />
        <source srcSet="/art/sanctuary/cosmic-gothic-desktop-v1.avif" type="image/avif" />
        <source srcSet="/art/sanctuary/cosmic-gothic-desktop-v1.webp" type="image/webp" />
        <img
          alt=""
          decoding="async"
          fetchPriority="high"
          src="/art/sanctuary/cosmic-gothic-desktop-v1.webp"
        />
      </picture>
      <AtmosphericLayers reducedMotion={reducedMotion} />
      <div className="sanctuary-content">{children}</div>
    </main>
  );
}

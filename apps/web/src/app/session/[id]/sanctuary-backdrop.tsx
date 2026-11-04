"use client";

import { useState } from "react";

import type { SanctuaryBackdrop } from "./mystic-sanctuary-scene";

const sources = {
  sanctuary: "/art/sanctuary/cosmic-gothic",
  "starry-reading": "/art/reading/starry-night",
} as const;

/** Keep the previous image visible until the next responsive asset has loaded.
 * Two bounded layers crossfade; slow images never hold up the reading. */
export function SanctuaryBackground({ backdrop }: { backdrop: SanctuaryBackdrop }) {
  const [initial] = useState(backdrop);
  const [loaded, setLoaded] = useState<Partial<Record<SanctuaryBackdrop, boolean>>>({});
  const visible = loaded[backdrop] ? backdrop : initial;

  return (Object.entries(sources) as [SanctuaryBackdrop, string][]).map(([key, source]) => (
    <picture className="sanctuary-background" data-active={key === visible} key={key}>
      <source media="(max-width: 767px)" srcSet={`${source}-mobile-v1.avif`} type="image/avif" />
      <source media="(max-width: 767px)" srcSet={`${source}-mobile-v1.webp`} type="image/webp" />
      <source srcSet={`${source}-desktop-v1.avif`} type="image/avif" />
      <img
        alt=""
        decoding="async"
        fetchPriority={key === initial ? "high" : "low"}
        onLoad={() =>
          setLoaded((current) => (current[key] ? current : { ...current, [key]: true }))
        }
        src={`${source}-desktop-v1.webp`}
      />
    </picture>
  ));
}

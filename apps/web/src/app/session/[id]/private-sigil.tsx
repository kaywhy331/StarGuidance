import type { CSSProperties } from "react";

function seedValues(seed: string) {
  let hash = 2_166_136_261;
  const values: number[] = [];
  for (const character of seed) {
    hash ^= character.codePointAt(0) ?? 0;
    hash = Math.imul(hash, 16_777_619) >>> 0;
    values.push(hash % 100);
  }
  while (values.length < 12) {
    hash ^= hash << 13;
    hash ^= hash >>> 17;
    hash ^= hash << 5;
    values.push((hash >>> 0) % 100);
  }
  return values;
}

/**
 * A deterministic visual signature derived only from an opaque profile
 * snapshot identifier. It never encodes raw birth facts or changes a draw.
 */
export function PrivateSigil({
  label = "Your private profile sigil",
  seed,
  subtle = false,
}: {
  label?: string;
  seed: string;
  subtle?: boolean;
}) {
  const values = seedValues(seed);
  const points = Array.from({ length: 6 }, (_, index) => {
    const angle = (Math.PI * 2 * index) / 6 - Math.PI / 2;
    const radius = 22 + (values[index] ?? 50) * 0.13;
    return `${50 + Math.cos(angle) * radius},${50 + Math.sin(angle) * radius}`;
  }).join(" ");
  const rotation = (values[7] ?? 0) * 1.8;
  const orbit = 26 + (values[8] ?? 0) * 0.08;

  return (
    <span
      className={`private-sigil ${subtle ? "is-subtle" : ""}`}
      style={{ "--sigil-rotation": `${rotation}deg` } as CSSProperties}
    >
      <svg aria-label={label} role="img" viewBox="0 0 100 100">
        <circle className="private-sigil__orbit" cx="50" cy="50" r={orbit} />
        <circle className="private-sigil__outer" cx="50" cy="50" r="45" />
        <polygon className="private-sigil__path" points={points} />
        <path
          className="private-sigil__axis"
          d={`M 50 10 L 50 90 M 10 50 L 90 50 M ${20 + (values[9] ?? 0) * 0.1} 20 L ${80 - (values[10] ?? 0) * 0.1} 80`}
        />
        <circle className="private-sigil__core" cx="50" cy="50" r="4" />
      </svg>
    </span>
  );
}

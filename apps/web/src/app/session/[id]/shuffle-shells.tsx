import type { CSSProperties } from "react";

const SHUFFLE_SHELL_COUNT = 15;

export function ShuffleShells({ phase }: { phase: "mixing" | "gathering" }) {
  return (
    <div aria-hidden="true" className={`sanctuary-shuffle-shells is-${phase}`}>
      {Array.from({ length: SHUFFLE_SHELL_COUNT }, (_, index) => {
        const angle = (index / SHUFFLE_SHELL_COUNT) * Math.PI * 2 - Math.PI / 2;
        const mixAngle = angle + Math.PI * (0.58 + (index % 3) * 0.13);
        const counterAngle = angle - Math.PI * (0.34 + (index % 4) * 0.08);
        const horizontalReach = 24 + (index % 4) * 5;
        const verticalReach = 18 + ((index + 2) % 4) * 4;
        return (
          <span
            key={index}
            style={
              {
                "--shell-index": index,
                "--scatter-x": `${Math.cos(angle) * horizontalReach}vw`,
                "--scatter-y": `${Math.sin(angle) * verticalReach}vh`,
                "--mix-x": `${Math.cos(mixAngle) * (horizontalReach * 0.82)}vw`,
                "--mix-y": `${Math.sin(mixAngle) * (verticalReach * 0.9)}vh`,
                "--counter-x": `${Math.cos(counterAngle) * (horizontalReach * 0.68)}vw`,
                "--counter-y": `${Math.sin(counterAngle) * (verticalReach * 0.72)}vh`,
                "--scatter-rotation": `${(index - 7) * 17}deg`,
                "--mix-rotation": `${(7 - index) * 13}deg`,
              } as CSSProperties
            }
          />
        );
      })}
    </div>
  );
}

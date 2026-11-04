"use client";

import {
  createContext,
  useContext,
  useLayoutEffect,
  useState,
  type Dispatch,
  type ReactNode,
  type SetStateAction,
} from "react";

import { SanctuaryBackground } from "./sanctuary-backdrop";
import { AtmosphericLayers } from "./atmospheric-layers";

export type ReadingFocusStage = "ambient" | "cards" | "reading" | "actions";
export type SanctuaryBackdrop = "sanctuary" | "starry-reading";
export type AnimationVariant = "immersive-v1" | "quiet-v1" | "disabled";

export interface SanctuaryFrameState {
  backdrop: SanctuaryBackdrop;
  focusStage: ReadingFocusStage;
  phase?: string | undefined;
  reducedMotion: boolean;
}

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
  phase?: string | undefined;
  reducedMotion: boolean;
  animationVariant?: AnimationVariant | undefined;
  backdrop?: SanctuaryBackdrop;
  focusStage?: ReadingFocusStage;
  testId?: string | undefined;
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

const SanctuaryFrameContext = createContext<Dispatch<SetStateAction<SanctuaryFrameState>> | null>(
  null,
);

/** One persistent sanctuary that several scenes can take turns inside. The
 * `<main>`, its backdrop, and its atmosphere survive the handoff from card
 * selection to the dealt reading instead of remounting and fading in again. */
export function SanctuaryFrameHost({
  animationVariant,
  children,
  initialFrame,
  testId,
}: {
  animationVariant?: AnimationVariant | undefined;
  children: ReactNode;
  initialFrame: SanctuaryFrameState;
  testId?: string | undefined;
}) {
  const [frame, setFrame] = useState(initialFrame);
  return (
    <SanctuaryFrameContext.Provider value={setFrame}>
      <MysticSanctuaryScene
        animationVariant={animationVariant}
        backdrop={frame.backdrop}
        focusStage={frame.focusStage}
        phase={frame.phase}
        reducedMotion={frame.reducedMotion}
        testId={testId}
      >
        {children}
      </MysticSanctuaryScene>
    </SanctuaryFrameContext.Provider>
  );
}

/** Renders a scene inside the nearest frame host when there is one, or as its
 * own sanctuary otherwise. Frame attributes are applied before paint. */
export function SanctuaryFrame({
  animationVariant,
  backdrop,
  children,
  focusStage,
  phase,
  reducedMotion,
  testId,
}: SanctuaryFrameState & {
  animationVariant?: AnimationVariant | undefined;
  children: ReactNode;
  testId?: string | undefined;
}) {
  const setFrame = useContext(SanctuaryFrameContext);
  useLayoutEffect(() => {
    setFrame?.({ backdrop, focusStage, phase, reducedMotion });
  }, [backdrop, focusStage, phase, reducedMotion, setFrame]);
  if (setFrame) return <>{children}</>;
  return (
    <MysticSanctuaryScene
      animationVariant={animationVariant}
      backdrop={backdrop}
      focusStage={focusStage}
      phase={phase}
      reducedMotion={reducedMotion}
      testId={testId}
    >
      {children}
    </MysticSanctuaryScene>
  );
}

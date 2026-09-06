"use client";

import { MotionConfig, motion, useMotionValue, useSpring } from "motion/react";
import { useEffect, useRef, type ReactNode } from "react";

import { depthSpring, motionEase, motionTiming } from "@/lib/motion";
import { useMotionPreference } from "@/lib/motion-preference";

export function SiteMotion({ children }: { children: ReactNode }) {
  const { reducedMotion } = useMotionPreference();
  useEffect(() => {
    document.documentElement.dataset.motion = reducedMotion ? "reduced" : "full";
  }, [reducedMotion]);
  useEffect(() => {
    const update = () => {
      document.documentElement.dataset.pageVisibility = document.hidden ? "hidden" : "visible";
    };
    update();
    document.addEventListener("visibilitychange", update);
    return () => document.removeEventListener("visibilitychange", update);
  }, []);
  return <MotionConfig reducedMotion={reducedMotion ? "always" : "never"}>{children}</MotionConfig>;
}

export function MotionToggle() {
  const { reducedMotion, systemReducedMotion, setReducedMotion } = useMotionPreference();
  return (
    <button
      aria-label="Reduce motion across StarGuidance"
      aria-pressed={reducedMotion}
      className="site-motion-toggle"
      disabled={systemReducedMotion}
      onClick={() => setReducedMotion(!reducedMotion)}
      type="button"
    >
      <span aria-hidden="true">◌</span>
      {systemReducedMotion
        ? "Motion reduced · device setting"
        : reducedMotion
          ? "Motion reduced"
          : "Reduce motion"}
    </button>
  );
}

/** Progressive enhancement: readable in server HTML, without JS, and in print.
 * No hidden queue, scroll handler, replay on back-scroll, or text splitting. */
export function MotionReveal({
  children,
  className,
  delay = 0,
}: {
  children: ReactNode;
  className?: string;
  delay?: number;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const seen = useRef(false);
  const { reducedMotion } = useMotionPreference();
  useEffect(() => {
    const element = ref.current;
    if (!element || reducedMotion || seen.current || !window.IntersectionObserver) return;
    let animation: Animation | undefined;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (!entry?.isIntersecting) return;
        seen.current = true;
        observer.disconnect();
        animation = element.animate(
          [
            { opacity: 0.3, transform: "translateY(12px)" },
            { opacity: 1, transform: "none" },
          ],
          {
            id: "sg-section-reveal",
            duration: motionTiming.reveal,
            delay: Math.min(delay, 160),
            easing: `cubic-bezier(${motionEase.settle.join(",")})`,
            // Leave content visible during the small stagger and after completion.
            fill: "none",
          },
        );
      },
      { threshold: 0.12 },
    );
    observer.observe(element);
    const cancel = () => animation?.cancel();
    // Keyboard navigation must never wait for a visual reveal.
    element.addEventListener("focusin", cancel);
    window.addEventListener("beforeprint", cancel);
    return () => {
      observer.disconnect();
      cancel();
      element.removeEventListener("focusin", cancel);
      window.removeEventListener("beforeprint", cancel);
    };
  }, [delay, reducedMotion]);
  return (
    <div className={className} data-motion-reveal="" ref={ref}>
      {children}
    </div>
  );
}

/** Only decorative artwork responds to a fine pointer. Targets and text stay still. */
export function HeroDepth({ children }: { children: ReactNode }) {
  const { reducedMotion } = useMotionPreference();
  const x = useMotionValue(0);
  const y = useMotionValue(0);
  const rotateX = useSpring(x, depthSpring);
  const rotateY = useSpring(y, depthSpring);
  useEffect(() => {
    if (reducedMotion) {
      x.jump(0);
      y.jump(0);
      rotateX.jump(0);
      rotateY.jump(0);
    }
  }, [reducedMotion, rotateX, rotateY, x, y]);
  return (
    <motion.div
      aria-label="A three-card reflective spread"
      className="home-oracle"
      onPointerMove={(event) => {
        if (
          reducedMotion ||
          event.pointerType !== "mouse" ||
          !window.matchMedia("(hover: hover) and (pointer: fine)").matches
        )
          return;
        const bounds = event.currentTarget.getBoundingClientRect();
        x.set(Math.max(-2, Math.min(2, (0.5 - (event.clientY - bounds.top) / bounds.height) * 4)));
        y.set(Math.max(-3, Math.min(3, ((event.clientX - bounds.left) / bounds.width - 0.5) * 6)));
      }}
      onPointerLeave={() => {
        x.set(0);
        y.set(0);
      }}
      style={{ rotateX, rotateY, transformPerspective: 1000 }}
    >
      {children}
    </motion.div>
  );
}

/** Shared choreography, in milliseconds. CSS receives these same values at the root. */
export const motionTiming = {
  feedback: 160,
  arrival: 320,
  reveal: 560,
  cardTravel: 620,
  cardFlip: 720,
  dealInterval: 420,
  dealSettle: 620,
  readyPause: 480,
  /** The deck rests as one pile before the wash scatters it. */
  washHold: 320,
  /** One wash pass: scatter across three planar destinations, then re-stack. */
  wash: 3000,
  /** Each of the 78 wash shells leaves the pile this much after the last. */
  washStagger: 12,
  /** The re-stacked pile settles before it travels. */
  stack: 240,
  /** In quiet mode the pile rests, unanimated, long enough to read the
   * status and stir. */
  quietWashHold: 1800,
  /** The pile slides from center to the lower-left corner. */
  gather: 700,
  fan: 960,
  fanStagger: 2,
  /** A picked card lifts out of the arch, then slides into its spread slot. */
  pickFlight: 900,
} as const;

export const motionEase = {
  settle: [0.22, 1, 0.36, 1],
  travel: [0.4, 0, 0.2, 1],
} as const;

export const depthSpring = { stiffness: 110, damping: 24, mass: 0.8 } as const;

/**
 * WebKit's Linux compositor (WPE and WebKitGTK: GNOME Web, and the WebKit that
 * Playwright runs) can crash or stall its compositing thread when an animated
 * `filter` on the full-screen atmosphere finishes while the 78-card fan is
 * composited. Safari on macOS and iOS composites differently and never reports
 * a Linux platform, even though Playwright's WebKit borrows Safari's user agent.
 */
export function usesLinuxWebKitCompositor(
  browser: Pick<Navigator, "platform" | "vendor">,
): boolean {
  return browser.vendor === "Apple Computer, Inc." && /^linux\b/i.test(browser.platform);
}

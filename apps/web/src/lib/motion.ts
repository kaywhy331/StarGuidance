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
  /** In quiet mode the pile rests, unanimated, long enough to be stirred. */
  quietWashHold: 900,
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

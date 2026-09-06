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
  fan: 960,
  fanStagger: 2,
} as const;

export const motionEase = {
  settle: [0.22, 1, 0.36, 1],
  travel: [0.4, 0, 0.2, 1],
} as const;

export const depthSpring = { stiffness: 110, damping: 24, mass: 0.8 } as const;

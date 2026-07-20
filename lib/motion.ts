export const motionTransition = {
  fast: { duration: 0.14, ease: [0.2, 0, 0, 1] },
  enter: { duration: 0.22, ease: [0.16, 1, 0.3, 1] },
  exit: { duration: 0.14, ease: [0.4, 0, 1, 1] },
  layout: { type: "spring", stiffness: 420, damping: 38, mass: 0.8 },
} as const

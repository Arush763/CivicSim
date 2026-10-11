import { Easing } from 'react-native-reanimated';

/**
 * The CivicSim Mobile design's motion, as its CSS has it, so the app moves the way the design does:
 * quick ease-outs that settle without wobbling, and a small overshoot only where something pops in.
 */
export const ease = {
  /** Entrances, sheets, fills: cubic-bezier(.16,1,.3,1) (expo-out). */
  out: Easing.bezier(0.16, 1, 0.3, 1),
  /** Things that pop in (badges, ticks): cubic-bezier(.34,1.56,.64,1). */
  pop: Easing.bezier(0.34, 1.56, 0.64, 1),
  /** Segmented thumbs and indicators: cubic-bezier(.34,1.3,.64,1). */
  seg: Easing.bezier(0.34, 1.3, 0.64, 1),
  /** Press-down: cubic-bezier(.2,.8,.2,1). */
  press: Easing.bezier(0.2, 0.8, 0.2, 1),
};

/** Durations from the design (ms). */
export const dur = { press: 180, release: 220, up: 650, drop: 600, pop: 550, seg: 450, sheet: 550, fill: 1400 };

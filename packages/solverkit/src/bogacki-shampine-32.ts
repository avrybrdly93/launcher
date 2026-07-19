import { EmbeddedRKStepper, type EmbeddedButcherTableau } from "./embedded-rk-kernel.js";
import type { Stepper, StepperInfo } from "./types.js";

/**
 * Bogacki-Shampine RK3(2) (§4.5): 4 stages, FSAL, effectively 3
 * evaluations/step -- the platform's default for loose-tolerance
 * interactive use. `b` (order 3) is exactly `a`'s 4th row (`a[3]`) with a
 * trailing 0, the same FSAL structural property DOPRI5's tableau has
 * (P2.24): $c_4=1$ makes stage 4 evaluate $f$ at exactly $(t+h, \mathbf
 * y_{k+1})$, reusable as the next step's stage 0.
 */
export const BS32_TABLEAU: EmbeddedButcherTableau = {
  c: [0, 1 / 2, 3 / 4, 1],
  a: [[], [1 / 2], [0, 3 / 4], [2 / 9, 1 / 3, 4 / 9]],
  b: [2 / 9, 1 / 3, 4 / 9, 0],
  bHat: [7 / 24, 1 / 4, 1 / 3, 1 / 8],
  embeddedOrder: 2,
};

/** {@link BS32_TABLEAU}'s stable metadata (§5.1). */
export const BS32_INFO: StepperInfo = {
  id: "bogacki-shampine-32",
  order: 3,
  embeddedOrder: 2,
  fsal: true,
  symplectic: false,
};

/** Builds a fresh {@link EmbeddedRKStepper} wired with {@link BS32_TABLEAU} (P2.25). */
export function createBogackiShampine32Stepper(): Stepper {
  return new EmbeddedRKStepper(BS32_INFO, BS32_TABLEAU);
}

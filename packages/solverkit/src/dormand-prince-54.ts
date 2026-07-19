import { EmbeddedRKStepper, type EmbeddedButcherTableau } from "./embedded-rk-kernel.js";
import type { Stepper, StepperInfo } from "./types.js";

/**
 * Dormand-Prince RK5(4)7M (§4.5): the platform's reference production
 * solver, 7 stages, FSAL (P2.24). `b` (order 5) advances the accepted
 * solution; `bHat` (order 4) is the embedded estimate used for error
 * control (P2.26/27). `b` is *exactly* `a`'s 7th row (all zero-indexed:
 * `a[6]`) with a trailing 0 -- the defining FSAL property, since $c_7=1$
 * makes stage 7 evaluate $f$ at exactly $(t+h, \mathbf y_{k+1})$, the same
 * point stage 0 of the *next* step would evaluate at.
 */
export const DOPRI5_TABLEAU: EmbeddedButcherTableau = {
  c: [0, 1 / 5, 3 / 10, 4 / 5, 8 / 9, 1, 1],
  a: [
    [],
    [1 / 5],
    [3 / 40, 9 / 40],
    [44 / 45, -56 / 15, 32 / 9],
    [19372 / 6561, -25360 / 2187, 64448 / 6561, -212 / 729],
    [9017 / 3168, -355 / 33, 46732 / 5247, 49 / 176, -5103 / 18656],
    [35 / 384, 0, 500 / 1113, 125 / 192, -2187 / 6784, 11 / 84],
  ],
  b: [35 / 384, 0, 500 / 1113, 125 / 192, -2187 / 6784, 11 / 84, 0],
  bHat: [5179 / 57600, 0, 7571 / 16695, 393 / 640, -92097 / 339200, 187 / 2100, 1 / 40],
  embeddedOrder: 4,
};

/** {@link DOPRI5_TABLEAU}'s stable metadata (§5.1). Dense output (`denseOrder`) is P2.30's job. */
export const DOPRI5_INFO: StepperInfo = {
  id: "dopri5",
  order: 5,
  embeddedOrder: 4,
  fsal: true,
  symplectic: false,
};

/** Builds a fresh {@link EmbeddedRKStepper} wired with {@link DOPRI5_TABLEAU} (P2.24). */
export function createDormandPrince54Stepper(): Stepper {
  return new EmbeddedRKStepper(DOPRI5_INFO, DOPRI5_TABLEAU);
}
